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

docker build \
  --build-arg NEXT_PUBLIC_SUPABASE_URL="$NEXT_PUBLIC_SUPABASE_URL" \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY="$NEXT_PUBLIC_SUPABASE_ANON_KEY" \
  --build-arg SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY" \
  -t oriontrack:latest .

docker stack deploy -c docker-stack.oriontrack.yml oriontrack

# The service uses the local tag oriontrack:latest. Docker Swarm does not always
# recreate tasks when the tag name is unchanged, so force a rolling restart.
docker service update --force oriontrack_oriontrack
