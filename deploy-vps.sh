#!/bin/sh
set -eu

PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$PROJECT_DIR"

if [ ! -f .env.production ]; then
  echo "Arquivo .env.production nao encontrado."
  echo "Crie o arquivo com NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY."
  exit 1
fi

set -a
. ./.env.production
set +a

for required_var in \
  NEXT_PUBLIC_SUPABASE_URL \
  NEXT_PUBLIC_SUPABASE_ANON_KEY \
  SUPABASE_SERVICE_ROLE_KEY \
  CRON_SECRET \
  VOIP_CLICK2CALL_DOMINIO \
  VOIP_CLICK2CALL_TOKEN \
  VOIP_CLICK2CALL_KEY \
  VOIP_CLICK2CALL_DEVICE_ID \
  VOIP_RECORDING_SIGNING_SECRET; do
  eval "required_value=\${$required_var:-}"
  if [ -z "$required_value" ]; then
    echo "A variavel obrigatoria $required_var esta vazia em .env.production. Deploy cancelado."
    exit 1
  fi
done

if [ "${#CRON_SECRET}" -lt 32 ] || [ "${#VOIP_RECORDING_SIGNING_SECRET}" -lt 32 ]; then
  echo "CRON_SECRET e VOIP_RECORDING_SIGNING_SECRET precisam ter pelo menos 32 caracteres."
  exit 1
fi

SCHEMA_STATUS="$(curl \
  --silent \
  --output /dev/null \
  --write-out '%{http_code}' \
  --max-time 20 \
  --header "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  --header "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/comercial_ligacoes?select=voip_record_id&limit=1" || true)"
if [ "$SCHEMA_STATUS" != "200" ]; then
  echo "Migration VoIP ainda nao aplicada no Supabase (HTTP $SCHEMA_STATUS)."
  echo "Execute supabase db push com uma conta autorizada antes do deploy."
  exit 1
fi

DEPLOY_TAG="$(date -u +%Y%m%d%H%M%S)"
ORIONTRACK_IMAGE="oriontrack:${DEPLOY_TAG}"
export ORIONTRACK_IMAGE

DEPLOY_LOG_DIR="/var/log/oriontrack-monitor"
DEPLOY_LOG_FILE="${DEPLOY_LOG_DIR}/deploys.jsonl"
DEPLOY_FINISHED=0
mkdir -p "$DEPLOY_LOG_DIR"
printf '{"timestamp":"%s","event":"deploy_started","image":"%s"}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$ORIONTRACK_IMAGE" >> "$DEPLOY_LOG_FILE"

log_failed_deploy() {
  exit_code="$?"
  if [ "$DEPLOY_FINISHED" -eq 0 ]; then
    printf '{"timestamp":"%s","event":"deploy_failed","image":"%s","exit_code":%s}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$ORIONTRACK_IMAGE" "$exit_code" >> "$DEPLOY_LOG_FILE"
  fi
}
trap log_failed_deploy EXIT

echo "[1/3] Construindo imagem ${ORIONTRACK_IMAGE}..."
BUILD_RESOURCE_ARGS=""
if docker buildx build --help 2>/dev/null | grep -q -- '--resource'; then
  # O build acontece na mesma VPS do CRM. Sob disputa, deixa o processo ao vivo
  # com oito vezes mais peso de CPU que cada etapa da compilacao.
  BUILD_RESOURCE_ARGS="--resource cpu-shares=128"
fi

# shellcheck disable=SC2086
docker buildx build \
  --load \
  $BUILD_RESOURCE_ARGS \
  --build-arg NEXT_PUBLIC_SUPABASE_URL="$NEXT_PUBLIC_SUPABASE_URL" \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY="$NEXT_PUBLIC_SUPABASE_ANON_KEY" \
  --build-arg SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY" \
  -t "$ORIONTRACK_IMAGE" .

echo "[2/3] Iniciando atualizacao sem derrubar a versao atual..."
docker stack deploy --resolve-image never -c docker-stack.oriontrack.yml oriontrack

SERVICE_NAME="oriontrack_oriontrack"
MAX_ATTEMPTS=90
ATTEMPT=0
DEPLOY_OK=0

