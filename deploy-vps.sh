#!/bin/sh
set -eu

if [ ! -f .env.production ]; then
  echo "Arquivo .env.production nao encontrado."
  echo "Crie o arquivo com NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY."
  exit 1
fi

set -a
. ./.env.production
set +a

for required_var in NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY; do
  eval "required_value=\${$required_var:-}"
  if [ -z "$required_value" ]; then
    echo "A variavel obrigatoria $required_var esta vazia em .env.production. Deploy cancelado."
    exit 1
  fi
done

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
docker build \
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
  if [ -z "$UPDATE_STATE" ] && [ "$REPLICAS" = "1/1" ] && [ "$SERVICE_IMAGE" = "$ORIONTRACK_IMAGE" ]; then
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
