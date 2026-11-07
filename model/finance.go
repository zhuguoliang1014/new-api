package model

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type FinanceValidationError string

func (e FinanceValidationError) Error() string { return string(e) }
func financeInvalid(message string) error      { return FinanceValidationError(message) }

const FinanceStartMonth = "2026-11"
const financeMaxCents int64 = 100_000_000_000

var financeZone = time.FixedZone("Asia/Shanghai", 8*60*60)

// FinanceEntry is a cash ledger, separate from user quota and settlement.
// Historical income is already net of fees; nil fees must never mean zero.
type FinanceEntry struct {
	ID           int    `json:"id"`
	EntryKey     string `json:"entry_key" gorm:"size:80;uniqueIndex"`
	Kind         string `json:"kind" gorm:"size:32;index"`
	Month        string `json:"month" gorm:"size:7;index"`
	Date         string `json:"date" gorm:"size:10"`
	AmountCents  int64  `json:"amount_cents"`
	FeeCents     *int64 `json:"fee_cents"`
	FeeConfirmed bool   `json:"fee_confirmed"`
	RateBPS      int    `json:"rate_bps"`
	Currency     string `json:"currency" gorm:"size:12"`
	Method       string `json:"method" gorm:"size:50"`
	Provider     string `json:"provider" gorm:"size:50"`
	Business     string `json:"business" gorm:"size:32"`
	Source       string `json:"source" gorm:"size:20;index"`
	SourceRef    string `json:"source_ref" gorm:"size:255;index"`
	UserID       int    `json:"user_id"`
	Category     string `json:"category" gorm:"size:80"`
	Counterparty string `json:"counterparty" gorm:"size:120"`
	Payer        string `json:"payer" gorm:"size:80"`
	Note         string `json:"note" gorm:"type:text"`
	RelatedID    int    `json:"related_id" gorm:"index"`
	Voided       bool   `json:"voided"`
	Version      int    `json:"version"`
	CreatedBy    int    `json:"created_by"`
	UpdatedBy    int    `json:"updated_by"`
	CreatedAt    int64  `json:"created_at"`
	UpdatedAt    int64  `json:"updated_at"`
}

type FinanceAudit struct {
	ID        int    `json:"id"`
	EntryID   int    `json:"entry_id" gorm:"index"`
	ActorID   int    `json:"actor_id"`
	Action    string `json:"action" gorm:"size:32"`
	Reason    string `json:"reason" gorm:"size:500"`
	Before    string `json:"before" gorm:"type:text"`
	After     string `json:"after" gorm:"type:text"`
	CreatedAt int64  `json:"created_at"`
}

type FinanceRule struct {
	ID        int    `json:"id"`
	Method    string `json:"method" gorm:"size:50;uniqueIndex:idx_finance_rate,priority:1"`
	Effective string `json:"effective" gorm:"size:10;uniqueIndex:idx_finance_rate,priority:2"`
	RateBPS   int    `json:"rate_bps"`
	CreatedBy int    `json:"created_by"`
	CreatedAt int64  `json:"created_at"`
}

type FinancePeriod struct {
	ID        int    `json:"id"`
	Month     string `json:"month" gorm:"size:7;uniqueIndex"`
	Locked    bool   `json:"locked"`
	UpdatedBy int    `json:"updated_by"`
	UpdatedAt int64  `json:"updated_at"`
}

// Serializes only ledger writes across app instances, including refund caps,
// import deduplication and period closing. Payment completion never uses it.
type FinanceState struct {
	ID       int `gorm:"primaryKey;autoIncrement:false"`
	Revision int64
	SyncedAt int64
}

type FinanceAttachment struct {
	ID        int    `json:"id"`
	EntryID   int    `json:"entry_id" gorm:"index"`
	Name      string `json:"name" gorm:"size:160"`
	MIME      string `json:"mime" gorm:"size:80"`
	Content   []byte `json:"-"`
	CreatedBy int    `json:"created_by"`
	CreatedAt int64  `json:"created_at"`
}

