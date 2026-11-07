package model

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

type FinanceImportRow struct {
	Input     FinanceInput `json:"input"`
	Line      int          `json:"line"`
	Duplicate bool         `json:"duplicate"`
	Error     string       `json:"error"`
}

type FinanceImportPreview struct {
	Rows       []FinanceImportRow `json:"rows"`
	Hash       string             `json:"hash"`
	Ready      int                `json:"ready"`
	Duplicates int                `json:"duplicates"`
	Errors     int                `json:"errors"`
}

func financeImportKey(in FinanceInput) string {
	if in.Kind == "historical_income" {
		return "historical:" + in.Month
	}
	return fmt.Sprintf("import:%x", sha256.Sum256([]byte(in.SourceRef)))
}

func PreviewFinanceImport(inputs []FinanceInput) (*FinanceImportPreview, error) {
	return previewFinanceImport(DB, inputs)
}

func previewFinanceImport(db *gorm.DB, inputs []FinanceInput) (*FinanceImportPreview, error) {
	if len(inputs) == 0 || len(inputs) > 2000 {
		return nil, financeInvalid("Import between 1 and 2000 financial rows at a time")
	}
	result := &FinanceImportPreview{Rows: []FinanceImportRow{}}
	seen := map[string]bool{}
	for i, in := range inputs {
		row := FinanceImportRow{Input: in, Line: i + 2}
		err := normalizeFinanceInput(&row.Input, true)
		if err == nil && in.Kind != "expense" && in.Kind != "historical_income" {
			err = financeInvalid("Historical imports accept expenses and net income only")
		}
		if err == nil && strings.TrimSpace(in.SourceRef) == "" {
			err = financeInvalid("A unique source reference is required for every imported row")
		}
		key := financeImportKey(row.Input)
		if err == nil && seen[key] {
			err = financeInvalid("Duplicate source reference or historical month within this file")
		}
		seen[key] = true
		if err == nil {
			err = financeOpen(db, row.Input.Month)
		}
		if err == nil && row.Input.Kind == "expense" {
			// Fresh previews can use defaults before the first ledger write seeds them.
			var count int64
			if db.Model(&FinanceCategory{}).Count(&count).Error != nil {
				return nil, financeInvalid("Unable to process financial records")
			}
			if count == 0 {
				valid := false
				for _, category := range defaultFinanceCategories() {
					if category.Code == row.Input.Category {
						valid = true
					}
				}
				if !valid {
					err = financeInvalid("Select an enabled expense category")
				}
			} else {
				err = validateFinanceCategory(db, row.Input.Category)
			}
		}
		if err == nil {
			var old FinanceEntry
			lookup := db.Where("entry_key = ?", key).First(&old).Error
			if lookup == nil {
				candidate := financeEntryFromInput(row.Input)
				if old.Kind != candidate.Kind || old.Month != candidate.Month || old.Date != candidate.Date || old.AmountCents != candidate.AmountCents || old.Payer != candidate.Payer || old.Category != candidate.Category || old.Counterparty != candidate.Counterparty || old.Note != candidate.Note || old.Method != candidate.Method || old.SourceRef != candidate.SourceRef {
					err = financeInvalid("This source was already imported with different data; edit the existing record instead")
				} else {
					row.Duplicate = true
				}
			} else if !errors.Is(lookup, gorm.ErrRecordNotFound) {
				return nil, lookup
			}
		}
		if err != nil {
			var invalid FinanceValidationError
			if !errors.As(err, &invalid) {
				return nil, err
			}
			row.Error = err.Error()
			result.Errors++
		} else if row.Duplicate {
			result.Duplicates++
		} else {
			result.Ready++
		}
		result.Rows = append(result.Rows, row)
	}
	payload, err := common.Marshal(result.Rows)
	if err != nil {
		return nil, err
	}
	result.Hash = fmt.Sprintf("%x", sha256.Sum256(payload))
	return result, nil
}

func CommitFinanceImport(inputs []FinanceInput, hash string, actor int) (int, error) {
	added := 0
	err := financeWrite(func(tx *gorm.DB) error {
		preview, err := previewFinanceImport(tx, inputs)
		if err != nil {
			return err
		}
		if preview.Errors > 0 || hash == "" || preview.Hash != hash {
			return financeInvalid("Import preview changed or contains errors; preview the file again")
		}
		for _, row := range preview.Rows {
			if row.Duplicate {
				continue
			}
			entry := financeEntryFromInput(row.Input)
			entry.Source, entry.EntryKey, entry.Version = "import", financeImportKey(row.Input), 1
			entry.CreatedBy, entry.UpdatedBy, entry.CreatedAt, entry.UpdatedAt = actor, actor, time.Now().Unix(), time.Now().Unix()
			if err := tx.Create(&entry).Error; err != nil {
				return err
			}
			if err := financeAudit(tx, entry.ID, actor, "import", hash, nil, entry); err != nil {
				return err
			}
			added++
		}
		return nil
	})
	return added, err
}

func AddFinanceAttachment(entryID, actor int, name, mime string, content []byte) (*FinanceAttachment, error) {
	if len(content) == 0 || len(content) > 3<<20 || len([]rune(name)) > 160 {
		return nil, financeInvalid("Receipt attachments must be no larger than 3 MB")
	}
	attachment := &FinanceAttachment{EntryID: entryID, Name: name, MIME: mime, Content: content, CreatedBy: actor, CreatedAt: time.Now().Unix()}
	err := financeWrite(func(tx *gorm.DB) error {
		var entry FinanceEntry
		if err := tx.First(&entry, entryID).Error; err != nil {
			return err
		}
		if entry.Voided {
			return financeInvalid("Voided entries cannot be changed")
		}
		if err := financeOpen(tx, entry.Month); err != nil {
			return err
		}
		var count int64
		if err := tx.Model(&FinanceAttachment{}).Where("entry_id = ?", entryID).Count(&count).Error; err != nil {
			return err
		}
		if count >= 5 {
			return financeInvalid("Each financial entry supports up to five attachments")
		}
		if err := tx.Create(attachment).Error; err != nil {
			return err
		}
		return financeAudit(tx, entryID, actor, "attachment", name, nil, map[string]any{"id": attachment.ID, "name": name, "size": len(content)})
	})
	return attachment, err
}
