package model

import (
	"fmt"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"gorm.io/gorm/schema"
)

func TestGiftQuotaDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			var driver gorm.Dialector
			switch dialect {
			case "sqlite":
				driver = sqlite.Open(":memory:")
			case "mysql":
				if os.Getenv("TEST_MYSQL_DSN") == "" {
					t.Skip("TEST_MYSQL_DSN not configured")
				}
				driver = mysql.Open(os.Getenv("TEST_MYSQL_DSN"))
			case "postgres":
				if os.Getenv("TEST_POSTGRES_DSN") == "" {
					t.Skip("TEST_POSTGRES_DSN not configured")
				}
				driver = postgres.Open(os.Getenv("TEST_POSTGRES_DSN"))
			}
			db, err := gorm.Open(driver, &gorm.Config{NamingStrategy: schema.NamingStrategy{TablePrefix: "gift_wallet_test_"}, Logger: logger.Default.LogMode(logger.Silent)})
			require.NoError(t, err)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			if dialect == "sqlite" {
				sqlDB.SetMaxOpenConns(1)
			}
			oldDB, oldType, oldRedis, oldBatch := DB, common.MainDatabaseType(), common.RedisEnabled, common.BatchUpdateEnabled
			DB = db
			common.SetMainDatabaseType(common.DatabaseType(dialect))
			common.RedisEnabled = false
			common.BatchUpdateEnabled = true
			models := []any{&User{}, &GiftQuota{}, &WalletGiftAllocation{}, &Token{}}
			t.Cleanup(func() {
				require.NoError(t, db.Migrator().DropTable(models...))
				DB = oldDB
				common.SetMainDatabaseType(oldType)
				common.RedisEnabled = oldRedis
				common.BatchUpdateEnabled = oldBatch
				require.NoError(t, sqlDB.Close())
			})
			// Repeated upgrade leaves existing paid balances untouched.
			require.NoError(t, db.AutoMigrate(&User{}))
			legacy := createReserveTestUser(t, 1000)
			for range 2 {
				require.NoError(t, db.AutoMigrate(models...))
			}
			b, err := GetWalletBalance(legacy.Id)
			require.NoError(t, err)
			require.Equal(t, WalletBalance{Quota: 1000, BalanceQuota: 1000}, b)
			versionQuery := "SELECT version()"
			if dialect == "sqlite" {
				versionQuery = "SELECT sqlite_version()"
			}
			var version string
			require.NoError(t, db.Raw(versionQuery).Scan(&version).Error)
			t.Log("database:", version)
			t.Run("grant consumes gifts before paid and partial refund preserves expiry", func(t *testing.T) {
				user := createReserveTestUser(t, 1000)
				gift, err := GrantGiftQuota(user.Id, 500, "admin", fmt.Sprintf("admin:%d", user.Id))
				require.NoError(t, err)
				duplicate, err := GrantGiftQuota(user.Id, 500, "admin", gift.Reference)
				require.NoError(t, err)
				require.Equal(t, gift.Id, duplicate.Id)
				_, err = GrantGiftQuota(user.Id, 501, "admin", gift.Reference)
				require.Error(t, err)
				require.Equal(t, gift.GrantedAt+GiftQuotaLifetime, gift.ExpiresAt)
				ok, err := ConsumeWalletQuota(user.Id, "partial-refund", 650, true)
				require.NoError(t, err)
				require.True(t, ok)
				b, err := GetWalletBalance(user.Id)
				require.NoError(t, err)
				require.Equal(t, 850, b.BalanceQuota)
				require.Zero(t, b.GiftQuota)
				require.NoError(t, RefundWalletQuota(user.Id, "partial-refund", 250))
				b, err = GetWalletBalance(user.Id)
				require.NoError(t, err)
				require.Equal(t, 1000, b.BalanceQuota)
				require.Equal(t, 100, b.GiftQuota)
				require.NoError(t, db.First(gift, gift.Id).Error)
				require.Equal(t, 100, gift.Remaining)
				require.NoError(t, RefundWalletQuota(user.Id, "partial-refund", 400))
				require.Error(t, RefundWalletQuota(user.Id, "partial-refund", 1), "the allocation cannot be refunded twice")
				b, err = GetWalletBalance(user.Id)
				require.NoError(t, err)
				require.Equal(t, 1500, b.Quota)
				require.Equal(t, 1000, b.BalanceQuota)
				require.Equal(t, 500, b.GiftQuota)
			})
			t.Run("expiry drops only unused gifts and keeps permanent balance", func(t *testing.T) {
				user := createReserveTestUser(t, 200)
				gift, err := GrantGiftQuota(user.Id, 500, "admin", fmt.Sprintf("expiry:%d", user.Id))
				require.NoError(t, err)
				ok, err := ConsumeWalletQuota(user.Id, "expiry-charge", 300, true)
				require.NoError(t, err)
				require.True(t, ok)
				require.NoError(t, db.Model(gift).Update("expires_at", common.GetTimestamp()).Error)
				require.NoError(t, ExpireDueGiftQuota(100))
				require.NoError(t, ExpireDueGiftQuota(100))
				b, err := GetWalletBalance(user.Id)
				require.NoError(t, err)
				require.Equal(t, 200, b.Quota)
				require.Equal(t, 200, b.BalanceQuota)
				require.Zero(t, b.GiftQuota)
				require.NoError(t, RefundWalletQuota(user.Id, "expiry-charge", 300))
				b, err = GetWalletBalance(user.Id)
				require.NoError(t, err)
				require.Equal(t, 200, b.Quota)
				records, total, err := ListGiftQuota(user.Id, 0, 10)
				require.NoError(t, err)
				require.EqualValues(t, 1, total)
				require.Equal(t, 500, records[0].Expired)
				require.Zero(t, records[0].Remaining)
				require.Positive(t, records[0].ExpiredAt)
			})
			t.Run("same request reserve supplement and refund reverse expiry priority", func(t *testing.T) {
				user := createReserveTestUser(t, 100)
				late, err := GrantGiftQuota(user.Id, 300, "admin", fmt.Sprintf("later:%d", user.Id))
				require.NoError(t, err)
				early, err := GrantGiftQuota(user.Id, 200, "admin", fmt.Sprintf("earlier:%d", user.Id))
				require.NoError(t, err)
				require.NoError(t, db.Model(early).Update("expires_at", early.ExpiresAt-60).Error)
				for _, amount := range []int{150, 250, 150} {
					ok, err := ConsumeWalletQuota(user.Id, "supplements", amount, true)
					require.NoError(t, err)
					require.True(t, ok)
				}
				require.NoError(t, RefundWalletQuota(user.Id, "supplements", 200))
				b, err := GetWalletBalance(user.Id)
				require.NoError(t, err)
				require.Equal(t, 100, b.BalanceQuota)
				require.Equal(t, 150, b.GiftQuota)
				require.NoError(t, db.First(late, late.Id).Error)
				require.Equal(t, 150, late.Remaining)
				require.NoError(t, db.First(early, early.Id).Error)
				require.Zero(t, early.Remaining)
			})
			t.Run("concurrent requests never double spend gifted funds", func(t *testing.T) {
				user := createReserveTestUser(t, 100)
				_, err := GrantGiftQuota(user.Id, 500, "admin", fmt.Sprintf("concurrent:%d", user.Id))
				require.NoError(t, err)
				var wg sync.WaitGroup
				var success atomic.Int64
				errorsCh := make(chan error, 24)
				for i := range 24 {
					wg.Go(func() {
						ok, err := ConsumeWalletQuota(user.Id, fmt.Sprintf("parallel-%d", i), 50, true)
						if err != nil {
							errorsCh <- err
						}
						if ok {
							success.Add(1)
						}
					})
				}
				wg.Wait()
				close(errorsCh)
				for err := range errorsCh {
					require.NoError(t, err)
				}
				require.EqualValues(t, 12, success.Load())
				b, err := GetWalletBalance(user.Id)
				require.NoError(t, err)
				require.Zero(t, b.Quota)
				require.Zero(t, b.GiftQuota)
			})
			t.Run("admin balance adjustment does not overwrite gifts", func(t *testing.T) {
				user := createReserveTestUser(t, 100)
				_, err := AdjustUserQuota(user.Id, common.RoleRootUser, "add", 500, "gift")
				require.NoError(t, err)
				_, err = AdjustUserQuota(user.Id, common.RoleRootUser, "override", 200, "balance")
				require.NoError(t, err)
				b, err := GetWalletBalance(user.Id)
				require.NoError(t, err)
				require.Equal(t, 200, b.BalanceQuota)
				require.Equal(t, 500, b.GiftQuota)
				_, err = AdjustUserQuota(user.Id, common.RoleRootUser, "subtract", 100, "gift")
				require.ErrorIs(t, err, ErrInvalidUserQuotaAdjustment)
				_, err = AdjustUserQuota(user.Id, common.RoleCommonUser, "add", 100, "gift")
				require.ErrorIs(t, err, ErrUserQuotaPermission)
				_, err = AdjustUserQuota(user.Id, common.RoleRootUser, "add", 100, "wrong")
				require.ErrorIs(t, err, ErrInvalidUserQuotaAdjustment)
			})
			t.Run("permanent topup and redemption remain after gifts expire", func(t *testing.T) {
				user := createReserveTestUser(t, 0)
				gift, err := GrantGiftQuota(user.Id, 500, "admin", fmt.Sprintf("paid:%d", user.Id))
				require.NoError(t, err)
				require.NoError(t, db.Transaction(func(tx *gorm.DB) error { return creditTopUpQuota(tx, user.Id, 1000, nil) }))
				b, err := GetWalletBalance(user.Id)
				require.NoError(t, err)
				require.Equal(t, 1000, b.BalanceQuota)
				require.Equal(t, 500, b.GiftQuota)
				require.NoError(t, db.Model(gift).Update("expires_at", time.Now().Unix()-1).Error)
				b, err = GetWalletBalance(user.Id)
				require.NoError(t, err)
				require.Equal(t, 1000, b.Quota)
				require.Zero(t, b.GiftQuota)
			})

			t.Run("historical reclassification preserves total and paid funds and is idempotent", func(t *testing.T) {
				user := createReserveTestUser(t, 1300)
				original := common.GetTimestamp() - 5*24*3600
				migration := LegacyGiftQuotaMigration{UserID: user.Id, Reference: fmt.Sprintf("yaohuo-legacy:%d", user.Id), Granted: 500, Remaining: 300, GrantedAt: original, ExpectedQuota: 1300}
				var gift *GiftQuota
				require.NoError(t, db.Transaction(func(tx *gorm.DB) error {
					var err error
					gift, err = MigrateLegacyGiftQuotaTx(tx, migration)
					return err
				}))
				b, err := GetWalletBalance(user.Id)
				require.NoError(t, err)
				require.Equal(t, 1300, b.Quota)
				require.Equal(t, 1000, b.BalanceQuota)
				require.Equal(t, 300, b.GiftQuota)
				require.Equal(t, original+GiftQuotaLifetime, gift.ExpiresAt)
				ok, err := ConsumeWalletQuota(user.Id, "after-migration", 100, true)
				require.NoError(t, err)
				require.True(t, ok)
				require.NoError(t, db.Transaction(func(tx *gorm.DB) error { _, err := MigrateLegacyGiftQuotaTx(tx, migration); return err }))
				b, err = GetWalletBalance(user.Id)
				require.NoError(t, err)
				require.Equal(t, 1200, b.Quota)
				require.Equal(t, 200, b.GiftQuota)
				migration.Reference += "-changed"
				migration.ExpectedQuota = 1300
				require.Error(t, db.Transaction(func(tx *gorm.DB) error { _, err := MigrateLegacyGiftQuotaTx(tx, migration); return err }))
			})
			t.Run("failure rolls back allocations and expired gifts cannot authorize", func(t *testing.T) {
				user := createReserveTestUser(t, 0)
				gift, err := GrantGiftQuota(user.Id, 500, "admin", fmt.Sprintf("reject:%d", user.Id))
				require.NoError(t, err)
				require.NoError(t, db.Model(gift).Update("expires_at", time.Now().Unix()).Error)
				ok, err := ConsumeWalletQuota(user.Id, "insufficient", 1, true)
				require.NoError(t, err)
				require.False(t, ok)
				require.NoError(t, db.First(gift, gift.Id).Error)
				require.Equal(t, 500, gift.Expired)
				var count int64
				require.NoError(t, db.Model(&WalletGiftAllocation{}).Where("user_id = ?", user.Id).Count(&count).Error)
				require.Zero(t, count)
				_, err = ConsumeWalletQuota(user.Id, "invalid", -1, true)
				require.Error(t, err)
				_, err = GrantGiftQuota(user.Id, common.MaxWalletQuota+1, "admin", "overflow")
				require.Error(t, err)
			})
		})
	}
}

