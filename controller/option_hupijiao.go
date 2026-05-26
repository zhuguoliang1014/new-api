package controller

// Hupijiao option validation — local fork addition. Keeps the validator out
// of controller/option.go so upstream merges only touch the dispatch case.

import (
	"errors"
	"math"
	"strconv"
)

// ValidateHupijiaoOption returns nil if the (key, value) pair represents a
// well-formed Hupijiao option, or a user-facing error message otherwise.
// Only handles keys that need cross-field/range validation; simple string
// options pass through untouched.
func ValidateHupijiaoOption(key, value string) error {
	switch key {
	case "HupijiaoInviteRewardRatio":
		ratio, parseErr := strconv.ParseFloat(value, 64)
		if parseErr != nil || math.IsNaN(ratio) || math.IsInf(ratio, 0) || ratio < 0 || ratio > 1 {
			return errors.New("邀请奖励比例必须在 0 到 1 之间")
		}
	}
	return nil
}
