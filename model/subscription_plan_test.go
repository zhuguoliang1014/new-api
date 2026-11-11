package model

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// Plan schema from v1.0.0-rc.41 (2035a82aeb5414253a728bd937d4b8f97aa99b9b).
type releasedSubscriptionPlan struct {
	Id int `json:"id"`

	Title    string `json:"title" gorm:"type:varchar(128);not null"`
	Subtitle string `json:"subtitle" gorm:"type:varchar(255);default:''"`

	// Display money amount (follow existing code style: float64 for money)
	PriceAmount float64 `json:"price_amount" gorm:"type:decimal(10,6);not null;default:0"`
	Currency    string  `json:"currency" gorm:"type:varchar(8);not null;default:'USD'"`

	DurationUnit  string `json:"duration_unit" gorm:"type:varchar(16);not null;default:'month'"`
	DurationValue int    `json:"duration_value" gorm:"type:int;not null;default:1"`
	CustomSeconds int64  `json:"custom_seconds" gorm:"type:bigint;not null;default:0"`

	Enabled   bool `json:"enabled" gorm:"default:true"`
	SortOrder int  `json:"sort_order" gorm:"type:int;default:0"`

	AllowBalancePay *bool `json:"allow_balance_pay"`

	// Allow falling back to wallet balance after subscription quota is exhausted (empty = true)
	AllowWalletOverflow *bool `json:"allow_wallet_overflow"`

	StripePriceId         string `json:"stripe_price_id" gorm:"type:varchar(128);default:''"`
	CreemProductId        string `json:"creem_product_id" gorm:"type:varchar(128);default:''"`
	WaffoPancakeProductId string `json:"waffo_pancake_product_id" gorm:"type:varchar(128);default:''"`

	// Max purchases per user (0 = unlimited)
	MaxPurchasePerUser int `json:"max_purchase_per_user" gorm:"type:int;default:0"`

	// Upgrade user group after purchase (empty = no change)
	UpgradeGroup string `json:"upgrade_group" gorm:"type:varchar(64);default:''"`

	// Downgrade user group on expiry (empty = revert to the group held before purchase)
	DowngradeGroup string `json:"downgrade_group" gorm:"type:varchar(64);default:''"`

	// Total quota (amount in quota units, 0 = unlimited)
	TotalAmount int64 `json:"total_amount" gorm:"type:bigint;not null;default:0"`

	// Quota reset period for plan
	QuotaResetPeriod        string `json:"quota_reset_period" gorm:"type:varchar(16);default:'never'"`
	QuotaResetCustomSeconds int64  `json:"quota_reset_custom_seconds" gorm:"type:bigint;default:0"`

	CreatedAt int64 `json:"created_at" gorm:"bigint"`
	UpdatedAt int64 `json:"updated_at" gorm:"bigint"`
}

func (releasedSubscriptionPlan) TableName() string { return "subscription_plans" }

