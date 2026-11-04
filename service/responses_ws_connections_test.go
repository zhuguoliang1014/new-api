package service

import (
	"context"
	"fmt"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/alicebob/miniredis/v2"
	"github.com/go-redis/redis/v8"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestResponsesWSLocalConnectionsCapPerUserAndRelease(t *testing.T) {
	previous := common.RedisEnabled
	common.RedisEnabled = false
	t.Cleanup(func() { common.RedisEnabled = previous })
	var leases []*ResponsesWSConnectionLease
	defer func() {
		for _, l := range leases {
			l.Release()
		}
	}()
	for range ResponsesWSConnectionsPerUser {
		lease, ok, err := AcquireResponsesWSConnection(t.Context(), 70601)
		require.NoError(t, err)
		require.True(t, ok)
		leases = append(leases, lease)
	}
	fourth, ok, err := AcquireResponsesWSConnection(t.Context(), 70601)
	require.NoError(t, err)
	assert.False(t, ok)
	assert.Nil(t, fourth)
	other, ok, err := AcquireResponsesWSConnection(t.Context(), 70602)
	require.NoError(t, err)
	require.True(t, ok)
	other.Release()
	leases[0].Release()
	leases[0].Release()
	replacement, ok, err := AcquireResponsesWSConnection(t.Context(), 70601)
	require.NoError(t, err)
	require.True(t, ok)
	leases = append(leases, replacement)
	// Releasing the original lease again cannot subtract the replacement.
	leases[0].Release()
	_, ok, err = AcquireResponsesWSConnection(t.Context(), 70601)
	require.NoError(t, err)
	assert.False(t, ok)
}

func TestResponsesWSLocalConnectionsConcurrentAdmissionIsAtomic(t *testing.T) {
	previous := common.RedisEnabled
	common.RedisEnabled = false
	t.Cleanup(func() { common.RedisEnabled = previous })
	var wg sync.WaitGroup
	var admitted atomic.Int32
	leases := make(chan *ResponsesWSConnectionLease, 30)
	for range 30 {
		wg.Go(func() {
			lease, ok, err := AcquireResponsesWSConnection(t.Context(), 70603)
			assert.NoError(t, err)
			if ok {
				admitted.Add(1)
				leases <- lease
			}
		})
	}
	wg.Wait()
	close(leases)
	for lease := range leases {
		lease.Release()
	}
	assert.Equal(t, int32(10), admitted.Load())
	responsesWSLocalConnections.Lock()
	defer responsesWSLocalConnections.Unlock()
	assert.NotContains(t, responsesWSLocalConnections.users, 70603)
}

func TestResponsesWSConfiguredLimitAppliesToNewConnectionsWithoutDroppingLeases(t *testing.T) {
	for _, useRedis := range []bool{false, true} {
		t.Run(fmt.Sprintf("redis=%t", useRedis), func(t *testing.T) {
			previousEnabled, previousClient := common.RedisEnabled, common.RDB
			common.RedisEnabled = useRedis
			if useRedis {
				server := miniredis.RunT(t)
				common.RDB = redis.NewClient(&redis.Options{Addr: server.Addr()})
				defer common.RDB.Close()
			}
			defer func() { common.RedisEnabled, common.RDB = previousEnabled, previousClient }()
			const key = "ResponsesWSMaxConnectionsPerUser"
			common.OptionMapRWMutex.Lock()
			mapWasNil := common.OptionMap == nil
			old, hadOld := common.OptionMap[key]
			if common.OptionMap == nil {
				common.OptionMap = map[string]string{}
			}
			common.OptionMap[key] = "2"
			common.OptionMapRWMutex.Unlock()
			defer func() {
				common.OptionMapRWMutex.Lock()
				defer common.OptionMapRWMutex.Unlock()
				if mapWasNil {
					common.OptionMap = nil
				} else if hadOld {
					common.OptionMap[key] = old
				} else {
					delete(common.OptionMap, key)
				}
			}()
			var leases []*ResponsesWSConnectionLease
			defer func() {
				for _, lease := range leases {
					lease.Release()
				}
			}()
			acquire := func(want bool) {
				lease, ok, err := AcquireResponsesWSConnection(t.Context(), 70609)
				require.NoError(t, err)
				if lease != nil {
					leases = append(leases, lease)
				}
				require.Equal(t, want, ok)
			}
			acquire(true)
			acquire(true)
			acquire(false)
			common.OptionMapRWMutex.Lock()
			common.OptionMap[key] = "4"
			common.OptionMapRWMutex.Unlock()
			acquire(true)
			acquire(true)
			acquire(false)
			common.OptionMapRWMutex.Lock()
			common.OptionMap[key] = "1"
			common.OptionMapRWMutex.Unlock()
			for _, lease := range leases {
				select {
				case <-lease.Lost():
					t.Fatal("lowering the limit must not terminate existing leases")
				default:
				}
			}
			acquire(false)
			for _, lease := range leases {
				lease.Release()
			}
			acquire(true)
			acquire(false)
		})
	}
}

func TestResponsesWSRedisConnectionsSharedAcrossClients(t *testing.T) {
	server := miniredis.RunT(t)
	first := redis.NewClient(&redis.Options{Addr: server.Addr()})
	second := redis.NewClient(&redis.Options{Addr: server.Addr()})
	defer first.Close()
	defer second.Close()
	var leases []*ResponsesWSConnectionLease
	defer func() {
		for _, l := range leases {
			l.Release()
		}
	}()
	var wg sync.WaitGroup
	var mu sync.Mutex
	for i := range 20 {
		wg.Go(func() {
			client := first
			if i%2 != 0 {
				client = second
			}
			lease, ok, err := acquireRedisResponsesWSConnection(t.Context(), client, 70604, time.Hour)
			assert.NoError(t, err)
			if ok {
				mu.Lock()
				leases = append(leases, lease)
				mu.Unlock()
			}
		})
	}
	wg.Wait()
	require.Len(t, leases, 10)
	assert.Equal(t, int64(10), first.ZCard(t.Context(), "new-api:responses-ws:connections:user:70604").Val())
	leases[0].Release()
	replacement, ok, err := acquireRedisResponsesWSConnection(t.Context(), second, 70604, time.Hour)
	require.NoError(t, err)
	require.True(t, ok)
	leases = append(leases, replacement)
	leases[0].Release()
	assert.Equal(t, int64(10), first.ZCard(t.Context(), "new-api:responses-ws:connections:user:70604").Val())
}

func TestResponsesWSRedisAbandonedLeaseExpiresAndCannotResurrect(t *testing.T) {
	server := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: server.Addr()})
	defer client.Close()
	now := time.Now()
	server.SetTime(now)
	key := "new-api:responses-ws:connections:user:70605"
	for i := range 3 {
		got, err := client.Eval(t.Context(), responsesWSConnectionAcquireScript, []string{key}, 3, 1000, fmt.Sprintf("old-%d", i)).Int()
		require.NoError(t, err)
		assert.Equal(t, 1, got)
	}
	server.SetTime(now.Add(2 * time.Second))
	got, err := client.Eval(t.Context(), responsesWSConnectionAcquireScript, []string{key}, 3, 60000, "replacement").Int()
	require.NoError(t, err)
	require.Equal(t, 1, got)
	// An old heartbeat after expiry must not recreate a fourth active socket.
	renewed, err := client.Eval(t.Context(), responsesWSConnectionRenewScript, []string{key}, "old-0", 60000).Int()
	require.NoError(t, err)
	assert.Zero(t, renewed)
	require.NoError(t, client.Eval(t.Context(), responsesWSConnectionReleaseScript, []string{key}, "old-0").Err())
	assert.Equal(t, int64(1), client.ZCard(t.Context(), key).Val())
}

