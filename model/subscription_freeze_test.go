package model

import (
	"fmt"
	"math"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/schema"
)

func TestSubscriptionFreezePolicyUsesOfficialBreaksAndBeijingDate(t *testing.T) {
	for _, tc := range []struct {
		date           string
		allowed, known bool
	}{
		{"2026-01-01T00:00:00+08:00", true, true},
		{"2026-01-04T12:00:00+08:00", false, true},
		{"2026-02-14T12:00:00+08:00", false, true},
		{"2026-02-15T00:00:00+08:00", true, true},
		{"2026-02-23T23:59:59+08:00", true, true},
		{"2026-02-28T12:00:00+08:00", false, true},
		{"2026-04-06T12:00:00+08:00", true, true},
		{"2026-05-05T12:00:00+08:00", true, true},
		{"2026-05-09T12:00:00+08:00", false, true},
		{"2026-06-19T12:00:00+08:00", true, true},
		{"2026-09-20T12:00:00+08:00", false, true},
		{"2026-09-25T12:00:00+08:00", true, true},
		{"2026-09-30T16:00:00Z", true, true},
		{"2026-10-07T16:00:00Z", false, true},
		{"2026-10-10T12:00:00+08:00", false, true},
		{"2026-10-11T12:00:00+08:00", false, true},
		{"2027-01-01T12:00:00+08:00", false, false},
	} {
		t.Run(tc.date, func(t *testing.T) {
			date, err := time.Parse(time.RFC3339, tc.date)
			require.NoError(t, err)
			policy := GetSubscriptionFreezePolicy(date.Unix())
			assert.Equal(t, tc.allowed, policy.Allowed)
			assert.Equal(t, tc.known, policy.CalendarAvailable)
			assert.Equal(t, date.In(subscriptionHolidayTimezone).Format(time.DateOnly), policy.Date)
		})
	}
}

// Exact UserSubscription schema from the latest released v1.0.0-rc.41
// (2035a82aeb5414253a728bd937d4b8f97aa99b9b), before user_priority/frozen_at.
type releasedFreezeSubscription struct {
	Id                  int
	UserId              int    `gorm:"index;index:idx_user_sub_active,priority:1"`
	PlanId              int    `gorm:"index"`
	AmountTotal         int64  `gorm:"type:bigint;not null;default:0"`
	AmountUsed          int64  `gorm:"type:bigint;not null;default:0"`
	StartTime           int64  `gorm:"bigint"`
	EndTime             int64  `gorm:"bigint;index;index:idx_user_sub_active,priority:3"`
	Status              string `gorm:"type:varchar(32);index;index:idx_user_sub_active,priority:2"`
	Source              string `gorm:"type:varchar(32);default:'order'"`
	LastResetTime       int64  `gorm:"type:bigint;default:0"`
	NextResetTime       int64  `gorm:"type:bigint;default:0;index"`
	UpgradeGroup        string `gorm:"type:varchar(64);default:''"`
	PrevUserGroup       string `gorm:"type:varchar(64);default:''"`
	DowngradeGroup      string `gorm:"type:varchar(64);default:''"`
	AllowWalletOverflow bool
	CreatedAt           int64 `gorm:"bigint"`
	UpdatedAt           int64 `gorm:"bigint"`
}

func (releasedFreezeSubscription) TableName() string { return "freeze_test_user_subscriptions" }

