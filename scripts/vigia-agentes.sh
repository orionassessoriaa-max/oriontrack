#!/bin/sh
# Vigia a arvore do Orion Track e avisa a cada arquivo salvo. Serve para o
# Escritorio: cada caminho vira a mesa do modulo correspondente, e quem salvou
# aparece sentado la. O recado de handoff entre Codex e Claude tem caso proprio.
#
#   sh scripts/vigia-agentes.sh            roda o vigia
#   sh scripts/vigia-agentes.sh --mapa <arquivo>...   so mostra para onde vai
REPO="$(cd "$(dirname "$0")/.." && pwd)"
MARCA="${TMPDIR:-/tmp}/orion-vigia-marca"
cd "$REPO" || exit 1

# A ordem importa: o caso mais especifico vem antes do mais geral. As rotas de
# API moram em src/app/api/<modulo>, entao precisam de caso proprio: o padrao do
# modulo (src/app/<modulo>) nao alcanca elas por causa do "api/" no meio.
mesa_de() {
  case "$1" in
    contexto/de-codex-para-claude.md|contexto/de-claude-para-codex.md) echo recado ;;
    src/app/api/webhooks*)                                      echo webhooks ;;
    src/app/api/monitor*|scripts/*)                             echo monitor ;;
    src/app/api/admin*|src/app/admin*)                          echo admin ;;
    src/app/api/comercial*)                                     echo leadsc ;;
    src/app/api/overview*)                                      echo sala ;;
    src/app/api/inbox*)                                         echo inbox ;;
    src/app/api/criativos*)                                     echo criativos ;;
    src/app/api/trafego*|src/app/api/meta*)                     echo trafego ;;
    src/app/api/ia*|src/app/api/lead-ai*)                       echo ia ;;
    src/app/api/leads*|src/app/api/crm*)                        echo leads ;;
    src/app/api/simulador*)                                     echo simulador ;;
    src/app/api/equipe*|src/app/api/apollo*)                    echo apollo ;;
    src/app/api*)                                               echo webhooks ;;
    src/app/comercial/kanban*)                                  echo kanbanc ;;
    src/app/comercial/leads*)                                   echo leadsc ;;
    src/app/comercial/inbox*)                                   echo inboxc ;;
    src/app/comercial/sala*|src/app/overview*)                  echo sala ;;
    src/components/overview*)                                   echo sala ;;
    src/lib/commercialSdr*)                                     echo iasdr ;;
    src/app/comercial*|src/lib/comercial*)                      echo leadsc ;;
    src/components/commercial*)                                 echo leadsc ;;
    src/app/kanban*)                                            echo kanban ;;
    src/app/inbox*|src/lib/uazapi*|src/lib/inboxMedia*)         echo inbox ;;
    src/app/ia*|src/lib/leadAi*)                                echo ia ;;
    src/app/simulador*)                                         echo simulador ;;
    src/app/dashboard*|src/app/financeiro*)                     echo painel ;;
    src/app/leads*|src/app/crm*|src/lib/lead*)                  echo leads ;;
    src/app/trafego*|src/lib/trafego*)                          echo trafego ;;
    src/lib/meta*)                                              echo otimizacoes ;;
    src/app/criativos*|src/lib/creatives*)                      echo criativos ;;
    src/app/equipe*)                                            echo apollo ;;
    src/app/login*|src/lib/auth*|src/components/AuthProvider*)  echo auth ;;
    src/lib/supabase*|supabase/*)                               echo banco ;;
    contexto/*|docs/*)                                          echo contas ;;
    *)                                                          echo monitor ;;
  esac
}

if [ "$1" = "--mapa" ]; then          # modo teste: so imprime o destino
  shift
  for f in "$@"; do echo "$f -> $(mesa_de "$f")"; done
  exit 0
fi

touch "$MARCA"
while true; do
  sleep 12
  novos=$(find src supabase docs contexto scripts -type f -newer "$MARCA" \
          -not -path '*/node_modules/*' -not -path '*/.next/*' \
          -not -name '*.log' 2>/dev/null)
  touch "$MARCA"
  [ -z "$novos" ] && continue
  # Um build pode encostar em dezenas de arquivos de uma vez. Emite os quatro
  # primeiros e resume o resto, senao o vigia vira metralhadora de aviso.
  total=$(echo "$novos" | wc -l)
  echo "$novos" | head -4 | while read -r f; do
    [ -n "$f" ] && echo "$(date +%H:%M:%S)|$(mesa_de "$f")|$f"
  done
  [ "$total" -gt 4 ] && echo "$(date +%H:%M:%S)|resumo|mais $((total - 4)) arquivos no mesmo salvamento"
done