func TestResponsesWSRedisLeaseRenewsAndSignalsLoss(t *testing.T) {
	server := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: server.Addr(), MaxRetries: -1})
	defer client.Close()
	lease, ok, err := acquireRedisResponsesWSConnection(t.Context(), client, 70606, 10*time.Millisecond)
	require.NoError(t, err)
	require.True(t, ok)
	defer lease.Release()
	key := "new-api:responses-ws:connections:user:70606"
	members, err := client.ZRange(t.Context(), key, 0, -1).Result()
	require.NoError(t, err)
	require.Len(t, members, 1)
	initial := client.ZScore(t.Context(), key, members[0]).Val()
	server.SetTime(time.Now().Add(20 * time.Second))
	require.Eventually(t, func() bool { return client.ZScore(t.Context(), key, members[0]).Val() > initial }, time.Second, 10*time.Millisecond)
	require.NoError(t, client.Del(t.Context(), key).Err())
	select {
	case <-lease.Lost():
	case <-time.After(time.Second):
		t.Fatal("lost lease was not signalled")
	}
	lease.Release()
}

func TestResponsesWSRedisOutageDoesNotAdmitLocalConnections(t *testing.T) {
	previousEnabled, previousClient := common.RedisEnabled, common.RDB
	defer func() { common.RedisEnabled, common.RDB = previousEnabled, previousClient }()
	server := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: server.Addr(), MaxRetries: -1})
	defer client.Close()
	common.RedisEnabled, common.RDB = true, client
	lease, ok, err := acquireRedisResponsesWSConnection(t.Context(), client, 70607, 10*time.Millisecond)
	require.NoError(t, err)
	require.True(t, ok)
	defer lease.Release()
	require.NoError(t, client.Close())
	select {
	case <-lease.Lost():
	case <-time.After(time.Second):
		t.Fatal("Redis outage must invalidate the lease")
	}
	other, ok, err := AcquireResponsesWSConnection(context.Background(), 70607)
	require.Error(t, err)
	assert.False(t, ok)
	assert.Nil(t, other)
	responsesWSLocalConnections.Lock()
	defer responsesWSLocalConnections.Unlock()
	assert.NotContains(t, responsesWSLocalConnections.users, 70607)
}

