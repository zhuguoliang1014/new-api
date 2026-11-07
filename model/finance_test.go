package model

import (
	"fmt"
	"os"
	"sync"
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

func TestFinanceDatabaseMatrix(t *testing.T) {
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
			db, err := gorm.Open(driver, &gorm.Config{NamingStrategy: schema.NamingStrategy{TablePrefix: "finance_test_"}})
			require.NoError(t, err)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			if dialect == "sqlite" {
				sqlDB.SetMaxOpenConns(1)
			}
			previousDB, previousType := DB, common.MainDatabaseType()
			DB = db
			common.SetMainDatabaseType(common.DatabaseType(dialect))
			models := []any{&FinanceEntry{}, &FinanceAudit{}, &FinanceRule{}, &FinancePeriod{}, &FinanceState{}, &FinanceAttachment{}, &FinanceCategory{}, &TopUp{}, &SubscriptionOrder{}}
			t.Cleanup(func() {
				assert.NoError(t, db.Migrator().DropTable(models...))
				DB = previousDB
				common.SetMainDatabaseType(previousType)
				assert.NoError(t, sqlDB.Close())
			})
			versionQuery := "SELECT version()"
			if dialect == "sqlite" {
				versionQuery = "SELECT sqlite_version()"
			}
			var version string
			require.NoError(t, db.Raw(versionQuery).Scan(&version).Error)
			t.Log("database version:", version)
			// An upgrade starts with released payment tables and preserves their data and unique keys.
			require.NoError(t, db.AutoMigrate(&TopUp{}, &SubscriptionOrder{}))
			paid, err := time.ParseInLocation("2006-01-02 15:04", "2026-11-01 00:00", financeZone)
			require.NoError(t, err)
			require.NoError(t, db.Create(&TopUp{TradeNo: "old-payment", Money: 10, Amount: 999999, PaymentMethod: "alipay", PaymentProvider: PaymentProviderHupijiao, CompleteTime: paid.Unix(), Status: common.TopUpStatusSuccess}).Error)
			for range 2 {
				require.NoError(t, db.AutoMigrate(models...))
			}
			require.Error(t, db.Create(&TopUp{TradeNo: "old-payment"}).Error)
			for _, order := range []TopUp{
				{TradeNo: "free-access", Money: 0, PaymentMethod: "virtual", PaymentProvider: "telegram_access", CompleteTime: paid.Unix() + 1, Status: common.TopUpStatusSuccess},
				{TradeNo: "prior-month", Money: 100, PaymentMethod: "alipay", PaymentProvider: PaymentProviderHupijiao, CompleteTime: paid.Unix() - 1, Status: common.TopUpStatusSuccess},
				{TradeNo: "mirror", Money: 20, PaymentMethod: "alipay", PaymentProvider: PaymentProviderHupijiao, CompleteTime: paid.Unix() + 1, Status: common.TopUpStatusSuccess},
				{TradeNo: "balance-mirror", Money: 40, PaymentMethod: "balance", PaymentProvider: PaymentProviderBalance, CompleteTime: paid.Unix() + 1, Status: common.TopUpStatusSuccess},
				{TradeNo: "small", Money: 0.83, PaymentMethod: "alipay", PaymentProvider: PaymentProviderHupijiao, CompleteTime: paid.Unix() + 1, Status: common.TopUpStatusSuccess},
				{TradeNo: "small2", Money: 0.84, PaymentMethod: "alipay", PaymentProvider: PaymentProviderHupijiao, CompleteTime: paid.Unix() + 1, Status: common.TopUpStatusSuccess},
				{TradeNo: "unpaid", Money: 100, PaymentMethod: "alipay", CompleteTime: paid.Unix() + 1, Status: common.TopUpStatusPending},
			} {
				require.NoError(t, db.Create(&order).Error)
			}
			for _, order := range []SubscriptionOrder{
				{TradeNo: "mirror", Money: 20, PaymentMethod: "alipay", PaymentProvider: PaymentProviderHupijiao, CompleteTime: paid.Unix() + 1, Status: common.TopUpStatusSuccess},
				{TradeNo: "balance-mirror", Money: 40, PaymentMethod: "balance", PaymentProvider: PaymentProviderBalance, CompleteTime: paid.Unix() + 1, Status: common.TopUpStatusSuccess},
			} {
				require.NoError(t, db.Create(&order).Error)
			}
			added, err := SyncFinanceIncome(1)
			require.NoError(t, err)
			assert.Equal(t, 4, added)
			added, err = SyncFinanceIncome(1)
			require.NoError(t, err)
			assert.Zero(t, added)
			report, err := GetFinanceReport("2026-11", "2026-11")
			require.NoError(t, err)
			assert.Equal(t, int64(3167), report.Summary.GrossIncomeCents)
			assert.Equal(t, int64(19), report.Summary.FeeCents) // Per-payment rounding: 6 + 12 + 0 + 1.
			assert.Equal(t, int64(3148), report.Summary.NetIncomeCents)
			require.NoError(t, SaveFinanceCategory(0, 1, "财务软件", true))
			var custom FinanceCategory
			require.NoError(t, db.Where("name = ?", "财务软件").First(&custom).Error)
			customInput := FinanceInput{Kind: "expense", Month: "2026-11", Date: "2026-11-02", AmountCents: 100, Category: custom.Code, Counterparty: "software", Payer: "西强", RequestID: "custom-expense"}
			customEntry, err := SaveFinanceEntry(0, 1, customInput)
			require.NoError(t, err)
			require.NoError(t, SaveFinanceCategory(custom.ID, 1, "财务工具", false))
			customInput.RequestID = "disabled-category"
			_, err = SaveFinanceEntry(0, 1, customInput)
			require.Error(t, err)
			require.NoError(t, db.First(customEntry, customEntry.ID).Error)
			assert.Equal(t, custom.Code, customEntry.Category)
			customInput.Category = "other"
			customInput.Payer = "第三人"
			_, err = SaveFinanceEntry(0, 1, customInput)
			require.Error(t, err)
			var categoryCount int64
			require.NoError(t, db.Model(&FinanceCategory{}).Count(&categoryCount).Error)
			assert.Equal(t, int64(9), categoryCount)
			var payment FinanceEntry
			require.NoError(t, db.Where("source_ref = ?", "old-payment").First(&payment).Error)
			require.Error(t, VoidFinanceEntry(payment.ID, 1, payment.Version, "test"))
			require.NoError(t, ReconcileFinanceEntry(payment.ID, 1, payment.Version, 1000, 6, "2026-11-01", "statement"))
			require.Error(t, ReconcileFinanceEntry(payment.ID, 1, payment.Version, 1000, 6, "2026-11-01", "stale"))
			zero := int64(0)
			receipt, err := SaveFinanceEntry(0, 1, FinanceInput{Kind: "income", Month: "2026-11", Date: "2026-11-02", AmountCents: 1000, FeeCents: &zero, Method: "wechat_offline", Note: "offline receipt", RequestID: "receipt", SourceRef: "wx-unique"})
			require.NoError(t, err)
			_, err = SaveFinanceEntry(0, 1, FinanceInput{Kind: "income", Month: "2026-11", Date: "2026-11-02", AmountCents: 1000, FeeCents: &zero, Method: "wechat_offline", Note: "offline receipt", RequestID: "receipt2", SourceRef: "wx-unique"})
			require.Error(t, err)
			in := FinanceInput{Kind: "expense", Month: "2026-11", Date: "2026-11-02", AmountCents: 1000, Category: "upstream_credit", Counterparty: "supplier", Payer: "国良", RequestID: "expense"}
			expense, err := SaveFinanceEntry(0, 1, in)
			require.NoError(t, err)
			retry, err := SaveFinanceEntry(0, 1, in)
			require.NoError(t, err)
			assert.Equal(t, expense.ID, retry.ID)
			in.Version, in.Reason, in.AmountCents = expense.Version, "correct amount", 1500
			edited, err := SaveFinanceEntry(expense.ID, 1, in)
			require.NoError(t, err)
			_, err = SaveFinanceEntry(expense.ID, 1, in)
			require.Error(t, err)
			_, err = SaveFinanceEntry(0, 1, FinanceInput{Kind: "customer_refund", Month: "2026-11", Date: "2026-11-03", AmountCents: 1001, RelatedID: receipt.ID, RequestID: "over-refund"})
			require.Error(t, err)
			// Concurrent refunds cannot collectively exceed the original payment.
			var wg sync.WaitGroup
			results := make(chan error, 2)
			for i := range 2 {
				wg.Go(func() {
					_, e := SaveFinanceEntry(0, 1, FinanceInput{Kind: "supplier_refund", Month: "2026-11", Date: "2026-11-03", AmountCents: 1000, RelatedID: expense.ID, RequestID: fmt.Sprintf("refund-%d", i)})
					results <- e
				})
			}
			wg.Wait()
			close(results)
			successes := 0
			for e := range results {
				if e == nil {
					successes++
				}
			}
			assert.Equal(t, 1, successes)
			require.Error(t, VoidFinanceEntry(expense.ID, 1, edited.Version, "has refund"))
			history := []FinanceInput{{Kind: "historical_income", Month: "2026-10", AmountCents: 527000, SourceRef: "sheet1:income:oct"}, {Kind: "expense", Month: "2026-10", AmountCents: 67207, Category: "other", Counterparty: "historical supplier", Payer: "国良", SourceRef: "sheet1:gl"}}
			preview, err := PreviewFinanceImport(history)
			require.NoError(t, err)
			require.Zero(t, preview.Errors)
			added, err = CommitFinanceImport(history, preview.Hash, 1)
			require.NoError(t, err)
			assert.Equal(t, 2, added)
			preview, err = PreviewFinanceImport(history)
			require.NoError(t, err)
			assert.Equal(t, 2, preview.Duplicates)
			added, err = CommitFinanceImport(history, preview.Hash, 1)
			require.NoError(t, err)
			assert.Zero(t, added)
			history[0].AmountCents++
			bad, err := PreviewFinanceImport(history)
			require.NoError(t, err)
			assert.Equal(t, 1, bad.Errors)
			_, err = CommitFinanceImport(history, preview.Hash, 1)
			require.Error(t, err)
			report, err = GetFinanceReport("2026-10", "2026-10")
			require.NoError(t, err)
			assert.True(t, report.Summary.HistoricalNet)
			assert.Equal(t, int64(459793), report.Summary.BalanceCents)
			assert.Zero(t, report.Summary.FeeCents)
			require.NoError(t, SetFinancePeriod("2026-10", true, 1, "confirmed history"))
			_, err = SaveFinanceEntry(0, 1, FinanceInput{Kind: "expense", Month: "2026-10", Date: "2026-10-02", AmountCents: 100, Category: "other", Counterparty: "supplier", Payer: "国良", RequestID: "locked"})
			require.Error(t, err)
			require.NoError(t, SetFinancePeriod("2026-10", false, 1, "correction"))
			attachment, err := AddFinanceAttachment(expense.ID, 1, "receipt.pdf", "application/pdf", make([]byte, 100000))
			require.NoError(t, err)
			var saved FinanceAttachment
			require.NoError(t, db.First(&saved, attachment.ID).Error)
			assert.Len(t, saved.Content, 100000)
			var old TopUp
			require.NoError(t, db.Where("trade_no = ?", "old-payment").First(&old).Error)
			assert.Equal(t, float64(10), old.Money)
			assert.Equal(t, int64(999999), old.Amount)
			require.NoError(t, db.AutoMigrate(models...))
			var count int64
			require.NoError(t, db.Model(&FinanceAudit{}).Where("entry_id = ?", expense.ID).Count(&count).Error)
			assert.GreaterOrEqual(t, count, int64(3))
		})
	}
}

func TestFinanceCentsRejectsLossyValues(t *testing.T) {
	for _, input := range []string{"0.001", "-1", "NaN", "9999999999999999999"} {
		_, err := FinanceCents(input)
		require.Error(t, err, input)
	}
	got, err := FinanceCents("10.06")
	require.NoError(t, err)
	assert.Equal(t, int64(1006), got)
}