type FinanceInput struct {
	Kind         string `json:"kind"`
	Month        string `json:"month"`
	Date         string `json:"date"`
	AmountCents  int64  `json:"amount_cents"`
	FeeCents     *int64 `json:"fee_cents"`
	Method       string `json:"method"`
	Category     string `json:"category"`
	Counterparty string `json:"counterparty"`
	Payer        string `json:"payer"`
	Note         string `json:"note"`
	RelatedID    int    `json:"related_id"`
	SourceRef    string `json:"source_ref"`
	RequestID    string `json:"request_id"`
	Version      int    `json:"version"`
	Reason       string `json:"reason"`
}

func FinanceMonthValid(month string) bool {
	parsed, err := time.Parse("2006-01", month)
	return err == nil && len(month) == 7 && parsed.Year() >= 2000 && parsed.Year() <= 2100
}

func FinanceCents(value string) (int64, error) {
	d, err := decimal.NewFromString(strings.TrimSpace(value))
	if err != nil || d.IsNegative() || d.GreaterThan(decimal.NewFromInt(financeMaxCents).Div(decimal.NewFromInt(100))) {
		return 0, financeInvalid("Invalid financial amount")
	}
	cents := d.Mul(decimal.NewFromInt(100))
	if !cents.Equal(cents.Truncate(0)) {
		return 0, financeInvalid("Financial amounts allow at most two decimal places")
	}
	return cents.IntPart(), nil
}

func financeWrite(fn func(*gorm.DB) error) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&FinanceState{ID: 1}).Error; err != nil {
			return err
		}
		if err := tx.Model(&FinanceState{}).Where("id = ?", 1).UpdateColumn("revision", gorm.Expr("revision + 1")).Error; err != nil {
			return err
		}
		if err := ensureFinanceCategories(tx); err != nil {
			return err
		}
		return fn(tx)
	})
}

func financeAudit(tx *gorm.DB, id, actor int, action, reason string, before, after any) error {
	b, err := common.Marshal(before)
	if err != nil {
		return err
	}
	a, err := common.Marshal(after)
	if err != nil {
		return err
	}
	return tx.Create(&FinanceAudit{EntryID: id, ActorID: actor, Action: action, Reason: reason, Before: string(b), After: string(a), CreatedAt: time.Now().Unix()}).Error
}

func financeOpen(tx *gorm.DB, month string) error {
	var count int64
	if err := tx.Model(&FinancePeriod{}).Where("month = ? AND locked = ?", month, true).Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return financeInvalid("This financial month is closed; reopen it before making changes")
	}
	return nil
}

func normalizeFinanceInput(in *FinanceInput, historical bool) error {
	in.Note, in.Reason = strings.TrimSpace(in.Note), strings.TrimSpace(in.Reason)
	in.SourceRef = strings.TrimSpace(in.SourceRef)
	if !FinanceMonthValid(in.Month) || in.AmountCents <= 0 || in.AmountCents > financeMaxCents {
		return financeInvalid("Invalid financial month or amount")
	}
	if !slices.Contains([]string{"income", "expense", "customer_refund", "supplier_refund", "historical_income", "fee_refund"}, in.Kind) {
		return financeInvalid("Invalid financial entry type")
	}
	if in.Kind == "historical_income" && (!historical || in.Month >= FinanceStartMonth || in.FeeCents != nil) {
		return financeInvalid("Historical income must be a net amount before automatic income starts")
	}
	if in.Kind == "income" && (in.Month < FinanceStartMonth || in.Method != "wechat_offline" || in.FeeCents == nil) {
		return financeInvalid("Manual income must be an offline WeChat receipt after automatic income starts")
	}
	if in.Date != "" {
		date, err := time.Parse("2006-01-02", in.Date)
		if err != nil || date.Format("2006-01") != in.Month {
			return financeInvalid("Payment date must belong to the selected month")
		}
	} else if !historical {
		return financeInvalid("Payment date is required")
	}
	if in.FeeCents != nil && (*in.FeeCents < 0 || *in.FeeCents > in.AmountCents) {
		return financeInvalid("Invalid payment fee")
	}
	if in.Kind != "income" && in.FeeCents != nil {
		return financeInvalid("Only receipt entries can contain a payment fee")
	}
	if in.Kind == "expense" && (strings.TrimSpace(in.Category) == "" || strings.TrimSpace(in.Counterparty) == "" || strings.TrimSpace(in.Payer) == "") {
		return financeInvalid("Category, payee and payer are required")
	}
	if in.Kind == "expense" && in.Payer != "西强" && in.Payer != "国良" {
		return financeInvalid("Payer must be Xiqiang or Guoliang")
	}
	if in.Kind != "expense" {
		in.Category, in.Payer, in.Counterparty = "", "", ""
	}
	if in.Kind == "income" && in.Note == "" && in.SourceRef == "" {
		return financeInvalid("A receipt reference or note is required")
	}
	for _, field := range []struct {
		value string
		limit int
	}{{in.Note, 3000}, {in.Reason, 500}, {in.SourceRef, 255}, {in.Category, 80}, {in.Counterparty, 120}, {in.Payer, 80}, {in.Method, 50}, {in.RequestID, 80}} {
		if len([]rune(field.value)) > field.limit {
			return financeInvalid("Financial entry text is too long")
		}
	}
	return nil
}

