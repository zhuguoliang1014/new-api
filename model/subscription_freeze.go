package model

import (
	"errors"
	"math"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

// Official mainland China holiday breaks, including the adjusted days off.
// Ordinary weekends and makeup working days are deliberately not included.
// Update annually after the State Council publishes the next year's schedule.
// 2026: https://www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm
var subscriptionHolidayBreaks = map[int][][2]string{
	2026: {
		{"01-01", "01-03"},
		{"02-15", "02-23"},
		{"04-04", "04-06"},
		{"05-01", "05-05"},
		{"06-19", "06-21"},
		{"09-25", "09-27"},
		{"10-01", "10-07"},
	},
}

var subscriptionHolidayTimezone = time.FixedZone("Asia/Shanghai", 8*60*60)

type SubscriptionFreezePolicy struct {
	Allowed           bool   `json:"allowed"`
	CalendarAvailable bool   `json:"calendar_available"`
	Date              string `json:"date"`
	ServerTime        int64  `json:"server_time"`
}

// GetSubscriptionFreezePolicy never accepts a client date or assumes an unknown
// year's holiday dates. Missing calendars deny new freezes, but never resumes.
func GetSubscriptionFreezePolicy(now int64) SubscriptionFreezePolicy {
	day := time.Unix(now, 0).In(subscriptionHolidayTimezone)
	breaks, known := subscriptionHolidayBreaks[day.Year()]
	policy := SubscriptionFreezePolicy{
		CalendarAvailable: known,
		Date:              day.Format(time.DateOnly),
		ServerTime:        now,
	}
	date := day.Format("01-02")
	for _, holiday := range breaks {
		if date >= holiday[0] && date <= holiday[1] {
			policy.Allowed = true
			break
		}
	}
	return policy
}

// SetUserSubscriptionFrozen uses a desired state instead of toggling, so replayed
// or duplicate requests cannot undo a freeze or extend validity twice.
func SetUserSubscriptionFrozen(userId, subscriptionId int, frozen bool, useFreezeCard ...bool) (*UserSubscription, error) {
	var result *UserSubscription
	err := DB.Transaction(func(tx *gorm.DB) error {
		var err error
		result, err = setUserSubscriptionFrozenTx(tx, userId, subscriptionId, frozen, common.GetTimestamp, useFreezeCard...)
		return err
	})
	if err != nil {
		return nil, err
	}
	refreshSubscriptionUserGroupCache(userId, "subscription freeze state change")
	return result, nil
}

func setUserSubscriptionFrozenTx(tx *gorm.DB, userId, subscriptionId int, frozen bool, clock func() int64, useFreezeCard ...bool) (*UserSubscription, error) {
	if userId <= 0 || subscriptionId <= 0 {
		return nil, errors.New("参数错误")
	}
	// Serialize group transitions across this user's subscriptions before
	// locking an individual subscription, including simultaneous freezes.
	var user User
	if err := lockForUpdate(tx).Select("id", "freeze_cards").Where("id = ?", userId).First(&user).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("订阅不存在")
		}
		return nil, err
	}
	var sub UserSubscription
	if err := lockForUpdate(tx).Where("id = ? AND user_id = ?", subscriptionId, userId).First(&sub).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("订阅不存在")
		}
		return nil, err
	}
	// Check the live server clock after waiting for the row lock. Neither the
	// client date nor a transaction timestamp captured before midnight is used.
	now := clock()
	if frozen && sub.Status == "frozen" {
		return &sub, nil
	}
	if !frozen && sub.Status == "active" && sub.EndTime > now {
		return &sub, nil
	}
	if frozen {
		if sub.Status != "active" || sub.EndTime <= now {
			return nil, errors.New("只能冻结有效订阅")
		}
		policy := GetSubscriptionFreezePolicy(now)
		if !policy.Allowed {
			if len(useFreezeCard) == 0 || !useFreezeCard[0] {
				return nil, errors.New("非节假日冻结需确认使用1张冻结卡，请刷新后重试")
			}
			if user.FreezeCards <= 0 {
				return nil, errors.New("冻结卡不足")
			}
			result := tx.Model(&User{}).Where("id = ? AND freeze_cards > 0", userId).
				UpdateColumn("freeze_cards", gorm.Expr("freeze_cards - 1"))
			if result.Error != nil {
				return nil, result.Error
			}
			if result.RowsAffected != 1 {
				return nil, errors.New("冻结卡不足")
			}
			sub.FreezeCardsUsed++
		}
		plan, err := getUserSubscriptionPlanTx(tx, &sub)
		if err != nil {
			return nil, err
		}
		// Apply any quota reset already due before pausing the reset clock.
		if err := maybeResetUserSubscriptionWithPlanTx(tx, &sub, plan, now); err != nil {
			return nil, err
		}
		sub.Status = "frozen"
		sub.FrozenAt = now
		// A second purchase in the same upgraded group may have no previous
		// group snapshot. Recover it from an already frozen sibling so the last
		// active subscription cannot keep upgraded privileges while paused.
		if sub.UpgradeGroup != "" && sub.PrevUserGroup == "" {
			var sibling UserSubscription
			query := tx.Where("user_id = ? AND status = ? AND upgrade_group = ? AND prev_user_group <> ''", userId, "frozen", sub.UpgradeGroup).
				Order("id asc").Limit(1).Find(&sibling)
			if query.Error != nil {
				return nil, query.Error
			}
			if query.RowsAffected > 0 {
				sub.PrevUserGroup = sibling.PrevUserGroup
			}
		}
		if err := tx.Save(&sub).Error; err != nil {
			return nil, err
		}
		if _, err := downgradeUserGroupForSubscriptionTx(tx, &sub, now); err != nil {
			return nil, err
		}
		return &sub, nil
	}
	if sub.Status != "frozen" || sub.FrozenAt <= 0 || now < sub.FrozenAt {
		return nil, errors.New("订阅无法解冻，请刷新后重试")
	}
	pausedSeconds := now - sub.FrozenAt
	// Pause both expiration and periodic quota resets; no quota is granted by
	// freezing. Existing in-flight settlements/refunds still apply to this row.
	for _, timestamp := range []*int64{&sub.EndTime, &sub.LastResetTime, &sub.NextResetTime} {
		if *timestamp <= 0 {
			continue
		}
		if *timestamp > math.MaxInt64-pausedSeconds {
			return nil, errors.New("订阅时间超出有效范围")
		}
		*timestamp += pausedSeconds
	}
	sub.Status = "active"
	sub.FrozenAt = 0
	upgradeGroup := strings.TrimSpace(sub.UpgradeGroup)
	if upgradeGroup != "" {
		var activeCount int64
		if err := tx.Model(&UserSubscription{}).
			Where("user_id = ? AND id <> ? AND status = ? AND end_time > ? AND upgrade_group <> ''", userId, sub.Id, "active", now).
			Count(&activeCount).Error; err != nil {
			return nil, err
		}
		if activeCount == 0 {
			currentGroup, err := getUserGroupByIdTx(tx, userId)
			if err != nil {
				return nil, err
			}
			if currentGroup != upgradeGroup {
				sub.PrevUserGroup = currentGroup
				if err := tx.Model(&User{}).Where("id = ?", userId).Update("group", upgradeGroup).Error; err != nil {
					return nil, err
				}
			}
		}
	}
	if err := tx.Save(&sub).Error; err != nil {
		return nil, err
	}
	return &sub, nil
}

// ValidateFreezeCards keeps plan grants within the supported integer range.
func (p *SubscriptionPlan) ValidateFreezeCards() error {
	if p.FreezeCards < 0 || p.FreezeCards > 1000000 {
		return errors.New("赠送冻结卡数量必须为0到1000000之间的整数")
	}
	return nil
}
