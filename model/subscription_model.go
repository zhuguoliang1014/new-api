package model

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/constant"
)

// NormalizeSubscriptionModelProviders rejects transport-only IDs and malformed
// lists before a plan can silently become unusable or unrestricted.
func NormalizeSubscriptionModelProviders(raw string) (string, error) {
	if strings.TrimSpace(raw) == "" {
		return "", nil
	}
	if len(raw) > 512 {
		return "", fmt.Errorf("model provider restrictions exceed 512 characters")
	}
	seen := map[int]bool{}
	values := []string{}
	for part := range strings.SplitSeq(raw, ",") {
		id, err := strconv.Atoi(strings.TrimSpace(part))
		if err != nil {
			return "", fmt.Errorf("invalid model provider: %q", part)
		}
		switch id {
		case constant.ChannelTypeOpenAI, constant.ChannelTypeAnthropic, constant.ChannelTypeGemini,
			constant.ChannelTypeDeepSeek, constant.ChannelTypeMoonshot, constant.ChannelTypeXai,
			constant.ChannelTypeAli, constant.ChannelTypeZhipu_v4, constant.ChannelTypeMiniMax, constant.ChannelTypeMistral:
		default:
			return "", fmt.Errorf("unsupported model provider: %d", id)
		}
		if !seen[id] {
			values = append(values, strconv.Itoa(id))
			seen[id] = true
		}
	}
	return strings.Join(values, ","), nil
}

// SubscriptionModelProvider identifies the requested model independently of
// the transport. Unknown/custom aliases must not inherit an OpenAI-compatible
// channel's identity, because that could charge the wrong restricted plan.
func SubscriptionModelProvider(modelName string) int {
	name := strings.ToLower(strings.TrimSpace(modelName))
	if _, tail, ok := strings.Cut(name, "/"); ok {
		name = tail
	}
	for _, prefix := range []string{"us.anthropic.", "eu.anthropic.", "apac.anthropic.", "global.anthropic.", "anthropic.", "openai."} {
		name = strings.TrimPrefix(name, prefix)
	}
	for _, rule := range []struct {
		provider int
		prefixes []string
	}{
		{constant.ChannelTypeAnthropic, []string{"claude-"}},
		{constant.ChannelTypeOpenAI, []string{"gpt", "chatgpt-", "o1-", "o3-", "o4-", "codex-"}},
		{constant.ChannelTypeGemini, []string{"gemini-", "gemma-", "learnlm-", "imagen-", "veo-"}},
		{constant.ChannelTypeDeepSeek, []string{"deepseek-"}},
		{constant.ChannelTypeMoonshot, []string{"moonshot-", "kimi-"}},
		{constant.ChannelTypeXai, []string{"grok-"}},
		{constant.ChannelTypeAli, []string{"qwen-", "qwen2", "qwen3", "qwq-", "qvq-"}},
		{constant.ChannelTypeZhipu_v4, []string{"glm-", "chatglm-"}},
		{constant.ChannelTypeMiniMax, []string{"minimax-", "abab"}},
		{constant.ChannelTypeMistral, []string{"mistral-", "mixtral-", "codestral-", "ministral-", "magistral-", "pixtral-"}},
	} {
		for _, prefix := range rule.prefixes {
			if strings.HasPrefix(name, prefix) {
				return rule.provider
			}
		}
	}
	if name == "o1" || name == "o3" || name == "o4" {
		return constant.ChannelTypeOpenAI
	}
	return constant.ChannelTypeUnknown
}

func (p *SubscriptionPlan) AllowsModel(modelName string) bool {
	if strings.TrimSpace(p.AllowedChannelTypes) == "" {
		return true
	}
	provider := SubscriptionModelProvider(modelName)
	return provider != constant.ChannelTypeUnknown && p.AllowsChannelType(provider)
}
