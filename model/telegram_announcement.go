package model

import (
	"gorm.io/gorm/clause"
)

// TelegramAnnouncement is a durable receipt. A reserved ID may never trigger a
// second Telegram send, including after a timeout or a process restart.
type TelegramAnnouncement struct {
	ID                string `json:"id" gorm:"type:varchar(36);primaryKey"`
	RequestHash       string `json:"-" gorm:"type:varchar(64);not null"`
	OperatorID        int    `json:"operator_id"`
	Title             string `json:"title" gorm:"type:varchar(256)"`
	Body              string `json:"body" gorm:"type:text"`
	Footer            string `json:"footer" gorm:"type:text"`
	ChannelLabel      string `json:"channel_label" gorm:"type:varchar(96)"`
	ContactLabel      string `json:"contact_label" gorm:"type:varchar(96)"`
	ChannelURL        string `json:"channel_url" gorm:"type:text"`
	ContactURL        string `json:"contact_url" gorm:"type:text"`
	ChatID            int64  `json:"chat_id"`
	Status            string `json:"status" gorm:"type:varchar(24);index"`
	PinRequested      bool   `json:"pin_requested"`
	PinStatus         string `json:"pin_status" gorm:"type:varchar(24)"`
	MessageID         int64  `json:"message_id"`
	MessageURL        string `json:"message_url" gorm:"type:text"`
	Error             string `json:"error" gorm:"type:text"`
	ChannelRequested  bool   `json:"channel_requested"`
	ChannelChatID     int64  `json:"channel_chat_id"`
	ChannelTitle      string `json:"channel_title" gorm:"type:text"`
	ChannelStatus     string `json:"channel_status" gorm:"type:varchar(24)"`
	ChannelMessageID  int64  `json:"channel_message_id"`
	ChannelMessageURL string `json:"channel_message_url" gorm:"type:text"`
	ChannelError      string `json:"channel_error" gorm:"type:text"`
	CreatedAt         int64  `json:"created_at" gorm:"index"`
}

func GetTelegramAnnouncement(id string) (*TelegramAnnouncement, error) {
	var record TelegramAnnouncement
	err := DB.Where("id = ?", id).First(&record).Error
	return &record, err
}

func ReserveTelegramAnnouncement(record *TelegramAnnouncement) (bool, error) {
	// The primary key arbitrates requests across processes and database engines.
	result := DB.Clauses(clause.OnConflict{DoNothing: true}).Create(record)
	if result.Error != nil {
		return false, result.Error
	}
	// A durable compare-and-set is also required because MySQL's affected-row
	// semantics may differ when clientFoundRows is enabled.
	result = DB.Model(&TelegramAnnouncement{}).Where("id = ? AND status = ? AND request_hash = ?", record.ID, "prepared", record.RequestHash).Update("status", "sending")
	return result.RowsAffected == 1, result.Error
}

func UpdateTelegramAnnouncement(id string, values map[string]any) error {
	return DB.Model(&TelegramAnnouncement{}).Where("id = ?", id).Updates(values).Error
}

func ListTelegramAnnouncements(page, size int) ([]TelegramAnnouncement, int64, error) {
	records := make([]TelegramAnnouncement, 0)
	var total int64
	query := DB.Model(&TelegramAnnouncement{})
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	err := query.Order("created_at DESC").Order("id DESC").Offset((page - 1) * size).Limit(size).Find(&records).Error
	return records, total, err
}
