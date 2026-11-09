"""Run full FP32 Depth Anything V2 Large on local pose reference PNGs."""
import argparse
import gc
import hashlib
import json
import time
from pathlib import Path

import numpy as np
import cv2
import torch
from PIL import Image, ImageFilter, ImageOps
from transformers import AutoImageProcessor, AutoModelForDepthEstimation

MODEL = 'depth-anything/Depth-Anything-V2-Large-hf'
REVISION = '7581137eff8d4e94f6e796d3baea0e9fa79b22d2'
CHECKSUM = '4e01e34ed5549b529b70b92d53226bc370f03041977b390d3dde45d47f516cf9'


def make_reference(image, depth, max_gap_fraction=.2, complete_open_contours=False):
    """Remove paper background and conservatively clear model-confirmed enclosed gaps.

    This cleanup is specific to closed-contour black-on-white pose drawings.
    It does not reconstruct geometry. Inspect every pilot result before batch use.
    """
    ink = Image.fromarray(np.uint8(np.asarray(image.convert('L')) < 225) * 255)
    ink = ink.filter(ImageFilter.MaxFilter(3))
    if complete_open_contours:
        # Close only the lower crop of an open half-body drawing, using its own
        # visible strokes. This does not fill the hull around arms or invent depth.
        ink_pixels = np.asarray(ink).copy()
        ys, xs = np.where(ink_pixels > 0)
        if not len(ys):
            raise ValueError('No figure contour')
        lower = ys >= ys.max() - round(image.height * .075)
        points = np.stack([xs[lower], ys[lower]], axis=1).astype(np.int32)
        cv2.fillConvexPoly(ink_pixels, cv2.convexHull(points), 255)
        ink = Image.fromarray(ink_pixels)
    paper = ImageOps.expand(ImageOps.invert(ink), border=1, fill=255)
    paper = np.asarray(paper).copy()
    cv2.floodFill(paper, None, (0, 0), 128, flags=4)
    mask = paper[1:-1, 1:-1] != 128
    if not .02 < mask.mean() < .85:
        raise ValueError('Unreliable silhouette; inspect source')
    count, labels, stats, _ = cv2.connectedComponentsWithStats(
        np.uint8(np.asarray(ink) == 0), 8
    )
    gaps = np.zeros(mask.shape, dtype=bool)
    threshold = float(np.median(depth[mask])) * .35
    for label in range(1, count):
        if stats[label, cv2.CC_STAT_AREA] < 64:
            continue
        x, y, width, height = stats[label, :4]
        area = np.s_[y:y + height, x:x + width]
        region = (labels[area] == label) & mask[area]
        if region.sum() >= 64 and np.percentile(depth[area][region], 90) < threshold:
            gaps[area] |= region
    gap_pixels = int(gaps.sum())
    if gap_pixels > int(mask.sum()) * max_gap_fraction:
        raise ValueError('Too many enclosed gaps; inspect source')
    gaps = np.asarray(Image.fromarray(np.uint8(gaps) * 255).filter(
        ImageFilter.MaxFilter(3))) > 0
    mask &= ~gaps
    low, high = np.percentile(depth[mask], [1, 99])
    value = .15 + .85 * np.clip((depth - low) / max(float(high - low), 1e-8), 0, 1)
    alpha = np.asarray(Image.fromarray(np.uint8(mask) * 255).filter(
        ImageFilter.GaussianBlur(.6))) / 255
    return Image.fromarray(np.uint8(np.round(value * alpha * 255))), gap_pixels


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model-dir', type=Path, required=True)
    parser.add_argument('--input-dir', type=Path, required=True)
    parser.add_argument('--output-dir', type=Path, required=True)
    parser.add_argument('--process-res', type=int, default=1008)
    parser.add_argument('--device', choices=['cpu', 'mps', 'cuda'], default='cpu')
    parser.add_argument('--max-gap-fraction', type=float, default=.2,
                        help='Only raise above .2 after visually reviewing large enclosed paper gaps')
    parser.add_argument('--complete-open-contours', action='store_true',
                        help='Complete open half-body crop contours inside the original drawn hull')
    parser.add_argument('files', nargs='+')
    args = parser.parse_args()
    if args.process_res <= 0 or args.process_res % 14:
        parser.error('--process-res must be a positive multiple of 14')
    if not 0 < args.max_gap_fraction <= .5:
        parser.error('--max-gap-fraction must be between 0 and .5')
    args.output_dir.mkdir(parents=True, exist_ok=True)
    with (args.model_dir / 'model.safetensors').open('rb') as source:
        checksum = hashlib.file_digest(source, 'sha256').hexdigest()
    if checksum != CHECKSUM:
        raise ValueError('Checkpoint integrity failed')
    torch.set_num_threads(4)
    torch.manual_seed(0)
    processor = AutoImageProcessor.from_pretrained(
        args.model_dir, local_files_only=True, trust_remote_code=False, use_fast=False
    )
    model = AutoModelForDepthEstimation.from_pretrained(
        args.model_dir, local_files_only=True, trust_remote_code=False,
        use_safetensors=True, dtype=torch.float32
    ).eval().requires_grad_(False).to(args.device)
    backbone = model.config.backbone_config
    if backbone.hidden_size != 1024 or backbone.num_hidden_layers != 24:
        raise ValueError('Expected the full V2 Large architecture')
    print('Loaded full FP32 Large model:', sum(p.numel() for p in model.parameters()), flush=True)
    records = []
    for filename in args.files:
        if Path(filename).name != filename or not filename.endswith('.png'):
            raise ValueError('Use plain source PNG filenames')
        source = args.input_dir / filename
        image = ImageOps.exif_transpose(Image.open(source)).convert('RGB')
        scale = args.process_res / max(image.size)
        target = {'height': max(14, round(image.height * scale / 14) * 14),
                  'width': max(14, round(image.width * scale / 14) * 14)}
        inputs = processor(images=image, size=target, return_tensors='pt').to(args.device)
        started = time.time()
        print('Inferring', filename, tuple(inputs.pixel_values.shape), flush=True)
        with torch.inference_mode():
            prediction = model(**inputs).predicted_depth
            depth = torch.nn.functional.interpolate(
                prediction.unsqueeze(1), size=(image.height, image.width),
                mode='bicubic', align_corners=False
            )[0, 0].float().cpu().numpy()
        if not np.isfinite(depth).all():
            raise ValueError('Non-finite depth estimate')
        np.save(args.output_dir / (source.stem + '-estimated-depth.npy'), depth)
        low, high = np.percentile(depth, [1, 99])
        if high <= low:
            raise ValueError('Constant depth estimate')
        raw = np.clip((depth - low) / (high - low), 0, 1)
        Image.fromarray(np.uint8(np.round(raw * 255))).save(
            args.output_dir / (source.stem + '-raw-depth.png')
        )
        gray, gap_pixels = make_reference(image, depth, args.max_gap_fraction, args.complete_open_contours)
        output = args.output_dir / (source.stem + '-depth.png')
        gray.save(output)
        record = {
            'source': filename, 'source_sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
            'output': output.name, 'model': MODEL, 'revision': REVISION,
            'checkpoint_dtype': 'FP32, non-quantized', 'device': args.device,
            'process_res': args.process_res, 'input_shape': list(inputs.pixel_values.shape),
            'width': image.width, 'height': image.height,
            'seconds': round(time.time() - started, 3), 'calibrated': False,
            'background_masked': True, 'enclosed_gap_pixels_removed': gap_pixels,
            'max_gap_fraction': args.max_gap_fraction,
            'open_contours_completed': args.complete_open_contours,
            'representation': 'estimated relative inverse depth, brighter=nearer'
        }
        records.append(record)
        print(json.dumps(record), flush=True)
        (args.output_dir / 'report.json').write_text(json.dumps({
            'model': MODEL, 'revision': REVISION, 'checkpoint_sha256': checksum,
            'records': records
        }, indent=2) + '\n')
        del inputs, prediction
        gc.collect()
        if args.device == 'mps':
            torch.mps.empty_cache()
    print('Completed', len(records), flush=True)


if __name__ == '__main__':
    main()
