package model

// Hupijiao subscription payment — local fork addition. Constants and the
// completion handler live here so model/subscription.go stays close to upstream.

import (
	"errors"
	"fmt"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"

	"gorm.io/gorm"
)

const (
	SubscriptionPaymentMethodHupijiao   = "hupijiao"
	SubscriptionPaymentProviderHupijiao = "hupijiao"
)

// CompleteHupijiaoSubscriptionOrder handles Hupijiao subscription payment callback
func CompleteHupijiaoSubscriptionOrder(tradeNo string, amount float64, providerPayload string) error {
	if tradeNo == "" {
		return errors.New("未提供订单号")
	}

	var order SubscriptionOrder
	var inviterId int
	var inviteRewardQuota int

	refCol := "`trade_no`"
	if common.UsingMainDatabase(common.DatabaseTypePostgreSQL) {
		refCol = `"trade_no"`
	}

	err := DB.Transaction(func(tx *gorm.DB) error {
		// 锁定订单记录
		err := tx.Set("gorm:query_option", "FOR UPDATE").Where(refCol+" = ?", tradeNo).First(&order).Error
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrSubscriptionOrderNotFound
			}
			return fmt.Errorf("查询订单失败: %w", err)
		}

		// 验证支付方式
		if order.PaymentProvider != SubscriptionPaymentProviderHupijiao {
			return fmt.Errorf("支付方式不匹配: %s", order.PaymentProvider)
		}

		// 幂等性检查
		if order.Status == common.TopUpStatusSuccess {
			return nil // 已成功，直接返回
		}

		// 验证订单状态
		if order.Status != common.TopUpStatusPending {
			return ErrSubscriptionOrderStatusInvalid
		}

		// 金额验证（允许0.01元误差）
		if order.Money < amount-0.01 || order.Money > amount+0.01 {
			return fmt.Errorf("金额不匹配: 期望%.2f, 实际%.2f", order.Money, amount)
		}

		// 更新订单状态
		order.Status = common.TopUpStatusSuccess
		order.CompleteTime = common.GetTimestamp()
		order.ProviderPayload = providerPayload

		if err := tx.Save(&order).Error; err != nil {
			return fmt.Errorf("更新订单失败: %w", err)
		}

		// 获取套餐信息
		plan, err := getSubscriptionPlanByIdTx(tx, order.PlanId)
		if err != nil {
			return fmt.Errorf("套餐不存在: %w", err)
		}

		// 创建用户订阅
		_, err = CreateUserSubscriptionFromPlanTx(tx, order.UserId, plan, "hupijiao")
		if err != nil {
			return fmt.Errorf("创建订阅失败: %w", err)
		}

		if err := upsertSubscriptionTopUpTx(tx, &order); err != nil {
			return err
		}

		var rewardErr error
		inviterId, inviteRewardQuota, rewardErr = applyHupijiaoInviteRewardTx(tx, order.UserId, amount)
		if rewardErr != nil {
			return fmt.Errorf("增加邀请奖励失败: %w", rewardErr)
		}

		return nil
	})

	if err != nil {
		common.SysError("hupijiao subscription failed: " + err.Error())
		return err
	}

	if inviterId > 0 && inviteRewardQuota > 0 {
		RecordLog(inviterId, LogTypeSystem, fmt.Sprintf("虎皮椒订阅邀请奖励，来自用户 %d，待转移奖励额度: %v，支付金额: %.2f", order.UserId, logger.FormatQuota(inviteRewardQuota), amount))
	}

	return nil
}
