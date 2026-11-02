package service

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/go-redis/redis/v8"
)

const ResponsesWSConnectionsPerUser = 3
const responsesWSConnectionTTL = time.Minute
const responsesWSConnectionRenewInterval = 15 * time.Second
const responsesWSConnectionRedisTimeout = 2 * time.Second

// The Redis server's clock avoids node clock skew. A unique member owns one
// connection, so a stale release cannot remove a replacement connection's slot.
const responsesWSConnectionAcquireScript = `
local clock = redis.call('TIME')
local now = clock[1] * 1000 + math.floor(clock[2] / 1000)
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[1]) then return 0 end
redis.call('ZADD', KEYS[1], now + tonumber(ARGV[2]), ARGV[3])
redis.call('PEXPIRE', KEYS[1], ARGV[2])
return 1`

const responsesWSConnectionRenewScript = `
local clock = redis.call('TIME')
local now = clock[1] * 1000 + math.floor(clock[2] / 1000)
local expires = redis.call('ZSCORE', KEYS[1], ARGV[1])
if not expires or tonumber(expires) <= now then return 0 end
redis.call('ZADD', KEYS[1], now + tonumber(ARGV[2]), ARGV[1])
redis.call('PEXPIRE', KEYS[1], ARGV[2])
return 1`

const responsesWSConnectionReleaseScript = `
redis.call('ZREM', KEYS[1], ARGV[1])
if redis.call('ZCARD', KEYS[1]) == 0 then redis.call('DEL', KEYS[1]) end
return 1`

var responsesWSLocalConnections = struct {
	sync.Mutex
	users map[int]int
}{users: make(map[int]int)}

// ResponsesWSConnectionLease is held until the socket and all request workers
// finish. Lost requires the controller to close the socket; a Redis outage must
// never silently switch an existing connection to an uncounted local slot.
type ResponsesWSConnectionLease struct {
	lost        chan struct{}
	stop        chan struct{}
	done        chan struct{}
	releaseOnce sync.Once
	remove      func()
}

func (l *ResponsesWSConnectionLease) Lost() <-chan struct{} { return l.lost }

func (l *ResponsesWSConnectionLease) Release() {
	l.releaseOnce.Do(func() {
		close(l.stop)
		<-l.done
		l.remove()
	})
}

func newResponsesWSConnectionLease(interval time.Duration, renew func() bool, remove func()) *ResponsesWSConnectionLease {
	lease := &ResponsesWSConnectionLease{lost: make(chan struct{}), stop: make(chan struct{}), done: make(chan struct{}), remove: remove}
	if renew == nil {
		close(lease.done)
		return lease
	}
	go func() {
		defer close(lease.done)
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-lease.stop:
				return
			case <-ticker.C:
				if !renew() {
					close(lease.lost)
					return
				}
			}
		}
	}()
	return lease
}

// AcquireResponsesWSConnection counts authenticated users across all their API
// keys, models and child-agent connections. Redis shares the cap across nodes;
// deployments without Redis use a process-local cap. Rejection is pre-upgrade,
// before any model request or quota reservation is created.
func AcquireResponsesWSConnection(ctx context.Context, userID int) (*ResponsesWSConnectionLease, bool, error) {
	if userID <= 0 {
		return nil, false, errors.New("authenticated user required for WebSocket connection")
	}
	if !common.RedisEnabled {
		responsesWSLocalConnections.Lock()
		if responsesWSLocalConnections.users[userID] >= ResponsesWSConnectionsPerUser {
			responsesWSLocalConnections.Unlock()
			return nil, false, nil
		}
		responsesWSLocalConnections.users[userID]++
		responsesWSLocalConnections.Unlock()
		lease := newResponsesWSConnectionLease(0, nil, func() {
			responsesWSLocalConnections.Lock()
			defer responsesWSLocalConnections.Unlock()
			responsesWSLocalConnections.users[userID]--
			if responsesWSLocalConnections.users[userID] == 0 {
				delete(responsesWSLocalConnections.users, userID)
			}
		})
		return lease, true, nil
	}
	rdb := common.RDB
	if rdb == nil {
		return nil, false, errors.New("WebSocket connection counter unavailable")
	}
	return acquireRedisResponsesWSConnection(ctx, rdb, userID, responsesWSConnectionRenewInterval)
}

func acquireRedisResponsesWSConnection(ctx context.Context, rdb *redis.Client, userID int, renewInterval time.Duration) (*ResponsesWSConnectionLease, bool, error) {
	key := fmt.Sprintf("new-api:responses-ws:connections:user:%d", userID)
	member := common.NewRequestId()
	acquireCtx, cancel := context.WithTimeout(ctx, responsesWSConnectionRedisTimeout)
	acquired, err := rdb.Eval(acquireCtx, responsesWSConnectionAcquireScript, []string{key}, ResponsesWSConnectionsPerUser, responsesWSConnectionTTL.Milliseconds(), member).Int()
	cancel()
	if err != nil || acquired != 1 {
		return nil, false, err
	}
	// Capture the client: changing configuration cannot release into another
	// Redis database, or move a running lease between the local/Redis counters.
	lease := newResponsesWSConnectionLease(renewInterval, func() bool {
		renewCtx, cancel := context.WithTimeout(context.Background(), responsesWSConnectionRedisTimeout)
		defer cancel()
		renewed, err := rdb.Eval(renewCtx, responsesWSConnectionRenewScript, []string{key}, member, responsesWSConnectionTTL.Milliseconds()).Int()
		return err == nil && renewed == 1
	}, func() {
		releaseCtx, cancel := context.WithTimeout(context.Background(), responsesWSConnectionRedisTimeout)
		defer cancel()
		// A failed release remains bounded by the lease TTL after the socket closes.
		_ = rdb.Eval(releaseCtx, responsesWSConnectionReleaseScript, []string{key}, member).Err()
	})
	return lease, true, nil
}
