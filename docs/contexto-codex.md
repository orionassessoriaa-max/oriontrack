# Orion Track — contexto completo para continuar o trabalho

Atualizado em 25/08/2026. Cole este arquivo inteiro no começo da conversa.
Ele descreve o sistema, o que foi feito nos últimos dias, o que está pendente e
as armadilhas que já custaram tempo.

Volume atual: 18.774 leads das corretoras, 290 leads comerciais, 29.409
mensagens de WhatsApp em 1.245 conversas. Último commit em produção: `22d5026`.

---

## 1. O que é o sistema

CRM da Orion Assessoria, em **Next.js 16 (App Router) + TypeScript + Supabase**,
rodando em VPS própria com Docker Swarm. Três operações dentro do mesmo produto:

- **CRM das corretoras** — leads de plano de saúde, inbox de WhatsApp, IA que
  atende o lead (persona padrão "Aline"). Telas: `/crm`, `/inbox`, `/leads`,
  `/tarefas`, `/ia`.
- **Comercial (Kripto Hunters)** — vende assessoria para corretores. Kanban
  próprio, inbox próprio, IA SDR e painel de parede. Telas em `/comercial/*`.
- **Tráfego + time Apollo** — gestores operam campanhas Meta pelo CRM, com o
  assistente "Apolo". Telas em `/trafego/*` e `/equipe/apollo/*`.

**Importante:** este Next.js tem quebras de compatibilidade em relação ao que
costuma estar na memória de modelos. Antes de escrever código de framework, leia
o guia correspondente em `node_modules/next/dist/docs/`.

## 2. Infraestrutura

| Item | Valor |
|---|---|
| App | `https://track.orionassessoriaa.com.br` |
| VPS | Docker Swarm, serviço `oriontrack_oriontrack`, pasta `/root/oriontrack` |
| Deploy | `cd /root/oriontrack && git pull origin main && sh deploy-vps.sh` |
| Supabase | projeto `nfkgrmzuizfxuoiwxcbm`, instância ~1 GB de RAM |
| WhatsApp | UAZAPI (`https://oriontrack.uazapi.com`) |
| Notificações | instância `apolo_master_sender` |
| VoIP | Click2Call da VoIP do Brasil, domínio `voipdobrasil.net.br` |
| Repo | `github.com/orionassessoriaa-max/oriontrack`, branch `main` |

- **Os workflows do GitHub Actions estão quebrados** (falham no passo SSH). Push
  não faz deploy; o deploy é sempre manual pelo comando acima.
- **A VPS não tem Node instalado.** Scripts de manutenção rodam dentro do
  container: `docker exec $(docker ps -q -f name=oriontrack_oriontrack) node scripts/<arquivo>.mjs`
- **No Windows/PowerShell, `npm` é bloqueado pela política de execução.** Use
  `npm.cmd run <script>`.

## 3. Armadilhas que já custaram tempo

1. **Prompt do banco vence o do código.** As IAs leem `corretora_ai_configs.system_prompt`
   e `comercial_config.ia_sdr_prompt`. Editar o `.ts` não muda nada em produção
   sem o UPDATE correspondente.
2. **Nono dígito do WhatsApp.** A UAZAPI entrega o JID de contas antigas sem o 9
   enquanto o CRM grava com ele. Comparar string com string descarta o lead. Use
   `phoneMatchKey` de `src/lib/uazapi.ts`.
3. **Operação comercial não tem corretora.** Os profiles do time comercial têm
   `corretor_id` nulo, e as conversas comerciais vivem com `corretor_id` e
   `lead_id` nulos. `whatsapp_conversas.lead_id` referencia `leads`, não
   `comercial_leads`.
4. **Eco da própria IA.** A UAZAPI devolve por webhook as mensagens que a IA
   enviou. Sem tratar, o sistema entende como "humano assumiu" e cala a IA.
5. **PostgREST estoura timeout** ao filtrar ou selecionar colunas JSONB grandes
   (`metadata` de `whatsapp_mensagens`). Use paginação por faixa e selects
   estreitos.
6. **Paginação por cursor de data perde linhas.** Cargas em lote gravam centenas
   de leads com o mesmo `created_at`; `gt(created_at, cursor)` pulou 4.772 leads.
   Ordene por `created_at` **e** `id`, e pagine por `range()`.
7. **`git add` com vários caminhos já deixou arquivo novo para trás** e quebrou o
   build na VPS. Sempre conferir `git status --short` antes do commit.
