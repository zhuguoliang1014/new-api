package service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"fmt"
	"math/rand"
	"net/http"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/bytedance/gopkg/util/gopool"
)

const wechatGroupMessageAPI = "http://8.141.100.180/api/wechat/group-message/send"

// SendWechatGroupMessage 立即发送指定消息到所有配置群（用于测试，也带随机延迟）
func SendWechatGroupMessage(msg string) error {
	if common.OptionMap == nil {
		return fmt.Errorf("option map not initialized")
	}

	common.OptionMapRWMutex.RLock()
	userId := common.OptionMap["WechatBotUserId"]
	groupIdsRaw := common.OptionMap["WechatBotGroupIds"]
	common.OptionMapRWMutex.RUnlock()

	if userId == "" || groupIdsRaw == "" {
		return fmt.Errorf("WechatBotUserId or WechatBotGroupIds not configured")
	}

	// 测试发送同步进行，不使用随机延迟
	groupIds := splitGroupIds(groupIdsRaw)
	logger.LogInfo(context.Background(), fmt.Sprintf("wechat test message: dispatching groups=%d msg_len=%d msg_hash=%s", len(groupIds), len(msg), messageFingerprint(msg)))
	var lastErr error
	for _, gid := range groupIds {
		if err := sendWechatGroupMessage(userId, gid, msg); err != nil {
			lastErr = err
		}
	}
	return lastErr
}

func SendWechatGroupMessageToGroups(msg string, groupIdsRaw string) error {
	if common.OptionMap == nil {
		return fmt.Errorf("option map not initialized")
	}

	common.OptionMapRWMutex.RLock()
	userId := common.OptionMap["WechatBotUserId"]
	common.OptionMapRWMutex.RUnlock()

	if userId == "" || strings.TrimSpace(groupIdsRaw) == "" {
		return fmt.Errorf("WechatBotUserId or groupIds not configured")
	}

	return sendToGroupsWithDelay(userId, groupIdsRaw, msg)
}

// sendToGroupsWithDelay 多群发送，第二群起每群随机延迟 3~8 秒
func sendToGroupsWithDelay(userId, groupIdsRaw, msg string) error {
	groupIds := splitGroupIds(groupIdsRaw)
	if len(groupIds) == 0 {
		return nil
	}

	// 第一群立即发送，后续群在 goroutine 里延迟发送
	ctx := context.Background()
	logger.LogInfo(ctx, fmt.Sprintf("wechat notify: dispatch start groups=%d first_group=%s msg_len=%d msg_hash=%s", len(groupIds), groupIds[0], len(msg), messageFingerprint(msg)))
	var firstErr error
	if err := sendWechatGroupMessage(userId, groupIds[0], msg); err != nil {
		logger.LogWarn(ctx, fmt.Sprintf("wechat notify: group %s: %v", groupIds[0], err))
		firstErr = err
	}

	for _, gid := range groupIds[1:] {
		gidCopy := gid
		delay := time.Duration(3+rand.Intn(6)) * time.Second
		logger.LogInfo(ctx, fmt.Sprintf("wechat notify: scheduling delayed group message group=%s delay=%s msg_hash=%s", gidCopy, delay, messageFingerprint(msg)))
		gopool.Go(func() {
			time.Sleep(delay)
			if err := sendWechatGroupMessage(userId, gidCopy, msg); err != nil {
				logger.LogWarn(ctx, fmt.Sprintf("wechat notify: group %s: %v", gidCopy, err))
			}
		})
	}

	return firstErr
}

func splitGroupIds(raw string) []string {
	parts := strings.Split(raw, ",")
	result := make([]string, 0, len(parts))
	seen := make(map[string]struct{}, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			if _, ok := seen[p]; ok {
				continue
			}
			seen[p] = struct{}{}
			result = append(result, p)
		}
	}
	return result
}

func messageFingerprint(message string) string {
	sum := sha256.Sum256([]byte(message))
	return fmt.Sprintf("%x", sum[:6])
}

func sendWechatGroupMessage(userId, groupId, message string) error {
	payload, err := common.Marshal(map[string]any{
		"user_id":  userId,
		"group_id": groupId,
		"content":  message,
		"at_wxids": nil,
	})
	if err != nil {
		return err
	}

	client := &http.Client{Timeout: 10 * time.Second}
	ctx := context.Background()
	msgHash := messageFingerprint(message)
	start := time.Now()
	logger.LogInfo(ctx, fmt.Sprintf("wechat notify: POST group-message user=%s group=%s msg_len=%d msg_hash=%s", userId, groupId, len(message), msgHash))
	resp, err := client.Post(wechatGroupMessageAPI, "application/json", bytes.NewReader(payload))
	if err != nil {
		logger.LogWarn(ctx, fmt.Sprintf("wechat notify: POST failed user=%s group=%s msg_hash=%s duration=%s err=%v", userId, groupId, msgHash, time.Since(start), err))
		return err
	}
	defer resp.Body.Close()

	logger.LogInfo(ctx, fmt.Sprintf("wechat notify: POST completed user=%s group=%s status=%d msg_hash=%s duration=%s", userId, groupId, resp.StatusCode, msgHash, time.Since(start)))
	if resp.StatusCode >= 400 {
		return fmt.Errorf("wechat API returned status %d", resp.StatusCode)
	}
	return nil
}
