package model

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

type FinanceSummary struct {
	Month               string           `json:"month"`
	NetIncomeCents      int64            `json:"net_income_cents"`
	GrossIncomeCents    int64            `json:"gross_income_cents"`
	FeeCents            int64            `json:"fee_cents"`
	ExpenseCents        int64            `json:"expense_cents"`
	CustomerRefundCents int64            `json:"customer_refund_cents"`
	SupplierRefundCents int64            `json:"supplier_refund_cents"`
	FeeRefundCents      int64            `json:"fee_refund_cents"`
	BalanceCents        int64            `json:"balance_cents"`
	HistoricalNet       bool             `json:"historical_net"`
	EstimatedFees       int              `json:"estimated_fees"`
	Unresolved          int              `json:"unresolved"`
	Count               int              `json:"count"`
	Categories          map[string]int64 `json:"categories"`
}

type FinanceReport struct {
	Categories []FinanceCategory `json:"categories"`
	Summary    FinanceSummary    `json:"summary"`
	Months     []FinanceSummary  `json:"months"`
	Periods    []FinancePeriod   `json:"periods"`
	Rules      []FinanceRule     `json:"rules"`
	SyncedAt   int64             `json:"synced_at"`
}

type FinanceFilter struct {
	From, To, Kind, Search, Source, Category, Payer string
	IncludeVoided                                   bool
	Page, PageSize                                  int
}

func financeQuery(db *gorm.DB, filter FinanceFilter) *gorm.DB {
	q := db.Model(&FinanceEntry{}).Where("month >= ? AND month <= ?", filter.From, filter.To)
	if !filter.IncludeVoided {
		q = q.Where("voided = ?", false)
	}
	if filter.Kind == "income" {
		q = q.Where("kind IN ?", []string{"income", "historical_income"})
	} else if filter.Kind == "refunds" {
		q = q.Where("kind IN ?", []string{"customer_refund", "supplier_refund", "fee_refund"})
	} else if filter.Kind != "" {
		q = q.Where("kind = ?", filter.Kind)
	}
	if filter.Source != "" {
		q = q.Where("source = ?", filter.Source)
	}
	if filter.Category != "" {
		q = q.Where("category = ?", filter.Category)
	}
	if filter.Payer != "" {
		q = q.Where("payer = ?", filter.Payer)
	}
	if filter.Search != "" {
		pattern := "%" + filter.Search + "%"
		q = q.Where("(source_ref LIKE ? OR counterparty LIKE ? OR note LIKE ? OR payer LIKE ?)", pattern, pattern, pattern, pattern)
	}
	return q
}

func ListFinanceEntries(filter FinanceFilter) ([]FinanceEntry, int64, error) {
	rows := []FinanceEntry{}
	var total int64
	if err := financeQuery(DB, filter).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if filter.Page < 1 {
		filter.Page = 1
	}
	if filter.PageSize < 1 || filter.PageSize > 100 {
		filter.PageSize = 50
	}
	err := financeQuery(DB, filter).Order("month DESC, date DESC, id DESC").Offset((filter.Page - 1) * filter.PageSize).Limit(filter.PageSize).Find(&rows).Error
	return rows, total, err
}

func ExportFinanceEntries(filter FinanceFilter) ([]FinanceEntry, error) {
	rows := []FinanceEntry{}
	err := financeQuery(DB, filter).Order("month DESC, date DESC, id DESC").Limit(50001).Find(&rows).Error
	if err != nil {
		return nil, err
	}
	if len(rows) > 50000 {
		return nil, financeInvalid("Export at most 50000 records; select a shorter period")
	}
	return rows, nil
}