8. **Mídia em base64 no Postgres derrubou o banco** (1055 MB numa instância de
   1 GB). Hoje as mídias vão para o bucket `inbox-media`; o teto por mensagem é
   256 KB.

---

## 4. O que foi feito de 21 a 23/08

### IA das corretoras (`src/lib/leadAiAgent.ts`)

- **Relógio.** O prompt não tinha data nem hora, então a IA confirmava "hoje às
  14h" para um lead que entrou às 18h. Agora o system prompt abre com o bloco
  `== AGORA ==` contendo data e hora de Brasília e a regra de nunca confirmar
  horário que já passou.
- **Não forçar agendamento.** "Não pode ser por mensagem mesmo??" e "Se poder me
  mandar por mensagem eu prefiro" não casavam com nenhuma regra e sobravam para
  o modelo, que às vezes insistia com "uma ligação é ideal". `isCallRefusal`
  passou a cobrir as formas de perguntar e de preferir mensagem, e os guardrails
  proíbem argumentar a favor da ligação. Varredura de 14 dias: 6 recusas, a IA
  aceitou 5 e insistiu 1.
- **Modos de identidade.** `aiIdentity()` decide como a IA se apresenta:
  - `equipe` → "Me chamo Aline, da Soma."
  - `equipe_pessoa` → "Me chamo Aline, faço parte da equipe da Michele."
  - `propria` → "Aqui é a Rafaela, da Soma." (cita a corretora só quando o nome
    dela é diferente do nome da persona; na Roniele fica "Aqui é a Roniele.")
  No modo `propria` o encerramento é `self_service`: "vou montar seu estudo", sem
  prometer especialista nem outro número.
- **Pedido de valor.** A resposta era fixa prometendo "um especialista". Agora
  `valueRequestHandoffReply()` acompanha o modo de identidade.
- **Prefixo de persona.** `stripPersonaPrefix` só removia "Aline:"; agora recebe
  a persona da corretora.

### Simulador de IA (novo)

`scripts/simular-ia-corretora.ts` roda o mesmo `askAline()` de produção com o
prompt real do banco, **sem enviar WhatsApp e sem gravar nada**.

```
npm.cmd run simular-ia -- soma
npm.cmd run simular-ia -- soma "sim" "sou mei" "pode ser hoje as 14h"
SIMULA_PERSONA=Rafaela SIMULA_MODO=propria npm.cmd run simular-ia -- soma
```

### Kanban comercial

- `src/lib/comercialCadencia.ts` é a regra única de leitura das etapas de
  cadência. As etapas foram renomeadas para "DIA 1º"…"DIA 10º" e o
  reconhecimento exigia "dia 1" exato, então a cadência ficou desligada em 90
  leads. A mesma regra existe no banco como `comercial_dia_da_etapa()`.
- Tempo real: `comercial_leads` entrou na publicação `supabase_realtime` (o
  código já assinava `postgres_changes` havia tempo, mas nenhum evento chegava).
  O recarregamento é bloqueado enquanto o usuário arrasta um card.
- Quadro de tarefas do comercial virou kanban de quatro colunas com rolagem
  dentro da caixa (CSS no fim de `src/app/comercial/commercial.css`).

### Tarefas (`/tarefas` e `/equipe/apollo/tarefas`)

- Componente novo `src/components/tasks/GoogleTaskList.tsx` + `tasks.css`: painel
  por lista, círculo de concluir, prazo atrasado em vermelho, concluídas
  recolhidas, rolagem interna. **A tela `/comercial/tarefas` não usa esse
  componente** — foi revertida a pedido do dono.
- Linha fechada mostra só título e prazo; descrição, anexo e botões aparecem ao
  clicar.
- **Notificações por WhatsApp** (`src/lib/taskNotifications.ts`):
  - tarefa criada/atribuída → avisa o responsável;
  - tarefa vai para "fazendo" → avisa quem criou ("Fulano iniciou a tarefa X");
  - tarefa vai para "feito" → avisa quem criou, com a **duração da entrega**
    contada a partir de `iniciada_em`;
  - revisão pedida → avisa quem executou.
  Todas levam cópia para o dev (`PERFIL_DEV` em `taskNotifications.ts`).
  Como a tarefa de lead é gravada pelo navegador, o envio passa por
  `POST /api/tarefas/notificar`, que relê a tarefa do banco.
