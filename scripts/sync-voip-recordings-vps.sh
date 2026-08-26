#!/bin/sh
set -eu

PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ENV_FILE="$PROJECT_DIR/.env.production"

if [ ! -f "$ENV_FILE" ]; then
  echo "Arquivo $ENV_FILE nao encontrado." >&2
  exit 1
fi

set -a
. "$ENV_FILE"
set +a

if [ -z "${CRON_SECRET:-}" ]; then
  echo "CRON_SECRET nao configurado." >&2
  exit 1
fi

curl \
  --fail \
  --silent \
  --show-error \
  --max-time 120 \
  --request POST \
  --header "Authorization: Bearer $CRON_SECRET" \
  'https://track.orionassessoriaa.com.br/api/integrations/voip/recordings/cron?dias=2'
printf '\n'