func TestSubscriptionPlanMigration(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			dsn := "local"
			switch dialect {
			case "mysql":
				dsn = os.Getenv("TEST_MYSQL_DSN")
			case "postgres":
				dsn = os.Getenv("TEST_POSTGRES_DSN")
			}
			if dsn == "" {
				t.Skip("test database DSN is not configured")
			}
			oldPath := common.SQLitePath
			common.SQLitePath = filepath.Join(t.TempDir(), "plans.db")
			t.Cleanup(func() { common.SQLitePath = oldPath })
			t.Setenv("SUBSCRIPTION_PLAN_TEST_DSN", dsn)
			db, dbType, err := chooseDB("SUBSCRIPTION_PLAN_TEST_DSN", false)
			require.NoError(t, err)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			oldDB := DB
			oldType := common.MainDatabaseType()
			DB = db
			common.SetMainDatabaseType(dbType)
			t.Cleanup(func() {
				DB = oldDB
				common.SetMainDatabaseType(oldType)
				require.NoError(t, sqlDB.Close())
			})
			var version string
			versionQuery := "SELECT version()"
			if dialect == "sqlite" {
				versionQuery = "SELECT sqlite_version()"
			}
			require.NoError(t, db.Raw(versionQuery).Scan(&version).Error)
			t.Logf("database=%s version=%s", dialect, version)

			for _, mode := range []string{"fresh", "released_upgrade", "current_upgrade"} {
				t.Run(mode, func(t *testing.T) {
					require.False(t, db.Migrator().HasTable(&SubscriptionPlan{}), "use an isolated test database")
					t.Cleanup(func() { require.NoError(t, db.Migrator().DropTable(&SubscriptionPlan{})) })
					var existingID int
					if mode == "released_upgrade" {
						require.NoError(t, db.AutoMigrate(&releasedSubscriptionPlan{}))
						previous := releasedSubscriptionPlan{Title: "existing paid plan", PriceAmount: 9.75, TotalAmount: 500000, Enabled: true}
						require.NoError(t, db.Create(&previous).Error)
						existingID = previous.Id
					}
					if mode == "current_upgrade" {
						// The exact pre-feature schema, including current custom fields.
						require.NoError(t, db.AutoMigrate(&SubscriptionPlan{}))
						previous := SubscriptionPlan{Title: "existing paid plan", PriceAmount: 9.75, TotalAmount: 500000, Enabled: true}
						require.NoError(t, db.Create(&previous).Error)
						existingID = previous.Id
						require.NoError(t, db.Migrator().DropColumn(&SubscriptionPlan{}, "SalesLimit"))
					}
					var currentID int
					for pass := range 2 {
						if dialect == "sqlite" {
							require.NoError(t, ensureSubscriptionPlanTableSQLite())
						} else {
							require.NoError(t, db.AutoMigrate(&SubscriptionPlan{}))
						}
						if existingID > 0 {
							var previous SubscriptionPlan
							require.NoError(t, db.First(&previous, existingID).Error)
							assert.Equal(t, "existing paid plan", previous.Title)
							assert.Equal(t, 9.75, previous.PriceAmount)
							assert.EqualValues(t, 500000, previous.TotalAmount)
							assert.True(t, previous.Enabled)
							assert.Empty(t, previous.AllowedChannelTypes)
							assert.Nil(t, previous.BillingRatio)
							assert.Zero(t, previous.SalesLimit)
							ratio, err := previous.EffectiveBillingRatio()
							require.NoError(t, err)
							assert.Equal(t, 1.0, ratio)
						}
						if pass == 0 {
							current := SubscriptionPlan{Title: "GPT plan", PriceAmount: 100, PriceCNY: 300, TotalAmount: 577500000, AllowedChannelTypes: "1", BillingRatio: common.GetPointer(0.75), Enabled: true, SalesLimit: 30}
							require.NoError(t, db.Create(&current).Error)
							currentID = current.Id
						}
						var current SubscriptionPlan
						require.NoError(t, db.First(&current, currentID).Error)
						assert.Equal(t, "1", current.AllowedChannelTypes)
						require.NotNil(t, current.BillingRatio)
						assert.Equal(t, 0.75, *current.BillingRatio)
						assert.Equal(t, 300.0, current.PriceCNY)
						assert.Equal(t, 30, current.SalesLimit)
						duplicate := SubscriptionPlan{Id: currentID, Title: "duplicate primary key"}
						assert.Error(t, db.Create(&duplicate).Error)
						var count int64
						require.NoError(t, db.Model(&SubscriptionPlan{}).Count(&count).Error)
						expected := int64(1)
						if existingID > 0 {
							expected++
						}
						assert.Equal(t, expected, count)
					}
				})
			}
		})
	}
}

func TestSubscriptionSalesDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			dsn := "local"
			if dialect == "mysql" {
				dsn = os.Getenv("TEST_MYSQL_DSN")
			}
			if dialect == "postgres" {
				dsn = os.Getenv("TEST_POSTGRES_DSN")
			}
			if dsn == "" {
				t.Skip("test database DSN is not configured")
			}
			var db *gorm.DB
			var err error
			if dialect == "sqlite" {
				db, err = gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "sales.db")+"?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)"), &gorm.Config{})
			} else {
				t.Setenv("SUBSCRIPTION_SALES_TEST_DSN", dsn)
				db, _, err = chooseDB("SUBSCRIPTION_SALES_TEST_DSN", false)
			}
			require.NoError(t, err)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			sqlDB.SetMaxOpenConns(4)
			previousDB, previousLogDB := DB, LOG_DB
			previousMain, previousLog := common.MainDatabaseType(), common.LogDatabaseType()
			DB, LOG_DB = db, db
			common.SetDatabaseTypes(common.DatabaseType(dialect), common.DatabaseType(dialect))
			initCol()
			models := []any{&SubscriptionPlan{}, &SubscriptionOrder{}, &UserSubscription{}, &User{}, &TopUp{}, &Log{}}
			require.False(t, db.Migrator().HasTable(&SubscriptionPlan{}), "use an isolated test database")
			t.Cleanup(func() {
				assert.NoError(t, db.Migrator().DropTable(models...))
				DB, LOG_DB = previousDB, previousLogDB
				common.SetDatabaseTypes(previousMain, previousLog)
				initCol()
				assert.NoError(t, sqlDB.Close())
			})
			versionQuery := "SELECT version()"
			if dialect == "sqlite" {
				versionQuery = "SELECT sqlite_version()"
			}
			var version string
			require.NoError(t, db.Raw(versionQuery).Scan(&version).Error)
			t.Logf("database=%s version=%s", dialect, version)
			require.NoError(t, db.AutoMigrate(models...))
			newPlan := func(limit int) *SubscriptionPlan {
				p := &SubscriptionPlan{Title: "limited plan", Enabled: true, SalesLimit: limit, PriceAmount: 1, PriceCNY: 7, TotalAmount: 1000, DurationUnit: SubscriptionDurationDay, DurationValue: 1}
				require.NoError(t, db.Create(p).Error)
				InvalidateSubscriptionPlanCache(p.Id)
				return p
			}
			user := &User{Username: "stock-buyer", Status: common.UserStatusEnabled, Quota: 10000000, Group: "default"}
			require.NoError(t, db.Create(user).Error)
			newOrder := func(p *SubscriptionPlan, provider, suffix string) *SubscriptionOrder {
				return &SubscriptionOrder{PlanId: p.Id, UserId: user.Id, Money: 7, TradeNo: fmt.Sprintf("sales-%d-%s", p.Id, suffix), PaymentProvider: provider, PaymentMethod: "alipay", Status: common.TopUpStatusPending}
			}
			salesFor := func(p *SubscriptionPlan) SubscriptionSalesCounts {
				counts, err := GetSubscriptionSalesCounts([]int{p.Id})
				require.NoError(t, err)
				return counts[p.Id]
			}
			t.Run("promotion_order_terms_and_zero_stock", func(t *testing.T) {
				p := newPlan(1)
				p.DiscountRate = common.GetPointer(0.8)
				p.DiscountEndsAt = common.GetTimestamp() + 3600
				p.PriceCNY = 100
				require.NoError(t, db.Save(p).Error)
				quote := p.PurchaseQuote(common.GetTimestamp())
				order := newOrder(p, SubscriptionPaymentProviderHupijiao, "discount")
				order.Money = 80
				order.QuotedPlan = &quote
				require.NoError(t, order.Insert())
				require.NoError(t, db.Model(p).Updates(map[string]any{"title": "edited", "total_amount": 1, "allowed_channel_types": "14"}).Error)
				require.NoError(t, CompleteHupijiaoSubscriptionOrder(order.TradeNo, 80, ""))
				var sub UserSubscription
				require.NoError(t, db.Where("plan_id = ?", p.Id).First(&sub).Error)
				require.EqualValues(t, 1000, sub.AmountTotal)
				snapshot, err := subscriptionPlanFromSnapshot(sub.PlanSnapshot, nil)
				require.NoError(t, err)
				require.Equal(t, 80.0, snapshot.PriceCNY)
				require.Equal(t, "limited plan", snapshot.Title)
				p2 := newPlan(0)
				require.NoError(t, db.Model(p2).Update("limited_sale", true).Error)
				require.ErrorIs(t, newOrder(p2, PaymentProviderEpay, "zero").Insert(), ErrSubscriptionSoldOut)
				require.NoError(t, db.Model(p2).Update("sales_limit", 1).Error)
				require.NoError(t, newOrder(p2, PaymentProviderEpay, "restock").Insert())
			})

			t.Run("reservation_completes_once_and_cancellation_does_not_restock", func(t *testing.T) {
				p := newPlan(1)
				order := newOrder(p, PaymentProviderEpay, "first")
				require.NoError(t, order.Insert())
				assert.ErrorIs(t, newOrder(p, PaymentProviderEpay, "blocked").Insert(), ErrSubscriptionSalesReserved)
				require.NoError(t, CompleteSubscriptionOrder(order.TradeNo, "", PaymentProviderEpay, "alipay"))
				require.NoError(t, CompleteSubscriptionOrder(order.TradeNo, "", PaymentProviderEpay, "alipay"))
				assert.Equal(t, SubscriptionSalesCounts{Sold: 1}, salesFor(p))
				var subs int64
				require.NoError(t, db.Model(&UserSubscription{}).Where("plan_id = ?", p.Id).Count(&subs).Error)
				assert.EqualValues(t, 1, subs)
				require.NoError(t, db.Model(&UserSubscription{}).Where("plan_id = ?", p.Id).Update("status", "cancelled").Error)
				assert.ErrorIs(t, PurchaseSubscriptionWithBalance(user.Id, p.Id), ErrSubscriptionSoldOut)
				var after User
				require.NoError(t, db.First(&after, user.Id).Error)
				assert.Equal(t, user.Quota, after.Quota, "sold-out attempts must not debit the wallet")
			})

			t.Run("closed_orders_release_stock_and_cannot_be_reactivated", func(t *testing.T) {
				for _, provider := range []string{PaymentProviderStripe, PaymentProviderEpay, SubscriptionPaymentProviderHupijiao} {
					p := newPlan(1)
					order := newOrder(p, provider, "timeout")
					require.NoError(t, order.Insert())
					require.NoError(t, ExpireSubscriptionOrder(order.TradeNo, provider))
					assert.Equal(t, SubscriptionSalesCounts{}, salesFor(p))
					require.NoError(t, newOrder(p, provider, "replacement").Insert())
					if provider == SubscriptionPaymentProviderHupijiao {
						assert.ErrorIs(t, CompleteHupijiaoSubscriptionOrder(order.TradeNo, 7, "verified receipt"), ErrSubscriptionPaymentClosed)
					} else {
						assert.ErrorIs(t, CompleteSubscriptionOrder(order.TradeNo, "verified receipt", provider, "alipay"), ErrSubscriptionPaymentClosed)
					}
					assert.Equal(t, SubscriptionSalesCounts{Reserved: 1}, salesFor(p))
					var subscriptions int64
					require.NoError(t, db.Model(&UserSubscription{}).Where("plan_id = ?", p.Id).Count(&subscriptions).Error)
					assert.Zero(t, subscriptions)
				}
			})
			t.Run("thirty_minute_expiry_and_callback_race_never_reopens_order", func(t *testing.T) {
				p := newPlan(1)
				order := newOrder(p, SubscriptionPaymentProviderHupijiao, "thirty-minute-race")
				require.NoError(t, order.Insert())
				now := common.GetTimestamp()
				require.NoError(t, db.Model(order).Update("create_time", now-1800).Error)
				mirror := &TopUp{UserId: user.Id, TradeNo: order.TradeNo, Money: 7, PaymentProvider: order.PaymentProvider, PaymentMethod: "alipay", Status: common.TopUpStatusPending, CreateTime: now - 1800}
				require.NoError(t, db.Create(mirror).Error)
				results := make(chan error, 2)
				start := make(chan struct{})
				go func() { <-start; _, err := ExpirePendingSubscriptionOrders(now-1800, 100); results <- err }()
				go func() {
					<-start
					results <- CompleteHupijiaoSubscriptionOrder(order.TradeNo, 7, "authenticated late receipt")
				}()
				close(start)
				for range 2 {
					err := <-results
					if err != nil {
						require.ErrorIs(t, err, ErrSubscriptionPaymentClosed)
					}
				}
				require.NoError(t, db.First(order, order.Id).Error)
				require.Equal(t, common.TopUpStatusExpired, order.Status)
				require.NoError(t, db.First(mirror, mirror.Id).Error)
				require.Equal(t, common.TopUpStatusExpired, mirror.Status)
				require.Positive(t, mirror.PaymentReceivedAfterClose)
				require.Equal(t, SubscriptionSalesCounts{}, salesFor(p))
				require.NoError(t, newOrder(p, PaymentProviderEpay, "after-timeout").Insert())
				require.ErrorIs(t, CompleteHupijiaoSubscriptionOrder(order.TradeNo, 7, "repeat receipt"), ErrSubscriptionPaymentClosed)
				wallet := &TopUp{UserId: user.Id, TradeNo: fmt.Sprintf("matrix-wallet-expiry-%d", p.Id), Money: 5, PaymentProvider: PaymentProviderHupijiao, Status: common.TopUpStatusPending, CreateTime: now - 1800}
				require.NoError(t, db.Create(wallet).Error)
				_, err := ExpirePendingTopUpOrders(now-1800, 100)
				require.NoError(t, err)
				require.NoError(t, db.First(wallet, wallet.Id).Error)
				require.Equal(t, common.TopUpStatusExpired, wallet.Status)
				require.Equal(t, SubscriptionSalesCounts{Reserved: 1}, salesFor(p))
			})

			t.Run("display_sales_consume_stock_without_creating_orders_and_gifts_do_not", func(t *testing.T) {
				p := newPlan(5)
				require.NoError(t, db.Model(p).Update("display_sold_count", 2).Error)
				_, err := AdminBindSubscription(user.Id, p.Id, "")
				require.NoError(t, err)
				assert.Equal(t, SubscriptionSalesCounts{}, salesFor(p))
				for range 3 {
					require.NoError(t, PurchaseSubscriptionWithBalance(user.Id, p.Id))
				}
				assert.ErrorIs(t, PurchaseSubscriptionWithBalance(user.Id, p.Id), ErrSubscriptionSoldOut)
				assert.ErrorIs(t, newOrder(p, PaymentProviderEpay, "full").Insert(), ErrSubscriptionSoldOut)
				assert.Equal(t, SubscriptionSalesCounts{Sold: 3}, salesFor(p))
			})
			t.Run("unlimited_stays_unlimited_and_lower_caps_protect_existing_orders", func(t *testing.T) {
				p := newPlan(0)
				require.NoError(t, db.Model(p).Update("display_sold_count", 999).Error)
				require.NoError(t, newOrder(p, PaymentProviderEpay, "one").Insert())
				require.NoError(t, newOrder(p, PaymentProviderEpay, "two").Insert())
				assert.Equal(t, SubscriptionSalesCounts{Reserved: 2}, salesFor(p))
				assert.Error(t, db.Transaction(func(tx *gorm.DB) error { return ValidateSubscriptionSalesLimitTx(tx, p.Id, 1000, 999) }))
				require.NoError(t, db.Transaction(func(tx *gorm.DB) error {
					if err := ValidateSubscriptionSalesLimitTx(tx, p.Id, 1001, 999); err != nil {
						return err
					}
					return tx.Model(p).Update("sales_limit", 1001).Error
				}))
				assert.ErrorIs(t, newOrder(p, PaymentProviderEpay, "three").Insert(), ErrSubscriptionSalesReserved)
			})
			t.Run("balance_and_external_checkout_compete_for_last_place", func(t *testing.T) {
				p := newPlan(3)
				require.NoError(t, db.Model(p).Update("display_sold_count", 2).Error)
				var before User
				require.NoError(t, db.First(&before, user.Id).Error)
				var results [2]error
				start := make(chan struct{})
				var wg sync.WaitGroup
				wg.Add(2)
				go func() { defer wg.Done(); <-start; results[0] = PurchaseSubscriptionWithBalance(user.Id, p.Id) }()
				go func() { defer wg.Done(); <-start; results[1] = newOrder(p, PaymentProviderEpay, "concurrent").Insert() }()
				close(start)
				wg.Wait()
				successful := 0
				for _, err := range results {
					if err == nil {
						successful++
					} else {
						assert.True(t, err == ErrSubscriptionSoldOut || err == ErrSubscriptionSalesReserved, "unexpected error: %v", err)
					}
				}
				assert.Equal(t, 1, successful)
				counts := salesFor(p)
				assert.EqualValues(t, 1, counts.Sold+counts.Reserved)
				var after User
				require.NoError(t, db.First(&after, user.Id).Error)
				expectedQuota := before.Quota
				if results[0] == nil {
					expectedQuota -= int(common.QuotaPerUnit)
				}
				assert.Equal(t, expectedQuota, after.Quota)
			})
			t.Run("display_sales_edit_and_checkout_share_the_same_last_place", func(t *testing.T) {
				p := newPlan(3)
				require.NoError(t, db.Model(p).Update("display_sold_count", 1).Error)
				require.NoError(t, newOrder(p, PaymentProviderEpay, "first").Insert())
				var results [2]error
				start := make(chan struct{})
				var wg sync.WaitGroup
				wg.Go(func() {
					<-start
					results[0] = db.Transaction(func(tx *gorm.DB) error {
						if err := ValidateSubscriptionSalesLimitTx(tx, p.Id, 3, 2); err != nil {
							return err
						}
						return tx.Model(p).Update("display_sold_count", 2).Error
					})
				})
				wg.Go(func() { <-start; results[1] = newOrder(p, PaymentProviderEpay, "last").Insert() })
				close(start)
				wg.Wait()
				accepted := 0
				for _, err := range results {
					if err == nil {
						accepted++
					} else {
						assert.True(t, errors.Is(err, ErrSubscriptionSalesReserved) || errors.Is(err, ErrSubscriptionSalesLimitTooLow), "unexpected error: %v", err)
					}
				}
				assert.Equal(t, 1, accepted)
				require.NoError(t, db.First(p, p.Id).Error)
				counts := salesFor(p)
				assert.EqualValues(t, 3, counts.Sold+counts.Reserved+p.DisplaySoldCount)
			})
		})
	}
}
