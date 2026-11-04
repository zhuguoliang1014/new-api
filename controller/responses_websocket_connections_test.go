package controller

import (
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestResponsesWebSocketLimitSharesUserAcrossKeysAndAgents(t *testing.T) {
	f := newResponsesHTTPWSFixture(t, `tier("request", fixed(0))`)
	secondKey := &model.Token{UserId: f.user.Id, Key: "sameusersecondkey", Group: "default", Status: common.TokenStatusEnabled, ExpiredTime: -1, RemainQuota: 1000}
	require.NoError(t, model.DB.Create(secondKey).Error)
	defer model.DB.Unscoped().Delete(secondKey)
	endpoint := "ws" + strings.TrimPrefix(f.gatewayURL, "http") + "/v1/responses"
	// The fixture owns the first connection. Nine more connections across keys
	// and child agents exhaust this user's shared default allowance.
	clients := []*websocket.Conn{}
	defer func() {
		for _, c := range clients {
			_ = c.Close()
		}
	}()
	headersByKey := []http.Header{
		{"Authorization": []string{"Bearer sk-" + f.token.Key}},
		{"Authorization": []string{"Bearer sk-" + secondKey.Key}, "User-Agent": []string{"codex/subAgent"}},
	}
	for index := range 9 {
		client, _, err := websocket.DefaultDialer.Dial(endpoint, headersByKey[index%2])
		require.NoError(t, err)
		clients = append(clients, client)
	}
	denied, resp, err := websocket.DefaultDialer.Dial(endpoint, http.Header{"Authorization": []string{"Bearer sk-" + secondKey.Key}, "User-Agent": []string{"codex/subAgent"}, "X-User-ID": []string{"999999"}})
	if denied != nil {
		_ = denied.Close()
	}
	require.Error(t, err)
	require.NotNil(t, resp)
	assert.Equal(t, http.StatusUpgradeRequired, resp.StatusCode)
	assert.Equal(t, "no-store", resp.Header.Get("Cache-Control"))
	body, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	assert.Contains(t, string(body), "up to 10 Responses WebSocket connections")
	require.NoError(t, resp.Body.Close())
	var count int64
	require.NoError(t, model.LOG_DB.Model(&model.Log{}).Where("user_id = ?", f.user.Id).Count(&count).Error)
	assert.Zero(t, count, "handshake rejection must not generate consume rows")
	require.NoError(t, clients[0].Close())
	counterKey := fmt.Sprintf("new-api:responses-ws:connections:user:%d", f.user.Id)
	require.Eventually(t, func() bool { return common.RDB.ZCard(t.Context(), counterKey).Val() == 9 }, 3*time.Second, 10*time.Millisecond)
	replacement, _, err := websocket.DefaultDialer.Dial(endpoint, http.Header{"Authorization": []string{"Bearer sk-" + secondKey.Key}})
	require.NoError(t, err)
	clients = append(clients, replacement)
	assert.Equal(t, int64(10), common.RDB.ZCard(t.Context(), counterKey).Val())
	// Neither idle sockets nor the cap consume tokens or alter existing quota.
	var fresh model.Token
	require.NoError(t, model.DB.First(&fresh, secondKey.Id).Error)
	assert.Equal(t, 1000, fresh.RemainQuota)
}

func TestResponsesWebSocketLimitKeepsUsersIndependent(t *testing.T) {
	f := newResponsesHTTPWSFixture(t, `tier("request", fixed(0))`)
	endpoint := "ws" + strings.TrimPrefix(f.gatewayURL, "http") + "/v1/responses"
	clients := []*websocket.Conn{}
	defer func() {
		for _, c := range clients {
			_ = c.Close()
		}
	}()
	for range 9 {
		c, _, err := websocket.DefaultDialer.Dial(endpoint, http.Header{"Authorization": []string{"Bearer sk-" + f.token.Key}})
		require.NoError(t, err)
		clients = append(clients, c)
	}
	user := &model.User{Id: 5062000 + int(responsesWSTestUserSequence.Add(1)), Username: "ws-cap-other-user", AffCode: "ws-cap-other-aff", Status: common.UserStatusEnabled, Group: "default", Quota: 1000, AuthVersion: 1}
	require.NoError(t, model.DB.Create(user).Error)
	defer model.DB.Unscoped().Delete(user)
	token := &model.Token{UserId: user.Id, Key: "otherusercapkey", Group: "default", Status: common.TokenStatusEnabled, ExpiredTime: -1, RemainQuota: 1000}
	require.NoError(t, model.DB.Create(token).Error)
	defer model.DB.Unscoped().Delete(token)
	for range 10 {
		c, _, err := websocket.DefaultDialer.Dial(endpoint, http.Header{"Authorization": []string{"Bearer sk-" + token.Key}})
		require.NoError(t, err)
		clients = append(clients, c)
	}
	c, resp, err := websocket.DefaultDialer.Dial(endpoint, http.Header{"Authorization": []string{"Bearer sk-" + token.Key}})
	if c != nil {
		_ = c.Close()
	}
	require.Error(t, err)
	require.NotNil(t, resp)
	assert.Equal(t, 426, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
}

func TestResponsesWebSocketFailedUpgradeDoesNotLeakSlots(t *testing.T) {
	f := newResponsesHTTPWSFixture(t, `tier("request", fixed(0))`)
	endpoint := "ws" + strings.TrimPrefix(f.gatewayURL, "http") + "/v1/responses"
	for range 5 {
		c, resp, err := websocket.DefaultDialer.Dial(endpoint, http.Header{"Authorization": []string{"Bearer sk-" + f.token.Key}, "Origin": []string{"https://untrusted.example"}})
		if c != nil {
			_ = c.Close()
		}
		require.Error(t, err)
		require.NotNil(t, resp)
		assert.Equal(t, 403, resp.StatusCode)
		require.NoError(t, resp.Body.Close())
	}
	key := fmt.Sprintf("new-api:responses-ws:connections:user:%d", f.user.Id)
	assert.Equal(t, int64(1), common.RDB.ZCard(t.Context(), key).Val())
}

func TestResponsesWebSocketConcurrentHandshakesAdmitExactlyTen(t *testing.T) {
	f := newResponsesHTTPWSFixture(t, `tier("request", fixed(0))`)
	endpoint := "ws" + strings.TrimPrefix(f.gatewayURL, "http") + "/v1/responses"
	var wg sync.WaitGroup
	var admitted, denied atomic.Int32
	clients := make(chan *websocket.Conn, 12)
	for range 12 {
		wg.Go(func() {
			c, resp, err := websocket.DefaultDialer.Dial(endpoint, http.Header{"Authorization": []string{"Bearer sk-" + f.token.Key}})
			if err == nil {
				admitted.Add(1)
				clients <- c
				return
			}
			require.NotNil(t, resp)
			assert.Equal(t, 426, resp.StatusCode)
			_ = resp.Body.Close()
			denied.Add(1)
		})
	}
	wg.Wait()
	close(clients)
	for c := range clients {
		_ = c.Close()
	}
	assert.Equal(t, int32(9), admitted.Load(), "the fixture already holds the first connection")
	assert.Equal(t, int32(3), denied.Load())
}

func TestResponsesWebSocketLostLeaseClosesConnection(t *testing.T) {
	f := newResponsesHTTPWSFixture(t, `tier("request", fixed(0))`)
	key := fmt.Sprintf("new-api:responses-ws:connections:user:%d", f.user.Id)
	// A lease which expires (or is lost after Redis data loss) must close its
	// socket rather than continue serving as an uncounted connection.
	require.NoError(t, common.RDB.Del(t.Context(), key).Err())
	require.NoError(t, f.client.SetReadDeadline(time.Now().Add(20*time.Second)))
	_, _, err := f.client.ReadMessage()
	require.Error(t, err)
	assert.True(t, websocket.IsCloseError(err, websocket.CloseTryAgainLater), "expected controlled lease-loss close, got %v", err)
}

func TestResponsesWebSocketAdmissionFailureLeavesHTTPSAvailable(t *testing.T) {
	f := newResponsesHTTPWSFixture(t, `tier("request", fixed(0))`)
	// An invalid API credential is rejected by authentication before the
	// connection controller. It must not consume anyone's remaining slots.
	endpoint := "ws" + strings.TrimPrefix(f.gatewayURL, "http") + "/v1/responses"
	bad, resp, err := websocket.DefaultDialer.Dial(endpoint, http.Header{"Authorization": []string{"Bearer sk-invalid"}})
	if bad != nil {
		_ = bad.Close()
	}
	require.Error(t, err)
	require.NotNil(t, resp)
	assert.Equal(t, 401, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
	key := fmt.Sprintf("new-api:responses-ws:connections:user:%d", f.user.Id)
	assert.Equal(t, int64(1), common.RDB.ZCard(t.Context(), key).Val())
}
