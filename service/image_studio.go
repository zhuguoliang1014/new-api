package service

import "strings"

const (
	ImageStudioGroup        = "画图"
	ImageStudioDefaultModel = "gpt-image-2.5-flare-basic"
)

// GIF output is a documented capability of the 2.6 route, not all GPT models.
func IsImageStudioOutputFormatSupported(model, format string) bool {
	if model == "gpt-image-2.6-basic" || model == "gpt-image-2.6" {
		return format == "" || format == "auto" || format == "png" || format == "gif"
	}
	switch format {
	case "", "png", "jpeg", "webp":
		return true
	default:
		return false
	}
}

// Legacy aliases remain available, with studio generation capped at 4K.
// Model-specific profiles retain native pixel limits; prices stay live.
type ImageStudioProfile struct {
	Group         string
	Name          string
	MaxResolution int
	SizeMode      string
	MaxEdge       int
	MaxPixels     int
	MaxCount      int
}

var ImageStudioProfiles = []ImageStudioProfile{
	{Group: "【生图】超分基础版1-4k", Name: "超分基础版", MaxResolution: 4, SizeMode: "upscale", MaxEdge: 4096, MaxPixels: 16777216},
	{Group: "【生图】超分高质量1-10k", Name: "超分高质量", MaxResolution: 4, SizeMode: "upscale", MaxEdge: 4096, MaxPixels: 16777216},
	{Group: "【生图】官逆原生1-4k", Name: "官逆原生", MaxResolution: 4, SizeMode: "native", MaxEdge: 3840, MaxPixels: 8294400},
}

func GetImageStudioProfile(group string) (ImageStudioProfile, bool) {
	if group == ImageStudioGroup {
		return ImageStudioProfile{Group: group, Name: "Image generation", MaxResolution: 4, SizeMode: "upscale", MaxEdge: 4096, MaxPixels: 16777216}, true
	}
	for _, profile := range ImageStudioProfiles {
		if profile.Group == group {
			return profile, true
		}
	}
	return ImageStudioProfile{}, false
}

// The public model alias identifies the route; channel model mappings translate
// it to the upstream ID. Capabilities must follow that alias, not the shared group.
func GetImageStudioModelProfile(group, model string) (ImageStudioProfile, bool) {
	if group != ImageStudioGroup {
		profile, ok := GetImageStudioProfile(group)
		return profile, ok && strings.HasPrefix(model, "gpt-image-")
	}
	var profile ImageStudioProfile
	switch {
	case strings.HasPrefix(model, "gpt-image-") && strings.HasSuffix(model, "-basic"):
		profile = ImageStudioProfiles[0]
	case strings.HasPrefix(model, "gpt-image-") && strings.HasSuffix(model, "-hq"):
		profile = ImageStudioProfiles[1]
	case strings.HasPrefix(model, "gpt-image-") && strings.HasSuffix(model, "-native"):
		profile = ImageStudioProfiles[2]
	case model == "gemini-2.5-flash-image":
		profile = ImageStudioProfile{MaxResolution: 1, SizeMode: "upscale", MaxEdge: 1536, MaxPixels: 2097152, MaxCount: 1}
	case strings.HasPrefix(model, "gemini-") && (strings.Contains(model, "image") || strings.Contains(model, "banana")):
		profile = ImageStudioProfile{MaxResolution: 4, SizeMode: "upscale", MaxEdge: 4096, MaxPixels: 16777216, MaxCount: 1}
	case model == "mj-v8.2":
		profile = ImageStudioProfile{SizeMode: "ratio", MaxCount: 1}
	default:
		return ImageStudioProfile{}, false
	}
	profile.Group = group
	return profile, true
}
