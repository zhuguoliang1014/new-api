package model

import (
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"gorm.io/gorm"
	"gorm.io/gorm/schema"
)

const GiftQuotaLifetime = int64(30 * 24 * time.Hour / time.Second)

// User.Quota remains the spendable total for API compatibility. The permanent
// balance is Quota minus the unexpired gift lots. Only gift lots can expire.
type GiftQuota struct {
	Id              int64  `json:"id" gorm:"primaryKey"`
	UserID          int    `json:"-" gorm:"not null;index:idx_gift_user_expiry,priority:1"`
	Source          string `json:"source" gorm:"type:varchar(40);not null"`
	Reference       string `json:"-" gorm:"type:varchar(128);not null;uniqueIndex"`
	Granted         int    `json:"granted" gorm:"not null"`
	Remaining       int    `json:"remaining" gorm:"not null"`
	Expired         int    `json:"expired" gorm:"not null;default:0"`
	GrantedAt       int64  `json:"granted_at" gorm:"not null"`
	ExpiresAt       int64  `json:"expires_at" gorm:"not null;index:idx_gift_user_expiry,priority:2;index"`
	ExpiredAt       int64  `json:"expired_at" gorm:"not null;default:0"`
	GrantLogPending bool   `json:"-" gorm:"not null;default:false;index"`
	// Set in the balance transaction, then delivered to the common log database.
	ExpiryLogPending bool `json:"-" gorm:"not null;default:false;index"`
}

func (GiftQuota) TableName(namer schema.Namer) string { return namer.TableName("GiftQuotas") }

// WalletGiftAllocation preserves the original funding source for partial and
// asynchronous refunds. GiftID zero denotes permanent balance.
type WalletGiftAllocation struct {
	UserID    int    `gorm:"primaryKey;autoIncrement:false"`
	RequestID string `gorm:"type:varchar(128);primaryKey"`
	GiftID    int64  `gorm:"primaryKey;autoIncrement:false"`
	Amount    int    `gorm:"not null"`
	Refunded  int    `gorm:"not null;default:0"`
}

type WalletBalance struct {
	Quota          int   `json:"quota"`
	BalanceQuota   int   `json:"balance_quota"`
	GiftQuota      int   `json:"gift_quota"`
	NextGiftExpiry int64 `json:"next_gift_expiry"`
}

func expireGiftQuotaTx(tx *gorm.DB, user *User, now int64) error {
	if !user.GiftWalletEnabled {
		return nil
	}
	var gifts []GiftQuota
	if err := tx.Where("user_id = ? AND expires_at <= ? AND remaining > 0", user.Id, now).Order("id").Find(&gifts).Error; err != nil {
		return err
	}
	for _, gift := range gifts {
		expired := gift.Remaining
		if err := tx.Model(&gift).Updates(map[string]any{"remaining": 0, "expired": gorm.Expr("expired + ?", gift.Remaining), "expired_at": now, "expiry_log_pending": true}).Error; err != nil {
			return err
		}
		user.Quota -= expired
	}
	if len(gifts) > 0 {
		return tx.Model(&User{}).Where("id = ?", user.Id).Update("quota", user.Quota).Error
	}
	return nil
}

func giftBalanceTx(tx *gorm.DB, user *User, now int64) (WalletBalance, error) {
	b := WalletBalance{Quota: user.Quota, BalanceQuota: user.Quota}
	if !user.GiftWalletEnabled {
		return b, nil
	}
	var gifts []GiftQuota
	if err := tx.Where("user_id = ? AND expires_at > ? AND remaining > 0", user.Id, now).Order("expires_at, id").Find(&gifts).Error; err != nil {
		return b, err
	}
	for _, g := range gifts {
		b.GiftQuota += g.Remaining
		if b.NextGiftExpiry == 0 {
			b.NextGiftExpiry = g.ExpiresAt
		}
	}
	b.BalanceQuota -= b.GiftQuota
	return b, nil
}

