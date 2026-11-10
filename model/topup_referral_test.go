package model

import (
	"os"
	"sync"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/schema"
)

func TestTopUpReferralSettlementDatabaseMatrix(t *testing.T) {
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
			db, err := gorm.Open(driver, &gorm.Config{NamingStrategy: schema.NamingStrategy{TablePrefix: "referral_test_"}})
			require.NoError(t, err)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			if dialect == "sqlite" {
				sqlDB.SetMaxOpenConns(1)
			}
			previousDB, previousLogDB := DB, LOG_DB
			previousType := common.MainDatabaseType()
			previousQPU := common.QuotaPerUnit
			payment := operation_setting.GetPaymentSetting()
			previousPayment := *payment
			common.OptionMapRWMutex.Lock()
			previousOptions := common.OptionMap
			common.OptionMap = map[string]string{"ReferralRewardPercent": "5"}
			common.OptionMapRWMutex.Unlock()
			DB, LOG_DB = db, db
			versionSQL := "SELECT version()"
			if dialect == "sqlite" {
				versionSQL = "SELECT sqlite_version()"
			}
			var version string
			require.NoError(t, db.Raw(versionSQL).Scan(&version).Error)
			t.Logf("database version: %s", version)
			common.SetMainDatabaseType(common.DatabaseType(dialect))
			common.QuotaPerUnit = 500000
			payment.ComplianceConfirmed, payment.ComplianceTermsVersion = true, operation_setting.CurrentComplianceTermsVersion
			t.Cleanup(func() {
				assert.NoError(t, db.Migrator().DropTable(&TopUp{}, &User{}, &Log{}, &SubscriptionOrder{}, &SubscriptionPlan{}, &UserSubscription{}))
				DB, LOG_DB = previousDB, previousLogDB
				common.SetMainDatabaseType(previousType)
				common.QuotaPerUnit = previousQPU
				*payment = previousPayment
				common.OptionMapRWMutex.Lock()
				common.OptionMap = previousOptions
				common.OptionMapRWMutex.Unlock()
				assert.NoError(t, sqlDB.Close())
			})
			require.NoError(t, db.AutoMigrate(&User{}, &TopUp{}, &Log{}, &SubscriptionOrder{}, &SubscriptionPlan{}, &UserSubscription{}))
			// Upgrade a representative old table with an existing order and unique index.
			for _, col := range []string{"ReferralUserId", "ReferralQuota", "ReferralPercent"} {
				require.NoError(t, db.Migrator().DropColumn(&TopUp{}, col))
			}
			require.NoError(t, db.Table("referral_test_top_ups").Create(map[string]any{"id": 990, "trade_no": "legacy-success", "status": common.TopUpStatusSuccess, "money": 100}).Error)
			require.NoError(t, db.AutoMigrate(&TopUp{}))
			require.NoError(t, db.AutoMigrate(&TopUp{}))
			var legacy TopUp
			require.NoError(t, db.First(&legacy, 990).Error)
			assert.Equal(t, common.TopUpStatusSuccess, legacy.Status)
			assert.Zero(t, legacy.ReferralQuota)
			require.Error(t, db.Create(&TopUp{TradeNo: "legacy-success"}).Error)
			inviter := &User{Id: 8101, Username: "reward_inviter", Status: common.UserStatusEnabled, AffCode: "reward_a"}
			invitee := &User{Id: 8102, Username: "reward_invitee", Status: common.UserStatusEnabled, InviterId: inviter.Id, AffCode: "reward_b"}
			require.NoError(t, db.Create(inviter).Error)
			require.NoError(t, db.Create(invitee).Error)
			for _, tc := range []struct {
				name, provider string
				complete       func(string) error
			}{
				{"hupijiao", PaymentProviderHupijiao, func(trade string) error { return RechargeByHupijiao(trade, 100) }},
				{"epay", PaymentProviderEpay, func(trade string) error { _, err := RechargeEpay(trade, "alipay", ""); return err }},
				{"manual", PaymentProviderHupijiao, func(trade string) error { return ManualCompleteTopUp(trade, "") }},
			} {
				t.Run(tc.name, func(t *testing.T) {
					require.NoError(t, db.Model(inviter).Updates(map[string]any{"aff_quota": 0, "aff_history": 0}).Error)
					amount := int64(100)
					if tc.provider == PaymentProviderHupijiao {
						amount = 10000
					}
					order := &TopUp{UserId: invitee.Id, Amount: amount, Money: 100, TradeNo: "referral-" + tc.name, PaymentProvider: tc.provider, PaymentMethod: "alipay", Status: common.TopUpStatusPending}
					require.NoError(t, db.Create(order).Error)
					var wg sync.WaitGroup
					results := make(chan error, 2)
					for range 2 {
						wg.Go(func() { results <- tc.complete(order.TradeNo) })
					}
					wg.Wait()
					close(results)
					for err := range results {
						require.NoError(t, err)
					}
					require.NoError(t, db.First(inviter, inviter.Id).Error)
					assert.Equal(t, 2500000, inviter.AffQuota)
					assert.Equal(t, 2500000, inviter.AffHistoryQuota)
					assert.Zero(t, inviter.Quota)
					require.NoError(t, db.First(order, order.Id).Error)
					assert.Equal(t, inviter.Id, order.ReferralUserId)
					assert.Equal(t, 2500000, order.ReferralQuota)
					assert.Equal(t, float64(5), order.ReferralPercent)
				})
			}
			t.Run("reward uses paid amount rather than promotional quota", func(t *testing.T) {
				order := &TopUp{UserId: invitee.Id, Amount: 50000, Money: 80, TradeNo: "discount-reward", PaymentProvider: PaymentProviderHupijiao, Status: common.TopUpStatusPending}
				require.NoError(t, db.Create(order).Error)
				require.NoError(t, RechargeByHupijiao(order.TradeNo, 80))
				require.NoError(t, db.First(order, order.Id).Error)
				assert.Equal(t, 2000000, order.ReferralQuota)
			})
			for _, provider := range []string{SubscriptionPaymentProviderHupijiao, PaymentProviderEpay} {
				t.Run("subscription purchase rewards once through "+provider, func(t *testing.T) {
					require.NoError(t, db.Model(inviter).Updates(map[string]any{"aff_quota": 0, "aff_history": 0}).Error)
					plan := &SubscriptionPlan{Title: "Referral subscription", PriceCNY: 100, PriceAmount: 100, Currency: "USD", DurationUnit: SubscriptionDurationMonth, DurationValue: 1, Enabled: true, TotalAmount: 50000000}
					require.NoError(t, db.Create(plan).Error)
					order := &SubscriptionOrder{UserId: invitee.Id, PlanId: plan.Id, Money: 100, TradeNo: "subscription-reward-" + provider, PaymentMethod: "alipay", PaymentProvider: provider, Status: common.TopUpStatusPending}
					require.NoError(t, order.Insert())
					if provider == PaymentProviderEpay {
						require.NoError(t, db.Create(&TopUp{UserId: invitee.Id, Money: 100, TradeNo: order.TradeNo, PaymentProvider: provider, Status: common.TopUpStatusPending}).Error)
					}
					var buyerBefore User
					require.NoError(t, db.First(&buyerBefore, invitee.Id).Error)
					var wg sync.WaitGroup
					results := make(chan error, 2)
					for range 2 {
						wg.Go(func() {
							if provider == SubscriptionPaymentProviderHupijiao {
								results <- CompleteHupijiaoSubscriptionOrder(order.TradeNo, 100, "{}")
							} else {
								results <- CompleteSubscriptionOrder(order.TradeNo, "{}", provider, "alipay")
							}
						})
					}
					wg.Wait()
					close(results)
					for err := range results {
						require.NoError(t, err)
					}
					require.NoError(t, db.First(inviter, inviter.Id).Error)
					assert.Equal(t, 2500000, inviter.AffQuota)
					assert.Equal(t, 2500000, inviter.AffHistoryQuota)
					var receipt TopUp
					require.NoError(t, db.Where("trade_no = ?", order.TradeNo).First(&receipt).Error)
					assert.Equal(t, 2500000, receipt.ReferralQuota)
					assert.Equal(t, inviter.Id, receipt.ReferralUserId)
					assert.Zero(t, receipt.Amount)
					var buyerAfter User
					require.NoError(t, db.First(&buyerAfter, invitee.Id).Error)
					assert.Equal(t, buyerBefore.Quota, buyerAfter.Quota, "subscription must not credit the wallet")
					var count int64
					require.NoError(t, db.Model(&UserSubscription{}).Where("user_id = ? AND plan_id = ?", invitee.Id, plan.Id).Count(&count).Error)
					assert.Equal(t, int64(1), count)
				})
			}
			t.Run("balance subscription does not reward twice after a wallet recharge", func(t *testing.T) {
				require.NoError(t, db.Model(inviter).Updates(map[string]any{"aff_quota": 0, "aff_history": 0}).Error)
				plan := &SubscriptionPlan{Title: "Balance subscription", PriceAmount: 1, Currency: "USD", DurationUnit: SubscriptionDurationMonth, DurationValue: 1, Enabled: true, TotalAmount: 500000}
				require.NoError(t, db.Create(plan).Error)
				require.NoError(t, PurchaseSubscriptionWithBalance(invitee.Id, plan.Id))
				require.NoError(t, db.First(inviter, inviter.Id).Error)
				assert.Zero(t, inviter.AffQuota)
			})
			t.Run("failed subscription payment rolls back receipt and rewards", func(t *testing.T) {
				require.NoError(t, db.Model(inviter).Updates(map[string]any{"aff_quota": 0, "aff_history": 0}).Error)
				order := &SubscriptionOrder{UserId: invitee.Id, PlanId: 999999, Money: 100, TradeNo: "subscription-invalid-plan", PaymentMethod: "alipay", PaymentProvider: SubscriptionPaymentProviderHupijiao, Status: common.TopUpStatusPending}
				// Seed a historical invalid order directly: new checkout validation
				// rejects it before the settlement rollback path can be exercised.
				require.NoError(t, db.Create(order).Error)
				require.Error(t, CompleteHupijiaoSubscriptionOrder(order.TradeNo, 100, "{}"))
				require.NoError(t, db.First(inviter, inviter.Id).Error)
				assert.Zero(t, inviter.AffQuota)
				require.NoError(t, db.First(order, order.Id).Error)
				assert.Equal(t, common.TopUpStatusPending, order.Status)
				var receiptCount int64
				require.NoError(t, db.Model(&TopUp{}).Where("trade_no = ?", order.TradeNo).Count(&receiptCount).Error)
				assert.Zero(t, receiptCount)
			})

			for _, name := range []string{"disabled", "compliance", "self", "banned", "overflow", "rollback"} {
				t.Run(name, func(t *testing.T) {
					require.NoError(t, db.Model(inviter).Updates(map[string]any{"aff_quota": 0, "aff_history": 0, "status": common.UserStatusEnabled}).Error)
					require.NoError(t, db.Model(invitee).Update("inviter_id", inviter.Id).Error)
					common.OptionMapRWMutex.Lock()
					common.OptionMap["ReferralRewardPercent"] = "5"
					common.OptionMapRWMutex.Unlock()
					payment.ComplianceConfirmed = true
					switch name {
					case "disabled":
						common.OptionMapRWMutex.Lock()
						common.OptionMap["ReferralRewardPercent"] = "0"
						common.OptionMapRWMutex.Unlock()
					case "compliance":
						payment.ComplianceConfirmed = false
					case "self":
						require.NoError(t, db.Model(invitee).Update("inviter_id", invitee.Id).Error)
					case "banned":
						require.NoError(t, db.Model(inviter).Update("status", common.UserStatusDisabled).Error)
					case "overflow":
						require.NoError(t, db.Model(inviter).Update("aff_quota", common.MaxWalletQuota).Error)
					}
					order := &TopUp{UserId: invitee.Id, Amount: 10000, Money: 100, TradeNo: "boundary-" + name, PaymentProvider: PaymentProviderHupijiao, Status: common.TopUpStatusPending}
					require.NoError(t, db.Create(order).Error)
					if name == "rollback" {
						require.NoError(t, db.Model(invitee).Update("quota", common.MaxWalletQuota).Error)
						require.Error(t, RechargeByHupijiao(order.TradeNo, 100))
					} else {
						require.NoError(t, RechargeByHupijiao(order.TradeNo, 100))
					}
					require.NoError(t, db.First(order, order.Id).Error)
					assert.Zero(t, order.ReferralQuota)
					if name == "rollback" {
						assert.Equal(t, common.TopUpStatusPending, order.Status)
					}
				})
			}
		})
	}
}

func TestReferralRewardPercentRejectsInvalidSettings(t *testing.T) {
	for _, value := range []string{"", "-1", "101", "NaN", "+Inf", "five"} {
		require.Error(t, validateOptionValue("ReferralRewardPercent", value))
	}
	for _, value := range []string{"0", "5", "5.5", "100"} {
		require.NoError(t, validateOptionValue("ReferralRewardPercent", value))
	}
}
