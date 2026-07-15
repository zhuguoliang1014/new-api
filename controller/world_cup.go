package controller

import (
	"context"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

type worldCupPredictRequest struct {
	MatchId string `json:"match_id"`
	Date    string `json:"date"`
	Choice  string `json:"choice"`
}

func WorldCupStatus(c *gin.Context) {
	userId := c.GetInt("id")
	query := service.WorldCupScheduleQuery{
		Type:   strings.TrimSpace(c.Query("type")),
		TeamId: strings.TrimSpace(c.Query("team_id")),
	}

	schedule, err := service.FetchWorldCupSchedule(c.Request.Context(), query)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	schedule = service.FilterWorldCupCurrentAndFuture(schedule, time.Now())

	matchIds := make([]string, 0)
	for _, day := range schedule.Data {
		for _, match := range day.ScheduleList {
			matchId := match.MatchId()
			if matchId != "" {
				matchIds = append(matchIds, matchId)
			}
		}
	}
	predictions, err := model.GetWorldCupPredictionsForUserByMatchIds(userId, matchIds)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	subscriptions, err := model.GetAllActiveUserSubscriptions(userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	common.ApiSuccess(c, gin.H{
		"schedule":             schedule,
		"predictions":          predictions,
		"eligible":             true,
		"subscriptions":        subscriptions,
		"next_settlement_unix": model.NextWorldCupSettlementUnix(),
	})
}

func PredictWorldCup(c *gin.Context) {
	userId := c.GetInt("id")
	var req worldCupPredictRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	req.MatchId = strings.TrimSpace(req.MatchId)
	req.Date = strings.TrimSpace(req.Date)
	req.Choice = strings.TrimSpace(req.Choice)
	if req.MatchId == "" || req.Date == "" {
		common.ApiErrorMsg(c, "比赛参数错误")
		return
	}
	if _, ok := model.NormalizeWorldCupChoice(req.Choice); !ok {
		common.ApiErrorMsg(c, "竞猜选项无效")
		return
	}

	schedule, err := service.FetchWorldCupSchedule(c.Request.Context(), service.WorldCupScheduleQuery{
		Date: req.Date,
	})
	if err != nil {
		common.ApiError(c, err)
		return
	}
	match, ok := service.FindWorldCupMatch(schedule, req.MatchId)
	if !ok {
		common.ApiErrorMsg(c, "未找到该场比赛")
		return
	}
	startUnix, err := match.StartUnix()
	if err != nil {
		common.ApiErrorMsg(c, "比赛时间无效")
		return
	}

	prediction, err := model.PlaceWorldCupPrediction(userId, req.Choice, model.WorldCupMatchSnapshot{
		MatchId:       match.MatchId(),
		MatchDate:     strings.TrimSpace(match.Date),
		MatchTime:     startUnix,
		MatchType:     strings.TrimSpace(match.MatchType),
		GroupName:     strings.TrimSpace(match.GroupName),
		HostTeamId:    strings.TrimSpace(match.HostTeamId),
		HostTeamName:  strings.TrimSpace(match.HostTeamName),
		GuestTeamId:   strings.TrimSpace(match.GuestTeamId),
		GuestTeamName: strings.TrimSpace(match.GuestTeamName),
	}, c.ClientIP(), time.Now().Unix())
	if err != nil {
		common.ApiError(c, err)
		return
	}

	common.ApiSuccess(c, gin.H{
		"prediction": prediction.ToDTO(),
	})
}

func WorldCupPredictionHistory(c *gin.Context) {
	userId := c.GetInt("id")
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	size, _ := strconv.Atoi(c.DefaultQuery("size", "30"))

	rows, total, err := model.GetWorldCupPredictionHistory(userId, page, size)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	completedSchedule := &service.WorldCupScheduleResult{}
	schedule, err := service.FetchWorldCupSchedule(c.Request.Context(), service.WorldCupScheduleQuery{})
	if err == nil {
		completedSchedule = service.FilterWorldCupCompleted(schedule)
	}
	common.ApiSuccess(c, gin.H{
		"records":            rows,
		"completed_schedule": completedSchedule,
		"total":              total,
		"page":               page,
		"size":               size,
	})
}

func AdminSettleWorldCupPredictions(c *gin.Context) {
	date := strings.TrimSpace(c.Query("date"))
	if date == "" {
		common.ApiErrorMsg(c, "date 参数不能为空")
		return
	}
	schedule, err := service.FetchWorldCupSchedule(context.Background(), service.WorldCupScheduleQuery{
		Date: date,
	})
	if err != nil {
		common.ApiError(c, err)
		return
	}
	totalWon := 0
	totalLost := 0
	for _, day := range schedule.Data {
		for _, match := range day.ScheduleList {
			outcome, ok := service.BuildWorldCupOutcome(match)
			if !ok {
				continue
			}
			won, lost, rewards, err := model.SettleWorldCupPredictionsWithRewards(outcome)
			if err != nil {
				common.ApiError(c, err)
				return
			}
			if len(rewards) > 0 {
				if _, err := service.SendWechatWorldCupWinResult(c.Request.Context(), rewards, outcome); err != nil {
					common.SysLog("world cup prediction wechat notify failed: " + err.Error())
				}
			}
			totalWon += won
			totalLost += lost
		}
	}
	common.ApiSuccess(c, gin.H{
		"won":  totalWon,
		"lost": totalLost,
	})
}
