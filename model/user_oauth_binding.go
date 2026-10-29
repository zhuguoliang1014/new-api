package model

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// OAuthSignupReward survives account deletion and OAuth unlinking so the same
// provider identity cannot collect a registration reward more than once.
type OAuthSignupReward struct {
	IdentityHash string `gorm:"type:varchar(64);primaryKey"`
	ClaimId      string `gorm:"type:varchar(32);not null"`
	UserId       int    `gorm:"not null;index"`
	Quota        int    `gorm:"not null"`
	CreatedAt    time.Time
}

func (OAuthSignupReward) TableName() string {
	return "oauth_signup_rewards"
}

// GrantOAuthSignupRewardWithTx is only called while creating a new OAuth user,
// after its verified provider binding has been inserted in the same transaction.
func GrantOAuthSignupRewardWithTx(tx *gorm.DB, user *User, provider, subject string) (int, error) {
	if provider != "yaohuo" {
		return 0, nil
	}
	if user.Id <= 0 || subject == "" {
		return 0, errors.New("OAuth signup reward requires a user and provider identity")
	}
	quota, err := common.WalletQuotaFromDecimalStrict(decimal.NewFromInt(5).Mul(decimal.NewFromFloat(common.QuotaPerUnit)))
	if err != nil || quota <= 0 {
		return 0, errors.New("invalid OAuth signup reward quota")
	}
	reward := OAuthSignupReward{
		IdentityHash: fmt.Sprintf("%x", sha256.Sum256([]byte(provider+"\x00"+subject))),
		ClaimId:      common.GetUUID(),
		UserId:       user.Id, Quota: quota,
	}
	result := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&reward)
	if result.Error != nil {
		return 0, result.Error
	}
	// MySQL's clientFoundRows can report an unchanged duplicate as an affected
	// row. Check ownership of this exact claim attempt instead of RowsAffected.
	var claimed int64
	if err := tx.Model(&OAuthSignupReward{}).Where("identity_hash = ? AND claim_id = ?", reward.IdentityHash, reward.ClaimId).Count(&claimed).Error; err != nil {
		return 0, err
	}
	if claimed == 0 {
		return 0, nil
	}
	result = tx.Model(&User{}).Where("id = ? AND quota >= 0 AND quota <= ?", user.Id, common.MaxWalletQuota-quota).
		UpdateColumn("quota", gorm.Expr("quota + ?", quota))
	if result.Error != nil {
		return 0, result.Error
	}
	if result.RowsAffected != 1 {
		return 0, errors.New("OAuth signup reward would exceed wallet quota bounds")
	}
	user.Quota += quota
	return quota, nil
}

// UserOAuthBinding stores the binding relationship between users and custom OAuth providers
type UserOAuthBinding struct {
	Id             int       `json:"id" gorm:"primaryKey"`
	UserId         int       `json:"user_id" gorm:"not null;uniqueIndex:ux_user_provider"`                                    // User ID - one binding per user per provider
	ProviderId     int       `json:"provider_id" gorm:"not null;uniqueIndex:ux_user_provider;uniqueIndex:ux_provider_userid"` // Custom OAuth provider ID
	ProviderUserId string    `json:"provider_user_id" gorm:"type:varchar(256);not null;uniqueIndex:ux_provider_userid"`       // User ID from OAuth provider - one OAuth account per provider
	CreatedAt      time.Time `json:"created_at"`
}

func (UserOAuthBinding) TableName() string {
	return "user_oauth_bindings"
}

// GetUserOAuthBindingsByUserId returns all OAuth bindings for a user
func GetUserOAuthBindingsByUserId(userId int) ([]*UserOAuthBinding, error) {
	var bindings []*UserOAuthBinding
	err := DB.Where("user_id = ?", userId).Find(&bindings).Error
	return bindings, err
}

// GetUserOAuthBinding returns a specific binding for a user and provider
func GetUserOAuthBinding(userId, providerId int) (*UserOAuthBinding, error) {
	var binding UserOAuthBinding
	err := DB.Where("user_id = ? AND provider_id = ?", userId, providerId).First(&binding).Error
	if err != nil {
		return nil, err
	}
	return &binding, nil
}

