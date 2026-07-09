package model

type ChannelHealthLogSample struct {
	CreatedAt int64  `gorm:"column:created_at"`
	ChannelId int    `gorm:"column:channel_id"`
	Type      int    `gorm:"column:type"`
	UseTime   int    `gorm:"column:use_time"`
	ModelName string `gorm:"column:model_name"`
	Group     string `gorm:"column:group"`
	Other     string `gorm:"column:other"`
}

type ChannelName struct {
	ID   int    `gorm:"column:id"`
	Name string `gorm:"column:name"`
}

func FindChannelHealthLogSamples(startTimestamp int64, endTimestamp int64) ([]ChannelHealthLogSample, error) {
	var samples []ChannelHealthLogSample
	err := LOG_DB.Model(&Log{}).
		Select("created_at, channel_id, type, use_time, model_name, "+logGroupCol+", other").
		Where("channel_id > 0 AND type IN ? AND created_at >= ? AND created_at <= ?",
			[]int{LogTypeConsume, LogTypeError}, startTimestamp, endTimestamp).
		Find(&samples).Error
	return samples, err
}

func GetChannelNamesByIDs(channelIDs []int) (map[int]string, error) {
	names := make(map[int]string, len(channelIDs))
	if len(channelIDs) == 0 {
		return names, nil
	}

	var rows []ChannelName
	if err := DB.Table("channels").Select("id, name").Where("id IN ?", channelIDs).Find(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		names[row.ID] = row.Name
	}
	return names, nil
}
