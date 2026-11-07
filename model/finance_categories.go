package model

import (
	"crypto/rand"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type FinanceCategory struct {
	ID        int    `json:"id"`
	Code      string `json:"code" gorm:"size:80;uniqueIndex"`
	Name      string `json:"name" gorm:"size:60"`
	Enabled   bool   `json:"enabled"`
	BuiltIn   bool   `json:"built_in"`
	UpdatedBy int    `json:"updated_by"`
	UpdatedAt int64  `json:"updated_at"`
}

func defaultFinanceCategories() []FinanceCategory {
	return []FinanceCategory{
		{Code: "upstream_credit", Name: "Upstream credit", Enabled: true, BuiltIn: true},
		{Code: "upstream_plan", Name: "Upstream subscription", Enabled: true, BuiltIn: true},
		{Code: "server", Name: "Servers and domains", Enabled: true, BuiltIn: true},
		{Code: "accounts", Name: "Account purchases", Enabled: true, BuiltIn: true},
		{Code: "proxy", Name: "Proxies and verification", Enabled: true, BuiltIn: true},
		{Code: "promotion", Name: "Promotion and cash gifts", Enabled: true, BuiltIn: true},
		{Code: "payment_service", Name: "Payment service fees", Enabled: true, BuiltIn: true},
		{Code: "other", Name: "Other", Enabled: true, BuiltIn: true},
	}
}

func ensureFinanceCategories(tx *gorm.DB) error {
	var count int64
	if err := tx.Model(&FinanceCategory{}).Where("built_in = ?", true).Count(&count).Error; err != nil {
		return err
	}
	if count >= 8 {
		return nil
	}
	defaults := defaultFinanceCategories()
	return tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&defaults).Error
}

func SaveFinanceCategory(id, actor int, name string, enabled bool) error {
	name = strings.TrimSpace(name)
	if name == "" || len([]rune(name)) > 60 {
		return financeInvalid("Enter a category name of up to 60 characters")
	}
	return financeWrite(func(tx *gorm.DB) error {
		var categories []FinanceCategory
		if err := tx.Find(&categories).Error; err != nil {
			return err
		}
		for _, category := range categories {
			if category.ID != id && strings.EqualFold(category.Name, name) {
				return financeInvalid("This expense category already exists")
			}
		}
		var category FinanceCategory
		if id > 0 {
			if err := tx.First(&category, id).Error; err != nil {
				return err
			}
		}
		before := category
		if category.BuiltIn && category.Name != name {
			return financeInvalid("Built-in category names cannot be changed")
		}
		if id == 0 {
			category.Code = "custom:" + rand.Text()
		}
		category.Name, category.Enabled, category.UpdatedBy, category.UpdatedAt = name, enabled, actor, time.Now().Unix()
		if err := tx.Save(&category).Error; err != nil {
			return err
		}
		return financeAudit(tx, 0, actor, "category", name, before, category)
	})
}

func validateFinanceCategory(tx *gorm.DB, code string) error {
	var count int64
	if err := tx.Model(&FinanceCategory{}).Where("code = ? AND enabled = ?", code, true).Count(&count).Error; err != nil {
		return err
	}
	if count == 0 {
		return financeInvalid("Select an enabled expense category")
	}
	return nil
}