func GetWalletBalance(userID int) (WalletBalance, error) {
	var snapshot User
	if err := DB.Select("id", "quota", "gift_wallet_enabled").First(&snapshot, userID).Error; err != nil {
		return WalletBalance{}, err
	}
	if !snapshot.GiftWalletEnabled {
		return WalletBalance{Quota: snapshot.Quota, BalanceQuota: snapshot.Quota}, nil
	}
	var b WalletBalance
	err := DB.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := lockForUpdate(tx).Select("id", "quota", "gift_wallet_enabled").First(&user, userID).Error; err != nil {
			return err
		}
		now := common.GetTimestamp()
		if err := expireGiftQuotaTx(tx, &user, now); err != nil {
			return err
		}
		var err error
		b, err = giftBalanceTx(tx, &user, now)
		return err
	})
	if err == nil && b.Quota != snapshot.Quota {
		_ = invalidateUserCache(userID)
		if logErr := FlushGiftQuotaLogsForUser(userID, 100); logErr != nil {
			common.SysError(common.LogText("failed to write gift quota log: %s", logErr))
		}
	}
	return b, err
}

func GrantGiftQuotaTx(tx *gorm.DB, userID, amount int, source, reference string, grantedAt int64) (*GiftQuota, error) {
	gift, _, err := grantGiftQuotaTx(tx, userID, amount, source, reference, grantedAt)
	return gift, err
}

func grantGiftQuotaTx(tx *gorm.DB, userID, amount int, source, reference string, grantedAt int64) (*GiftQuota, bool, error) {
	if amount <= 0 || common.ValidateWalletQuota(amount) != nil || source == "" || len(source) > 40 || reference == "" || len(reference) > 128 || grantedAt <= 0 {
		return nil, false, ErrInvalidUserQuotaAdjustment
	}
	var user User
	if err := lockForUpdate(tx).Select("id", "quota", "gift_wallet_enabled").First(&user, userID).Error; err != nil {
		return nil, false, err
	}
	var existing GiftQuota
	err := tx.Where("reference = ?", reference).First(&existing).Error
	if err == nil {
		if existing.UserID != userID || existing.Granted != amount || existing.Source != source {
			return nil, false, errors.New("gift reference conflicts with an existing grant")
		}
		return &existing, false, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, false, err
	}
	now := common.GetTimestamp()
	if err := expireGiftQuotaTx(tx, &user, now); err != nil {
		return nil, false, err
	}
	if user.Quota > common.MaxWalletQuota-amount {
		return nil, false, ErrWalletQuotaLimitExceeded
	}
	gift := GiftQuota{UserID: userID, Source: source, Reference: reference, Granted: amount, Remaining: amount, GrantedAt: grantedAt, ExpiresAt: grantedAt + GiftQuotaLifetime, GrantLogPending: true}
	if gift.ExpiresAt <= now {
		gift.Remaining = 0
		gift.Expired = amount
		gift.ExpiredAt = now
		gift.ExpiryLogPending = true
	}
	if err := tx.Create(&gift).Error; err != nil {
		return nil, false, err
	}
	if err := tx.Model(&User{}).Where("id = ?", userID).Updates(map[string]any{"quota": user.Quota + gift.Remaining, "gift_wallet_enabled": true}).Error; err != nil {
		return nil, false, err
	}
	return &gift, true, nil
}

func GrantGiftQuota(userID, amount int, source, reference string) (*GiftQuota, error) {
	var gift *GiftQuota
	var created bool
	err := DB.Transaction(func(tx *gorm.DB) error {
		var err error
		gift, created, err = grantGiftQuotaTx(tx, userID, amount, source, reference, common.GetTimestamp())
		return err
	})
	if err == nil {
		_ = invalidateUserCache(userID)
		if created {
			if logErr := FlushGiftQuotaLogsForUser(userID, 100); logErr != nil {
				common.SysError(common.LogText("failed to write gift quota log: %s", logErr))
			}
		}
	}
	return gift, err
}