func TestResponsesWSConnectionLeaseReleaseStopsRenewal(t *testing.T) {
	var renewals atomic.Int32
	var releases atomic.Int32
	lease := newResponsesWSConnectionLease(time.Hour, func() bool { renewals.Add(1); return true }, func() { releases.Add(1) })
	var wg sync.WaitGroup
	for range 10 {
		wg.Go(lease.Release)
	}
	wg.Wait()
	assert.Zero(t, renewals.Load())
	assert.Equal(t, int32(1), releases.Load())
}

func TestResponsesWSConnectionsWithRealRedis(t *testing.T) {
	socket := os.Getenv("TEST_RESPONSES_REDIS_SOCKET")
	if socket == "" {
		t.Skip("set TEST_RESPONSES_REDIS_SOCKET for isolated real Redis verification")
	}
	client := redis.NewClient(&redis.Options{Network: "unix", Addr: socket, MaxRetries: -1})
	defer client.Close()
	require.NoError(t, client.Ping(t.Context()).Err())
	userID := 70608
	key := fmt.Sprintf("new-api:responses-ws:connections:user:%d", userID)
	require.NoError(t, client.Del(t.Context(), key).Err())
	defer client.Del(context.Background(), key)
	var leases []*ResponsesWSConnectionLease
	defer func() {
		for _, l := range leases {
			l.Release()
		}
	}()
	for range 10 {
		lease, ok, err := acquireRedisResponsesWSConnection(t.Context(), client, userID, 10*time.Millisecond)
		require.NoError(t, err)
		require.True(t, ok)
		leases = append(leases, lease)
	}
	_, ok, err := acquireRedisResponsesWSConnection(t.Context(), client, userID, time.Hour)
	require.NoError(t, err)
	assert.False(t, ok)
	members, err := client.ZRange(t.Context(), key, 0, -1).Result()
	require.NoError(t, err)
	require.Len(t, members, 10)
	initial := client.ZScore(t.Context(), key, members[0]).Val()
	require.Eventually(t, func() bool { return client.ZScore(t.Context(), key, members[0]).Val() > initial }, time.Second, 10*time.Millisecond)
	leases[0].Release()
	replace, ok, err := acquireRedisResponsesWSConnection(t.Context(), client, userID, time.Hour)
	require.NoError(t, err)
	require.True(t, ok)
	leases = append(leases, replace)
	for _, l := range leases {
		l.Release()
	}
	assert.Zero(t, client.Exists(t.Context(), key).Val())
	// Stale process entries lapse using Redis TIME, independently of the
	// gateway node's clock. A late renewal cannot resurrect the dead socket.
	acquired, err := client.Eval(t.Context(), responsesWSConnectionAcquireScript, []string{key}, 3, 40, "abandoned").Int()
	require.NoError(t, err)
	require.Equal(t, 1, acquired)
	require.Eventually(t, func() bool { return client.Exists(t.Context(), key).Val() == 0 }, time.Second, 10*time.Millisecond)
	renewed, err := client.Eval(t.Context(), responsesWSConnectionRenewScript, []string{key}, "abandoned", 60000).Int()
	require.NoError(t, err)
	assert.Zero(t, renewed)
	t.Log("real Redis atomic admission, shared cap, renewal, release and expiry passed")
}
