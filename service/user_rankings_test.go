package service

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/schema"
)

func TestUserRankingDay(t *testing.T) {
	now := time.Date(2026, 10, 29, 16, 0, 0, 0, time.UTC)
	for _, tc := range []struct {
		date, want string
		invalid    bool
	}{
		{"", "2026-10-30", false}, {"2026-10-01", "2026-10-01", false},
		{"2026-10-31", "", true}, {"2026-09-30", "", true}, {"2026-02-30", "", true}, {"invalid", "", true},
	} {
		t.Run(tc.date, func(t *testing.T) {
			day, err := UserRankingDay(tc.date, now)
			if tc.invalid {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tc.want, day.Format(time.DateOnly))
			assert.Equal(t, 0, day.Hour())
			_, offset := day.Zone()
			assert.Equal(t, 8*3600, offset)
		})
	}
}

// This exercises the real aggregate and user lookup on independent connections.
// Dedicated table prefixes keep the fixture isolated from application data.
func TestDailyUserRankingsDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			var driver gorm.Dialector
			switch dialect {
			case "sqlite":
				driver = sqlite.Open(":memory:")
			case "mysql":
				dsn := os.Getenv("TEST_MYSQL_DSN")
				if dsn == "" {
					t.Skip("TEST_MYSQL_DSN is not configured")
				}
				driver = mysql.Open(dsn)
			case "postgres":
				dsn := os.Getenv("TEST_POSTGRES_DSN")
				if dsn == "" {
					t.Skip("TEST_POSTGRES_DSN is not configured")
				}
				driver = postgres.Open(dsn)
			}
			mainDB, err := gorm.Open(driver, &gorm.Config{NamingStrategy: schema.NamingStrategy{TablePrefix: "daily_rank_main_"}})
			require.NoError(t, err)
			logDB, err := gorm.Open(driver, &gorm.Config{NamingStrategy: schema.NamingStrategy{TablePrefix: "daily_rank_log_"}})
			require.NoError(t, err)
			for _, db := range []*gorm.DB{mainDB, logDB} {
				connection, err := db.DB()
				require.NoError(t, err)
				connection.SetMaxOpenConns(1)
				t.Cleanup(func() { assert.NoError(t, connection.Close()) })
			}
			versionQuery := "SELECT version()"
			if dialect == "sqlite" {
				versionQuery = "SELECT sqlite_version()"
			}
			var version string
			require.NoError(t, mainDB.Raw(versionQuery).Scan(&version).Error)
			t.Logf("database version: %s", version)
			// Only columns read by the leaderboard are required; no production migrations change.
			type userFixture struct {
				Id        int `gorm:"primaryKey"`
				Username  string
				Role      int
				Status    int
				DeletedAt gorm.DeletedAt
			}
			type logFixture struct {
				Id               int `gorm:"primaryKey"`
				UserId           int
				Type             int
				CreatedAt        int64
				PromptTokens     int64
				CompletionTokens int64
				ModelName        string
			}
			require.NoError(t, mainDB.Table("daily_rank_main_users").AutoMigrate(&userFixture{}))
			require.NoError(t, logDB.Table("daily_rank_log_logs").AutoMigrate(&logFixture{}))
			t.Cleanup(func() {
				assert.NoError(t, mainDB.Migrator().DropTable("daily_rank_main_users"))
				assert.NoError(t, logDB.Migrator().DropTable("daily_rank_log_logs"))
			})
			oldDB, oldLogDB := model.DB, model.LOG_DB
			model.DB, model.LOG_DB = mainDB, logDB
			t.Cleanup(func() {
				model.DB, model.LOG_DB = oldDB, oldLogDB
				userRankingCache.entries = make(map[string]dailyUserRankingCacheEntry)
			})
			userRankingCache.entries = make(map[string]dailyUserRankingCacheEntry)
			users := []userFixture{
				{Id: 1, Username: "alice", Role: 1, Status: 1}, {Id: 2, Username: "张三丰", Role: 1, Status: 1}, {Id: 3, Username: "ab", Role: 1, Status: 1},
				{Id: 4, Username: "admin", Role: 10, Status: 1}, {Id: 5, Username: "banned", Role: 1, Status: 2}, {Id: 6, Username: "deleted", Role: 1, Status: 1, DeletedAt: gorm.DeletedAt{Time: time.Now(), Valid: true}},
			}
			require.NoError(t, mainDB.Table("daily_rank_main_users").Create(&users).Error)
			day := time.Date(2026, 10, 29, 0, 0, 0, 0, userRankingLocation)
			start := day.Unix()
			logs := []logFixture{
				{Id: 1, UserId: 1, Type: 2, CreatedAt: start, PromptTokens: 200, CompletionTokens: 100, ModelName: "model-a"},
				{Id: 2, UserId: 1, Type: 2, CreatedAt: start + 10, PromptTokens: 100, CompletionTokens: 100, ModelName: "model-b"},
				{Id: 3, UserId: 2, Type: 2, CreatedAt: start + 20, PromptTokens: 400, CompletionTokens: 100},
				{Id: 4, UserId: 3, Type: 2, CreatedAt: start + 86399, PromptTokens: -50, CompletionTokens: 100},
				{Id: 5, UserId: 1, Type: 2, CreatedAt: start - 1, PromptTokens: 99999},
				{Id: 6, UserId: 1, Type: 2, CreatedAt: start + 86400, PromptTokens: 99999},
				{Id: 7, UserId: 1, Type: model.LogTypeError, CreatedAt: start, PromptTokens: 99999},
			}
			for _, id := range []int{4, 5, 6, 999} {
				logs = append(logs, logFixture{Id: 10 + id, UserId: id, Type: 2, CreatedAt: start, PromptTokens: 99999})
			}
			require.NoError(t, logDB.Table("daily_rank_log_logs").Create(&logs).Error)
			got, err := GetDailyUserRankings(context.Background(), day, 2)
			require.NoError(t, err)
			assert.Equal(t, int64(1100), got.TotalTokens)
			assert.Equal(t, 3, got.Participants)
			require.Len(t, got.Rows, 3)
			assert.Equal(t, []string{"a***e", "张***丰", "***"}, []string{got.Rows[0].Name, got.Rows[1].Name, got.Rows[2].Name})
			assert.Equal(t, int64(300), got.Rows[0].InputTokens)
			assert.Equal(t, int64(200), got.Rows[0].OutputTokens)
			require.NotNil(t, got.Me)
			assert.Equal(t, 2, got.Me.Rank)
			assert.True(t, got.Rows[1].IsMe)
			anonymous, err := GetDailyUserRankings(context.Background(), day, 0)
			require.NoError(t, err)
			assert.Nil(t, anonymous.Me)
			for _, row := range anonymous.Rows {
				assert.False(t, row.IsMe)
			}
			body, err := common.Marshal(anonymous)
			require.NoError(t, err)
			assert.NotContains(t, string(body), "user_id")
			assert.NotContains(t, string(body), "alice")
			empty, err := GetDailyUserRankings(context.Background(), day.AddDate(0, 0, -2), 1)
			require.NoError(t, err)
			assert.Empty(t, empty.Rows)
			assert.Zero(t, empty.TotalTokens)
			assert.Nil(t, empty.Me)
			// The caller's own rank remains available beyond the public top 100.
			rows := make([]model.UserTokenRank, 101)
			for i := range rows {
				rows[i] = model.UserTokenRank{UserID: i + 1, Rank: i + 1, TotalTokens: 1}
			}
			userRankingCache.entries[day.Format(time.DateOnly)] = dailyUserRankingCacheEntry{rows: rows, generatedAt: time.Now()}
			beyond, err := GetDailyUserRankings(context.Background(), day, 101)
			require.NoError(t, err)
			require.Len(t, beyond.Rows, 100)
			require.NotNil(t, beyond.Me)
			assert.Equal(t, 101, beyond.Me.Rank)
			assert.Equal(t, int64(101), beyond.TotalTokens)
		})
	}
}