// FlushGiftQuotaLogsForUser projects committed grants and expirations into common logs.
// A stable request ID lets a retry finish if the log write succeeded but the
// pending flag could not be cleared (the log database may be separate).
func FlushGiftQuotaLogsForUser(userID, limit int) error {
	if LOG_DB == nil {
		return nil
	}
	var ids []int64
	query := DB.Model(&GiftQuota{}).Where("(grant_log_pending = ? OR expiry_log_pending = ?)", true, true)
	if userID > 0 {
		query = query.Where("user_id = ?", userID)
	}
	if err := query.Order("id").Limit(limit).Pluck("id", &ids).Error; err != nil {
		return err
	}
	for _, id := range ids {
		if err := DB.Transaction(func(tx *gorm.DB) error {
			var gift GiftQuota
			if err := lockForUpdate(tx).First(&gift, id).Error; err != nil {
				return err
			}
			if !gift.GrantLogPending && !gift.ExpiryLogPending {
				return nil
			}
			logDB := LOG_DB
			if LOG_DB == DB {
				logDB = tx
			}
			var username string
			if err := tx.Model(&User{}).Where("id = ?", gift.UserID).Select("username").Scan(&username).Error; err != nil {
				return err
			}
			for _, event := range []struct {
				pending   bool
				name      string
				amount    int
				createdAt int64
				key       string
			}{
				{gift.GrantLogPending, "grant", gift.Granted, gift.GrantedAt, "Gift credit granted: {{quota}}"},
				{gift.ExpiryLogPending, "expiry", gift.Expired, gift.ExpiredAt, "Gift credit expired: {{quota}}"},
			} {
				if !event.pending {
					continue
				}
				requestID := fmt.Sprintf("gift-%s:%d", event.name, gift.Id)
				var count int64
				if err := logDB.Model(&Log{}).Where("request_id = ?", requestID).Count(&count).Error; err != nil {
					return err
				}
				if count == 0 {
					other := NewLogOther()
					message := common.NewMessage(event.key, map[string]any{"quota": logger.FormatQuota(event.amount)})
					log := Log{UserId: gift.UserID, Username: username, CreatedAt: event.createdAt, Type: LogTypeSystem, RequestId: requestID, Content: other.setContent([]*common.Message{message}), Other: other.JSONString()}
					if err := logDB.Create(&log).Error; err != nil {
						return err
					}
				}
			}
			return tx.Model(&gift).Updates(map[string]any{"grant_log_pending": false, "expiry_log_pending": false}).Error
		}); err != nil {
			return err
		}
	}
	return nil
}

func recordWalletAllocationTx(tx *gorm.DB, userID int, requestID string, giftID int64, amount int) error {
	if amount == 0 || requestID == "" {
		return nil
	}
	var row WalletGiftAllocation
	err := tx.Where("user_id = ? AND request_id = ? AND gift_id = ?", userID, requestID, giftID).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return tx.Create(&WalletGiftAllocation{UserID: userID, RequestID: requestID, GiftID: giftID, Amount: amount}).Error
	}
	if err != nil {
		return err
	}
	if row.Amount > common.MaxWalletQuota-amount {
		return ErrWalletQuotaLimitExceeded
	}
	return tx.Model(&WalletGiftAllocation{}).Where("user_id = ? AND request_id = ? AND gift_id = ?", row.UserID, row.RequestID, row.GiftID).Update("amount", row.Amount+amount).Error
}

// consumeWalletQuotaTx requires a locked user row. No cache or batch balance
// may authorize a spend: expiry, allocation and deduction commit together.
func consumeWalletQuotaTx(tx *gorm.DB, user *User, requestID string, amount int, requireAvailable bool) (bool, error) {
	now := common.GetTimestamp()
	if err := expireGiftQuotaTx(tx, user, now); err != nil {
		return false, err
	}
	if requireAvailable && user.Quota < amount {
		return false, nil
	}
	remaining := amount
	if user.GiftWalletEnabled {
		var gifts []GiftQuota
		if err := tx.Where("user_id = ? AND expires_at > ? AND remaining > 0", user.Id, now).Order("expires_at, id").Find(&gifts).Error; err != nil {
			return false, err
		}
		for _, g := range gifts {
			take := min(remaining, g.Remaining)
			if take <= 0 {
				break
			}
			if err := tx.Model(&g).Update("remaining", g.Remaining-take).Error; err != nil {
				return false, err
			}
			if err := recordWalletAllocationTx(tx, user.Id, requestID, g.Id, take); err != nil {
				return false, err
			}
			remaining -= take
		}
		if err := recordWalletAllocationTx(tx, user.Id, requestID, 0, remaining); err != nil {
			return false, err
		}
	}
	if user.Quota < -common.MaxWalletQuota+amount {
		return false, ErrWalletQuotaLimitExceeded
	}
	user.Quota -= amount
	return true, tx.Model(&User{}).Where("id = ?", user.Id).Update("quota", user.Quota).Error
}

