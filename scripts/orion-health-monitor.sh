#!/usr/bin/env bash
set -u

BASE_URL="${ORION_MONITOR_URL:-https://track.orionassessoriaa.com.br}"
SERVICE_NAME="${ORION_MONITOR_SERVICE:-oriontrack_oriontrack}"
INTERVAL_SECONDS="${ORION_MONITOR_INTERVAL:-60}"
LOG_DIR="${ORION_MONITOR_LOG_DIR:-/var/log/oriontrack-monitor}"
LOG_FILE="${LOG_DIR}/health.jsonl"
STATE_FILE="${LOG_DIR}/last-state"
HEARTBEAT_FILE="${LOG_DIR}/last-heartbeat"
INCIDENT_DIR="${LOG_DIR}/incidents"
TMP_DIR="/tmp/oriontrack-monitor"

mkdir -p "$LOG_DIR" "$INCIDENT_DIR" "$TMP_DIR"
touch "$LOG_FILE"

write_event() {
  local event="$1"
  local state="$2"
  local health_code="$3"
  local deep_code="$4"
  local health_time="$5"
  local deep_time="$6"
  local replicas="$7"
  local dns_result="$8"
  local deep_payload_file="$9"

  EVENT="$event" STATE="$state" HEALTH_CODE="$health_code" DEEP_CODE="$deep_code" \
  HEALTH_TIME="$health_time" DEEP_TIME="$deep_time" REPLICAS="$replicas" DNS_RESULT="$dns_result" \
  DEEP_PAYLOAD_FILE="$deep_payload_file" SERVICE_NAME="$SERVICE_NAME" python3 - <<'PY' >> "$LOG_FILE"
import json, os
from datetime import datetime, timezone

payload = None
payload_file = os.environ.get("DEEP_PAYLOAD_FILE", "")
try:
    with open(payload_file, "r", encoding="utf-8") as handle:
        payload = json.load(handle)
except Exception:
    payload = None

def number(name):
    try:
        return float(os.environ.get(name, "0") or 0)
    except ValueError:
        return None

print(json.dumps({
    "timestamp": datetime.now(timezone.utc).isoformat(),
    "event": os.environ.get("EVENT"),
    "state": os.environ.get("STATE"),
    "service": os.environ.get("SERVICE_NAME"),
    "http": {
        "health_code": os.environ.get("HEALTH_CODE"),
        "deep_code": os.environ.get("DEEP_CODE"),
        "health_time_seconds": number("HEALTH_TIME"),
        "deep_time_seconds": number("DEEP_TIME"),
    },
    "docker_replicas": os.environ.get("REPLICAS"),
    "dns": os.environ.get("DNS_RESULT"),
    "deep_health": payload,
}, ensure_ascii=False, separators=(",", ":")))
PY
}

while true; do
  cycle_id="$(date +%s)-$$"
  health_body="${TMP_DIR}/health-${cycle_id}.json"
  deep_body="${TMP_DIR}/deep-${cycle_id}.json"

  health_result="$(curl -sS --connect-timeout 5 --max-time 12 -o "$health_body" -w '%{http_code} %{time_total}' "${BASE_URL}/api/health" 2>/dev/null || printf '000 12')"
  deep_result="$(curl -sS --connect-timeout 5 --max-time 15 -o "$deep_body" -w '%{http_code} %{time_total}' "${BASE_URL}/api/health/deep" 2>/dev/null || printf '000 15')"
  health_code="$(printf '%s' "$health_result" | awk '{print $1}')"
  health_time="$(printf '%s' "$health_result" | awk '{print $2}')"
  deep_code="$(printf '%s' "$deep_result" | awk '{print $1}')"
  deep_time="$(printf '%s' "$deep_result" | awk '{print $2}')"
  replicas="$(docker service ls --filter "name=${SERVICE_NAME}" --format '{{.Replicas}}' 2>/dev/null | head -n 1)"
  dns_result="$(getent ahostsv4 "$(printf '%s' "$BASE_URL" | sed -E 's#https?://([^/]+).*#\1#')" 2>/dev/null | awk 'NR==1{print $1}')"

  state="UP"
  if [ "$health_code" != "200" ] || [ "$replicas" != "1/1" ]; then
    state="DOWN"
  elif [ "$deep_code" != "200" ]; then
    state="DEGRADED"
  fi

  previous_state="$(cat "$STATE_FILE" 2>/dev/null || printf 'UNKNOWN')"
  now_epoch="$(date +%s)"
  last_heartbeat="$(cat "$HEARTBEAT_FILE" 2>/dev/null || printf '0')"
  event=""

  if [ "$state" != "$previous_state" ]; then
    event="state_change"
  elif [ $((now_epoch - last_heartbeat)) -ge 900 ]; then
    event="heartbeat"
  fi

  if [ -n "$event" ]; then
    write_event "$event" "$state" "$health_code" "$deep_code" "$health_time" "$deep_time" "${replicas:-missing}" "${dns_result:-unresolved}" "$deep_body"
    printf '%s' "$now_epoch" > "$HEARTBEAT_FILE"
  fi

  if [ "$event" = "state_change" ] && [ "$state" != "UP" ]; then
    incident_file="${INCIDENT_DIR}/$(date -u +%Y%m%dT%H%M%SZ)-${state}.log"
    {
      echo "timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
      echo "state=${state}"
      echo "health_code=${health_code} health_time=${health_time}"
      echo "deep_code=${deep_code} deep_time=${deep_time}"
      echo "dns=${dns_result:-unresolved} replicas=${replicas:-missing}"
      echo
      echo "=== DEEP HEALTH ==="
      cat "$deep_body" 2>/dev/null || true
      echo
      echo "=== DOCKER SERVICE PS ==="
      docker service ps "$SERVICE_NAME" --no-trunc 2>&1 || true
      echo
      echo "=== DOCKER STATS ==="
      docker stats --no-stream 2>&1 || true
      echo
      echo "=== MEMORY AND LOAD ==="
      uptime 2>&1 || true
      free -h 2>&1 || true
      echo
      echo "=== RECENT KERNEL EVENTS ==="
      journalctl -k --since "10 minutes ago" --no-pager 2>&1 | tail -n 300 || true
      echo
      echo "=== RECENT SERVICE LOGS ==="
      docker service logs "$SERVICE_NAME" --since 10m --timestamps 2>&1 | tail -n 500 || true
    } > "$incident_file"
  fi

  printf '%s' "$state" > "$STATE_FILE"
  rm -f "$health_body" "$deep_body"
  sleep "$INTERVAL_SECONDS"
done
