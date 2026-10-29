package service

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/model"
)

var userRankingLocation = time.FixedZone("Asia/Shanghai", 8*60*60)

var userRankingCache = struct {
	sync.Mutex
	entries map[string]dailyUserRankingCacheEntry
}{entries: make(map[string]dailyUserRankingCacheEntry)}

type dailyUserRankingCacheEntry struct {
	rows        []model.UserTokenRank
	generatedAt time.Time
}

type DailyUserRankings struct {
	Date         string                `json:"date"`
	Timezone     string                `json:"timezone"`
	GeneratedAt  int64                 `json:"generated_at"`
	NextResetAt  int64                 `json:"next_reset_at"`
	TotalTokens  int64                 `json:"total_tokens"`
	Participants int                   `json:"participants"`
	Rows         []model.UserTokenRank `json:"rows"`
	Me           *model.UserTokenRank  `json:"me"`
	Limit        int                   `json:"limit"`
}

func UserRankingDay(date string, now time.Time) (time.Time, error) {
	localNow := now.In(userRankingLocation)
	today := time.Date(localNow.Year(), localNow.Month(), localNow.Day(), 0, 0, 0, 0, userRankingLocation)
	if date == "" {
		return today, nil
	}
	day, err := time.ParseInLocation(time.DateOnly, date, userRankingLocation)
	if err != nil || day.After(today) || day.Before(today.AddDate(0, 0, -29)) {
		return time.Time{}, errors.New("Choose a date within the last 30 days")
	}
	return day, nil
}

func GetDailyUserRankings(ctx context.Context, day time.Time, userID int) (*DailyUserRankings, error) {
	date := day.Format(time.DateOnly)
	// Serialize cache fills to avoid every viewer scanning the daily logs.
	userRankingCache.Lock()
	defer userRankingCache.Unlock()
	now := time.Now()
	entry, found := userRankingCache.entries[date]
	if !found || now.Sub(entry.generatedAt) >= time.Minute {
		rows, err := model.GetDailyUserTokenRanks(ctx, day.Unix(), day.AddDate(0, 0, 1).Unix())
		if err != nil {
			return nil, err
		}
		entry = dailyUserRankingCacheEntry{rows: rows, generatedAt: time.Now()}
		for key, cached := range userRankingCache.entries {
			if now.Sub(cached.generatedAt) >= time.Minute {
				delete(userRankingCache.entries, key)
			}
		}
		userRankingCache.entries[date] = entry
	}
	result := &DailyUserRankings{
		Date:         date,
		Timezone:     "Asia/Shanghai",
		GeneratedAt:  entry.generatedAt.Unix(),
		NextResetAt:  day.AddDate(0, 0, 1).Unix(),
		Participants: len(entry.rows),
		Limit:        100,
		Rows:         make([]model.UserTokenRank, 0, min(100, len(entry.rows))),
	}
	for _, row := range entry.rows {
		result.TotalTokens += row.TotalTokens
		row.IsMe = userID > 0 && row.UserID == userID
		if row.IsMe {
			result.Me = &row
		}
		if row.Rank <= result.Limit {
			result.Rows = append(result.Rows, row)
		}
	}
	return result, nil
}
