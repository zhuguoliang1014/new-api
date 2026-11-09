package controller

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/png"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func planPreview(t *testing.T, width int) string {
	t.Helper()
	var buf bytes.Buffer
	require.NoError(t, png.Encode(&buf, image.NewRGBA(image.Rect(0, 0, width, 2))))
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(buf.Bytes())
}

func TestStudioPlanPreservesReferenceRolesAndOrder(t *testing.T) {
	preview := planPreview(t, 2)
	messages, err := studioPlanMessages(studioPlanInput{Brief: "保留人物，换装", TaskType: "portrait", Language: "zhCN", References: []studioPlanReference{{Role: "identity", Image: preview}, {Role: "outfit", Image: preview}}})
	require.NoError(t, err)
	require.Equal(t, "system", messages[0]["role"])
	content := messages[1]["content"].([]map[string]any)
	require.Contains(t, content[0]["text"], "Simplified Chinese")
	require.Equal(t, "Reference image 1 — role: identity", content[1]["text"])
	require.Equal(t, preview, content[2]["image_url"].(map[string]any)["url"])
	require.Equal(t, "Reference image 2 — role: outfit", content[3]["text"])
}

func TestStudioPlanRejectsInvalidBriefAndUntrustedPreview(t *testing.T) {
	preview := planPreview(t, 2)
	cases := map[string]studioPlanInput{
		"empty brief":         {TaskType: "portrait"},
		"large brief":         {Brief: strings.Repeat("a", maxPlaygroundPrompt+1), TaskType: "portrait"},
		"unknown task":        {Brief: "A", TaskType: "browser"},
		"too many references": {Brief: "A", TaskType: "poster", References: make([]studioPlanReference, 6)},
		"unknown role":        {Brief: "A", TaskType: "poster", References: []studioPlanReference{{Role: "system", Image: preview}}},
		"external URL":        {Brief: "A", TaskType: "product", References: []studioPlanReference{{Role: "product", Image: "http://127.0.0.1/private"}}},
		"mismatched mime":     {Brief: "A", TaskType: "product", References: []studioPlanReference{{Role: "product", Image: strings.Replace(preview, "png", "jpeg", 1)}}},
		"invalid base64":      {Brief: "A", TaskType: "product", References: []studioPlanReference{{Role: "product", Image: "data:image/png;base64,!"}}},
		"large dimensions":    {Brief: "A", TaskType: "product", References: []studioPlanReference{{Role: "product", Image: planPreview(t, 2049)}}},
	}
	for name, input := range cases {
		t.Run(name, func(t *testing.T) { _, err := studioPlanMessages(input); require.Error(t, err) })
	}
}

func TestStudioCreativePlanRequiresReviewableBoundedOutput(t *testing.T) {
	valid := `{"title":"自然光","summary":"保留轮廓","prompt":"一只玻璃瓶","preserve":[],"steps":["自然光和留白"]}`
	plan, err := parseStudioCreativePlan(valid)
	require.NoError(t, err)
	require.Equal(t, "一只玻璃瓶", plan.Prompt)
	require.NotNil(t, plan.Preserve)
	_, err = parseStudioCreativePlan("```json\n" + valid + "\n```")
	require.NoError(t, err)
	for _, text := range []string{"{}", "not JSON", valid + " trailing", strings.Replace(valid, `"steps":["自然光和留白"]`, `"steps":[]`, 1), strings.Replace(valid, "自然光和留白", strings.Repeat("长", 301), 1)} {
		_, err := parseStudioCreativePlan(text)
		require.Error(t, err)
	}
	plan.Title = strings.Repeat("长", 121)
	encoded, err := json.Marshal(plan)
	require.NoError(t, err)
	_, err = parseStudioCreativePlan(string(encoded))
	require.Error(t, err)
}

func TestStudioPlanGeneralTaskDoesNotRequireCharacterReferences(t *testing.T) {
	messages, err := studioPlanMessages(studioPlanInput{Brief: "A red bicycle beside a lake", TaskType: "general", Language: "en"})
	if err != nil || len(messages) != 2 {
		t.Fatalf("general task rejected: %v", err)
	}
}
