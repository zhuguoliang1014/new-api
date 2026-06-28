package model

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"

	"github.com/bytedance/gopkg/util/gopool"
	"gorm.io/gorm"
)

const (
	WorldCupChoiceHost  = "host"
	WorldCupChoiceDraw  = "draw"
	WorldCupChoiceGuest = "guest"

	WorldCupPredictionPending = "pending"
	WorldCupPredictionWon     = "won"
	WorldCupPredictionLost    = "lost"
	WorldCupPredictionVoid    = "void"

	worldCupPredictionLockBeforeSeconds = 3600
)

type WorldCupPrediction struct {
	Id int64 `json:"id" gorm:"primaryKey;autoIncrement"`

	UserId  int    `json:"user_id" gorm:"not null;uniqueIndex:idx_world_cup_prediction_user_match,priority:1;index:idx_world_cup_prediction_user_created,priority:1"`
	MatchId string `json:"match_id" gorm:"type:varchar(128);not null;uniqueIndex:idx_world_cup_prediction_user_match,priority:2;index"`

	MatchDate string `json:"match_date" gorm:"type:varchar(16);not null;index:idx_world_cup_prediction_date_status,priority:1"`
	MatchTime int64  `json:"match_time" gorm:"not null;default:0;index"`
	MatchType string `json:"match_type" gorm:"type:varchar(16);not null;default:'1'"`
	GroupName string `json:"group_name" gorm:"type:varchar(64);default:''"`

	HostTeamId    string `json:"host_team_id" gorm:"type:varchar(64);default:''"`
	HostTeamName  string `json:"host_team_name" gorm:"type:varchar(128);default:''"`
	GuestTeamId   string `json:"guest_team_id" gorm:"type:varchar(64);default:''"`
	GuestTeamName string `json:"guest_team_name" gorm:"type:varchar(128);default:''"`

	Choice           string `json:"choice" gorm:"type:varchar(16);not null"`
	Status           string `json:"status" gorm:"type:varchar(16);not null;default:'pending';index:idx_world_cup_prediction_date_status,priority:2"`
	RewardQuota      int    `json:"reward_quota" gorm:"not null;default:0"`
	StreakBonusQuota int    `json:"streak_bonus_quota" gorm:"not null;default:0"`
	SettledAt        int64  `json:"settled_at" gorm:"not null;default:0"`

	Ip        string `json:"-" gorm:"type:varchar(64);default:''"`
	CreatedAt int64  `json:"created_at" gorm:"bigint;index:idx_world_cup_prediction_user_created,priority:2"`
	UpdatedAt int64  `json:"updated_at" gorm:"bigint"`
}

type WorldCupPredictionDTO struct {
	Id               int64  `json:"id"`
	MatchId          string `json:"match_id"`
	MatchDate        string `json:"match_date"`
	MatchTime        int64  `json:"match_time"`
	MatchType        string `json:"match_type"`
	GroupName        string `json:"group_name"`
	HostTeamName     string `json:"host_team_name"`
	GuestTeamName    string `json:"guest_team_name"`
	Choice           string `json:"choice"`
	Status           string `json:"status"`
	RewardQuota      int    `json:"reward_quota"`
	StreakBonusQuota int    `json:"streak_bonus_quota"`
	SettledAt        int64  `json:"settled_at"`
	CreatedAt        int64  `json:"created_at"`
}

type WorldCupMatchSnapshot struct {
	MatchId       string
	MatchDate     string
	MatchTime     int64
	MatchType     string
	GroupName     string
	HostTeamId    string
	HostTeamName  string
	GuestTeamId   string
	GuestTeamName string
}

type WorldCupMatchOutcome struct {
	MatchId    string
	MatchDate  string
	Choice     string
	HostScore  int
	GuestScore int
}

type WorldCupRewardAdjustment struct {
	UserId           int
	Prediction       WorldCupPrediction
	RewardDelta      int
	BaseRewardDelta  int
	StreakBonusDelta int
}

type WorldCupPredictionStreak struct {
	Id int64 `json:"id" gorm:"primaryKey;autoIncrement"`

	UserId       int    `json:"user_id" gorm:"not null;index:idx_world_cup_streak_user_created,priority:1"`
	PredictionId int64  `json:"prediction_id" gorm:"not null;uniqueIndex"`
	MatchId      string `json:"match_id" gorm:"type:varchar(128);not null;index"`
	BonusQuota   int    `json:"bonus_quota" gorm:"not null;default:0"`

	CreatedAt int64 `json:"created_at" gorm:"bigint;index:idx_world_cup_streak_user_created,priority:2"`
	UpdatedAt int64 `json:"updated_at" gorm:"bigint"`
}

