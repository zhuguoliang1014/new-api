package controller

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
)

const hupijiaoReconcileTaskType = "hupijiao_reconcile"

type hupijiaoReconcileHandler struct{}

type hupijiaoReconcileResult struct {
	NextID  int `json:"next_id"`
	Checked int `json:"checked"`
	Settled int `json:"settled"`
	Failed  int `json:"failed"`
}

func (hupijiaoReconcileHandler) Type() string { return hupijiaoReconcileTaskType }

// Continue honoring existing payments even if creation of new orders is disabled.
func (hupijiaoReconcileHandler) Enabled() bool {
	return strings.TrimSpace(setting.HupijiaoAppId) != "" && strings.TrimSpace(setting.HupijiaoAppSecret) != ""
}

func (hupijiaoReconcileHandler) Interval() time.Duration { return 30 * time.Second }

func (hupijiaoReconcileHandler) NewPayload() any {
	var result hupijiaoReconcileResult
	last, err := model.GetLatestSystemTask(hupijiaoReconcileTaskType)
	if err == nil && last != nil && last.Result != "" {
		err = common.UnmarshalJsonStr(last.Result, &result)
	}
	if err != nil {
		common.SysError(fmt.Sprintf("hupijiao reconciliation cursor lookup failed: %v", err))
	}
	return hupijiaoReconcileResult{NextID: result.NextID}
}

func (hupijiaoReconcileHandler) Run(ctx context.Context, task *model.SystemTask, runnerID string) {
	var result hupijiaoReconcileResult
	if err := task.DecodePayload(&result); err != nil {
		finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusFailed, nil, err)
		return
	}
	result, err := runHupijiaoReconciliation(ctx, result.NextID)
	status := model.SystemTaskStatusSucceeded
	if err != nil {
		status = model.SystemTaskStatusFailed
	}
	finishSystemTaskHandler(task, runnerID, status, result, err)
}

func runHupijiaoReconciliation(ctx context.Context, afterID int) (hupijiaoReconcileResult, error) {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	result := hupijiaoReconcileResult{NextID: afterID}
	now := common.GetTimestamp()
	// Poll recent payments every run and rotate through older checkouts over
	// seven days. Persisted keyset pagination survives restarts and multiple masters.
	recent, err := model.ListUnsettledHupijiaoTopUps(ctx, now-15*60, now-5, 0, 100)
	if err != nil {
		return result, err
	}
	older, err := model.ListUnsettledHupijiaoTopUps(ctx, now-7*24*60*60, now-15*60, afterID, 50)
	if err != nil {
		return result, err
	}
	for _, orders := range [][]model.TopUp{recent, older} {
		for _, order := range orders {
			if err := ctx.Err(); err != nil {
				return result, err
			}
			paid, err := reconcileHupijiaoOrder(ctx, &order, "background")
			result.Checked++
			if order.CreateTime < now-15*60 {
				result.NextID = order.Id
			}
			if err != nil {
				result.Failed++
				logger.LogWarn(ctx, fmt.Sprintf("虎皮椒后台查单失败 trade_no=%s err=%v", order.TradeNo, err))
			} else if paid {
				result.Settled++
			}
		}
	}
	if len(older) < 50 {
		result.NextID = 0
	}
	if result.Failed > 0 {
		return result, fmt.Errorf("hupijiao reconciliation: %d of %d checks failed; retry on next sweep", result.Failed, result.Checked)
	}
	return result, nil
}