func TestGiftQuotaAutomaticRewardSources(t *testing.T) {
	truncateTables(t)
	require.NoError(t, DB.AutoMigrate(&Checkin{}))
	t.Cleanup(func() { DB.Exec("DELETE FROM checkins") })
	originalSignup := common.QuotaForNewUser
	common.QuotaForNewUser = 500
	t.Cleanup(func() { common.QuotaForNewUser = originalSignup })
	user := &User{Username: "gift-signup-only", Role: common.RoleCommonUser, Status: common.UserStatusEnabled}
	require.NoError(t, DB.Transaction(func(tx *gorm.DB) error { return user.InsertWithTx(tx, 0) }))
	balance, err := GetWalletBalance(user.Id)
	require.NoError(t, err)
	require.Zero(t, balance.BalanceQuota)
	require.Equal(t, 500, balance.GiftQuota)
	checkin := &Checkin{UserId: user.Id, CheckinDate: "2026-11-10", QuotaAwarded: 100, CreatedAt: common.GetTimestamp()}
	_, err = userCheckinWithTransaction(checkin, user.Id, 100)
	require.NoError(t, err)
	_, err = userCheckinWithTransaction(&Checkin{UserId: user.Id, CheckinDate: checkin.CheckinDate, QuotaAwarded: 100, CreatedAt: checkin.CreatedAt}, user.Id, 100)
	require.Error(t, err)
	balance, err = GetWalletBalance(user.Id)
	require.NoError(t, err)
	require.Equal(t, 600, balance.GiftQuota)
	require.NoError(t, DB.Model(&User{}).Where("id = ?", user.Id).Update("aff_quota", 10000).Error)
	require.NoError(t, user.TransferAffQuotaToQuota(5000))
	balance, err = GetWalletBalance(user.Id)
	require.NoError(t, err)
	require.Zero(t, balance.BalanceQuota)
	require.Equal(t, 5600, balance.GiftQuota)
	require.NoError(t, DB.First(user, user.Id).Error)
	require.Equal(t, 5000, user.AffQuota)
	records, total, err := ListGiftQuota(user.Id, 0, 10)
	require.NoError(t, err)
	require.EqualValues(t, 3, total)
	for _, record := range records {
		require.Equal(t, GiftQuotaLifetime, record.ExpiresAt-record.GrantedAt)
	}
}