func (p *WorldCupPrediction) BeforeCreate(tx *gorm.DB) error {
	now := common.GetTimestamp()
	p.CreatedAt = now
	p.UpdatedAt = now
	return nil
}

func (p *WorldCupPrediction) BeforeUpdate(tx *gorm.DB) error {
	p.UpdatedAt = common.GetTimestamp()
	return nil
}

func (s *WorldCupPredictionStreak) BeforeCreate(tx *gorm.DB) error {
	now := common.GetTimestamp()
	s.CreatedAt = now
	s.UpdatedAt = now
	return nil
}

func (s *WorldCupPredictionStreak) BeforeUpdate(tx *gorm.DB) error {
	s.UpdatedAt = common.GetTimestamp()
	return nil
}

func WorldCupLocation() *time.Location {
	return time.FixedZone("CST", 8*3600)
}

func WorldCupPredictionRewardQuota() int {
	fallback := int(common.QuotaPerUnit / 10)
	if fallback <= 0 {
		return 1
	}
	return fallback
}

func WorldCupPredictionRewardQuotaForUserAt(userId int, atUnix int64) (int, error) {
	return worldCupPredictionRewardQuotaForUserAtDB(DB, userId, atUnix)
}

func worldCupPredictionRewardQuotaForUserAtDB(db *gorm.DB, userId int, atUnix int64) (int, error) {
	if userId <= 0 {
		return 0, errors.New("invalid user id")
	}
	if atUnix <= 0 {
		atUnix = common.GetTimestamp()
	}
	if db == nil {
		db = DB
	}
	var subs []UserSubscription
	if err := db.Where("user_id = ?", userId).
		Order("end_time desc, id desc").
		Find(&subs).Error; err != nil {
		return 0, err
	}
	summaries := buildSubscriptionSummariesWithDB(db, subs)
	bestReward := int64(0)
	for _, summary := range summaries {
		sub := summary.Subscription
		if sub == nil {
			continue
		}
		if sub.StartTime > atUnix || sub.EndTime <= atUnix {
			continue
		}
		if !worldCupSubscriptionSummaryMatches(summary) {
			continue
		}
		if sub.AmountTotal <= 0 || sub.EndTime <= sub.StartTime {
			continue
		}
		durationSeconds := sub.EndTime - sub.StartTime
		effectiveDays := (durationSeconds + 24*3600 - 1) / (24 * 3600)
		if effectiveDays <= 0 {
			effectiveDays = 1
		}
		reward := sub.AmountTotal / (effectiveDays * 10)
		if reward > bestReward {
			bestReward = reward
		}
	}
	if bestReward <= 0 {
		return WorldCupPredictionRewardQuota(), nil
	}
	return int(bestReward), nil
}

func WorldCupPredictionStreakBonusThreshold() int {
	raw := firstWorldCupModelConfigValue(
		[]string{"WORLD_CUP_STREAK_BONUS_THRESHOLD"},
		[]string{"WorldCupStreakBonusThreshold"},
		"5",
	)
	threshold, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil || threshold <= 0 {
		return 0
	}
	return threshold
}

func WorldCupPredictionStreakBonusQuota() int {
	raw := firstWorldCupModelConfigValue(
		[]string{"WORLD_CUP_STREAK_BONUS_QUOTA"},
		[]string{"WorldCupStreakBonusQuota"},
		"",
	)
	if raw != "" {
		quota, err := strconv.Atoi(strings.TrimSpace(raw))
		if err == nil && quota > 0 {
			return quota
		}
	}
	return int(common.QuotaPerUnit * 5)
}

func NextWorldCupSettlementUnix() int64 {
	now := time.Now().In(WorldCupLocation())
	interval := time.Duration(WorldCupSettlementCheckIntervalSeconds()) * time.Second
	if interval <= 0 {
		return now.Unix()
	}
	return now.Truncate(interval).Add(interval).Unix()
}

func WorldCupSettlementCheckIntervalSeconds() int64 {
	raw := firstWorldCupModelConfigValue(
		[]string{"WORLD_CUP_SETTLEMENT_CHECK_INTERVAL_SECONDS"},
		[]string{"WorldCupSettlementCheckIntervalSeconds"},
		"1800",
	)
	seconds, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil || seconds <= 0 {
		return 1800
	}
	return int64(seconds)
}

