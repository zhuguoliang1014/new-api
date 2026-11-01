package openai

import (
	"github.com/QuantumNous/new-api/common"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestConvertMJImageRequestPreservesCreativeControls(t *testing.T) {
	const body = `{"model":"mj-v8.2","prompt":"A cat","n":1,"quality":"1","hd":false,"raw":false,"tile":true,"seed":0,"stylize":0,"chaos":35,"weird":100,"negative_prompt":"text","iw":0,"cref":"https://example.com/c.png","cw":0,"sref":"https://example.com/s.png","sw":0,"dref":"https://example.com/d.png","dw":0}`
	var request dto.ImageRequest
	require.NoError(t, common.UnmarshalJsonStr(body, &request))
	converted, err := (&Adaptor{}).ConvertImageRequest(nil, &relaycommon.RelayInfo{}, request)
	require.NoError(t, err)
	encoded, err := common.Marshal(converted)
	require.NoError(t, err)
	require.JSONEq(t, body, string(encoded))
	var absent dto.ImageRequest
	require.NoError(t, common.UnmarshalJsonStr(`{"model":"gpt-image-2","prompt":"A cat"}`, &absent))
	encoded, err = common.Marshal(absent)
	require.NoError(t, err)
	require.JSONEq(t, `{"model":"gpt-image-2","prompt":"A cat"}`, string(encoded))
}
