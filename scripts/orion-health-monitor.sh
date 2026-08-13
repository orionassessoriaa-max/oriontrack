#!/usr/bin/env bash
set -u

BASE_URL="${ORION_MONITOR_URL:-https://track.orionassessoriaa.com.br}"
SERVICE_NAME="${ORION_MONITOR_SERVICE:-oriontrack_oriontrack}"
INTERVAL_SECONDS="${ORION_MONITOR_INTERVAL:-60}"
LOG_DIR="${ORION_MONITOR_LOG_DIR:-/var/log/oriontrack-monitor}"
LOG_FILE="${LOG_DIR}/health.jsonl"
STATE_FILE="${LOG_DIR}/last-state"
HEARTBEAT_FILE="${LOG_DIR}/last-heartbeat"
INCIDENT_STARTED_FILE="${LOG_DIR}/incident-started-at"
NOTIFICATION_LOG="${LOG_DIR}/notifications.jsonl"
INCIDENT_DIR="${LOG_DIR}/incidents"
TMP_DIR="/tmp/oriontrack-monitor"
ALERT_PHONE="${ORION_MONITOR_WHATSAPP:-5561984409328}"
APOLO_INSTANCE="${ORION_MONITOR_APOLO_INSTANCE:-apolo_master_sender}"

mkdir -p "$LOG_DIR" "$INCIDENT_DIR" "$TMP_DIR"
touch "$LOG_FILE"

send_apolo_alert() {
  local title="$1"
  local message="$2"

  ALERT_TITLE="$title" ALERT_MESSAGE="$message" ALERT_PHONE="$ALERT_PHONE" \
  APOLO_INSTANCE="$APOLO_INSTANCE" NOTIFICATION_LOG="$NOTIFICATION_LOG" python3 - <<'PY'
import json, os, sys, urllib.error, urllib.request
from datetime import datetime, timezone

base_url = os.environ.get("UAZAPI_URL", "").rstrip("/")
global_token = os.environ.get("UAZAPI_GLOBAL_TOKEN", "")
instance_name = os.environ.get("APOLO_INSTANCE", "apolo_master_sender")
phone = "".join(ch for ch in os.environ.get("ALERT_PHONE", "") if ch.isdigit())
log_file = os.environ.get("NOTIFICATION_LOG", "/var/log/oriontrack-monitor/notifications.jsonl")

result = {
    "timestamp": datetime.now(timezone.utc).isoformat(),
    "instance": instance_name,
    "phone_suffix": phone[-4:] if phone else None,
    "status": "failed",
}

def write_result():
    with open(log_file, "a", encoding="utf-8") as handle:
        handle.write(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n")

if not base_url or not global_token or not phone:
    result["reason"] = "Configuracao UAZAPI ou telefone ausente."
    write_result()
    sys.exit(1)

def request_json(url, method="GET", headers=None, body=None, timeout=15):
    payload = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=payload, method=method, headers=headers or {})
    with urllib.request.urlopen(req, timeout=timeout) as response:
        raw = response.read().decode("utf-8", errors="replace")
        return json.loads(raw) if raw else {}

def as_array(payload):
    if isinstance(payload, list): return payload
    for key in ("data", "instances", "response"):
        if isinstance(payload.get(key), list): return payload[key]
    return []

def instance_name_of(item):
    return str(item.get("name") or item.get("instanceName") or item.get("instance") or item.get("session") or item.get("sessionkey") or "")

def instance_token_of(item):
    credential = item.get("credential") if isinstance(item.get("credential"), dict) else {}
    return str(item.get("token") or item.get("instanceToken") or item.get("apikey") or item.get("apiKey") or item.get("key") or credential.get("token") or "").strip()

def connected(item):
    nested = item.get("instance") if isinstance(item.get("instance"), dict) else {}
    state = str(item.get("status") or item.get("state") or item.get("connectionStatus") or nested.get("status") or "").lower()
    if any(word in state for word in ("disconnect", "close", "offline", "logout")): return False
    return item.get("connected") is True or item.get("loggedIn") is True or state in ("open", "connected", "online", "loggedin")

try:
    instances = request_json(
        f"{base_url}/instance/all",
        headers={"Content-Type": "application/json", "admintoken": global_token},
    )
    matches = [item for item in as_array(instances) if instance_name_of(item).lower() == instance_name.lower()]
    selected = next((item for item in matches if connected(item)), matches[0] if matches else None)
    token = instance_token_of(selected or {})
    if not token:
        raise RuntimeError("Instancia Apolo sem token ou nao encontrada.")

    alert_message = os.environ.get("ALERT_MESSAGE", "").replace("\\n", "\n")
    text = f"*{os.environ.get('ALERT_TITLE', 'Alerta do CRM')}*\n\n{alert_message}\n\n_Apolo Notificador - Orion Track_"
    request_json(
        f"{base_url}/send/text",
        method="POST",
        headers={
            "Content-Type": "application/json",
            "token": token,
            "sessionkey": instance_name,
            "session": instance_name,
        },
        body={"number": phone, "text": text},
    )
    result["status"] = "success"
    write_result()
except Exception as error:
    result["reason"] = str(error)[:240]
    write_result()
    sys.exit(1)
PY
}

