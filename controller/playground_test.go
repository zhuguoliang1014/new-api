package controller

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestExtractPlaygroundPromptSupportsStringAndContentBlocks(t *testing.T) {
	tests := []struct {
		name    string
		payload string
		want    string
	}{
		{
			name:    "legacy string content",
			payload: `{"choices":[{"message":{"content":"A cinematic mountain lake at sunrise."}}]}`,
			want:    "A cinematic mountain lake at sunrise.",
		},
		{
			name:    "text content blocks",
			payload: `{"choices":[{"message":{"content":[{"type":"text","text":"A cinematic "},{"type":"output_text","text":"mountain lake at sunrise."},{"type":"image","image_url":"ignored"}]}}]}`,
			want:    "A cinematic mountain lake at sunrise.",
		},
		{
			name:    "streaming text content blocks",
			payload: "data: {\"choices\":[{\"delta\":{\"content\":[{\"type\":\"text\",\"text\":\"A cinematic \"}]}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"mountain lake at sunrise.\"}}]}\n\ndata: [DONE]\n",
			want:    "A cinematic mountain lake at sunrise.",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := extractPlaygroundPrompt([]byte(test.payload))
			require.NoError(t, err)
			assert.Equal(t, test.want, got)
		})
	}
}

func TestExtractPlaygroundPromptRejectsUnsupportedContent(t *testing.T) {
	_, err := extractPlaygroundPrompt([]byte(`{"choices":[{"message":{"content":[{"type":"refusal","refusal":"no"}]}}]}`))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "empty prompt response")
}
