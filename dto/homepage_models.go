package dto

// Homepage model content is an explicit public selection. It carries no
// pricing, channel, group, or relay availability information.
type HomepageModelScenario struct {
	Zh string `json:"zh"`
	En string `json:"en"`
}

type HomepageModelSelection struct {
	ModelName string                `json:"model_name"`
	Enabled   bool                  `json:"enabled"`
	Order     int                   `json:"order"`
	Featured  bool                  `json:"featured"`
	Scenario  HomepageModelScenario `json:"scenario"`
}

type HomepageModelsConfig struct {
	Enabled bool                     `json:"enabled"`
	Models  []HomepageModelSelection `json:"models"`
}

type HomepageModelProvider struct {
	Name string `json:"name"`
	Icon string `json:"icon,omitempty"`
}

type HomepageModel struct {
	ModelName   string                 `json:"model_name"`
	Description string                 `json:"description,omitempty"`
	Icon        string                 `json:"icon,omitempty"`
	Tags        string                 `json:"tags,omitempty"`
	Provider    *HomepageModelProvider `json:"provider,omitempty"`
	Featured    bool                   `json:"featured"`
	Scenario    HomepageModelScenario  `json:"scenario"`
}

type HomepageModelsData struct {
	Enabled bool            `json:"enabled"`
	Models  []HomepageModel `json:"models"`
}
