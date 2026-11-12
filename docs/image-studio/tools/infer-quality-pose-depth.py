"""Quality-first pose depth pilot with the full DA3 Nested Giant-Large 1.1 checkpoint.
No image-generation API is called. Each source view is estimated independently.
Run with the official Depth Anything 3 source on PYTHONPATH.
"""
import argparse,contextlib,gc,hashlib,json,time
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw,ImageFilter,ImageOps
import torch
from unittest.mock import patch
from omegaconf import OmegaConf
from safetensors.torch import load_file
from depth_anything_3.cfg import create_object
from depth_anything_3.utils.io.input_processor import InputProcessor

MODEL='depth-anything/DA3NESTED-GIANT-LARGE-1.1'
REVISION='b2359bdf726fb44ef62acca04d629dcf158053e7'
p=argparse.ArgumentParser()
p.add_argument('--model-dir',type=Path,required=True)
p.add_argument('--input-dir',type=Path,required=True)
p.add_argument('--output-dir',type=Path,required=True)
p.add_argument('--device',choices=['mps','cpu','cuda'],default='cpu')
p.add_argument('--process-res',type=int,default=1008)
p.add_argument('files',nargs='+')
args=p.parse_args();args.output_dir.mkdir(parents=True,exist_ok=True)
if args.process_res % 14:raise ValueError('Resolution must be divisible by 14')
meta=json.loads((args.model_dir/'config.json').read_text())
if meta['model_name']!='da3nested-giant-large':raise ValueError('Incorrect model architecture')
weights=args.model_dir/'model.safetensors'
expected='8ebe871a022ed58d2fc8fdfb2ebdb31d57b60fe39611c849095851a7b7c6020c'
print('Verifying full checkpoint',flush=True)
with weights.open('rb') as source:actual=hashlib.file_digest(source,'sha256').hexdigest()
if actual!=expected:raise ValueError('Checkpoint integrity failed')
torch.set_num_threads(4)
torch.manual_seed(0)
# Upstream architecture performs a scalar CPU linspace during construction.
# A CPU device argument there is required if constructing on meta to avoid duplicate weights.
original_linspace=torch.linspace
def cpu_linspace(*values,**kwargs):
 kwargs.setdefault('device','cpu')
 return original_linspace(*values,**kwargs)
with patch('torch.linspace',cpu_linspace),torch.device('meta'):
 model=create_object(OmegaConf.create(meta['config']))
state=load_file(str(weights),device='cpu')
state={key.removeprefix('model.'):value for key,value in state.items()}
# Safetensors omits aliases for LayerNorm shared by all four auxiliary levels.
for level in range(1,4):
 for suffix in ('weight','bias'):
  alias=f'da3.head.scratch.output_conv2_aux.{level}.2.{suffix}'
  original=f'da3.head.scratch.output_conv2_aux.0.2.{suffix}'
  if alias not in state:
   if model.get_parameter(alias) is not model.get_parameter(original):raise ValueError('Unexpected checkpoint omission')
   state[alias]=state[original]
model.load_state_dict(state,strict=True,assign=True)
if any(value.is_meta for value in model.parameters()):raise ValueError('Uninitialized model parameter')
del state;gc.collect()
# This deterministic nonpersistent buffer is not present in the checkpoint.
adapter=model.da3.gs_adapter
if adapter is not None and not adapter.pred_color:
 adapter.sh_mask=torch.ones(adapter.d_sh,dtype=torch.float32,device='cpu')
 for degree in range(1,adapter.sh_degree+1):
  adapter.sh_mask[degree**2:(degree+1)**2]=.1*.25**degree