format_duration() {
  local total_seconds="$1"
  if [ "$total_seconds" -lt 60 ]; then
    printf '%ss' "$total_seconds"
  elif [ "$total_seconds" -lt 3600 ]; then
    printf '%sm %ss' $((total_seconds / 60)) $((total_seconds % 60))
  else
    printf '%sh %sm' $((total_seconds / 3600)) $(((total_seconds % 3600) / 60))
  fi
}

if [ "${1:-}" = "--test-alert" ]; then
  send_apolo_alert "Monitor do CRM ativado" "O monitor independente do Orion Track foi configurado com sucesso. Este numero recebera avisos de instabilidade, queda e recuperacao do sistema." 
  echo "Mensagem de teste enviada pelo Apolo Notificador."
  exit 0
fi

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

  if [ "$event" = "state_change" ]; then
    local_time="$(date '+%d/%m/%Y %H:%M:%S %Z')"
    if [ "$state" = "UP" ] && { [ "$previous_state" = "DOWN" ] || [ "$previous_state" = "DEGRADED" ]; }; then
      incident_started="$(cat "$INCIDENT_STARTED_FILE" 2>/dev/null || printf '%s' "$now_epoch")"
      duration_seconds=$((now_epoch - incident_started))
      duration_text="$(format_duration "$duration_seconds")"
      send_apolo_alert "CRM normalizado" "O Orion Track voltou a operar normalmente.\n\nHorario da recuperacao: ${local_time}\nDuracao aproximada: ${duration_text}\nAplicacao: HTTP ${health_code}\nSupabase/Auth e banco: HTTP ${deep_code}\nDocker: ${replicas:-missing}" || true
      rm -f "$INCIDENT_STARTED_FILE"
    elif [ "$state" = "DOWN" ]; then
      if [ "$previous_state" = "UP" ] || [ "$previous_state" = "UNKNOWN" ]; then
        printf '%s' "$now_epoch" > "$INCIDENT_STARTED_FILE"
      fi
      send_apolo_alert "CRM fora do ar" "O monitor independente detectou indisponibilidade no Orion Track.\n\nHorario: ${local_time}\nAplicacao: HTTP ${health_code}\nDiagnostico Supabase: HTTP ${deep_code}\nDocker: ${replicas:-missing}\nDNS: ${dns_result:-unresolved}\n\nO incidente foi registrado automaticamente na VPS." || true
    elif [ "$state" = "DEGRADED" ]; then
      if [ "$previous_state" = "UP" ] || [ "$previous_state" = "UNKNOWN" ]; then
        printf '%s' "$now_epoch" > "$INCIDENT_STARTED_FILE"
      fi
      send_apolo_alert "CRM com instabilidade" "O CRM esta respondendo, mas o diagnostico de Auth ou banco identificou falha ou lentidao.\n\nHorario: ${local_time}\nAplicacao: HTTP ${health_code} (${health_time}s)\nSupabase/Auth e banco: HTTP ${deep_code} (${deep_time}s)\nDocker: ${replicas:-missing}\n\nO incidente foi registrado automaticamente na VPS." || true
    fi
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
