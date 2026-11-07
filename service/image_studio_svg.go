package service

import (
	"bytes"
	"encoding/xml"
	"errors"
	"io"
	"math"
	"regexp"
	"strconv"
	"strings"
)

const studioSVGContentType = "image/svg+xml"
const studioMaxSVGBytes = 16 << 20

var studioSVGElements = strings.Fields("svg g defs symbol use path rect circle ellipse line polyline polygon text tspan textPath linearGradient radialGradient stop pattern clipPath mask filter feBlend feColorMatrix feComponentTransfer feComposite feConvolveMatrix feDiffuseLighting feDisplacementMap feDistantLight feDropShadow feFlood feFuncA feFuncB feFuncG feFuncR feGaussianBlur feImage feMerge feMergeNode feMorphology feOffset fePointLight feSpecularLighting feSpotLight feTile feTurbulence image style title desc marker switch view a")
var studioSVGURL = regexp.MustCompile(`(?i)url\s*\(\s*['"]?([^)'"\s]+)['"]?\s*\)`)
var studioSVGCSSComment = regexp.MustCompile(`(?s)/\*.*?\*/`)

// SVGs stay as vector originals. Validate a passive, self-contained document
// instead of decoding it as a raster or executing it in a document context.
func prepareStudioSVG(source io.Reader) (StudioTaskImage, error) {
	data, err := io.ReadAll(io.LimitReader(source, studioMaxSVGBytes+1))
	if err != nil {
		return StudioTaskImage{}, err
	}
	if len(data) > studioMaxSVGBytes {
		return StudioTaskImage{}, errors.New("SVG exceeds storage limit")
	}
	data = bytes.TrimPrefix(data, []byte{0xef, 0xbb, 0xbf})
	decoder := xml.NewDecoder(bytes.NewReader(data))
	depth, roots, tokens := 0, 0, 0
	var root xml.StartElement
	inStyle := false
	var css strings.Builder
	for {
		token, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return StudioTaskImage{}, err
		}
		tokens++
		if tokens > 200000 {
			return StudioTaskImage{}, errors.New("SVG is too complex")
		}
		switch element := token.(type) {
		case xml.StartElement:
			if depth == 0 {
				roots++
				root = element
				if roots != 1 || element.Name.Local != "svg" || element.Name.Space != "http://www.w3.org/2000/svg" {
					return StudioTaskImage{}, errors.New("invalid SVG root")
				}
			}
			depth++
			if depth > 128 {
				return StudioTaskImage{}, errors.New("SVG is too deeply nested")
			}
			allowed := false
			for _, name := range studioSVGElements {
				if element.Name.Local == name {
					allowed = true
					break
				}
			}
			if !allowed || element.Name.Space != "http://www.w3.org/2000/svg" {
				return StudioTaskImage{}, errors.New("unsupported SVG element")
			}
			if err := validateStudioSVGAttributes(element); err != nil {
				return StudioTaskImage{}, err
			}
			if element.Name.Local == "style" {
				inStyle = true
				css.Reset()
			}
		case xml.EndElement:
			if element.Name.Local == "style" {
				if !studioSVGLocalCSS(css.String()) {
					return StudioTaskImage{}, errors.New("SVG styles must be self-contained")
				}
				inStyle = false
			}
			depth--
		case xml.CharData:
			if depth == 0 && strings.TrimSpace(string(element)) != "" {
				return StudioTaskImage{}, errors.New("invalid SVG content")
			}
			if inStyle {
				css.Write(element)
			}
		case xml.Directive:
			return StudioTaskImage{}, errors.New("SVG document directives are not supported")
		case xml.ProcInst:
			if element.Target != "xml" || roots != 0 {
				return StudioTaskImage{}, errors.New("SVG processing instructions are not supported")
			}
		}
	}
	if roots != 1 || depth != 0 {
		return StudioTaskImage{}, errors.New("invalid SVG document")
	}
	width, height, err := studioSVGDimensions(root)
	if err != nil {
		return StudioTaskImage{}, err
	}
	return StudioTaskImage{Width: width, Height: height, ContentType: studioSVGContentType}, nil
}

