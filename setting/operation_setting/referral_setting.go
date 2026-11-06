package operation_setting

import (
	"math"
	"strconv"

	"github.com/QuantumNous/new-api/common"
)

const ReferralRewardPercentOptionKey = "ReferralRewardPercent"

func ValidateReferralRewardPercent(value string) error {
	percent, err := strconv.ParseFloat(value, 64)
	if err != nil || math.IsNaN(percent) || math.IsInf(percent, 0) || percent < 0 || percent > 100 {
		return common.NewMessage("Referral reward percentage must be between 0 and 100.")
	}
	return nil
}

func GetReferralRewardPercent() float64 {
	common.OptionMapRWMutex.RLock()
	value := common.OptionMap[ReferralRewardPercentOptionKey]
	common.OptionMapRWMutex.RUnlock()
	if ValidateReferralRewardPercent(value) != nil {
		return 0
	}
	percent, _ := strconv.ParseFloat(value, 64)
	return percent
}