- **Revisão**: quem criou a tarefa pode devolvê-la com título e comentário; a
  tarefa volta para "fazendo" e fica registrada em `apollo_task_revisoes`.
- **Predefinições** (`src/lib/apolloTaskPresets.ts`): "Criar funil", "Edição de
  vídeo" e "Ajuste CRM". A pessoa dá o nome e a tarefa nasce como
  "Criar funil {nome}" com checklist pronto. O checklist vem do catálogo do
  servidor, não do que o navegador enviar.
- **Checklist manual**: o formulário de nova tarefa aceita itens digitados
  (até 20, 180 caracteres cada). Aparece só na criação — a rota de edição
  (PATCH) ainda não mexe em checklist.

### Higiene de dados

- 52 leads de teste apagados (nomes com "teste"/"tst" e "Ewertton"), com backup
  em `reports/backup-leads-teste.json`. Os 6 "John Doe" ficaram, a pedido.
- `scripts/leads-em-varias-corretoras.mjs` — 332 telefones aparecem em mais de
  uma concessionária (781 cadastros).
- `scripts/ranking-concessionarias.mjs` — ranking por `data_entrada`, que é a
  data real da planilha. `created_at` é o carimbo da importação: a Vida Protegida
  tem 2.716 leads gravados no mesmo minuto.

---

## 4b. O que foi feito em 24 e 25/08

### Inbox: mensagem que aparece mas não chega

Três defeitos diferentes produziam o mesmo sintoma — o corretor via a mensagem
na tela e o cliente nunca recebia. Todos corrigidos:

1. **Balão inventado pela tela.** Quando o servidor respondia OK sem devolver a
   linha gravada, `src/app/inbox/page.tsx` criava um `local_<timestamp>` com o
   texto digitado. Sumia no F5 e nunca existiu no banco. Agora a conversa é
   relida.
2. **Reserva órfã.** A linha é gravada antes de chamar o provedor e apagada se o
   envio falha; se o processo morre no meio (deploy, restart), ela ficava com
   cara de enviada. O GET de mensagens apaga reservas `orion-client:%` paradas há
   mais de 3 minutos (o provedor tem timeout de 15s).
3. **Eco do provedor duplicando.** O CRM guardava o id curto da resposta do envio
   (`3A87…`) e o webhook devolvia o mesmo envio prefixado
   (`5511989057745:3A87…`). Sem normalizar, as strings não batiam e a mesma
   mensagem entrava duas vezes. É o "chat bugado" que a equipe relatava.

### Inbox: recibo de entrega

Antes **nenhuma** mensagem enviada pelo CRM tinha confirmação: as 57 enviadas em
96h estavam todas com `status: Pending`, que é só a resposta síncrona da API. O
`messages_update` está assinado nas instâncias, mas **a UAZAPI não manda esse
evento** (meia hora de produção, zero eventos).

Solução em duas camadas:

- `src/lib/whatsappRecibo.ts` — escala única de estados
  (`pending → sent → server → delivered → read → played`), porque o evento fala
  `DELIVERY_ACK` e o histórico fala `Delivered`.
- O webhook trata o evento se ele chegar; e o `syncProviderHistory` do
  `GET /api/inbox/messages`, que já consulta `/message/find` ao abrir a conversa,
  grava o recibo real de cada mensagem (até 40 por abertura).
- Na bolha aparece `enviada` / `entregue` / `lida`. O que saiu pelo CRM e passou
  5 minutos sem recibo aparece em âmbar como `! sem confirmacao`. Mensagem
  digitada no celular não recebe selo, porque chega pelo webhook e não teria
  recibo.

**Ferramenta de diagnóstico:** `POST {UAZAPI}/message/find` com `{id}` devolve o
status real de qualquer mensagem. Foi assim que se provou que a mensagem que o
corretor jurava não ter saído estava como `Read`.

### Inbox: mídia e áudio

- Abrir mídia varria todas as instâncias da corretora: 17.310 chamadas à UAZAPI
  em 3 horas. Hoje o leque é limitado a 4 instâncias.
- 19 áudios estavam cortados em exatamente 262.144 bytes (teto do cache em
  base64). `scripts/reparar-audios-cortados.mjs` rebaixou tudo para o bucket e
  liberou 4,8 MB. A rota de mídia rebaixa de novo quando encontra o teto.

### Comercial: fila comum e Start do SDR