func NormalizeWorldCupChoice(choice string) (string, bool) {
	switch strings.TrimSpace(choice) {
	case WorldCupChoiceHost:
		return WorldCupChoiceHost, true
	case WorldCupChoiceDraw:
		return WorldCupChoiceDraw, true
	case WorldCupChoiceGuest:
		return WorldCupChoiceGuest, true
	default:
		return "", false
	}
}

func HasWorldCupSubscription(userId int) (bool, []SubscriptionSummary, error) {
	summaries, err := GetAllActiveUserSubscriptions(userId)
	if err != nil {
		return false, nil, err
	}
	if len(summaries) == 0 {
		return false, summaries, nil
	}
	planIds := worldCupPlanIdSet()
	for _, summary := range summaries {
		if worldCupSubscriptionSummaryMatchesWithPlanIds(summary, planIds) {
			return true, summaries, nil
		}
	}
	return false, summaries, nil
}

func PlaceWorldCupPrediction(userId int, choice string, snapshot WorldCupMatchSnapshot, ip string, nowUnix int64) (*WorldCupPrediction, error) {
	if userId <= 0 {
		return nil, errors.New("invalid user id")
	}
	normalizedChoice, ok := NormalizeWorldCupChoice(choice)
	if !ok {
		return nil, errors.New("竞猜选项无效")
	}
	if strings.TrimSpace(snapshot.MatchId) == "" || strings.TrimSpace(snapshot.MatchDate) == "" {
		return nil, errors.New("比赛信息不完整")
	}
	if snapshot.MatchTime <= 0 {
		return nil, errors.New("比赛时间无效")
	}
	if nowUnix >= snapshot.MatchTime-worldCupPredictionLockBeforeSeconds {
		return nil, errors.New("比赛开赛前 1 小时已停止竞猜")
	}

	var result WorldCupPrediction
	err := DB.Transaction(func(tx *gorm.DB) error {
		var existing WorldCupPrediction
		err := tx.Where("user_id = ? AND match_id = ?", userId, snapshot.MatchId).First(&existing).Error
		if err == nil {
			return errors.New("该场比赛已竞猜，无法重复提交")
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		created := WorldCupPrediction{
			UserId:        userId,
			MatchId:       strings.TrimSpace(snapshot.MatchId),
			MatchDate:     strings.TrimSpace(snapshot.MatchDate),
			MatchTime:     snapshot.MatchTime,
			MatchType:     strings.TrimSpace(snapshot.MatchType),
			GroupName:     strings.TrimSpace(snapshot.GroupName),
			HostTeamId:    strings.TrimSpace(snapshot.HostTeamId),
			HostTeamName:  strings.TrimSpace(snapshot.HostTeamName),
			GuestTeamId:   strings.TrimSpace(snapshot.GuestTeamId),
			GuestTeamName: strings.TrimSpace(snapshot.GuestTeamName),
			Choice:        normalizedChoice,
			Status:        WorldCupPredictionPending,
			Ip:            ip,
		}
		if err := tx.Create(&created).Error; err != nil {
			return err
		}
		result = created
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &result, nil
}

func GetWorldCupPredictionsForUserByMatchIds(userId int, matchIds []string) (map[string]WorldCupPredictionDTO, error) {
	result := map[string]WorldCupPredictionDTO{}
	if userId <= 0 || len(matchIds) == 0 {
		return result, nil
	}
	cleanIds := make([]string, 0, len(matchIds))
	seen := map[string]struct{}{}
	for _, matchId := range matchIds {
		matchId = strings.TrimSpace(matchId)
		if matchId == "" {
			continue
		}
		if _, ok := seen[matchId]; ok {
			continue
		}
		seen[matchId] = struct{}{}
		cleanIds = append(cleanIds, matchId)
	}
	if len(cleanIds) == 0 {
		return result, nil
	}
	var rows []WorldCupPrediction
	if err := DB.Where("user_id = ? AND match_id IN ?", userId, cleanIds).Find(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		result[row.MatchId] = row.ToDTO()
	}
	return result, nil
}

func GetWorldCupPredictionHistory(userId, page, size int) ([]WorldCupPredictionDTO, int64, error) {
	if size <= 0 {
		size = 30
	}
	if size > 100 {
		size = 100
	}
	if page <= 0 {
		page = 1
	}
	offset := (page - 1) * size

	var total int64
	if err := DB.Model(&WorldCupPrediction{}).Where("user_id = ?", userId).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var rows []WorldCupPrediction
	if err := DB.Where("user_id = ?", userId).
		Order("match_time desc, id desc").
		Offset(offset).Limit(size).
		Find(&rows).Error; err != nil {
		return nil, 0, err
	}
	out := make([]WorldCupPredictionDTO, len(rows))
	for i, row := range rows {
		out[i] = row.ToDTO()
	}
	return out, total, nil
}

func SettleWorldCupPredictions(outcome WorldCupMatchOutcome) (won int, lost int, err error) {
	won, lost, _, err = SettleWorldCupPredictionsWithRewards(outcome)
	return won, lost, err
}

func SettleWorldCupPredictionsWithRewards(outcome WorldCupMatchOutcome) (won int, lost int, adjustments []WorldCupRewardAdjustment, err error) {
	if strings.TrimSpace(outcome.MatchId) == "" || strings.TrimSpace(outcome.MatchDate) == "" {
		return 0, 0, nil, errors.New("invalid world cup outcome")
	}
	winningChoice, ok := NormalizeWorldCupChoice(outcome.Choice)
	if !ok {
		return 0, 0, nil, errors.New("invalid world cup outcome choice")
	}
	now := common.GetTimestamp()
	adjustments = make([]WorldCupRewardAdjustment, 0)

	err = DB.Transaction(func(tx *gorm.DB) error {
		var rows []WorldCupPrediction
		if err := tx.Where("match_id = ? AND status = ?", outcome.MatchId, WorldCupPredictionPending).
			Find(&rows).Error; err != nil {
			return err
		}
		for _, row := range rows {
			if row.Choice == winningChoice {
				rewardQuota, err := worldCupPredictionRewardQuotaForUserAtDB(tx, row.UserId, row.CreatedAt)
				if err != nil {
					return err
				}
				streakBonusQuota, err := addWorldCupPredictionStreakTx(tx, row)
				if err != nil {
					return err
				}
				row.Status = WorldCupPredictionWon
				row.RewardQuota = rewardQuota
				row.StreakBonusQuota = streakBonusQuota
				row.SettledAt = now
				totalRewardQuota := rewardQuota + streakBonusQuota
				if err := tx.Model(&User{}).Where("id = ?", row.UserId).
					Update("quota", gorm.Expr("quota + ?", totalRewardQuota)).Error; err != nil {
					return err
				}
				adjustments = append(adjustments, WorldCupRewardAdjustment{
					UserId:           row.UserId,
					Prediction:       row,
					RewardDelta:      totalRewardQuota,
					BaseRewardDelta:  rewardQuota,
					StreakBonusDelta: streakBonusQuota,
				})
				won++
			} else {
				row.Status = WorldCupPredictionLost
				row.RewardQuota = 0
				row.StreakBonusQuota = 0
				row.SettledAt = now
				if err := tx.Where("user_id = ?", row.UserId).Delete(&WorldCupPredictionStreak{}).Error; err != nil {
					return err
				}
				lost++
			}
			if err := tx.Save(&row).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return 0, 0, nil, err
	}
	for _, adjustment := range adjustments {
		userId := adjustment.UserId
		rewardDelta := adjustment.RewardDelta
		gopool.Go(func() {
			if err := cacheIncrUserQuota(userId, int64(rewardDelta)); err != nil {
				common.SysLog("failed to increase user quota cache: " + err.Error())
			}
		})
		if rewardDelta <= 0 {
			continue
		}
		if adjustment.BaseRewardDelta > 0 {
			RecordLog(userId, LogTypeTopup, fmt.Sprintf("世界杯竞猜中奖奖励 %s，比赛: %s vs %s",
				logger.LogQuota(adjustment.BaseRewardDelta), adjustment.Prediction.HostTeamName, adjustment.Prediction.GuestTeamName))
		}
		if adjustment.StreakBonusDelta > 0 {
			RecordLog(userId, LogTypeTopup, fmt.Sprintf("世界杯竞猜连胜额外赠送额度 %s",
				logger.LogQuota(adjustment.StreakBonusDelta)))
		}
	}
	return won, lost, adjustments, nil
}

func addWorldCupPredictionStreakTx(tx *gorm.DB, row WorldCupPrediction) (int, error) {
	threshold := WorldCupPredictionStreakBonusThreshold()
	bonusQuota := WorldCupPredictionStreakBonusQuota()
	streak := WorldCupPredictionStreak{
		UserId:       row.UserId,
		PredictionId: row.Id,
		MatchId:      row.MatchId,
	}
	if err := tx.Create(&streak).Error; err != nil {
		return 0, err
	}
	if threshold <= 0 || bonusQuota <= 0 {
		return 0, nil
	}
	var streakCount int64
	if err := tx.Model(&WorldCupPredictionStreak{}).Where("user_id = ?", row.UserId).Count(&streakCount).Error; err != nil {
		return 0, err
	}
	if streakCount%int64(threshold) != 0 {
		return 0, nil
	}
	if err := tx.Model(&WorldCupPredictionStreak{}).Where("id = ?", streak.Id).Update("bonus_quota", bonusQuota).Error; err != nil {
		return 0, err
	}
	return bonusQuota, nil
}

func (p WorldCupPrediction) ToDTO() WorldCupPredictionDTO {
	return WorldCupPredictionDTO{
		Id:               p.Id,
		MatchId:          p.MatchId,
		MatchDate:        p.MatchDate,
		MatchTime:        p.MatchTime,
		MatchType:        p.MatchType,
		GroupName:        p.GroupName,
		HostTeamName:     p.HostTeamName,
		GuestTeamName:    p.GuestTeamName,
		Choice:           p.Choice,
		Status:           p.Status,
		RewardQuota:      p.RewardQuota,
		StreakBonusQuota: p.StreakBonusQuota,
		SettledAt:        p.SettledAt,
		CreatedAt:        p.CreatedAt,
	}
}

func worldCupPlanIdSet() map[int]struct{} {
	raw := firstWorldCupModelConfigValue(
		[]string{"WORLD_CUP_PLAN_IDS"},
		[]string{"WorldCupPlanIds"},
		"",
	)
	result := map[int]struct{}{}
	for _, part := range strings.Split(raw, ",") {
		id, err := strconv.Atoi(strings.TrimSpace(part))
		if err != nil || id <= 0 {
			continue
		}
		result[id] = struct{}{}
	}
	return result
}

func worldCupPlanTitleMatches(title string) bool {
	title = strings.TrimSpace(title)
	if title == "" {
		return false
	}
	normalizedTitle := strings.ToLower(strings.ReplaceAll(title, " ", ""))
	raw := firstWorldCupModelConfigValue(
		[]string{"WORLD_CUP_PLAN_KEYWORDS"},
		[]string{"WorldCupPlanKeywords"},
		"世界杯,world cup,worldcup",
	)
	for _, keyword := range strings.Split(raw, ",") {
		keyword = strings.TrimSpace(keyword)
		if keyword == "" {
			continue
		}
		normalizedKeyword := strings.ToLower(strings.ReplaceAll(keyword, " ", ""))
		if strings.Contains(normalizedTitle, normalizedKeyword) {
			return true
		}
	}
	return false
}

func worldCupSubscriptionSummaryMatches(summary SubscriptionSummary) bool {
	return worldCupSubscriptionSummaryMatchesWithPlanIds(summary, worldCupPlanIdSet())
}

func worldCupSubscriptionSummaryMatchesWithPlanIds(summary SubscriptionSummary, planIds map[int]struct{}) bool {
	if summary.Subscription == nil {
		return false
	}
	if len(planIds) > 0 {
		_, ok := planIds[summary.Subscription.PlanId]
		return ok
	}
	if worldCupPlanTitleMatches(summary.PlanTitle) {
		return true
	}
	if summary.Plan != nil && worldCupPlanTitleMatches(summary.Plan.Title) {
		return true
	}
	return false
}

func firstWorldCupModelConfigValue(envKeys []string, optionKeys []string, fallback string) string {
	for _, key := range envKeys {
		if value := strings.TrimSpace(common.GetEnvOrDefaultString(key, "")); value != "" {
			return value
		}
	}
	if common.OptionMap != nil {
		common.OptionMapRWMutex.RLock()
		defer common.OptionMapRWMutex.RUnlock()
		for _, key := range optionKeys {
			if value := strings.TrimSpace(common.OptionMap[key]); value != "" {
				return value
			}
		}
	}
	return fallback
}