func TestSubscriptionFreezeDatabaseLifecycle(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			var driver gorm.Dialector = sqlite.Open(filepath.Join(t.TempDir(), "freeze.db"))
			dbType := common.DatabaseTypeSQLite
			switch dialect {
			case "mysql":
				dsn := os.Getenv("TEST_MYSQL_DSN")
				if dsn == "" {
					t.Skip("TEST_MYSQL_DSN is not configured")
				}
				driver, dbType = mysql.Open(dsn), common.DatabaseTypeMySQL
			case "postgres":
				dsn := os.Getenv("TEST_POSTGRES_DSN")
				if dsn == "" {
					t.Skip("TEST_POSTGRES_DSN is not configured")
				}
				if strings.Contains(dsn, "://") {
					parsed, err := url.Parse(dsn)
					require.NoError(t, err)
					query := parsed.Query()
					query.Set("search_path", "subscription_freeze_test")
					parsed.RawQuery = query.Encode()
					dsn = parsed.String()
				} else {
					dsn += " search_path=subscription_freeze_test"
				}
				driver = postgres.New(postgres.Config{DSN: dsn, PreferSimpleProtocol: true})
				dbType = common.DatabaseTypePostgreSQL
			}
			db, err := gorm.Open(driver, &gorm.Config{NamingStrategy: schema.NamingStrategy{TablePrefix: "freeze_test_"}})
			require.NoError(t, err)
			if dialect == "postgres" {
				require.NoError(t, db.Exec("CREATE SCHEMA IF NOT EXISTS subscription_freeze_test").Error)
			}
			sqlDB, err := db.DB()
			require.NoError(t, err)
			sqlDB.SetMaxOpenConns(4)
			oldDB, oldLogDB := DB, LOG_DB
			oldMain, oldLog := common.MainDatabaseType(), common.LogDatabaseType()
			DB, LOG_DB = db, db
			common.SetDatabaseTypes(dbType, dbType)
			initCol()
			t.Cleanup(func() {
				require.NoError(t, db.Migrator().DropTable(&SubscriptionPreConsumeRecord{}, &UserSubscription{}, &SubscriptionPlan{}, &User{}))
				if dialect == "postgres" {
					require.NoError(t, db.Exec("DROP SCHEMA subscription_freeze_test CASCADE").Error)
				}
				DB, LOG_DB = oldDB, oldLogDB
				common.SetDatabaseTypes(oldMain, oldLog)
				initCol()
				require.NoError(t, sqlDB.Close())
			})
			var version string
			versionSQL := "SELECT version()"
			if dialect == "sqlite" {
				versionSQL = "SELECT sqlite_version()"
			}
			require.NoError(t, db.Raw(versionSQL).Scan(&version).Error)
			t.Logf("%s version: %s", dialect, version)
			for _, upgrade := range []bool{false, true} {
				t.Run(fmt.Sprintf("upgrade=%t", upgrade), func(t *testing.T) {
					require.NoError(t, db.Migrator().DropTable(&UserSubscription{}))
					if upgrade {
						require.NoError(t, db.AutoMigrate(&releasedFreezeSubscription{}))
						require.NoError(t, db.Create(&releasedFreezeSubscription{Id: 80, UserId: 9, PlanId: 1, Status: "active", EndTime: 2000000000, AmountTotal: 1234, AmountUsed: 345, NextResetTime: 1900000000, UpgradeGroup: "pro", PrevUserGroup: "default", AllowWalletOverflow: true}).Error)
					}
					for pass := range 2 {
						recorder := &migrationSQLRecorder{}
						require.NoError(t, db.Session(&gorm.Session{Logger: recorder}).AutoMigrate(&UserSubscription{}))
						if pass == 1 {
							assert.Empty(t, recorder.schemaMutations(), "restart must not alter the schema")
						}
					}
					assert.True(t, db.Migrator().HasIndex(&UserSubscription{}, "idx_user_sub_active"))
					if upgrade {
						var preserved UserSubscription
						require.NoError(t, db.First(&preserved, 80).Error)
						assert.EqualValues(t, 345, preserved.AmountUsed)
						assert.EqualValues(t, 1234, preserved.AmountTotal)
						assert.EqualValues(t, 2000000000, preserved.EndTime)
						assert.EqualValues(t, 1900000000, preserved.NextResetTime)
						assert.Equal(t, "pro", preserved.UpgradeGroup)
						assert.True(t, preserved.AllowWalletOverflow)
						assert.Zero(t, preserved.FrozenAt)
						require.NoError(t, db.Delete(&preserved).Error)
					}
				})
			}
			require.NoError(t, db.AutoMigrate(&User{}, &SubscriptionPlan{}, &SubscriptionPreConsumeRecord{}))
			user := User{Username: "freeze-user", Group: "pro", AuthVersion: 1}
			require.NoError(t, db.Create(&user).Error)
			plan := SubscriptionPlan{Title: "Freeze plan", DurationUnit: SubscriptionDurationMonth, DurationValue: 1, QuotaResetPeriod: SubscriptionResetDaily, TotalAmount: 1000}
			require.NoError(t, db.Create(&plan).Error)
			InvalidateSubscriptionPlanCache(plan.Id)
			t.Cleanup(func() { InvalidateSubscriptionPlanCache(plan.Id) })
			holiday := time.Date(2026, 10, 1, 12, 0, 0, 0, subscriptionHolidayTimezone).Unix()
			sub := UserSubscription{UserId: user.Id, PlanId: plan.Id, Status: "active", StartTime: holiday - 3600, EndTime: holiday + 86400, AmountTotal: 1000, AmountUsed: 250, LastResetTime: holiday - 3600, NextResetTime: holiday + 3600, UpgradeGroup: "pro", PrevUserGroup: "default"}
			require.NoError(t, db.Create(&sub).Error)
			apply := func(userId int, frozen bool, now int64) (*UserSubscription, error) {
				var result *UserSubscription
				err := db.Transaction(func(tx *gorm.DB) error {
					var err error
					result, err = setUserSubscriptionFrozenTx(tx, userId, sub.Id, frozen, func() int64 { return now })
					return err
				})
				return result, err
			}
			_, err = apply(user.Id+1, true, holiday)
			require.ErrorContains(t, err, "订阅不存在")
			_, err = apply(user.Id, true, holiday+10*86400)
			require.ErrorContains(t, err, "只能冻结有效订阅")
			_, err = apply(user.Id, true, holiday-86400)
			require.ErrorContains(t, err, "仅中国大陆法定节假日")
			require.NoError(t, db.Model(&UserSubscription{}).Where("id = ?", sub.Id).Updates(map[string]any{"status": "cancelled"}).Error)
			_, err = apply(user.Id, true, holiday)
			require.ErrorContains(t, err, "只能冻结有效订阅")
			require.NoError(t, db.Model(&UserSubscription{}).Where("id = ?", sub.Id).Updates(map[string]any{"status": "active", "end_time": int64(2000000000)}).Error)
			_, err = apply(user.Id, true, time.Date(2027, 1, 1, 12, 0, 0, 0, subscriptionHolidayTimezone).Unix())
			require.ErrorContains(t, err, "当前年份的节假日日历尚未配置")
			require.NoError(t, db.Model(&UserSubscription{}).Where("id = ?", sub.Id).Update("end_time", sub.EndTime).Error)
			frozen, err := apply(user.Id, true, holiday)
			require.NoError(t, err)
			assert.Equal(t, "frozen", frozen.Status)
			assert.Equal(t, holiday, frozen.FrozenAt)
			assert.EqualValues(t, 250, frozen.AmountUsed)
			require.NoError(t, db.Transaction(func(tx *gorm.DB) error {
				return maybeResetUserSubscriptionWithPlanTx(tx, frozen, &plan, holiday+11*86400)
			}))
			assert.EqualValues(t, 250, frozen.AmountUsed, "a reset worker must not reset a subscription frozen after selection")
			var updated User
			require.NoError(t, db.First(&updated, user.Id).Error)
			assert.Equal(t, "default", updated.Group)
			assert.EqualValues(t, 1, updated.AuthVersion)
			duplicate, err := apply(user.Id, true, holiday+3600)
			require.NoError(t, err)
			assert.Equal(t, holiday, duplicate.FrozenAt)
			active, err := HasActiveUserSubscription(user.Id)
			require.NoError(t, err)
			assert.False(t, active)
			_, err = PreConsumeUserSubscriptionWithGroupQuota("frozen-request", user.Id, "gpt-test", 100, 100)
			require.ErrorContains(t, err, "no active subscription")
			history, historyCount, err := GetInactiveUserSubscriptionsPaginated(user.Id, &common.PageInfo{})
			require.NoError(t, err)
			assert.Empty(t, history, "frozen subscriptions must remain in the main card")
			assert.Zero(t, historyCount)
			_, err = ExpireDueSubscriptions(100)
			require.NoError(t, err)
			_, err = ResetDueSubscriptions(100)
			require.NoError(t, err)
			require.NoError(t, PostConsumeUserSubscriptionDelta(sub.Id, 20))
			// Existing in-flight reservations can settle while frozen; new ones cannot.
			resumedAt := holiday + 11*86400
			resumed, err := apply(user.Id, false, resumedAt)
			require.NoError(t, err)
			assert.Equal(t, "active", resumed.Status)
			assert.Zero(t, resumed.FrozenAt)
			assert.Equal(t, sub.EndTime+11*86400, resumed.EndTime)
			assert.Equal(t, sub.NextResetTime+11*86400, resumed.NextResetTime)
			assert.Equal(t, sub.LastResetTime+11*86400, resumed.LastResetTime)
			assert.EqualValues(t, 270, resumed.AmountUsed)
			duplicate, err = apply(user.Id, false, resumedAt+1)
			require.NoError(t, err)
			assert.Equal(t, resumed.EndTime, duplicate.EndTime)
			require.NoError(t, db.First(&updated, user.Id).Error)
			assert.Equal(t, "pro", updated.Group)
			assert.EqualValues(t, 1, updated.AuthVersion)
			// Resuming never depends on holiday calendar availability.
			require.NoError(t, db.Model(&sub).Updates(map[string]any{"status": "frozen", "frozen_at": holiday, "end_time": int64(math.MaxInt64)}).Error)
			_, err = apply(user.Id, false, resumedAt)
			require.ErrorContains(t, err, "订阅时间超出有效范围")
			require.NoError(t, db.Model(&sub).Update("end_time", holiday+86400).Error)
			_, err = apply(user.Id, false, time.Date(2027, 1, 2, 12, 0, 0, 0, subscriptionHolidayTimezone).Unix())
			require.NoError(t, err)

			t.Run("repeated cycles preserve quota priority and exact paused duration", func(t *testing.T) {
				cyclePlan := SubscriptionPlan{Title: "no-reset cycle", QuotaResetPeriod: SubscriptionResetNever}
				require.NoError(t, db.Create(&cyclePlan).Error)
				InvalidateSubscriptionPlanCache(cyclePlan.Id)
				t.Cleanup(func() { InvalidateSubscriptionPlanCache(cyclePlan.Id) })
				cycle := UserSubscription{UserId: user.Id, PlanId: cyclePlan.Id, Status: "active", StartTime: holiday - 60, EndTime: holiday + 30*86400, AmountTotal: 1000, AmountUsed: 317, UserPriority: 9}
				require.NoError(t, db.Create(&cycle).Error)
				for _, step := range []struct {
					freeze, resume int64
				}{
					{holiday, holiday + 3661},
					{holiday + 2*86400, holiday + 2*86400 + 7200},
					{holiday + 3*86400, holiday + 3*86400},
				} {
					for _, frozen := range []bool{true, false, false} {
						now := step.resume
						if frozen {
							now = step.freeze
						}
						require.NoError(t, db.Transaction(func(tx *gorm.DB) error {
							_, err := setUserSubscriptionFrozenTx(tx, user.Id, cycle.Id, frozen, func() int64 { return now })
							return err
						}))
					}
				}
				var saved UserSubscription
				require.NoError(t, db.First(&saved, cycle.Id).Error)
				assert.Equal(t, cycle.EndTime+3661+7200, saved.EndTime)
				assert.Equal(t, cycle.StartTime, saved.StartTime)
				assert.Equal(t, cycle.UserPriority, saved.UserPriority)
				assert.EqualValues(t, 317, saved.AmountUsed, "repeated pausing cannot grant fresh quota")
				assert.Equal(t, "active", saved.Status)
				assert.Zero(t, saved.FrozenAt)
			})

			for _, period := range []string{SubscriptionResetNever, SubscriptionResetDaily, SubscriptionResetWeekly, SubscriptionResetMonthly, SubscriptionResetCustom} {
				t.Run("pause reset clock "+period, func(t *testing.T) {
					resetPlan := SubscriptionPlan{Title: "paused reset", QuotaResetPeriod: period, QuotaResetCustomSeconds: 3600}
					require.NoError(t, db.Create(&resetPlan).Error)
					InvalidateSubscriptionPlanCache(resetPlan.Id)
					t.Cleanup(func() { InvalidateSubscriptionPlanCache(resetPlan.Id) })
					lastReset := holiday - 60
					nextReset := calcNextResetTime(time.Unix(lastReset, 0), &resetPlan, holiday+90*86400)
					paused := UserSubscription{UserId: user.Id, PlanId: resetPlan.Id, Status: "active", StartTime: lastReset, EndTime: holiday + 90*86400, AmountTotal: 1000, AmountUsed: 317, LastResetTime: lastReset, NextResetTime: nextReset}
					require.NoError(t, db.Create(&paused).Error)
					for _, step := range []struct {
						frozen bool
						now    int64
					}{{true, holiday}, {false, holiday + 86400 + 1234}} {
						require.NoError(t, db.Transaction(func(tx *gorm.DB) error {
							_, err := setUserSubscriptionFrozenTx(tx, user.Id, paused.Id, step.frozen, func() int64 { return step.now })
							return err
						}))
						if step.frozen {
							_, err := AdminResetUserSubscriptionsByPlan(user.Id, resetPlan.Id, true)
							require.ErrorContains(t, err, "没有有效")
							result, err := AdminResetPlanSubscriptions(resetPlan.Id, true)
							require.NoError(t, err)
							assert.Zero(t, result.ResetCount)
						}
					}
					var saved UserSubscription
					require.NoError(t, db.First(&saved, paused.Id).Error)
					assert.EqualValues(t, 317, saved.AmountUsed)
					assert.Equal(t, paused.EndTime+86400+1234, saved.EndTime)
					if nextReset == 0 {
						assert.Zero(t, saved.NextResetTime)
						return
					}
					assert.Equal(t, nextReset+86400+1234, saved.NextResetTime)
					require.NoError(t, db.Transaction(func(tx *gorm.DB) error {
						return maybeResetUserSubscriptionWithPlanTx(tx, &saved, &resetPlan, saved.NextResetTime-1)
					}))
					assert.EqualValues(t, 317, saved.AmountUsed, "no reset before the postponed deadline")
					deadline := saved.NextResetTime
					require.NoError(t, db.Transaction(func(tx *gorm.DB) error {
						return maybeResetUserSubscriptionWithPlanTx(tx, &saved, &resetPlan, deadline)
					}))
					assert.Zero(t, saved.AmountUsed, "reset at the postponed deadline")
					assert.Equal(t, deadline, saved.LastResetTime, "the reset must begin at its actual postponed deadline")
					assert.Greater(t, saved.NextResetTime, deadline)
				})
			}

			t.Run("quota already due resets before freeze and then stays paused", func(t *testing.T) {
				duePlan := SubscriptionPlan{Title: "due reset", QuotaResetPeriod: SubscriptionResetCustom, QuotaResetCustomSeconds: 3600}
				require.NoError(t, db.Create(&duePlan).Error)
				InvalidateSubscriptionPlanCache(duePlan.Id)
				t.Cleanup(func() { InvalidateSubscriptionPlanCache(duePlan.Id) })
				due := UserSubscription{UserId: user.Id, PlanId: duePlan.Id, Status: "active", StartTime: holiday - 3600, EndTime: holiday + 30*86400, LastResetTime: holiday - 3600, NextResetTime: holiday, AmountTotal: 1000, AmountUsed: 317}
				require.NoError(t, db.Create(&due).Error)
				var saved *UserSubscription
				require.NoError(t, db.Transaction(func(tx *gorm.DB) error {
					var err error
					saved, err = setUserSubscriptionFrozenTx(tx, user.Id, due.Id, true, func() int64 { return holiday })
					return err
				}))
				assert.Zero(t, saved.AmountUsed)
				assert.Equal(t, holiday, saved.LastResetTime)
				assert.Equal(t, holiday+3600, saved.NextResetTime)
				require.NoError(t, PostConsumeUserSubscriptionDelta(due.Id, 20))
				require.NoError(t, db.Transaction(func(tx *gorm.DB) error {
					var err error
					saved, err = setUserSubscriptionFrozenTx(tx, user.Id, due.Id, false, func() int64 { return holiday + 2*86400 })
					return err
				}))
				assert.EqualValues(t, 20, saved.AmountUsed)
				assert.Equal(t, holiday+2*86400+3600, saved.NextResetTime)
			})

			t.Run("resume preserves an administrator changed baseline group", func(t *testing.T) {
				groupUser := User{Username: "freeze-group", AffCode: "freeze-group", Group: "pro", AuthVersion: 3}
				require.NoError(t, db.Create(&groupUser).Error)
				groupSub := UserSubscription{UserId: groupUser.Id, PlanId: plan.Id, Status: "active", StartTime: holiday - 60, EndTime: holiday + 30*86400, UpgradeGroup: "pro", PrevUserGroup: "default"}
				require.NoError(t, db.Create(&groupSub).Error)
				for i, step := range []struct {
					frozen bool
					group  string
				}{{true, "default"}, {false, "pro"}, {true, "manual"}} {
					if i == 1 {
						require.NoError(t, db.Model(&groupUser).Update("group", "manual").Error)
					}
					require.NoError(t, db.Transaction(func(tx *gorm.DB) error {
						_, err := setUserSubscriptionFrozenTx(tx, groupUser.Id, groupSub.Id, step.frozen, func() int64 { return holiday + int64(i)*3600 })
						return err
					}))
					var saved User
					require.NoError(t, db.First(&saved, groupUser.Id).Error)
					assert.Equal(t, step.group, saved.Group)
					assert.EqualValues(t, 3, saved.AuthVersion)
				}
			})

			t.Run("invalid resume rollback and cancelled frozen subscription cannot revive", func(t *testing.T) {
				invalid := UserSubscription{UserId: user.Id, PlanId: plan.Id, Status: "frozen", FrozenAt: holiday, EndTime: holiday + 86400, AmountUsed: 317}
				require.NoError(t, db.Create(&invalid).Error)
				for _, badClock := range []int64{holiday - 1, holiday} {
					if badClock == holiday {
						require.NoError(t, db.Model(&invalid).Update("frozen_at", 0).Error)
					}
					err := db.Transaction(func(tx *gorm.DB) error {
						_, err := setUserSubscriptionFrozenTx(tx, user.Id, invalid.Id, false, func() int64 { return badClock })
						return err
					})
					require.ErrorContains(t, err, "订阅无法解冻")
					var saved UserSubscription
					require.NoError(t, db.First(&saved, invalid.Id).Error)
					assert.Equal(t, "frozen", saved.Status)
					assert.EqualValues(t, 317, saved.AmountUsed)
					assert.Equal(t, invalid.EndTime, saved.EndTime)
				}
				require.NoError(t, db.Model(&invalid).Update("frozen_at", holiday).Error)
				_, err := AdminInvalidateUserSubscription(invalid.Id)
				require.NoError(t, err)
				_, err = SetUserSubscriptionFrozen(user.Id, invalid.Id, false)
				require.ErrorContains(t, err, "订阅无法解冻")
				var saved UserSubscription
				require.NoError(t, db.First(&saved, invalid.Id).Error)
				assert.Equal(t, "cancelled", saved.Status)
				assert.EqualValues(t, 317, saved.AmountUsed)
			})

			for _, timestamp := range []string{"end_time", "last_reset_time", "next_reset_time"} {
				t.Run("resume overflow rolls back "+timestamp, func(t *testing.T) {
					overflow := UserSubscription{UserId: user.Id, PlanId: plan.Id, Status: "frozen", FrozenAt: holiday, EndTime: holiday + 86400, LastResetTime: holiday - 3600, NextResetTime: holiday + 3600, AmountUsed: 317}
					require.NoError(t, db.Create(&overflow).Error)
					require.NoError(t, db.Model(&overflow).Update(timestamp, int64(math.MaxInt64)).Error)
					var before UserSubscription
					require.NoError(t, db.First(&before, overflow.Id).Error)
					err := db.Transaction(func(tx *gorm.DB) error {
						_, err := setUserSubscriptionFrozenTx(tx, user.Id, overflow.Id, false, func() int64 { return holiday + 3600 })
						return err
					})
					require.ErrorContains(t, err, "订阅时间超出有效范围")
					var after UserSubscription
					require.NoError(t, db.First(&after, overflow.Id).Error)
					assert.Equal(t, before, after, "failed resume must not extend some timestamps or alter quota/group state")
				})
			}

			t.Run("reservation before freeze remains refundable and new requests are excluded", func(t *testing.T) {
				billingUser := User{Username: "freeze-ledger", AffCode: "freeze-ledger", Group: "default"}
				require.NoError(t, db.Create(&billingUser).Error)
				billingPlan := SubscriptionPlan{Title: "freeze-ledger", QuotaResetPeriod: SubscriptionResetNever}
				require.NoError(t, db.Create(&billingPlan).Error)
				InvalidateSubscriptionPlanCache(billingPlan.Id)
				t.Cleanup(func() { InvalidateSubscriptionPlanCache(billingPlan.Id) })
				billingSub := UserSubscription{UserId: billingUser.Id, PlanId: billingPlan.Id, Status: "active", StartTime: holiday - 60, EndTime: holiday + 30*86400, AmountTotal: 1000, AmountUsed: 317}
				require.NoError(t, db.Create(&billingSub).Error)
				reservation, err := PreConsumeUserSubscriptionWithGroupQuota("before-freeze", billingUser.Id, "gpt-test", 100, 100)
				require.NoError(t, err)
				assert.EqualValues(t, 417, reservation.AmountUsedAfter)
				frozenSaved := make(chan struct{})
				releaseFreeze := make(chan struct{})
				freezeResult := make(chan error, 1)
				go func() {
					freezeResult <- db.Transaction(func(tx *gorm.DB) error {
						_, err := setUserSubscriptionFrozenTx(tx, billingUser.Id, billingSub.Id, true, func() int64 { return holiday })
						close(frozenSaved)
						<-releaseFreeze
						return err
					})
				}()
				<-frozenSaved
				started := make(chan struct{})
				consumeResult := make(chan error, 1)
				go func() {
					close(started)
					_, err := PreConsumeUserSubscriptionWithGroupQuota("during-freeze", billingUser.Id, "gpt-test", 100, 100)
					consumeResult <- err
				}()
				<-started
				close(releaseFreeze)
				require.NoError(t, <-freezeResult)
				require.Error(t, <-consumeResult, "concurrent new reservations must not charge the frozen plan")
				_, err = PreConsumeUserSubscriptionWithGroupQuota("after-freeze", billingUser.Id, "gpt-test", 100, 100)
				require.ErrorContains(t, err, "no active subscription")
				replay, err := PreConsumeUserSubscriptionWithGroupQuota("before-freeze", billingUser.Id, "gpt-test", 100, 100)
				require.NoError(t, err)
				assert.Equal(t, reservation.UserSubscriptionId, replay.UserSubscriptionId)
				assert.Equal(t, reservation.PreConsumed, replay.PreConsumed)
				require.NoError(t, RefundSubscriptionPreConsume("before-freeze"))
				require.NoError(t, RefundSubscriptionPreConsume("before-freeze"))
				_, err = PreConsumeUserSubscriptionWithGroupQuota("before-freeze", billingUser.Id, "gpt-test", 100, 100)
				require.ErrorContains(t, err, "already refunded")
				var saved UserSubscription
				require.NoError(t, db.First(&saved, billingSub.Id).Error)
				assert.Equal(t, "frozen", saved.Status)
				assert.EqualValues(t, 317, saved.AmountUsed)
				var records []SubscriptionPreConsumeRecord
				require.NoError(t, db.Where("user_id = ?", billingUser.Id).Find(&records).Error)
				require.Len(t, records, 1, "rejected new requests cannot leave reservations behind")
				assert.Equal(t, "refunded", records[0].Status)
			})

			if dialect != "sqlite" {
				t.Run("concurrent settlement and resume preserve charged quota", func(t *testing.T) {
					settling := UserSubscription{UserId: user.Id, PlanId: plan.Id, Status: "frozen", FrozenAt: holiday, StartTime: holiday - 60, EndTime: holiday + 30*86400, AmountTotal: 1000, AmountUsed: 317}
					require.NoError(t, db.Create(&settling).Error)
					resumedSaved := make(chan struct{})
					releaseResume := make(chan struct{})
					resumeResult := make(chan error, 1)
					go func() {
						resumeResult <- db.Transaction(func(tx *gorm.DB) error {
							_, err := setUserSubscriptionFrozenTx(tx, user.Id, settling.Id, false, func() int64 { return holiday + 3600 })
							close(resumedSaved)
							<-releaseResume
							return err
						})
					}()
					<-resumedSaved
					settleStarted := make(chan struct{})
					settleResult := make(chan error, 1)
					go func() {
						close(settleStarted)
						settleResult <- PostConsumeUserSubscriptionDelta(settling.Id, 37)
					}()
					<-settleStarted
					close(releaseResume)
					require.NoError(t, <-resumeResult)
					require.NoError(t, <-settleResult)
					var saved UserSubscription
					require.NoError(t, db.First(&saved, settling.Id).Error)
					assert.Equal(t, "active", saved.Status)
					assert.EqualValues(t, 354, saved.AmountUsed)
					assert.Equal(t, settling.EndTime+3600, saved.EndTime)
				})
			}

			t.Run("freeze both subscriptions removes the shared upgraded group", func(t *testing.T) {
				otherUser := User{Username: "freeze-sibling-user", Group: "pro", AffCode: "freeze-sibling"}
				require.NoError(t, db.Create(&otherUser).Error)
				for _, previousGroup := range []string{"default", ""} {
					sibling := UserSubscription{UserId: otherUser.Id, PlanId: plan.Id, Status: "active", StartTime: holiday, EndTime: holiday + 86400, UpgradeGroup: "pro", PrevUserGroup: previousGroup}
					require.NoError(t, db.Create(&sibling).Error)
				}
				var siblings []UserSubscription
				require.NoError(t, db.Where("user_id = ?", otherUser.Id).Order("id asc").Find(&siblings).Error)
				for i, sibling := range siblings {
					require.NoError(t, db.Transaction(func(tx *gorm.DB) error {
						_, err := setUserSubscriptionFrozenTx(tx, otherUser.Id, sibling.Id, true, func() int64 { return holiday })
						return err
					}))
					var saved User
					require.NoError(t, db.First(&saved, otherUser.Id).Error)
					want := "pro"
					if i == 1 {
						want = "default"
					}
					assert.Equal(t, want, saved.Group)
				}
				if dialect == "sqlite" {
					return // SQLite serializes writers by rejecting conflicting transactions.
				}
				for _, sibling := range siblings {
					require.NoError(t, db.Transaction(func(tx *gorm.DB) error {
						_, err := setUserSubscriptionFrozenTx(tx, otherUser.Id, sibling.Id, false, func() int64 { return holiday + 3600 })
						return err
					}))
				}
				start := make(chan struct{})
				results := make(chan error, len(siblings))
				for _, sibling := range siblings {
					go func() {
						<-start
						results <- db.Transaction(func(tx *gorm.DB) error {
							_, err := setUserSubscriptionFrozenTx(tx, otherUser.Id, sibling.Id, true, func() int64 { return holiday + 7200 })
							return err
						})
					}()
				}
				close(start)
				for range siblings {
					require.NoError(t, <-results)
				}
				var saved User
				require.NoError(t, db.First(&saved, otherUser.Id).Error)
				assert.Equal(t, "default", saved.Group, "simultaneous freezes must also remove the upgraded group")
			})
		})
	}
}
