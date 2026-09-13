# Orion Track — contexto para continuar o trabalho

> Arquivo portátil. Leve para qualquer assistente ou pessoa nova e ela entende o
> sistema sem precisar perguntar. **Atualizado em 13/09/2026.**
>
> Quando levar para outro lugar, mande junto: `AGENTS.md` (regra do Next) e este
> arquivo. O resto o leitor descobre lendo o código.

---

## 1. O que é

CRM próprio que roda a operação comercial de corretoras de plano de saúde.
Não é CRM de cadastro: o lead entra por anúncio, é distribuído sozinho, uma IA
atende no WhatsApp em segundos, qualifica e entrega ao vendedor com resumo.

Três operações convivem no mesmo sistema:

| Operação | O que é | Onde mora |
|---|---|---|
| **CRM das corretoras** | o produto vendido a 58 corretoras | `/leads`, `/kanban`, `/inbox`, `/ia` |
| **Comercial (Kripto Hunters)** | o time que vende o CRM | `/comercial/*` |
| **Tráfego e criação (Apollo)** | quem roda os anúncios | `/trafego/*`, `/criativos`, `/equipe/apollo` |

## 2. Tamanho real

| | |
|---|---|
| Leads | **24.199** (15.854 ainda em "Aguardando atendimento" = **65%**) |
| Corretoras | 58 |
| Usuários ativos | 101 |
| Contas de anúncio Meta | 114 |
| Mensagens de WhatsApp | 40.677 |
| Sessões de IA | 661 |
| Leads do comercial | 521 |

Código: **98.556 linhas**, 311 arquivos TS/TSX, 181 componentes React,
80 páginas, 115 rotas de API, 142 migrations.

**Número que vale para venda:** de cada dez leads que a IA atende, quase nove
respondem (87,9%). Sem IA, com pessoa só, menos de quatro (39,4%). Medido
comparando conversas com e sem sessão de IA.

## 3. Infraestrutura

```
Navegador ─┐
n8n ───────┼─► Traefik (TLS, healthcheck /api/health a cada 10s)
           │      │
WhatsApp ──┼──► UAZAPI ──┐   (mesmo enxame, rede uazapi_uazapi)
           │             ▼
           └──────► Orion Track × 2 réplicas (Next.js 16, porta 3000)
                            │
             ┌──────────────┼──────────────┬────────────┐
             ▼              ▼              ▼            ▼
         Supabase        OpenAI      Meta Graph      VoIP
```

- **VPS única** com Docker Swarm, em `72.60.12.164`, projeto em `/root/oriontrack`.
- **`replicas: 2` com `order: start-first`**: a versão nova sobe e passa no
  healthcheck antes de a antiga sair. É o que impede o CRM de cair no deploy.
- **O container não publica porta.** Traefik é a única entrada. Cron que aponte
  para `127.0.0.1:3000` não funciona: usar `$APP_URL`.
- **UAZAPI roda no mesmo enxame**, então o webhook de mensagem viaja pela rede
  interna do Docker (`http://oriontrack_oriontrack:3000`) e nunca sai para fora.
- **Supabase é gerenciado, fora da VPS.** Postgres com RLS, Storage com URL
  assinada, Realtime ligado em `whatsapp_mensagens` e `whatsapp_conversas`.
- **O build roda na própria VPS**, a partir do working tree de lá.

### Processos automáticos

| Processo | Frequência | Onde está declarado |
|---|---|---|
| Sync de gravações VoIP | 5 min | `deploy-vps.sh` |
| Monitor de saúde | 10 min | `deploy-vps.sh` |
| Aquecimento do cache Meta | 20 min | `deploy-vps.sh` |
| `oriontrack-monitor.service` | **60 s** | `scripts/install-orion-monitor.sh` |

**Atenção no último.** Esse serviço systemd confere saúde e, a cada volta
saudável, dispara `POST /api/inbox/uazapi/cron-lead-bots`. Ou seja, **o
atendimento automático de lead novo depende de um monitor de saúde**, não de
cron. Se ele parar ou classificar o sistema como degradado, lead novo para de
ser atendido e nada no crontab cobre.

A rota `cron-timeout`, que encerra sessão de IA parada, **não está em nenhum
crontab**: quem a sustenta é um `setInterval` em memória, por réplica, que só
existe depois que algum tráfego o arma.

## 4. Os 22 módulos

**Vila das Corretoras** — Leads (`app/leads`, `app/crm`, `lib/lead*`), Kanban
(`app/kanban`), Inbox WhatsApp (`app/inbox`, `lib/uazapi*`, `lib/inboxMedia`),
IA de Atendimento (`app/ia`, `lib/leadAi*`), Simulador (`app/simulador`),
Painel do Corretor (`app/dashboard`, `app/financeiro`).

**Quartel Kripto** — Leads, Kanban e Inbox do comercial (`app/comercial/*`),
IA SDR (`lib/commercialSdr*`), Sala e Metas (`app/comercial/sala`, `app/overview`).

**Torre Apollo** — Tráfego (`app/trafego`, `lib/trafego`), Otimizações
(`lib/meta`), Criativos (`lib/creatives`), Designer, Time Apollo (`app/equipe`).

**Castelo Admin** — `app/admin` (41 arquivos, o maior bloco).

**Subsolo** — Autenticação (`app/login`, `AuthProvider`), Banco (`lib/supabase`,
`supabase/*.sql`), Webhooks (`api/webhooks`), Monitor (`api/monitor`).

## 5. Armadilhas que já custaram tempo

