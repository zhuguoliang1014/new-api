package model

import (
	"errors"
	"fmt"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
)

const HomepageModelsOptionKey = "homepage_models"

// ParseHomepageModelsConfig validates content independently from the current
// model table so a deleted model does not prevent reading or clearing config.
func ParseHomepageModelsConfig(raw string) (dto.HomepageModelsConfig, error) {
	config := dto.HomepageModelsConfig{Models: []dto.HomepageModelSelection{}}
	if len(raw) > 64*1024 {
		return config, errors.New("homepage models configuration is too large")
	}
	if strings.TrimSpace(raw) == "" {
		return config, nil
	}
	if !strings.HasPrefix(strings.TrimSpace(raw), "{") {
		return config, errors.New("homepage models configuration must be an object")
	}
	if err := common.UnmarshalJsonStr(raw, &config); err != nil {
		return config, errors.New("invalid homepage models configuration")
	}
	if config.Models == nil {
		config.Models = []dto.HomepageModelSelection{}
	}
	if len(config.Models) > 24 {
		return config, errors.New("homepage models configuration allows at most 24 models")
	}
	seen := make(map[string]struct{}, len(config.Models))
	for _, selection := range config.Models {
		if strings.TrimSpace(selection.ModelName) == "" || strings.TrimSpace(selection.ModelName) != selection.ModelName || utf8.RuneCountInString(selection.ModelName) > 128 {
			return config, errors.New("homepage model name must contain 1 to 128 characters without surrounding whitespace")
		}
		if _, exists := seen[selection.ModelName]; exists {
			return config, errors.New("homepage model names must be unique")
		}
		seen[selection.ModelName] = struct{}{}
		if selection.Order < 0 || selection.Order > 9999 {
			return config, errors.New("homepage model order must be an integer from 0 to 9999")
		}
		if utf8.RuneCountInString(selection.Scenario.Zh) > 160 || utf8.RuneCountInString(selection.Scenario.En) > 160 {
			return config, errors.New("homepage model scenario must contain at most 160 characters per language")
		}
	}
	return config, nil
}

func ValidateHomepageModelsOption(raw string) error {
	config, err := ParseHomepageModelsConfig(raw)
	if err != nil {
		return err
	}
	if len(config.Models) == 0 {
		return nil
	}
	if DB == nil {
		return errors.New("database is not initialized")
	}
	names := make([]string, 0, len(config.Models))
	for _, selection := range config.Models {
		names = append(names, selection.ModelName)
	}
	var models []Model
	if err := DB.Where("model_name IN ? AND status = ? AND name_rule = ?", names, 1, NameRuleExact).Find(&models).Error; err != nil {
		return err
	}
	available := make(map[string]struct{}, len(models))
	for _, item := range models {
		available[item.ModelName] = struct{}{}
	}
	for _, name := range names {
		if _, exists := available[name]; !exists {
			return fmt.Errorf("homepage model %q must reference an enabled exact model", name)
		}
	}
	return nil
}

func GetHomepageModelsConfig() (dto.HomepageModelsConfig, error) {
	common.OptionMapRWMutex.RLock()
	raw := common.OptionMap[HomepageModelsOptionKey]
	common.OptionMapRWMutex.RUnlock()
	return ParseHomepageModelsConfig(raw)
}

func GetHomepageModels() (dto.HomepageModelsData, error) {
	config, err := GetHomepageModelsConfig()
	data := dto.HomepageModelsData{Models: []dto.HomepageModel{}}
	if err != nil {
		return data, err
	}
	data.Enabled = config.Enabled
	if !config.Enabled || len(config.Models) == 0 {
		return data, nil
	}
	selections := make([]dto.HomepageModelSelection, 0, len(config.Models))
	names := make([]string, 0, len(config.Models))
	for _, selection := range config.Models {
		if selection.Enabled {
			selections = append(selections, selection)
			names = append(names, selection.ModelName)
		}
	}
	if len(selections) == 0 {
		return data, nil
	}
	if DB == nil {
		return data, errors.New("database is not initialized")
	}
	var models []Model
	if err := DB.Where("model_name IN ? AND status = ? AND name_rule = ?", names, 1, NameRuleExact).Find(&models).Error; err != nil {
		return data, err
	}
	byName := make(map[string]Model, len(models))
	vendorIDs := make([]int, 0, len(models))
	for _, item := range models {
		byName[item.ModelName] = item
		if item.VendorID > 0 {
			vendorIDs = append(vendorIDs, item.VendorID)
		}
	}
	providers := make(map[int]dto.HomepageModelProvider, len(vendorIDs))
	if len(vendorIDs) > 0 {
		var vendors []Vendor
		if err := DB.Where("id IN ? AND status = ?", vendorIDs, 1).Find(&vendors).Error; err != nil {
			return data, err
		}
		for _, vendor := range vendors {
			providers[vendor.Id] = dto.HomepageModelProvider{Name: vendor.Name, Icon: vendor.Icon}
		}
	}
	sort.Slice(selections, func(i, j int) bool {
		if selections[i].Order == selections[j].Order {
			return selections[i].ModelName < selections[j].ModelName
		}
		return selections[i].Order < selections[j].Order
	})
	for _, selection := range selections {
		metadata, exists := byName[selection.ModelName]
		if !exists {
			continue
		}
		item := dto.HomepageModel{
			ModelName: metadata.ModelName, Description: metadata.Description,
			Icon: metadata.Icon, Tags: metadata.Tags,
			Featured: selection.Featured, Scenario: selection.Scenario,
		}
		if provider, exists := providers[metadata.VendorID]; exists {
			item.Provider = &provider
		}
		data.Models = append(data.Models, item)
	}
	return data, nil
}
