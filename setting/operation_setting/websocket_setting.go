package operation_setting

import (
	"strconv"

	"github.com/QuantumNous/new-api/common"
)

const (
	ResponsesWSMaxConnectionsPerUserOptionKey = "ResponsesWSMaxConnectionsPerUser"
	DefaultResponsesWSMaxConnectionsPerUser   = 10
	MaxResponsesWSConnectionsPerUser          = 1000
)

func ValidateResponsesWSMaxConnectionsPerUser(value string) error {
	limit, err := strconv.Atoi(value)
	if err != nil || limit < 1 || limit > MaxResponsesWSConnectionsPerUser {
		return common.NewMessage("WebSocket connection limit must be an integer from 1 to 1000.")
	}
	return nil
}

// OptionMap uses the same lock for reloads and updates. Reading a snapshot here
// lets new handshakes follow administrator changes without racing live sockets.
func GetResponsesWSMaxConnectionsPerUser() int {
	common.OptionMapRWMutex.RLock()
	value := common.OptionMap[ResponsesWSMaxConnectionsPerUserOptionKey]
	common.OptionMapRWMutex.RUnlock()
	limit, err := strconv.Atoi(value)
	if err != nil || limit < 1 || limit > MaxResponsesWSConnectionsPerUser {
		return DefaultResponsesWSMaxConnectionsPerUser
	}
	return limit
}
