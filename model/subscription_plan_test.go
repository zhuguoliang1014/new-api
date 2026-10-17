package model

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
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

			for _, mode := range []string{"fresh", "released_upgrade"} {
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
							ratio, err := previous.EffectiveBillingRatio()
							require.NoError(t, err)
							assert.Equal(t, 1.0, ratio)
						}
						if pass == 0 {
							current := SubscriptionPlan{Title: "GPT plan", PriceAmount: 100, PriceCNY: 300, TotalAmount: 577500000, AllowedChannelTypes: "1", BillingRatio: common.GetPointer(0.75), Enabled: true}
							require.NoError(t, db.Create(&current).Error)
							currentID = current.Id
						}
						var current SubscriptionPlan
						require.NoError(t, db.First(&current, currentID).Error)
						assert.Equal(t, "1", current.AllowedChannelTypes)
						require.NotNil(t, current.BillingRatio)
						assert.Equal(t, 0.75, *current.BillingRatio)
						assert.Equal(t, 300.0, current.PriceCNY)
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
