package model

import (
	"cmp"
	"context"
	"slices"

	"github.com/QuantumNous/new-api/common"
)

// UserTokenRank contains only the public, masked identity and usage counters.
// UserID remains internal so the caller can identify its own entry securely.
type UserTokenRank struct {
	UserID       int    `json:"-"`
	Rank         int    `json:"rank"`
	Name         string `json:"name"`
	InputTokens  int64  `json:"input_tokens"`
	OutputTokens int64  `json:"output_tokens"`
	TotalTokens  int64  `json:"total_tokens"`
	IsMe         bool   `json:"is_me"`
}

// GetDailyUserTokenRanks uses the log connection independently of the user DB.
// The half-open range assigns midnight requests to exactly one day.
func GetDailyUserTokenRanks(ctx context.Context, start, end int64) ([]UserTokenRank, error) {
	var usage []UserTokenRank
	err := LOG_DB.WithContext(ctx).Model(&Log{}).
		Select("user_id, SUM(CASE WHEN prompt_tokens > 0 THEN prompt_tokens ELSE 0 END) AS input_tokens, SUM(CASE WHEN completion_tokens > 0 THEN completion_tokens ELSE 0 END) AS output_tokens").
		Where("type = ? AND created_at >= ? AND created_at < ?", LogTypeConsume, start, end).
		Group("user_id").Scan(&usage).Error
	if err != nil {
		return nil, err
	}
	var users []User
	if err := DB.WithContext(ctx).Model(&User{}).Select("id", "username").Where("role = ? AND status = ?", common.RoleCommonUser, common.UserStatusEnabled).Find(&users).Error; err != nil {
		return nil, err
	}
	names := make(map[int]string, len(users))
	for _, user := range users {
		name := []rune(user.Username)
		masked := "***"
		if len(name) > 2 {
			masked = string(name[:1]) + "***" + string(name[len(name)-1:])
		}
		names[user.Id] = masked
	}
	ranks := make([]UserTokenRank, 0, len(usage))
	for _, row := range usage {
		name, eligible := names[row.UserID]
		row.TotalTokens = row.InputTokens + row.OutputTokens
		if !eligible || row.TotalTokens <= 0 {
			continue
		}
		row.Name = name
		ranks = append(ranks, row)
	}
	slices.SortFunc(ranks, func(a, b UserTokenRank) int {
		if order := cmp.Compare(b.TotalTokens, a.TotalTokens); order != 0 {
			return order
		}
		return cmp.Compare(a.UserID, b.UserID)
	})
	for i := range ranks {
		ranks[i].Rank = i + 1
	}
	return ranks, nil
}
