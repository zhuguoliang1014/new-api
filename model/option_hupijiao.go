package model

// Hupijiao option-bag plumbing — local fork addition. Keeps the OptionMap
// seed/load/migration glue out of the long switch statements in option.go.

import (
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting"
)

// SeedHupijiaoOptions populates common.OptionMap with Hupijiao defaults.
// Called once during InitOptionMap.
func SeedHupijiaoOptions() {
	common.OptionMap["HupijiaoEnabled"] = strconv.FormatBool(setting.HupijiaoEnabled)
	common.OptionMap["HupijiaoAppId"] = setting.HupijiaoAppId
	common.OptionMap["HupijiaoAppSecret"] = setting.HupijiaoAppSecret
	common.OptionMap["HupijiaoApiUrl"] = setting.HupijiaoApiUrl
	common.OptionMap["HupijiaoNotifyUrl"] = setting.HupijiaoNotifyUrl
	common.OptionMap["HupijiaoReturnUrl"] = setting.HupijiaoReturnUrl
	common.OptionMap["HupijiaoMinTopUp"] = strconv.Itoa(setting.HupijiaoMinTopUp)
	common.OptionMap["HupijiaoPrice"] = strconv.FormatFloat(setting.HupijiaoPrice, 'f', -1, 64)
	common.OptionMap["HupijiaoAmountOptions"] = setting.HupijiaoAmountOptions
	common.OptionMap["HupijiaoAmountDiscount"] = setting.HupijiaoAmountDiscount
	common.OptionMap["HupijiaoInviteRewardRatio"] = strconv.FormatFloat(setting.HupijiaoInviteRewardRatio, 'f', -1, 64)
}

// RunHupijiaoMigrations runs Hupijiao-specific data migrations after options
// load. Called once at the end of loadOptionsFromDatabase.
func RunHupijiaoMigrations(loadedKeys map[string]struct{}) {
	migrateHupijiaoPricingFromLegacyIfNeeded(loadedKeys)
	migrateHupijiaoTopupAmountToUsdCentsIfNeeded(loadedKeys)
}

// UpdateHupijiaoOption applies a Hupijiao option write into the in-memory
// setting struct. Returns true when the key matched a Hupijiao option.
func UpdateHupijiaoOption(key, value string) bool {
	switch key {
	case "HupijiaoEnabled":
		setting.HupijiaoEnabled = value == "true"
	case "HupijiaoAppId":
		setting.HupijiaoAppId = value
	case "HupijiaoAppSecret":
		setting.HupijiaoAppSecret = value
	case "HupijiaoApiUrl":
		setting.HupijiaoApiUrl = value
	case "HupijiaoNotifyUrl":
		setting.HupijiaoNotifyUrl = value
	case "HupijiaoReturnUrl":
		setting.HupijiaoReturnUrl = value
	case "HupijiaoMinTopUp":
		setting.HupijiaoMinTopUp, _ = strconv.Atoi(value)
	case "HupijiaoPrice":
		setting.HupijiaoPrice, _ = strconv.ParseFloat(value, 64)
	case "HupijiaoAmountOptions":
		setting.HupijiaoAmountOptions = value
	case "HupijiaoAmountDiscount":
		setting.HupijiaoAmountDiscount = value
	case "HupijiaoInviteRewardRatio":
		setting.HupijiaoInviteRewardRatio, _ = strconv.ParseFloat(value, 64)
	default:
		return false
	}
	return true
}