if any(value.is_meta for value in model.buffers()):raise ValueError('Uninitialized model buffer')
print('Full non-quantized checkpoint loaded; parameters',sum(x.numel() for x in model.parameters()),flush=True)
model.eval().requires_grad_(False).to(args.device)
processor=InputProcessor();results=[]
for file in args.files:
 if Path(file).name!=file or not file.endswith('.png'):raise ValueError('Use plain source PNG filenames')
 source=args.input_dir/file;raw=source.read_bytes();image=ImageOps.exif_transpose(Image.open(source)).convert('RGB')
 tensor,_,_=processor([image],process_res=args.process_res,process_res_method='upper_bound_resize',num_workers=1)
 if tensor.ndim==4:tensor=tensor.unsqueeze(0)
 tensor=tensor.to(args.device)
 start=time.time();print('Inferring',file,'shape',tuple(tensor.shape),flush=True)
 # Match the official mixed-precision backbone path. Depth heads remain FP32.
 autocast=torch.autocast(device_type=args.device,dtype=torch.float16,cache_enabled=False) if args.device!='cpu' else contextlib.nullcontext()
 with torch.inference_mode(),autocast:
  prediction=model(tensor,infer_gs=False,use_ray_pose=False)
 if args.device=='mps':torch.mps.synchronize()
 native=prediction.depth.detach().float().cpu()
 if not torch.isfinite(native).all() or native.min()<=0:raise ValueError('Invalid positive depth estimate')
 depth=torch.nn.functional.interpolate(native.reshape(1,1,*native.shape[-2:]),size=(image.height,image.width),mode='bicubic',align_corners=False)[0,0].numpy()
 if not np.isfinite(depth).all() or depth.min()<=0:raise ValueError('Invalid resized depth estimate')
 np.save(args.output_dir/(source.stem+'-estimated-depth.npy'),depth)
 # Nearer is brighter for a conventional depth-reference image.
 inverse=1.0/np.maximum(depth,1e-6)
 lo,hi=np.percentile(inverse,[1,99]);normalized=np.clip((inverse-lo)/max(float(hi-lo),1e-8),0,1)
 Image.fromarray(np.round(normalized*255).astype(np.uint8)).save(args.output_dir/(source.stem+'-raw-depth.png'))
 ink=Image.fromarray(np.where(np.asarray(image.convert('L'))<225,255,0).astype(np.uint8)).filter(ImageFilter.MaxFilter(3))
 paper=ImageOps.expand(ImageOps.invert(ink),border=1,fill=255);ImageDraw.floodfill(paper,(0,0),128)
 mask=np.asarray(paper.crop((1,1,image.width+1,image.height+1)))!=128
 fraction=float(mask.mean())
 if not .02<fraction<.8:raise ValueError('Unreliable silhouette; inspect source')
 lo,hi=np.percentile(inverse[mask],[1,99]);normalized=.15+.85*np.clip((inverse-lo)/max(float(hi-lo),1e-8),0,1)
 alpha=np.asarray(Image.fromarray(np.uint8(mask)*255).filter(ImageFilter.GaussianBlur(.6)))/255.0
 gray=Image.fromarray(np.round(normalized*alpha*255).astype(np.uint8))
 output=args.output_dir/(source.stem+'-depth.png');gray.save(output)
 item={'source':file,'source_sha256':hashlib.sha256(raw).hexdigest(),'model':MODEL,'revision':REVISION,'device':args.device,'checkpoint_dtype':'FP32, non-quantized','backbone_autocast':'float16' if args.device!='cpu' else 'none','process_res':args.process_res,'output':output.name,'width':image.width,'height':image.height,'seconds':round(time.time()-start,3),'calibrated':False,'background_masked':True,'representation':'estimated relative inverse depth, brighter=nearer'}
 results.append(item);print(json.dumps(item),flush=True)
 (args.output_dir/'report.json').write_text(json.dumps({'model':MODEL,'revision':REVISION,'checkpoint_sha256':actual,'records':results},indent=2)+'\n')
 del prediction,tensor,native;gc.collect()
 if args.device=='mps':torch.mps.empty_cache()
print('Completed',len(results),flush=True)