func financeAccumulate(summary *FinanceSummary, row FinanceEntry) {
	if row.Voided {
		return
	}
	summary.Count++
	if row.Currency != "CNY" || (row.Kind == "income" && row.FeeCents == nil) {
		summary.Unresolved++
		return
	}
	switch row.Kind {
	case "historical_income":
		summary.NetIncomeCents += row.AmountCents
		summary.HistoricalNet = true
	case "income":
		summary.GrossIncomeCents += row.AmountCents
		summary.FeeCents += *row.FeeCents
		summary.NetIncomeCents += row.AmountCents - *row.FeeCents
		if !row.FeeConfirmed {
			summary.EstimatedFees++
		}
	case "expense":
		summary.ExpenseCents += row.AmountCents
		summary.Categories[row.Category] += row.AmountCents
	case "customer_refund":
		summary.CustomerRefundCents += row.AmountCents
	case "supplier_refund":
		summary.SupplierRefundCents += row.AmountCents
	case "fee_refund":
		summary.FeeRefundCents += row.AmountCents
	}
	summary.BalanceCents = summary.NetIncomeCents - summary.CustomerRefundCents - summary.ExpenseCents + summary.SupplierRefundCents + summary.FeeRefundCents
}

func GetFinanceReport(from, to string) (*FinanceReport, error) {
	result := &FinanceReport{Summary: FinanceSummary{Categories: map[string]int64{}}, Months: []FinanceSummary{}, Periods: []FinancePeriod{}, Rules: []FinanceRule{}}
	monthly := map[string]*FinanceSummary{}
	start, _ := time.Parse("2006-01", from)
	end, _ := time.Parse("2006-01", to)
	for month := start; !month.After(end); month = month.AddDate(0, 1, 0) {
		key := month.Format("2006-01")
		monthly[key] = &FinanceSummary{Month: key, Categories: map[string]int64{}}
	}
	// One SELECT snapshot prevents concurrent edits from moving rows between batches.
	rows, err := financeQuery(DB, FinanceFilter{From: from, To: to}).Rows()
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var row FinanceEntry
		if err := DB.ScanRows(rows, &row); err != nil {
			return nil, err
		}
		financeAccumulate(&result.Summary, row)
		if summary := monthly[row.Month]; summary != nil {
			financeAccumulate(summary, row)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	for month := end; !month.Before(start); month = month.AddDate(0, -1, 0) {
		result.Months = append(result.Months, *monthly[month.Format("2006-01")])
	}
	if err := DB.Where("month >= ? AND month <= ?", from, to).Find(&result.Periods).Error; err != nil {
		return nil, err
	}
	if err := DB.Order("effective DESC, id DESC").Find(&result.Rules).Error; err != nil {
		return nil, err
	}
	var state FinanceState
	if err := DB.First(&state, 1).Error; err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	result.SyncedAt = state.SyncedAt
	result.Categories = []FinanceCategory{}
	if err := DB.Order("id ASC").Find(&result.Categories).Error; err != nil {
		return nil, err
	}
	if len(result.Categories) == 0 {
		result.Categories = defaultFinanceCategories()
	}
	return result, nil
}

func financeRate(rules []FinanceRule, method, date string) (int, bool) {
	rate, found := 0, false
	if method == PaymentMethodAlipay {
		rate, found = 60, true
	}
	for _, rule := range rules {
		if rule.Method == method && rule.Effective <= date {
			rate, found = rule.RateBPS, true
		}
	}
	return rate, found
}

// SyncFinanceIncome snapshots successful external payments without changing
// orders, balances, referrals, or user quotas. It is safe to retry.
func SyncFinanceIncome(actor int) (int, error) {
	added := 0
	err := financeWrite(func(tx *gorm.DB) error {
		cutoff, _ := time.ParseInLocation("2006-01", FinanceStartMonth, financeZone)
		var rules []FinanceRule
		if err := tx.Order("effective ASC, id ASC").Find(&rules).Error; err != nil {
			return err
		}
		// Subscriptions are authoritative when mirrored by a TopUp with the same trade number.
		var subscriptions []SubscriptionOrder
		if err := tx.Where("complete_time >= ?", cutoff.Unix()).Find(&subscriptions).Error; err != nil {
			return err
		}
		subByTrade := make(map[string]SubscriptionOrder, len(subscriptions))
		for _, sub := range subscriptions {
			subByTrade[sub.TradeNo] = sub
		}
		var recorded []string
		if err := tx.Model(&FinanceEntry{}).Where("source = ?", "payment").Pluck("source_ref", &recorded).Error; err != nil {
			return err
		}
		seen := make(map[string]bool, len(recorded))
		for _, trade := range recorded {
			seen[trade] = true
		}
		var batch []TopUp
		if err := tx.Where("status = ? AND complete_time >= ?", common.TopUpStatusSuccess, cutoff.Unix()).FindInBatches(&batch, 500, func(_ *gorm.DB, _ int) error {
			trades := make([]string, 0, len(batch))
			for _, topup := range batch {
				trades = append(trades, topup.TradeNo)
			}
			var mirrors []string
			if err := tx.Model(&SubscriptionOrder{}).Where("trade_no IN ?", trades).Pluck("trade_no", &mirrors).Error; err != nil {
				return err
			}
			mirrored := make(map[string]bool, len(mirrors))
			for _, trade := range mirrors {
				mirrored[trade] = true
			}
			for _, topup := range batch {
				if seen[topup.TradeNo] || mirrored[topup.TradeNo] {
					continue
				}
				if _, ok := subByTrade[topup.TradeNo]; ok {
					continue
				}
				n, err := financeSnapshotPayment(tx, rules, topup.TradeNo, topup.UserId, topup.Money, topup.PaymentMethod, topup.PaymentProvider, "topup", topup.CompleteTime, actor)
				if err != nil {
					return err
				}
				added += n
			}
			return nil
		}).Error; err != nil {
			return err
		}
		for _, sub := range subscriptions {
			if sub.Status != common.TopUpStatusSuccess || seen[sub.TradeNo] {
				continue
			}
			n, err := financeSnapshotPayment(tx, rules, sub.TradeNo, sub.UserId, sub.Money, sub.PaymentMethod, sub.PaymentProvider, "subscription", sub.CompleteTime, actor)
			if err != nil {
				return err
			}
			added += n
		}
		return tx.Model(&FinanceState{}).Where("id = ?", 1).Update("synced_at", time.Now().Unix()).Error
	})
	return added, err
}

func financeSnapshotPayment(tx *gorm.DB, rules []FinanceRule, trade string, user int, money float64, method, provider, business string, paidAt int64, actor int) (int, error) {
	if method == PaymentMethodBalance || provider == PaymentProviderBalance {
		return 0, nil
	}
	if money == 0 || provider == "telegram_access" {
		return 0, nil
	}
	if strings.TrimSpace(trade) == "" || math.IsNaN(money) || math.IsInf(money, 0) || money <= 0 {
		return 0, financeInvalid("A successful payment has invalid financial data")
	}
	key := fmt.Sprintf("payment:%x", sha256.Sum256([]byte(trade)))
	var count int64
	if err := tx.Model(&FinanceEntry{}).Where("entry_key = ?", key).Count(&count).Error; err != nil {
		return 0, err
	}
	if count > 0 {
		return 0, nil
	}
	cents, err := FinanceCents(decimal.NewFromFloat(money).String())
	if err != nil {
		return 0, err
	}
	date := time.Unix(paidAt, 0).In(financeZone)
	entry := FinanceEntry{EntryKey: key, Kind: "income", Month: date.Format("2006-01"), Date: date.Format("2006-01-02"), AmountCents: cents,
		Currency: inferPaymentCurrency(method, provider), Method: method, Provider: provider, Business: business, Source: "payment", SourceRef: trade,
		UserID: user, Version: 1, CreatedBy: actor, UpdatedBy: actor, CreatedAt: time.Now().Unix(), UpdatedAt: time.Now().Unix()}
	if err := financeOpen(tx, entry.Month); err != nil {
		return 0, financeInvalid("A closed month contains an unrecorded payment; reopen it and synchronize again")
	}
	if entry.Currency == "CNY" {
		if rate, ok := financeRate(rules, method, entry.Date); ok {
			fee := (cents*int64(rate) + 5000) / 10000
			entry.FeeCents, entry.RateBPS = &fee, rate
		}
	}
	if err := tx.Create(&entry).Error; err != nil {
		return 0, err
	}
	return 1, nil
}

func ReconcileFinanceEntry(id, actor, version int, amount, fee int64, date, reason string) error {
	if strings.TrimSpace(reason) == "" || len([]rune(reason)) > 500 || amount <= 0 || amount > financeMaxCents || fee < 0 || fee > amount {
		return financeInvalid("Invalid reconciliation amount or reason")
	}
	parsed, err := time.Parse("2006-01-02", date)
	if err != nil || parsed.Format("2006-01") < FinanceStartMonth {
		return financeInvalid("Invalid reconciliation date")
	}
	return financeWrite(func(tx *gorm.DB) error {
		var entry FinanceEntry
		if err := tx.First(&entry, id).Error; err != nil {
			return err
		}
		if entry.Source != "payment" || entry.Version != version {
			return financeInvalid("This financial entry changed; refresh before saving")
		}
		if err := financeOpen(tx, entry.Month); err != nil {
			return err
		}
		if err := financeOpen(tx, parsed.Format("2006-01")); err != nil {
			return err
		}
		var children int64
		if err := tx.Model(&FinanceEntry{}).Where("related_id = ? AND voided = ?", id, false).Count(&children).Error; err != nil {
			return err
		}
		if children > 0 {
			return financeInvalid("An entry with refunds cannot be edited or voided")
		}
		if entry.Currency == "CNY" && amount != entry.AmountCents {
			return financeInvalid("The platform payment amount cannot be changed")
		}
		before := entry
		entry.Currency, entry.AmountCents, entry.FeeCents, entry.FeeConfirmed = "CNY", amount, &fee, true
		entry.Date, entry.Month, entry.Version, entry.UpdatedBy, entry.UpdatedAt = date, parsed.Format("2006-01"), entry.Version+1, actor, time.Now().Unix()
		if err := tx.Save(&entry).Error; err != nil {
			return err
		}
		return financeAudit(tx, id, actor, "reconcile", reason, before, entry)
	})
}

func AddFinanceRule(rule FinanceRule, actor int) error {
	day, err := time.Parse("2006-01-02", rule.Effective)
	if err != nil || rule.RateBPS < 0 || rule.RateBPS > 10000 || len(rule.Method) > 50 || rule.Method == "" {
		return financeInvalid("Invalid payment fee rule")
	}
	// Rules are append-only; historical snapshots are corrected explicitly via reconciliation.
	if day.Format("2006-01-02") < time.Now().In(financeZone).Format("2006-01-02") {
		return financeInvalid("New fee rules cannot take effect in the past")
	}
	rule.ID, rule.CreatedBy, rule.CreatedAt = 0, actor, time.Now().Unix()
	return financeWrite(func(tx *gorm.DB) error {
		if err := financeOpen(tx, day.Format("2006-01")); err != nil {
			return err
		}
		var count int64
		if err := tx.Model(&FinanceEntry{}).Where("source = ? AND method = ? AND date >= ?", "payment", rule.Method, rule.Effective).Count(&count).Error; err != nil {
			return err
		}
		if count > 0 {
			return financeInvalid("Payments already use this date range; choose a later effective date")
		}
		if err := tx.Create(&rule).Error; err != nil {
			return err
		}
		return financeAudit(tx, 0, actor, "fee_rule", "", nil, rule)
	})
}

func SetFinancePeriod(month string, locked bool, actor int, reason string) error {
	if !FinanceMonthValid(month) || strings.TrimSpace(reason) == "" || len([]rune(reason)) > 500 {
		return financeInvalid("A valid month and a reason are required")
	}
	if locked && month >= time.Now().In(financeZone).Format("2006-01") {
		return financeInvalid("Only completed months can be closed")
	}
	if locked {
		if _, err := SyncFinanceIncome(actor); err != nil {
			return err
		}
	}
	return financeWrite(func(tx *gorm.DB) error {
		if locked {
			var count int64
			if err := tx.Model(&FinanceEntry{}).Where("month = ? AND voided = ? AND (currency <> ? OR (kind = ? AND (fee_cents IS NULL OR fee_confirmed = ?)))", month, false, "CNY", "income", false).Count(&count).Error; err != nil {
				return err
			}
			if count > 0 {
				return financeInvalid("Reconcile payment fees and currency before closing this month")
			}
		}
		var period FinancePeriod
		err := tx.Where("month = ?", month).First(&period).Error
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		before := period
		period.Month, period.Locked, period.UpdatedBy, period.UpdatedAt = month, locked, actor, time.Now().Unix()
		if err := tx.Save(&period).Error; err != nil {
			return err
		}
		return financeAudit(tx, 0, actor, "period", reason, before, period)
	})
}