// GetUserByOAuthBinding finds a user by provider ID and provider user ID
func GetUserByOAuthBinding(providerId int, providerUserId string) (*User, error) {
	var binding UserOAuthBinding
	err := DB.Where("provider_id = ? AND provider_user_id = ?", providerId, providerUserId).First(&binding).Error
	if err != nil {
		return nil, err
	}

	var user User
	err = DB.First(&user, binding.UserId).Error
	if err != nil {
		return nil, err
	}
	return &user, nil
}

// IsProviderUserIdTaken checks if a provider user ID is already bound to any user
func IsProviderUserIdTaken(providerId int, providerUserId string) bool {
	var count int64
	DB.Model(&UserOAuthBinding{}).Where("provider_id = ? AND provider_user_id = ?", providerId, providerUserId).Count(&count)
	return count > 0
}

// CreateUserOAuthBinding creates a new OAuth binding
func CreateUserOAuthBinding(binding *UserOAuthBinding) error {
	if binding.UserId == 0 {
		return errors.New("user ID is required")
	}
	if binding.ProviderId == 0 {
		return errors.New("provider ID is required")
	}
	if binding.ProviderUserId == "" {
		return errors.New("provider user ID is required")
	}

	// Check if this provider user ID is already taken
	if IsProviderUserIdTaken(binding.ProviderId, binding.ProviderUserId) {
		return errors.New("this OAuth account is already bound to another user")
	}

	binding.CreatedAt = time.Now()
	return DB.Create(binding).Error
}

// CreateUserOAuthBindingWithTx creates a new OAuth binding within a transaction
func CreateUserOAuthBindingWithTx(tx *gorm.DB, binding *UserOAuthBinding) error {
	if binding.UserId == 0 {
		return errors.New("user ID is required")
	}
	if binding.ProviderId == 0 {
		return errors.New("provider ID is required")
	}
	if binding.ProviderUserId == "" {
		return errors.New("provider user ID is required")
	}

	// Check if this provider user ID is already taken (use tx to check within the same transaction)
	var count int64
	tx.Model(&UserOAuthBinding{}).Where("provider_id = ? AND provider_user_id = ?", binding.ProviderId, binding.ProviderUserId).Count(&count)
	if count > 0 {
		return errors.New("this OAuth account is already bound to another user")
	}

	binding.CreatedAt = time.Now()
	return tx.Create(binding).Error
}

// UpdateUserOAuthBinding updates an existing OAuth binding (e.g., rebind to different OAuth account)
func UpdateUserOAuthBinding(userId, providerId int, newProviderUserId string) error {
	// Check if the new provider user ID is already taken by another user
	var existingBinding UserOAuthBinding
	err := DB.Where("provider_id = ? AND provider_user_id = ?", providerId, newProviderUserId).First(&existingBinding).Error
	if err == nil && existingBinding.UserId != userId {
		return errors.New("this OAuth account is already bound to another user")
	}

	// Check if user already has a binding for this provider
	var binding UserOAuthBinding
	err = DB.Where("user_id = ? AND provider_id = ?", userId, providerId).First(&binding).Error
	if err != nil {
		// No existing binding, create new one
		return CreateUserOAuthBinding(&UserOAuthBinding{
			UserId:         userId,
			ProviderId:     providerId,
			ProviderUserId: newProviderUserId,
		})
	}

	// Update existing binding
	return DB.Model(&binding).Update("provider_user_id", newProviderUserId).Error
}

// DeleteUserOAuthBinding deletes an OAuth binding
func DeleteUserOAuthBinding(userId, providerId int) error {
	return DB.Where("user_id = ? AND provider_id = ?", userId, providerId).Delete(&UserOAuthBinding{}).Error
}

func deleteUserOAuthBindingsByUserId(tx *gorm.DB, userId int) error {
	return tx.Where("user_id = ?", userId).Delete(&UserOAuthBinding{}).Error
}

// GetBindingCountByProviderId returns the number of bindings for a provider
func GetBindingCountByProviderId(providerId int) (int64, error) {
	var count int64
	err := DB.Model(&UserOAuthBinding{}).Where("provider_id = ?", providerId).Count(&count).Error
	return count, err
}