echo "[3/3] Aguardando a nova versao ficar saudavel..."
while [ "$ATTEMPT" -lt "$MAX_ATTEMPTS" ]; do
  UPDATE_STATE="$(docker service inspect --format '{{if .UpdateStatus}}{{.UpdateStatus.State}}{{end}}' "$SERVICE_NAME" 2>/dev/null || true)"
  SERVICE_IMAGE="$(docker service inspect --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}' "$SERVICE_NAME" 2>/dev/null || true)"
  REPLICAS="$(docker service ls --filter "name=$SERVICE_NAME" --format '{{.Replicas}}' 2>/dev/null || true)"

  case "$UPDATE_STATE" in
    completed)
      if [ "$SERVICE_IMAGE" = "$ORIONTRACK_IMAGE" ]; then
        DEPLOY_OK=1
        break
      fi
      ;;
    rollback_started|rollback_paused|rollback_completed|paused)
      echo "Deploy falhou. O Docker preservou ou restaurou a versao anterior. Estado: $UPDATE_STATE"
      docker service ps "$SERVICE_NAME" --no-trunc || true
      exit 1
      ;;
  esac

  # Tambem cobre a primeira criacao do servico, quando ainda nao existe UpdateStatus.
  # Primeira criacao do servico, quando ainda nao existe UpdateStatus. O
  # "2/2" acompanha o numero de replicas do stack; com "1/1" fixo, o deploy
  # ficava esperando um estado que nunca chega.
  if [ -z "$UPDATE_STATE" ] && [ "${REPLICAS%%/*}" = "${REPLICAS##*/}" ] && [ -n "$REPLICAS" ] && [ "$SERVICE_IMAGE" = "$ORIONTRACK_IMAGE" ]; then
    DEPLOY_OK=1
    break
  fi

  ATTEMPT=$((ATTEMPT + 1))
  sleep 2
done

if [ "$DEPLOY_OK" -ne 1 ]; then
  echo "A nova versao nao ficou saudavel dentro do prazo. Iniciando rollback."
  docker service rollback "$SERVICE_NAME" || true
  exit 1
fi

docker service ps "$SERVICE_NAME" --filter desired-state=running
DEPLOY_FINISHED=1
printf '{"timestamp":"%s","event":"deploy_completed","image":"%s"}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$ORIONTRACK_IMAGE" >> "$DEPLOY_LOG_FILE"
trap - EXIT
echo "Deploy concluido sem interrupcao. Imagem ativa: $ORIONTRACK_IMAGE"

# O servico nao publica porta no host: quem alcanca a aplicacao e o Traefik,
# pelo dominio. Cron batendo em 127.0.0.1:3000 nunca chegava a lugar nenhum.
APP_URL="${APP_URL:-https://track.orionassessoriaa.com.br}"

VOIP_CRON_TAG="# oriontrack-voip-recordings"
VOIP_CRON_LINE="*/5 * * * * $PROJECT_DIR/scripts/sync-voip-recordings-vps.sh >> /var/log/oriontrack-voip-sync.log 2>&1 $VOIP_CRON_TAG"
CRON_TMP="$(mktemp)"
crontab -l 2>/dev/null | grep -F -v "$VOIP_CRON_TAG" > "$CRON_TMP" || true
printf '%s\n' "$VOIP_CRON_LINE" >> "$CRON_TMP"
crontab "$CRON_TMP"
rm -f "$CRON_TMP"
chmod 700 "$PROJECT_DIR/scripts/sync-voip-recordings-vps.sh"
echo "Sincronizacao VoIP instalada no cron a cada 5 minutos."

# Monitor de saude: avisa no WhatsApp quando o banco fica lento, uma instancia
# conectada para de gravar mensagem ou o lead para de cair no expediente. Antes
# disso, todo problema era descoberto por reclamacao de quem estava usando.
MONITOR_CRON_TAG="# oriontrack-monitor-saude"
MONITOR_CRON_LINE="*/10 * * * * curl -s -m 60 -H \"Authorization: Bearer $CRON_SECRET\" $APP_URL/api/monitor/saude >> /var/log/oriontrack-monitor-saude.log 2>&1 $MONITOR_CRON_TAG"
CRON_TMP="$(mktemp)"
crontab -l 2>/dev/null | grep -F -v "$MONITOR_CRON_TAG" > "$CRON_TMP" || true
printf '%s\n' "$MONITOR_CRON_LINE" >> "$CRON_TMP"
crontab "$CRON_TMP"
rm -f "$CRON_TMP"
echo "Monitor de saude instalado no cron a cada 10 minutos."

# Aquecimento do cache da Meta: a resposta vale meia hora, entao so a primeira
# visita do gestor era lenta. Rodando antes dele, a tela ja abre com o dado.
AQUECE_CRON_TAG="# oriontrack-aquece-meta"
AQUECE_CRON_LINE="*/20 * * * * curl -s -m 300 -H \"Authorization: Bearer $CRON_SECRET\" $APP_URL/api/monitor/aquecer-meta >> /var/log/oriontrack-aquece-meta.log 2>&1 $AQUECE_CRON_TAG"
CRON_TMP="$(mktemp)"
crontab -l 2>/dev/null | grep -F -v "$AQUECE_CRON_TAG" > "$CRON_TMP" || true
printf '%s\n' "$AQUECE_CRON_LINE" >> "$CRON_TMP"
crontab "$CRON_TMP"
rm -f "$CRON_TMP"
echo "Aquecimento do cache da Meta instalado no cron a cada 20 minutos."