func financeEntryFromInput(in FinanceInput) FinanceEntry {
	return FinanceEntry{Kind: in.Kind, Month: in.Month, Date: in.Date, AmountCents: in.AmountCents, FeeCents: in.FeeCents,
		FeeConfirmed: true, Currency: "CNY", Method: in.Method, Category: strings.TrimSpace(in.Category),
		Counterparty: strings.TrimSpace(in.Counterparty), Payer: strings.TrimSpace(in.Payer), Note: in.Note,
		RelatedID: in.RelatedID, SourceRef: in.SourceRef, Source: "manual"}
}

func financeValidateRelated(tx *gorm.DB, entry FinanceEntry) error {
	refund := slices.Contains([]string{"customer_refund", "supplier_refund", "fee_refund"}, entry.Kind)
	if !refund {
		if entry.RelatedID != 0 {
			return financeInvalid("Only refunds can reference another entry")
		}
		return nil
	}
	var parent FinanceEntry
	if entry.RelatedID == 0 || tx.First(&parent, entry.RelatedID).Error != nil || parent.Voided || parent.Currency != "CNY" {
		return financeInvalid("Select an active original entry for the refund")
	}
	limit := parent.AmountCents
	if (entry.Kind == "supplier_refund" && parent.Kind != "expense") ||
		(entry.Kind != "supplier_refund" && !slices.Contains([]string{"income", "historical_income"}, parent.Kind)) {
		return financeInvalid("Refund type does not match the original entry")
	}
	if entry.Month < parent.Month || (entry.Date != "" && parent.Date != "" && entry.Date < parent.Date) {
		return financeInvalid("Refund cannot precede the original payment")
	}
	if entry.Kind == "fee_refund" {
		if parent.FeeCents == nil || !parent.FeeConfirmed {
			return financeInvalid("Confirm the original payment fee before recording a fee refund")
		}
		limit = *parent.FeeCents
	}
	var refunded int64
	if err := tx.Model(&FinanceEntry{}).Select("COALESCE(SUM(amount_cents), 0)").Where("related_id = ? AND kind = ? AND voided = ? AND id <> ?", parent.ID, entry.Kind, false, entry.ID).Scan(&refunded).Error; err != nil {
		return err
	}
	if refunded+entry.AmountCents > limit {
		return financeInvalid("Refund exceeds the remaining refundable amount")
	}
	return nil
}

