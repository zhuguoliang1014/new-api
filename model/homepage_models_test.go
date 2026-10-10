package model

import (
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupHomepageModelsTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	previousDB := DB
	common.OptionMapRWMutex.Lock()
	previousOptions := common.OptionMap
	common.OptionMap = map[string]string{}
	common.OptionMapRWMutex.Unlock()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&Option{}, &Model{}, &Vendor{}))
	DB = db
	t.Cleanup(func() {
		DB = previousDB
		common.OptionMapRWMutex.Lock()
		common.OptionMap = previousOptions
		common.OptionMapRWMutex.Unlock()
		sqlDB, err := db.DB()
		require.NoError(t, err)
		require.NoError(t, sqlDB.Close())
	})
	return db
}

func TestHomepageModelsPersistenceAndPublicProjection(t *testing.T) {
	db := setupHomepageModelsTestDB(t)
	vendor := Vendor{Name: "Test provider", Icon: "TestIcon", Status: 1}
	require.NoError(t, db.Create(&vendor).Error)
	metadata := []Model{
		{ModelName: "beta", Description: "Beta description", Icon: "BetaIcon", Tags: "text,tools", Status: 1, VendorID: vendor.Id, Endpoints: "private endpoint"},
		{ModelName: "alpha", Status: 1},
		{ModelName: "hidden", Status: 1},
		{ModelName: "disabled-later", Status: 1},
		{ModelName: "deleted-later", Status: 1},
		{ModelName: "rule-later", Status: 1},
		{ModelName: "unselected", Status: 1},
	}
	require.NoError(t, db.Create(&metadata).Error)
	config := dto.HomepageModelsConfig{Enabled: true, Models: []dto.HomepageModelSelection{
		{ModelName: "beta", Enabled: true, Order: 10, Featured: true, Scenario: dto.HomepageModelScenario{Zh: "代码审阅", En: "Code review"}},
		{ModelName: "alpha", Enabled: true, Order: 10},
		{ModelName: "hidden", Enabled: false, Order: 0},
		{ModelName: "disabled-later", Enabled: true, Order: 1},
		{ModelName: "deleted-later", Enabled: true, Order: 2},
		{ModelName: "rule-later", Enabled: true, Order: 3},
	}}
	raw, err := common.Marshal(config)
	require.NoError(t, err)
	require.NoError(t, UpdateOption(HomepageModelsOptionKey, string(raw)))
	var saved Option
	require.NoError(t, db.Where("key = ?", HomepageModelsOptionKey).First(&saved).Error)
	assert.JSONEq(t, string(raw), saved.Value)
	common.OptionMapRWMutex.Lock()
	delete(common.OptionMap, HomepageModelsOptionKey)
	common.OptionMapRWMutex.Unlock()
	// The startup option loader dispatches stored values through this function.
	require.NoError(t, updateOptionMap(saved.Key, saved.Value))
	reloaded, err := GetHomepageModelsConfig()
	require.NoError(t, err)
	assert.Equal(t, config, reloaded)
	require.NoError(t, db.Model(&Model{}).Where("model_name = ?", "disabled-later").Update("status", 0).Error)
	require.NoError(t, db.Where("model_name = ?", "deleted-later").Delete(&Model{}).Error)
	require.NoError(t, db.Model(&Model{}).Where("model_name = ?", "rule-later").Update("name_rule", NameRulePrefix).Error)

	data, err := GetHomepageModels()
	require.NoError(t, err)
	assert.True(t, data.Enabled)
	require.Len(t, data.Models, 2)
	assert.Equal(t, "alpha", data.Models[0].ModelName)
	assert.Nil(t, data.Models[0].Provider)
	assert.Equal(t, "beta", data.Models[1].ModelName)
	assert.Equal(t, &dto.HomepageModelProvider{Name: vendor.Name, Icon: vendor.Icon}, data.Models[1].Provider)
	assert.True(t, data.Models[1].Featured)
	assert.Equal(t, config.Models[0].Scenario, data.Models[1].Scenario)
	encoded, err := common.Marshal(data.Models[1])
	require.NoError(t, err)
	var fields map[string]any
	require.NoError(t, common.Unmarshal(encoded, &fields))
	assert.Equal(t, map[string]any{
		"model_name": "beta", "description": "Beta description", "icon": "BetaIcon", "tags": "text,tools", "featured": true,
		"provider": map[string]any{"name": "Test provider", "icon": "TestIcon"},
		"scenario": map[string]any{"zh": "代码审阅", "en": "Code review"},
	}, fields)
	assert.NotContains(t, string(encoded), "private endpoint")
}