func ConsumeWalletQuota(userID int, requestID string, amount int, requireAvailable bool) (bool, error) {
	if amount < 0 || common.ValidateWalletQuota(amount) != nil || len(requestID) > 128 {
		return false, ErrInvalidUserQuotaAdjustment
	}
	if amount == 0 {
		return true, nil
	}
	var ok bool
	err := DB.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := lockForUpdate(tx).Select("id", "quota", "gift_wallet_enabled").First(&user, userID).Error; err != nil {
			return err
		}
		var err error
		ok, err = consumeWalletQuotaTx(tx, &user, requestID, amount, requireAvailable)
		return err
	})
	if err == nil {
		_ = invalidateUserCache(userID)
	}
	return ok, err
}

// RefundWalletQuota restores paid funds first, then the original gift lots.
// A gift refunded after its original deadline remains expired; refunding never
// turns a promotional credit into permanent balance or restarts its lifetime.
func RefundWalletQuota(userID int, requestID string, amount int) error {
	if amount < 0 || common.ValidateWalletQuota(amount) != nil || len(requestID) > 128 {
		return ErrInvalidUserQuotaAdjustment
	}
	if amount == 0 {
		return nil
	}
	err := DB.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := lockForUpdate(tx).Select("id", "quota", "gift_wallet_enabled").First(&user, userID).Error; err != nil {
			return err
		}
		now := common.GetTimestamp()
		if err := expireGiftQuotaTx(tx, &user, now); err != nil {
			return err
		}
		remaining, credit := amount, 0
		if user.GiftWalletEnabled && requestID != "" {
			var rows []WalletGiftAllocation
			if err := tx.Where("user_id = ? AND request_id = ? AND amount > refunded", userID, requestID).Order("gift_id ASC").Find(&rows).Error; err != nil {
				return err
			}
			// Refund the latest-expiring gift first, retaining earliest expiry
			// priority even when historical grants were inserted out of order.
			gifts := make(map[int64]GiftQuota, len(rows))
			available := 0
			for _, row := range rows {
				available += row.Amount - row.Refunded
				if row.GiftID == 0 {
					continue
				}
				var gift GiftQuota
				if err := tx.First(&gift, row.GiftID).Error; err != nil {
					return err
				}
				gifts[row.GiftID] = gift
			}
			var allocationCount int64
			if err := tx.Model(&WalletGiftAllocation{}).Where("user_id = ? AND request_id = ?", userID, requestID).Count(&allocationCount).Error; err != nil {
				return err
			}
			if allocationCount > 0 && amount > available {
				return errors.New("wallet refund exceeds the request's remaining charge")
			}
			sort.Slice(rows, func(i, j int) bool {
				if rows[i].GiftID == 0 {
					return true
				}
				if rows[j].GiftID == 0 {
					return false
				}
				left, right := gifts[rows[i].GiftID], gifts[rows[j].GiftID]
				if left.ExpiresAt != right.ExpiresAt {
					return left.ExpiresAt > right.ExpiresAt
				}
				return left.Id > right.Id
			})
			for _, row := range rows {
				take := min(remaining, row.Amount-row.Refunded)
				if take <= 0 {
					break
				}
				if row.GiftID == 0 {
					credit += take
				} else {
					gift := gifts[row.GiftID]
					updates := map[string]any{}
					if gift.ExpiresAt <= now {
						updates["expired"] = gorm.Expr("expired + ?", take)
						updates["expired_at"] = now
					} else {
						updates["remaining"] = gorm.Expr("remaining + ?", take)
						credit += take
					}
					if err := tx.Model(&gift).Updates(updates).Error; err != nil {
						return err
					}
				}
				if err := tx.Model(&WalletGiftAllocation{}).Where("user_id = ? AND request_id = ? AND gift_id = ?", row.UserID, row.RequestID, row.GiftID).Update("refunded", row.Refunded+take).Error; err != nil {
					return err
				}
				remaining -= take
			}
		}
		// Requests submitted before this wallet's first gift have no allocations.
		credit += remaining
		if user.Quota > common.MaxWalletQuota-credit {
			return ErrWalletQuotaLimitExceeded
		}
		return tx.Model(&User{}).Where("id = ?", userID).Update("quota", user.Quota+credit).Error
	})
	if err == nil {
		_ = invalidateUserCache(userID)
	}
	return err
}

