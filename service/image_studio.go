package service

// These are the site's three image routes, not a capability inferred from a
// billing multiplier or a model name. Prices and available models remain live.
type ImageStudioProfile struct {
	Group         string
	Name          string
	MaxResolution int
	SizeMode      string
}

// Preserve existing group identifiers, including the legacy 1-10k label.
// Larger resolutions must not be enabled without upstream verification.
var ImageStudioProfiles = []ImageStudioProfile{
	{Group: "【生图】超分基础版1-4k", Name: "超分基础版", MaxResolution: 4, SizeMode: "native"},
	{Group: "【生图】超分高质量1-10k", Name: "超分高质量", MaxResolution: 4, SizeMode: "native"},
	{Group: "【生图】官逆原生1-4k", Name: "官逆原生", MaxResolution: 4, SizeMode: "native"},
}

func GetImageStudioProfile(group string) (ImageStudioProfile, bool) {
	for _, profile := range ImageStudioProfiles {
		if profile.Group == group {
			return profile, true
		}
	}
	return ImageStudioProfile{}, false
}