**Não varra tabela grande.** Um scan completo de `whatsapp_mensagens` com a
coluna `metadata` derrubou o Supabase inteiro num sábado. Sempre `select` de
colunas específicas, com `limit`, em lote.

**Nunca deixe base64 voltar ao banco.** A mídia vai para o bucket e a linha
guarda só a URL. Um `...(body||{})` reintroduziu o base64 e gerou 24 MB num dia.
`removerBlobs()` existe para isso.

**Transcrição depois da checagem de duplicidade.** Na ordem errada, 200 áudios
viraram 1.301 transcrições e o gasto foi de US$ 0,56 para US$ 5,59 por dia.

**O arquivo do inbox tem 4.705 linhas.** É o maior do projeto, quase o dobro do
segundo. Todo incidente sério do inbox saiu dele. Mexer ali exige cuidado e não
existe teste automatizado no projeto.

**Prefetch de mídia sem trava vira tempestade.** Já gerou 1.180
`ERR_INSUFFICIENT_RESOURCES` e travou o inbox de um corretor. Use `ref` para
rastrear o que está em voo, não estado.

**Zero no banco não é meta.** As colunas de meta são `not null default 0` e um
bug gravou zeros de verdade. Testar sempre `> 0`, nunca `??`.

## 6. Convenções

- Comentários em português, explicando **por que**, não o que. Sem acento nos
  comentários de código (o resto do texto usa).
- Antes de commitar: `npx tsc --noEmit` e `npm run build`.
- **Leia `node_modules/next/dist/docs/` antes de escrever código de rota ou
  página.** Esta versão do Next tem mudanças que quebram o que você aprendeu.
- Migration em `supabase/AAAA-MM-DD_nome.sql`, aplicada **na mão** pelo SQL
  Editor. Toda migration precisa de guard idempotente e rollback comentado.
- Consulta ao banco pelo terminal:
  ```
  node --env-file=.env.local -e "const{createClient}=require('@supabase/supabase-js');const s=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY); ...consulta..."
  ```

## 7. Deploy

**Duas máquinas.** O git roda no Windows do dono; o deploy roda na VPS.

Na máquina (PowerShell 5.1 — **`&&` dá erro de parser, uma linha por vez**):

```
cd C:\Users\PC-000\Documents\oriontrack
git add <arquivo> <arquivo>          # NUNCA -A nem -u <pasta>
git commit -m "..."
git push
```

Na VPS:

```
cd /root/oriontrack && git pull && sh deploy-vps.sh
```

**SQL sempre antes do deploy**, quando houver migration.

### Três coisas que mordem

**`git add -A` ou `git add -u <pasta>` varre trabalho de outras sessões.** A
árvore vive com dezenas de arquivos modificados pela metade. Nomear um a um.

**A VPS tem arquivos fora do git** e o build sai do working tree de lá, então o
que roda em produção pode não estar no GitHub. Antes de qualquer `checkout`,
`stash` ou `reset` lá: `git diff > /root/backup-vps-$(date +%F-%H%M).patch`.

**Diff gigante na VPS quase sempre é quebra de linha.** A VPS é LF, a máquina é
CRLF. Conferir com `git diff --ignore-cr-at-eol --stat` antes de se assustar:
`inbox/page.tsx` já apareceu com 9.199 alterações sendo que o real eram 163.

## 8. Estado em 13/09/2026

### Funcionando

CRM, inbox, IA de atendimento, distribuição, VoIP, criativos, Overview Vendas
com metas editáveis, reivindicação de lead pelo grupo de WhatsApp.

### Quebrado agora

**O token da Meta expirou** em 12/09 às 11:42 de Brasília. Tudo que depende de
anúncio está cego: Tráfego, Otimizações, alertas de CPL e saldo, insights do
Apollo. **E o app do `.env.local` foi apagado** ("Application has been deleted"),
então não dá para gerar token novo por ele. O sistema avisou nos dias 10 e 11.

Recomendado: token de **System User** do Business Manager, que não expira.

**O ciclo de crédito de criativo está parado em agosto** (`ciclo_inicio
2026-08-01`, `ciclo_fim 2026-08-31`) com o gasto diário no teto. Desde a
correção da reserva, a geração agora recusa por falta de crédito em vez de gerar
sem contar. Alguém precisa virar o ciclo.

### Pendente

- **Multicanal da Unity**: o envio já assina a mensagem e garante exclusividade,
  mas a migration nunca foi aplicada e **não existe tela** para ligar a chave.
  Cuidado: a migration adiciona colunas em `corretores`, e a tela de admin grava
  em `corretoras`. São tabelas diferentes.
- **Nenhum processo registra "rodei e estava tudo bem".** Os monitores só
  escrevem quando encontram problema, então silêncio significa tanto saúde
  quanto cron morto. A menor mudança que resolve é uma tabela
  `processo_execucoes` com uma chamada no fim de cada rota de cron.
- **`valor_venda` está zerado** nos registros marcados como venda. Não dá para
  falar de faturamento gerado enquanto isso não for preenchido.

## 9. Como investigar problema de mensagem

Roteiro que já funcionou mais de uma vez:

1. `whatsapp_mensagens` da conversa, **sem a coluna `metadata`**, com `limit`.
2. Comparar `provider_message_id` com o que a UAZAPI tem em `/message/find`.
3. Conferir a instância em `/instance/all`: `connected` não garante entrega.
4. Olhar `openai_uso` filtrando por origem, para ver se a IA tentou e falhou.
5. `audit_logs` com `action` do evento esperado.

O erro quase nunca está onde o sintoma aparece.