Voltou a regra antiga: o lead novo entra **sem dono**, todos os SDRs são
avisados, e quem apertar Start primeiro fica com ele.

- `donoAutomaticoDoLead(nivel)` — só quem tem `comercial_membros.recebe_apenas_mql`
  igual ao nível ganha dono na entrada. Hoje é só o Léo, com `S`.
- `notifyCommercialLeadPool()` — avisa todos os SDRs ativos, ignorando
  preferências: "Lead novo no CRM. Quem pegar primeiro fica com a oportunidade."
- `POST /api/comercial/leads/start` — o update tem `.is('sdr_id', null)` como
  trava de corrida; o segundo a clicar recebe 409. SDR não rouba lead com dono.
- **Estado real em 25/08:** 11 leads criados pelo webhook, **0 assumidos pelo
  Start**, 13 atribuídos na mão pelo Léo no seletor. A fila funciona (um lead
  ficou 24 minutos sem dono), mas a coordenação distribui antes dos SDRs
  reagirem. Falta decidir se o closer continua podendo atribuir.
- **Pendente no banco:** `supabase/2026-08-24_fila_comum_de_leads.sql`, que faz o
  SDR **enxergar** lead sem dono. Sem ele a fila é invisível. Conferir com
  `select policyname, qual from pg_policies where tablename = 'comercial_leads';`

### Comercial: rodízio, sala e relatórios

- Rodízio por volume, não por ordem de chegada
  (`src/app/api/webhooks/n8n/leads/route.ts`): a escolha é o membro com menos
  leads no período, o que corrigiu a diferença de 8 x 6 na Conexão Corretora.
- Painel da sala (`/comercial/sala`): responsivo por largura **e** altura,
  ranking só de SDR, tudo medido **somente hoje**, ligações atendidas separadas
  das feitas, meta de 100/dia (`comercial_metas.meta_calls`).
- Relatório do SDR (`/comercial/relatorios`): filtro por SDR e por data,
  ligações da central + cadência, ranking, meta, exportação CSV e as gravações
  das atendidas. A coluna "Central" é a ligação originada pelo Click2Call.
- **Regra de venda:** venda é o que está na etapa `Negócio fechado`. Valor solto
  em lead estornado não conta mais (caso Vinicius Heliodoro).

### Tráfego: relatório no formato de campanha

O relatório geral e o histórico salvo agora saem no bloco que o gestor manda no
grupo do cliente:

```
Logo abaixo estou deixando os dados das nossas campanhas (17/08 até 23/08): ⤵️

📈 CAMPANHAS PLANO DE SAÚDE:
💸 Investimento: R$ 97,13
✅ Nº Leads: 6
✅ Custo médio por Lead: R$ 16,18
```

A prévia na tela mostra exatamente o texto que vai ser copiado.

### Notificações

- `src/lib/apoloNotifications.ts` quebrava para quem não tinha linha em
  `notificacao_preferencias` — só o Cadu tinha. Faltava um `?.`. Todo o time
  comercial ficou sem aviso até isso ser corrigido.
- Patrick não recebe mais notificação de lead Kripto; o admin responsável é o
  Pedro.

### Acesso e RLS

- Corretor com mais de um registro em `corretores` (caso Fortis, 2 registros) não
  enxergava os próprios leads: 56 de 64 pertenciam à Milena. Criada
  `current_profile_corretor_ids()` e reescritas 4 políticas.
- Criar tarefa em lead quebrava para o corretor porque o insert pedia
  `.select('id')` de volta e a política de leitura barrava. O insert virou cego e
  `POST /api/tarefas/notificar` encontra a tarefa pelo par lead + responsável
  numa janela de 5 minutos.
- Observação digitada num lead vazava para os outros cards: faltava chave no
  componente e reset do estado ao trocar de lead.

---

## 5. VoIP — estado e o que falta

### O que a API faz

Manual da VoIP do Brasil, produto **Click2Call**. Um endpoint só:

```
POST https://voipdobrasil.net.br/api/click2Call/{API_TOKEN}/{API_KEY}
{ "device_id": 1, "src": "021980986000", "dst": "02130900017" }
```

A central liga primeiro para `src` (o operador) e, quando ele atende, liga para
`dst` (o lead) e junta os dois em conferência. Resposta de sucesso:
`{"error":0,"reason":"OK","message":"Sua chamada está sendo processada."}`.

