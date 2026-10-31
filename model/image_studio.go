package model

import (
	"errors"
	"fmt"
	"slices"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

// Studio tokens are created on first use for every eligible account. Revoked or
// deleted tokens are deliberately not recreated when the page is reopened.
func EnsureImageStudioTokens(userID int, expectedGroup string, groups map[string][]string) (map[string]*Token, []int, error) {
	tokens := make(map[string]*Token, len(groups))
	created := []int{}
	err := DB.Transaction(func(tx *gorm.DB) error {
		// SQLite needs a write lock before reading the token set. Other dialects
		// serialize requests by locking the owning user below.
		if common.UsingMainDatabase(common.DatabaseTypeSQLite) {
			if err := tx.Model(&User{}).Where("id = ?", userID).UpdateColumn("id", gorm.Expr("id")).Error; err != nil {
				return err
			}
		}
		var user User
		if err := lockForUpdate(tx).First(&user, userID).Error; err != nil {
			return err
		}
		if user.Status != common.UserStatusEnabled || user.Group != expectedGroup {
			return errors.New("image studio account permissions changed")
		}
		names := make([]string, 0, len(groups))
		for group := range groups {
			names = append(names, group)
		}
		slices.Sort(names)
		for _, group := range names {
			var token Token
			err := tx.Unscoped().Where("user_id = ? AND name = ?", userID, ImageStudioTokenName(group)).Order("id").First(&token).Error
			if errors.Is(err, gorm.ErrRecordNotFound) {
				key, err := common.GenerateKey()
				if err != nil {
					return err
				}
				token = Token{UserId: userID, Name: ImageStudioTokenName(group), Key: key, Status: common.TokenStatusEnabled, Group: group, CreatedTime: common.GetTimestamp(), AccessedTime: common.GetTimestamp(), ExpiredTime: -1, UnlimitedQuota: true, ModelLimitsEnabled: true, ModelLimits: strings.Join(groups[group], ",")}
				if err := tx.Create(&token).Error; err != nil {
					return err
				}
				created = append(created, token.Id)
			} else if err != nil {
				return err
			}
			tokens[group] = &token
		}
		return nil
	})
	return tokens, created, err
}

func ImageStudioTokenName(group string) string { return fmt.Sprintf("画图工作台 / %s", group) }

func GetImageStudioToken(userID int, group string) (*Token, error) {
	var token Token
	err := DB.Where("user_id = ? AND name = ?", userID, ImageStudioTokenName(group)).Order("id").First(&token).Error
	return &token, err
}

// Query the current enabled abilities rather than a global model list. Routing
// still checks channel availability independently on every billable request.
func GetImageStudioModels(group string) ([]string, error) {
	models := []string{}
	err := DB.Model(&Ability{}).Where(commonGroupCol+" = ? AND enabled = ?", group, true).Distinct("model").Order("model").Pluck("model", &models).Error
	if err != nil {
		return nil, err
	}
	return slices.DeleteFunc(models, func(name string) bool { return !strings.HasPrefix(name, "gpt-image-") }), nil
}
