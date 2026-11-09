package service

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"sync"
	"time"
)

var giftQuotaExpiryOnce sync.Once

func StartGiftQuotaExpiryTask() {
	giftQuotaExpiryOnce.Do(func() {
		go func() {
			ticker := time.NewTicker(time.Minute)
			defer ticker.Stop()
			for {
				if err := model.ExpireDueGiftQuota(200); err != nil {
					common.SysError(common.LogText("gift quota expiry failed: %s", err))
				}
				<-ticker.C
			}
		}()
	})
}