**A resposta não traz identificador da chamada, não confirma atendimento, não tem
duração e não tem gravação.** O próprio manual diz que o retorno não garante que
os participantes atenderam.

Descoberta útil: a central valida na ordem **src → dst → device_id**. Um
`device_id` errado responde `DEVICE_NOT_FOUND` **antes de discar**, então dá para
varrer ids sem tocar telefone de ninguém.

### O que já está implementado

- `src/lib/voip.ts` — `voipConfigurado()`, `formatarNumeroVoip()` (converte
  `(11)93152-9897` para `011931529897`, formato do manual) e
  `originarClick2Call()`. Token e key entram na URL, então a chamada nunca sai do
  navegador e a URL nunca vai para log.
- `POST /api/comercial/calls` origina a chamada quando a central está
  configurada, e grava em `comercial_ligacoes` a origem (`manual` ou
  `click2call`) e os números usados.
- O botão de ligar do Kanban e da planilha comercial não abre mais o discador do
  celular quando a central assume a chamada.
- `scripts/testar-voip.mjs` — `npm.cmd run testar-voip -- <src> <dst> scan`
  procura o `device_id` sem discar.
- Migration aplicada: colunas `origem`, `numero_origem`, `numero_destino` em
  `comercial_ligacoes` e `voip_ramal` em `profiles`.

### O que falta

1. ~~`VOIP_CLICK2CALL_DEVICE_ID`~~ **resolvido.** As duas linhas foram
   descobertas pela varredura e ficaram amarradas ao operador em
   `profiles.voip_device_id`: **Talita = 12291**, **Carlos Eduardo (Cadu) =
   12292**. O `.env` guarda `12291` só como padrão de quem não tem linha
   própria; `POST /api/comercial/calls` manda o `device_id` do operador.
   Migration: `supabase/2026-08-24_voip_linha_por_operador.sql`. Até agora só 7
   ligações registradas em `comercial_ligacoes` — a central ainda é pouco usada.
2. **CDR não existe.** Sem ele não há duração, "atendeu ou não" nem gravação.
   Perguntar à VoIP do Brasil: existe API ou webhook de fim de chamada? A API
   pode devolver um identificador único? Sem id, casar o registro do CRM com o da
   central só dá por origem + destino + janela de horário — por isso os números
   são gravados.
3. **Gravação está INATIVA nas duas linhas** (visto no painel). Precisa ser
   habilitada na conta, e é preciso saber como o áudio é recuperado e por quanto
   tempo fica disponível. O campo `comercial_ligacoes.gravacao_url` já existe.
4. **Decidir `src` por operador.** Hoje a central chama o celular do perfil. Se
   algum SDR usar ramal, preencher `profiles.voip_ramal` — e o ramal precisa ser
   diferente do `device_id`, regra crítica do manual.

---

## 6. Estado das IAs por corretora (25/08)

São 9 configurações em `corretora_ai_configs`, 5 com `status = ativo`:

| Persona | Status | Envio | Identidade | Atende sozinho |
|---|---|---|---|---|
| Aline | ativo | profile | equipe | não |
| Aline | ativo | dedicated | equipe | não |
| Aline | ativo | profile | equipe | não |
| **Roniele** | ativo | profile | **própria** | **sim** |
| **Rafaela (Soma)** | ativo | profile | **própria** | **sim** |
| Aline | aguardando conexão | profile | equipe | não |
| Aline | desconectado (3) | profile/dedicated | equipe | não |

**A Soma entrou no ar**: a Rafaela atende como ela mesma, pelo WhatsApp dela, em
modo `propria` e `atende_sozinho`. As mudanças de texto pedidas para a Roniele
(CNPJ, ligação de 5 minutos) valem **somente** para ela.

Lembrete que já custou tempo: o prompt vem de `corretora_ai_configs.system_prompt`.
Editar o `.ts` não muda produção.

## 7. Pendências abertas (25/08)

**SQL que ainda não foi aplicado no Supabase** (aplicação é manual, no SQL Editor)
1. `supabase/2026-08-24_fila_comum_de_leads.sql` — sem ele o SDR não enxerga lead
   sem dono e a fila do Start é invisível. **É o mais urgente.**
2. `supabase/2026-08-24_rodizio_por_nivel_mql.sql`
3. `supabase/2026-08-24_voip_linha_por_operador.sql` — a coluna
   `voip_device_id` já responde em produção, mas confirmar se este arquivo foi o
   aplicado.