func ListGiftQuota(userID, offset, limit int) ([]GiftQuota, int64, error) {
	if _, err := GetWalletBalance(userID); err != nil {
		return nil, 0, err
	}
	var user User
	if err := DB.Select("id", "gift_wallet_enabled").First(&user, userID).Error; err != nil {
		return nil, 0, err
	}
	gifts := make([]GiftQuota, 0)
	if !user.GiftWalletEnabled {
		return gifts, 0, nil
	}
	var total int64
	q := DB.Model(&GiftQuota{}).Where("user_id = ?", userID)
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	err := q.Order("id DESC").Offset(max(offset, 0)).Limit(min(max(limit, 1), 100)).Find(&gifts).Error
	return gifts, total, err
}

// ExpireDueGiftQuota is bounded so it can run on every server. The user row
// serializes replicas and simultaneous relay/refund/admin transactions.
func ExpireDueGiftQuota(limit int) error {
	var ids []int
	if err := DB.Model(&GiftQuota{}).Distinct("user_id").
		Where("expires_at <= ? AND remaining > 0", common.GetTimestamp()).
		Where("user_id IN (?)", DB.Model(&User{}).Select("id")).
		Limit(limit).Pluck("user_id", &ids).Error; err != nil {
		return err
	}
	for _, id := range ids {
		if _, err := GetWalletBalance(id); err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return fmt.Errorf("expire gifts for user %d: %w", id, err)
		}
	}
	return FlushGiftQuotaLogsForUser(0, limit)
}

// LegacyGiftQuotaMigration reclassifies an evidenced historical gift. It does
// not grant funds: Remaining must already be included in ExpectedQuota.
// The caller supplies a reviewed receipt and computes remaining funds from
// the original grant and subsequent wallet debits (excluding subscriptions).
type LegacyGiftQuotaMigration struct {
	UserID        int
	Reference     string
	Granted       int
	Remaining     int
	GrantedAt     int64
	ExpectedQuota int
}

func MigrateLegacyGiftQuotaTx(tx *gorm.DB, migration LegacyGiftQuotaMigration) (*GiftQuota, error) {
	if migration.UserID <= 0 || migration.Granted <= 0 || migration.Remaining < 0 || migration.Remaining > migration.Granted || common.ValidateWalletQuota(migration.Granted) != nil || migration.Reference == "" || len(migration.Reference) > 128 || migration.GrantedAt <= 0 || migration.GrantedAt > common.GetTimestamp() {
		return nil, ErrInvalidUserQuotaAdjustment
	}
	var user User
	if err := lockForUpdate(tx).Select("id", "quota", "gift_wallet_enabled").First(&user, migration.UserID).Error; err != nil {
		return nil, err
	}
	var existing GiftQuota
	err := tx.Where("reference = ?", migration.Reference).First(&existing).Error
	if err == nil {
		if existing.UserID != migration.UserID || existing.Granted != migration.Granted || existing.GrantedAt != migration.GrantedAt || existing.Source != "yaohuo_migration" {
			return nil, errors.New("historical gift reference conflicts")
		}
		return &existing, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	if user.Quota != migration.ExpectedQuota {
		return nil, errors.New("wallet changed since the migration was reviewed")
	}
	now := common.GetTimestamp()
	// Refuse stale plans instead of silently taking money from a later grant.
	balance, err := giftBalanceTx(tx, &user, now)
	if err != nil {
		return nil, err
	}
	if migration.Remaining > max(0, balance.BalanceQuota) {
		return nil, errors.New("historical gift exceeds the unclassified wallet balance")
	}
	gift := GiftQuota{UserID: migration.UserID, Source: "yaohuo_migration", Reference: migration.Reference, Granted: migration.Granted, Remaining: migration.Remaining, GrantedAt: migration.GrantedAt, ExpiresAt: migration.GrantedAt + GiftQuotaLifetime}
	if gift.ExpiresAt <= now {
		gift.Expired = gift.Remaining
		gift.Remaining = 0
		gift.ExpiredAt = now
	}
	if err := tx.Create(&gift).Error; err != nil {
		return nil, err
	}
	if err := tx.Model(&User{}).Where("id = ?", user.Id).Updates(map[string]any{"gift_wallet_enabled": true, "quota": user.Quota - gift.Expired}).Error; err != nil {
		return nil, err
	}
	return &gift, nil
}