func validateStudioSVGAttributes(element xml.StartElement) error {
	for _, attr := range element.Attr {
		name := strings.ToLower(attr.Name.Local)
		if strings.HasPrefix(name, "on") || name == "src" || name == "base" {
			return errors.New("active SVG attributes are not supported")
		}
		if attr.Name.Space != "" && attr.Name.Space != "xmlns" && attr.Name.Space != "http://www.w3.org/1999/xlink" && attr.Name.Space != "http://www.w3.org/XML/1998/namespace" {
			return errors.New("unsupported SVG attribute namespace")
		}
		if name == "href" {
			value := strings.TrimSpace(attr.Value)
			local := strings.HasPrefix(value, "#")
			raster := false
			if element.Name.Local == "image" || element.Name.Local == "feImage" {
				for _, prefix := range []string{"data:image/png;base64,", "data:image/jpeg;base64,", "data:image/webp;base64,", "data:image/gif;base64,"} {
					raster = raster || strings.HasPrefix(value, prefix)
				}
			}
			if !local && !raster {
				return errors.New("SVG references must be local")
			}
		} else if !studioSVGLocalCSS(attr.Value) {
			return errors.New("SVG styles must be self-contained")
		}
	}
	return nil
}

func studioSVGLocalCSS(value string) bool {
	// Escapes and at-rules can conceal network references. Ordinary generated
	// SVG styles need neither; same-document paint/filter URLs remain supported.
	value = studioSVGCSSComment.ReplaceAllString(value, "")
	if strings.ContainsAny(value, `\@`) {
		return false
	}
	for _, match := range studioSVGURL.FindAllStringSubmatch(value, -1) {
		if !strings.HasPrefix(match[1], "#") {
			return false
		}
	}
	// Reject malformed url() constructs as well as legacy expression syntax.
	remaining := studioSVGURL.ReplaceAllString(strings.ToLower(value), "")
	return !strings.Contains(remaining, "url(") && !strings.Contains(remaining, "expression(")
}

func studioSVGDimensions(root xml.StartElement) (int, int, error) {
	var width, height float64
	var viewBox []float64
	for _, attr := range root.Attr {
		if attr.Name.Local == "viewBox" {
			parts := strings.Fields(strings.ReplaceAll(attr.Value, ",", " "))
			if len(parts) != 4 {
				return 0, 0, errors.New("invalid SVG viewBox")
			}
			for _, part := range parts {
				n, err := strconv.ParseFloat(part, 64)
				if err != nil || math.IsNaN(n) || math.IsInf(n, 0) {
					return 0, 0, errors.New("invalid SVG viewBox")
				}
				viewBox = append(viewBox, n)
			}
			if viewBox[2] <= 0 || viewBox[3] <= 0 {
				return 0, 0, errors.New("invalid SVG viewBox")
			}
		}
		if attr.Name.Local == "width" || attr.Name.Local == "height" {
			value := strings.TrimSpace(attr.Value)
			if strings.HasSuffix(value, "%") {
				continue
			}
			n, err := strconv.ParseFloat(strings.TrimSuffix(value, "px"), 64)
			if err != nil || math.IsNaN(n) || math.IsInf(n, 0) || n <= 0 {
				return 0, 0, errors.New("invalid SVG dimensions")
			}
			if attr.Name.Local == "width" {
				width = n
			} else {
				height = n
			}
		}
	}
	if len(viewBox) == 4 {
		if width == 0 && height == 0 {
			width, height = viewBox[2], viewBox[3]
		} else if width == 0 {
			width = height * viewBox[2] / viewBox[3]
		} else if height == 0 {
			height = width * viewBox[3] / viewBox[2]
		}
	}
	if width <= 0 || height <= 0 || width > 8192 || height > 8192 || math.Ceil(width)*math.Ceil(height) > 67108864 {
		return 0, 0, errors.New("invalid SVG dimensions")
	}
	return int(math.Ceil(width)), int(math.Ceil(height)), nil
}