**Segurança**
4. `SUPABASE_SERVICE_ROLE_KEY` está embutida na imagem Docker (`Dockerfile`,
   `ARG` + `ENV`). É o maior risco aberto.
5. Bucket `inbox-media` é público: quem tem o link abre sem login.

**Produto**
6. Decidir se o closer continua podendo atribuir lead no seletor. Hoje ele
   distribui antes de os SDRs apertarem Start, e o Start nunca é usado.
7. Furo no contador de gasto de criativo: `jobs/route.ts` reserva e
   `automation.ts` dá baixa, mas `library/route.ts` não passa pelo controle. Por
   isso `gasto_usd` fica zerado e os alertas nunca disparam.
8. Qualidade de imagem configurável (`low` como padrão). Faz US$ 20 renderem 129
   criativos em vez de 36.
9. Comercial: os dois interruptores de primeiro contato estão `false`. Decidir
   entre bot e IA e religar.
10. Checklist só pode ser criado junto com a tarefa. Falta permitir acrescentar
    item depois, no detalhe.
11. Os checklists das predefinições "Edição de vídeo" e "Ajuste CRM" foram
    chutados; o dono ainda não confirmou os itens reais.
12. Cliente novo quer migrar 19.700 leads com histórico de mensagens. O banco
    hoje tem 18.774 leads e 29.409 mensagens numa instância de ~1 GB — a
    migração praticamente dobra a base e precisa de plano antes de começar.

**Perguntar à VoIP do Brasil**
13. Existe API ou webhook de fim de chamada (CDR)? Sem isso não há duração nem
    "atendeu ou não" confiável vindo da central.
14. A gravação está **inativa** nas duas linhas. Precisa ser habilitada, e é
    preciso saber como o áudio é recuperado e por quanto tempo fica disponível.
    O campo `comercial_ligacoes.gravacao_url` e a tela de relatório já esperam
    por ele.

**Operação**
15. Código morto do ElevenLabs em `leadAiAgent.ts`.
16. Dois workflows disparam no mesmo push e rodam o mesmo deploy em paralelo.
17. O monitor alerta "Docker: 2/1" durante o deploy, que é o comportamento normal
    de `order: start-first`.
18. Monitor diário comparando contagem de mensagens da UAZAPI com a do CRM —
    oferecido, nunca construído. Serviria para pegar cedo o tipo de falha que
    levou dias para ser notada no inbox.

## 8. Convenções deste repositório

- Comentários em português, sem acento em código novo; explicam **por que**, não
  o que a linha faz.
- Nomes de variáveis novas em português quando o contexto é de negócio
  (`prefereMensagem`, `duracaoLegivel`), seguindo o que já existe no arquivo.
- Antes de commitar: `npx tsc --noEmit`, `npm.cmd run build` e `npx eslint` nos
  arquivos tocados. O build já quebrou na VPS por arquivo novo não commitado.
- SQL fica em `supabase/*.sql` (aplicado à mão no SQL Editor) e em
  `supabase/migrations/*.sql`. Nada é aplicado automaticamente.
- Toda migration termina com `notify pgrst, 'reload schema';`.

---

## 9. Como investigar problema de mensagem (roteiro que funcionou)

1. **A mensagem existe no banco?** `whatsapp_mensagens` filtrando por
   `metadata->>sender_profile_id`. Sem `send_status` = veio do celular pelo
   webhook; `send_status: sent` = saiu pelo CRM.
2. **A instância é a do corretor?** `GET {UAZAPI}/instance/all` com `admintoken`.
   Confira `owner` — número brasileiro antigo vem sem o nono dígito.
3. **O WhatsApp entregou?** `POST {UAZAPI}/message/find` com `{id}` (aceita o id
   com ou sem prefixo). O campo `status` traz `Pending`, `Delivered`, `Read`.
4. **O webhook está configurado?** `GET {UAZAPI}/webhook` com o token da
   instância. Tem que listar a URL de produção e os eventos.
5. **O build no ar é o esperado?** Sondar um endpoint que mudou. Exemplo usado:
   `POST /api/inbox/uazapi/webhook` com `{"EventType":"messages_update",...}` —
   o build novo responde `{"recibo":true,...}`, o antigo responde
   `{"ignored":true}`.

O caminho da VPS é `/root/oriontrack` (`cd ~/oriontrack`), **não** `/opt`.