func TestHomepageModelsEmptyAndCorruptConfiguration(t *testing.T) {
	setupHomepageModelsTestDB(t)
	tests := []struct {
		name    string
		raw     string
		enabled bool
		wantErr bool
	}{
		{name: "unconfigured"},
		{name: "disabled", raw: `{"enabled":false,"models":[]}`},
		{name: "enabled empty", raw: `{"enabled":true,"models":[]}`, enabled: true},
		{name: "null models normalized", raw: `{"enabled":true,"models":null}`, enabled: true},
		{name: "invalid JSON", raw: `{"enabled":true`, wantErr: true},
		{name: "invalid root", raw: `null`, wantErr: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			common.OptionMapRWMutex.Lock()
			common.OptionMap[HomepageModelsOptionKey] = test.raw
			common.OptionMapRWMutex.Unlock()
			data, err := GetHomepageModels()
			if test.wantErr {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, test.enabled, data.Enabled)
			assert.NotNil(t, data.Models)
			assert.Empty(t, data.Models)
		})
	}
}

func TestHomepageModelsConfigurationRejectsInvalidSelections(t *testing.T) {
	db := setupHomepageModelsTestDB(t)
	models := []Model{{ModelName: "valid", Status: 1}, {ModelName: "disabled", Status: 1}, {ModelName: "rule", Status: 1, NameRule: NameRulePrefix}, {ModelName: "deleted", Status: 1}}
	require.NoError(t, db.Create(&models).Error)
	require.NoError(t, db.Model(&Model{}).Where("model_name = ?", "disabled").Update("status", 0).Error)
	require.NoError(t, db.Where("model_name = ?", "deleted").Delete(&Model{}).Error)
	tests := []struct {
		name string
		raw  string
	}{
		{"missing model", `{"models":[{"model_name":"missing"}]}`},
		{"disabled model", `{"models":[{"model_name":"disabled"}]}`},
		{"rule model", `{"models":[{"model_name":"rule"}]}`},
		{"deleted model", `{"models":[{"model_name":"deleted"}]}`},
		{"duplicate", `{"models":[{"model_name":"valid"},{"model_name":"valid"}]}`},
		{"negative order", `{"models":[{"model_name":"valid","order":-1}]}`},
		{"excessive order", `{"models":[{"model_name":"valid","order":10000}]}`},
		{"fractional order", `{"models":[{"model_name":"valid","order":1.5}]}`},
		{"empty name", `{"models":[{"model_name":""}]}`},
		{"trimmed name", `{"models":[{"model_name":" valid "}]}`},
		{"long name", `{"models":[{"model_name":"` + strings.Repeat("x", 129) + `"}]}`},
		{"long Chinese scenario", `{"models":[{"model_name":"valid","scenario":{"zh":"` + strings.Repeat("字", 161) + `"}}]}`},
		{"long English scenario", `{"models":[{"model_name":"valid","scenario":{"en":"` + strings.Repeat("x", 161) + `"}}]}`},
		{"incorrect locale type", `{"models":[{"model_name":"valid","scenario":{"zh":5}}]}`},
		{"too many models", `{"models":[` + strings.TrimSuffix(strings.Repeat(`{"model_name":"valid"},`, 25), ",") + `]}`},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			assert.Error(t, UpdateOption(HomepageModelsOptionKey, test.raw))
			assert.Error(t, UpdateOptionsBulk(map[string]string{HomepageModelsOptionKey: test.raw}))
		})
	}
	valid := `{"enabled":true,"models":[{"model_name":"valid","enabled":true,"order":9999,"scenario":{"zh":"` + strings.Repeat("字", 160) + `","en":""}}]}`
	require.NoError(t, UpdateOptionsBulk(map[string]string{HomepageModelsOptionKey: valid}))
}

func TestHomepageModelsDatabaseWriteFailurePreservesConfiguration(t *testing.T) {
	db := setupHomepageModelsTestDB(t)
	previous := `{"enabled":false,"models":[]}`
	require.NoError(t, UpdateOptionsBulk(map[string]string{HomepageModelsOptionKey: previous}))
	require.NoError(t, db.Migrator().DropTable(&Option{}))
	assert.Error(t, UpdateOption(HomepageModelsOptionKey, `{"enabled":true,"models":[]}`))
	config, err := GetHomepageModelsConfig()
	require.NoError(t, err)
	assert.False(t, config.Enabled)
}
