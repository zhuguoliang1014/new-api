package service

import (
	"errors"
	"net/url"
	"unicode/utf8"
)

// StudioMJOptions are the documented creative controls for the stable MJ route.
// Price-changing quality and HD fields are deliberately outside this contract.
// Pointers preserve an explicitly selected zero or false when relaying upstream.
type StudioMJOptions struct {
	Raw             *bool    `json:"raw,omitempty"`
	Tile            *bool    `json:"tile,omitempty"`
	NegativePrompt  *string  `json:"negative_prompt,omitempty"`
	Seed            *int64   `json:"seed,omitempty"`
	Stylize         *int     `json:"stylize,omitempty"`
	Chaos           *int     `json:"chaos,omitempty"`
	Weird           *int     `json:"weird,omitempty"`
	ImageWeight     *float64 `json:"iw,omitempty"`
	CharacterRef    *string  `json:"cref,omitempty"`
	CharacterWeight *int     `json:"cw,omitempty"`
	StyleRef        *string  `json:"sref,omitempty"`
	StyleWeight     *int     `json:"sw,omitempty"`
	DepthRef        *string  `json:"dref,omitempty"`
	DepthWeight     *float64 `json:"dw,omitempty"`
}

func (options StudioMJOptions) Validate() error {
	invalid := errors.New("invalid Midjourney controls")
	for _, bound := range []struct {
		value *int
		max   int
	}{
		{options.Stylize, 1000}, {options.Chaos, 100}, {options.Weird, 3000},
		{options.CharacterWeight, 100}, {options.StyleWeight, 1000},
	} {
		if bound.value != nil && (*bound.value < 0 || *bound.value > bound.max) {
			return invalid
		}
	}
	for _, bound := range []struct {
		value *float64
		max   float64
	}{
		{options.ImageWeight, 3}, {options.DepthWeight, 100},
	} {
		if bound.value != nil && (*bound.value < 0 || *bound.value > bound.max) {
			return invalid
		}
	}
	if options.Seed != nil && (*options.Seed < 0 || *options.Seed > 4294967295) {
		return invalid
	}
	if options.NegativePrompt != nil && utf8.RuneCountInString(*options.NegativePrompt) > 4000 {
		return invalid
	}
	for _, source := range []*string{options.CharacterRef, options.StyleRef, options.DepthRef} {
		if source == nil {
			continue
		}
		parsed, err := url.Parse(*source)
		if err != nil || len(*source) > 8192 || parsed.Hostname() == "" || parsed.User != nil || (parsed.Scheme != "https" && parsed.Scheme != "http") {
			return invalid
		}
	}
	if options.CharacterWeight != nil && options.CharacterRef == nil || options.StyleWeight != nil && options.StyleRef == nil || options.DepthWeight != nil && options.DepthRef == nil {
		return invalid
	}
	return nil
}
