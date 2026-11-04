package model

import (
	"os"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/schema"
)

func TestWebSocketConnectionLimitOptionRejectsInvalidValuesBeforePersistence(t *testing.T) {
	const key = "ResponsesWSMaxConnectionsPerUser"
	for _, value := range []string{"", "0", "-1", "1.5", "NaN", "1001", "999999999999999999999"} {
		t.Run(value, func(t *testing.T) {
			require.Error(t, validateOptionValue(key, value))
			require.Error(t, UpdateOption(key, value))
			require.Error(t, UpdateOptionsBulk(map[string]string{key: value}))
		})
	}
	for _, value := range []string{"1", "10", "1000"} {
		require.NoError(t, validateOptionValue(key, value))
	}
}

func TestWebSocketConnectionLimitPersistsReloadsAndRejectsInvalidUpdates(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			previousDB := DB
			common.OptionMapRWMutex.Lock()
			previousOptions := common.OptionMap
			common.OptionMapRWMutex.Unlock()
			var driver gorm.Dialector
			switch dialect {
			case "sqlite":
				driver = sqlite.Open(":memory:")
			case "mysql":
				dsn := os.Getenv("TEST_MYSQL_DSN")
				if dsn == "" {
					t.Skip("TEST_MYSQL_DSN not configured")
				}
				driver = mysql.Open(dsn)
			case "postgres":
				dsn := os.Getenv("TEST_POSTGRES_DSN")
				if dsn == "" {
					t.Skip("TEST_POSTGRES_DSN not configured")
				}
				driver = postgres.Open(dsn)
			}
			db, err := gorm.Open(driver, &gorm.Config{NamingStrategy: schema.NamingStrategy{TablePrefix: "ws_limits_test_"}})
			require.NoError(t, err)
			require.NoError(t, db.AutoMigrate(&Option{}))
			DB = db
			common.OptionMapRWMutex.Lock()
			common.OptionMap = map[string]string{}
			common.OptionMapRWMutex.Unlock()
			t.Cleanup(func() {
				require.NoError(t, db.Migrator().DropTable(&Option{}))
				DB = previousDB
				common.OptionMapRWMutex.Lock()
				common.OptionMap = previousOptions
				common.OptionMapRWMutex.Unlock()
				sqlDB, err := db.DB()
				require.NoError(t, err)
				require.NoError(t, sqlDB.Close())
			})
			key := operation_setting.ResponsesWSMaxConnectionsPerUserOptionKey
			require.Equal(t, 10, operation_setting.GetResponsesWSMaxConnectionsPerUser())
			require.NoError(t, UpdateOption(key, "25"))
			require.Equal(t, 25, operation_setting.GetResponsesWSMaxConnectionsPerUser())
			var stored Option
			require.NoError(t, db.Where(&Option{Key: key}).First(&stored).Error)
			require.Equal(t, "25", stored.Value)
			common.OptionMapRWMutex.Lock()
			delete(common.OptionMap, key)
			common.OptionMapRWMutex.Unlock()
			// Startup and periodic sync dispatch persisted options through this loader.
			require.NoError(t, updateOptionMap(stored.Key, stored.Value))
			require.Equal(t, 25, operation_setting.GetResponsesWSMaxConnectionsPerUser())
			require.Error(t, UpdateOption(key, "0"))
			require.Error(t, UpdateOptionsBulk(map[string]string{key: "1.5"}))
			require.NoError(t, db.Where(&Option{Key: key}).First(&stored).Error)
			require.Equal(t, "25", stored.Value)
			require.Equal(t, 25, operation_setting.GetResponsesWSMaxConnectionsPerUser())
		})
	}
}

func TestResponsesWSLimitDefaultsSafelyForMissingOrCorruptStoredValues(t *testing.T) {
	common.OptionMapRWMutex.Lock()
	previous := common.OptionMap
	common.OptionMap = map[string]string{}
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		common.OptionMapRWMutex.Lock()
		common.OptionMap = previous
		common.OptionMapRWMutex.Unlock()
	})
	require.Equal(t, 10, operation_setting.GetResponsesWSMaxConnectionsPerUser())
	for _, value := range []string{"", "0", "-1", "1.5", "invalid", "1001"} {
		common.OptionMapRWMutex.Lock()
		common.OptionMap[operation_setting.ResponsesWSMaxConnectionsPerUserOptionKey] = value
		common.OptionMapRWMutex.Unlock()
		require.Equal(t, 10, operation_setting.GetResponsesWSMaxConnectionsPerUser(), "stored value: %q", value)
	}
	common.OptionMapRWMutex.Lock()
	common.OptionMap[operation_setting.ResponsesWSMaxConnectionsPerUserOptionKey] = "1000"
	common.OptionMapRWMutex.Unlock()
	require.Equal(t, 1000, operation_setting.GetResponsesWSMaxConnectionsPerUser())
}