func SaveFinanceEntry(id, actor int, in FinanceInput) (*FinanceEntry, error) {
	if err := normalizeFinanceInput(&in, id > 0); err != nil {
		return nil, err
	}
	entry := financeEntryFromInput(in)
	err := financeWrite(func(tx *gorm.DB) error {
		if err := financeOpen(tx, in.Month); err != nil {
			return err
		}
		var before *FinanceEntry
		if id > 0 {
			var old FinanceEntry
			if err := lockForUpdate(tx).First(&old, id).Error; err != nil {
				return err
			}
			if old.Source == "payment" || old.Kind == "historical_income" || old.Voided {
				return financeInvalid("This entry cannot be edited directly")
			}
			if old.Version != in.Version {
				return financeInvalid("This financial entry changed; refresh before saving")
			}
			if in.Reason == "" {
				return financeInvalid("A reason is required for financial changes")
			}
			if old.Kind != in.Kind {
				return financeInvalid("The entry type cannot be changed")
			}
			if old.Source != "import" && in.Date == "" {
				return financeInvalid("Payment date is required")
			}
			if err := financeOpen(tx, old.Month); err != nil {
				return err
			}
			var children int64
			if err := tx.Model(&FinanceEntry{}).Where("related_id = ? AND voided = ?", id, false).Count(&children).Error; err != nil {
				return err
			}
			if children > 0 {
				return financeInvalid("An entry with refunds cannot be edited or voided")
			}
			entry.ID, entry.EntryKey, entry.Source = old.ID, old.EntryKey, old.Source
			entry.CreatedAt, entry.CreatedBy, entry.Version = old.CreatedAt, old.CreatedBy, old.Version
			before = &old
		} else {
			if in.RequestID == "" {
				return financeInvalid("A request identifier is required")
			}
			entry.EntryKey = fmt.Sprintf("manual:%x", sha256.Sum256([]byte(fmt.Sprintf("%d:%s", actor, in.RequestID))))
			var old FinanceEntry
			err := tx.Where("entry_key = ?", entry.EntryKey).First(&old).Error
			if err == nil {
				entry = old
				return nil
			}
			if !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
			entry.CreatedAt, entry.CreatedBy = time.Now().Unix(), actor
		}
		if entry.SourceRef != "" && entry.Kind == "income" {
			var count int64
			if err := tx.Model(&FinanceEntry{}).Where("source_ref = ? AND kind = ? AND id <> ?", entry.SourceRef, "income", entry.ID).Count(&count).Error; err != nil {
				return err
			}
			if count > 0 {
				return financeInvalid("This payment reference is already recorded")
			}
			if err := tx.Model(&TopUp{}).Where("trade_no = ? OR open_order_id = ?", entry.SourceRef, entry.SourceRef).Count(&count).Error; err != nil {
				return err
			}
			if count > 0 {
				return financeInvalid("This payment reference belongs to a platform order; reconcile the automatic entry")
			}
		}
		if err := financeValidateRelated(tx, entry); err != nil {
			return err
		}
		if entry.Kind == "expense" && (before == nil || before.Category != entry.Category) {
			if err := validateFinanceCategory(tx, entry.Category); err != nil {
				return err
			}
		}
		entry.Version++
		entry.UpdatedAt, entry.UpdatedBy = time.Now().Unix(), actor
		if err := tx.Save(&entry).Error; err != nil {
			return err
		}
		return financeAudit(tx, entry.ID, actor, "save", in.Reason, before, entry)
	})
	return &entry, err
}

func VoidFinanceEntry(id, actor, version int, reason string) error {
	if strings.TrimSpace(reason) == "" || len([]rune(reason)) > 500 {
		return financeInvalid("A reason is required for financial changes")
	}
	return financeWrite(func(tx *gorm.DB) error {
		var entry FinanceEntry
		if err := tx.First(&entry, id).Error; err != nil {
			return err
		}
		if entry.Source == "payment" {
			return financeInvalid("Automatic income cannot be voided; record a refund instead")
		}
		if entry.Voided {
			return nil
		}
		if entry.Version != version {
			return financeInvalid("This financial entry changed; refresh before saving")
		}
		if err := financeOpen(tx, entry.Month); err != nil {
			return err
		}
		var count int64
		if err := tx.Model(&FinanceEntry{}).Where("related_id = ? AND voided = ?", id, false).Count(&count).Error; err != nil {
			return err
		}
		if count > 0 {
			return financeInvalid("An entry with refunds cannot be edited or voided")
		}
		before := entry
		entry.Voided, entry.Version, entry.UpdatedBy, entry.UpdatedAt = true, entry.Version+1, actor, time.Now().Unix()
		if err := tx.Save(&entry).Error; err != nil {
			return err
		}
		return financeAudit(tx, id, actor, "void", reason, before, entry)
	})
}
