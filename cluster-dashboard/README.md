# Cluster Dashboard

Web dashboard for the Docker cluster: monitors the 5 app replicas, MongoDB, and Redis, and lets you run operations (create guest, send message, list users) against a chosen replica.

## Run

```bash
cd ~/Developer/devOps
docker compose up -d --build
```

Open http://localhost:8081.

## What it shows

- Replica health cards (UP/DOWN, DB state, latency) with a live health-over-time chart
- Mongo collection counts (users / messages)
- Redis status: cached `messageCount` key, TTL, total keys, version, memory
- Per-replica message count (cache vs Mongo)
- Operations panel to exercise the API against any replica

## Architecture

```
browser ──> dashboard (Express, :8081) ──> app replicas (api/health, operations)
                          │
                          ├──> MongoDB (read-only stats / collection counts)
                          └──> Redis (messageCount cache, info)
```

The React client is built into `client/dist` and served statically by the Express
server. Frontend source lives in `client/src`.

## Note: sequential replica polling (Docker Desktop on macOS)

The dashboard polls all 5 replicas (health + message count). Polling is done
**sequentially**, one replica at a time.

**Why:** with parallel `Promise.all` polling, the running dashboard process
intermittently stalled requests at ~15ms with AbortError/timeout — far too fast
to be a real timeout, and standalone parallel test scripts never failed.

Root cause: Docker Desktop for macOS routes container network traffic through
**vpnkit**, a user-space networking daemon with a single-threaded event pump.
Sustained parallel outbound connections from a long-running process (which also
keeps Mongo + Redis client sockets alive and serves inbound HTTP) can saturate
that pump, leaving some connections to silently stall. Sequential polling keeps
only one connection in-flight at a time, so the pump is never overloaded.

Consequences for maintainers:

- **Don't "optimize" this back to `Promise.all`.** On a Linux host (real server,
  CI, EC2) it would work fine and slightly faster, but sequentially the full
  poll is only ~30ms, so there is no benefit — and on macOS it regresses to
  flaky.
- This limitation only affects the dashboard talking to the replicas. It does
  not affect the replicas talking to Mongo/Redis, nor Linux deployments.

See `docker cluster/text.txt` for the full investigation.