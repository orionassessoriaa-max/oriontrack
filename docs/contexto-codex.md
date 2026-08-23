# Orion Track — contexto completo para continuar o trabalho

Escrito em 23/08/2026. Cole este arquivo inteiro no começo da conversa.
Ele descreve o sistema, o que foi feito nos últimos dias, o que está pendente e
as armadilhas que já custaram tempo.

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

1. **`VOIP_CLICK2CALL_DEVICE_ID`** não foi descoberto. Token, key e domínio já
   estão no `.env.local` local; falta esse valor no `.env.local` e no
   `.env.production` da VPS. O id da linha fica no PABX Virtual em
   "gerenciar linhas"; a conta tem duas linhas, `9171025` e `9171026`.
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

## 6. Estado das IAs por corretora (23/08)

| Corretora | Status | Persona | Envio | Identidade |
|---|---|---|---|---|
| OCTAVITA | ativo | Aline | profile | equipe |
| FACILITA | ativo | Aline | dedicated | equipe |
| RONIELE | ativo | Roniele | profile | própria |
| B2L | ativo | Aline | profile | equipe |
| SOMA | desconectado | **Rafaela** | profile | **própria** |
| HP | aguardando conexão | Aline | profile | equipe |
| EVO SEG, ORION, ITAEL | desconectado | Aline | — | equipe |

**Soma**: a Rafaela vai atender como ela mesma, pelo WhatsApp dela. Falta apenas
conectar o WhatsApp dela ao inbox — não existe instância UAZAPI para o número
dela. A instância dedicada antiga (`orion_ai_af16f182…`) foi abandonada.

Volume: 18.586 leads no CRM, 260 no comercial. A Soma é a terceira em captação do
mês e ainda é atendida no braço.

---

## 7. Pendências abertas

**Segurança**
1. `SUPABASE_SERVICE_ROLE_KEY` está embutida na imagem Docker (`Dockerfile`,
   `ARG` + `ENV`). É o maior risco aberto.
2. Bucket `inbox-media` é público: quem tem o link abre sem login.

**Produto**
3. Thalysson não enxerga a conversa da vendedora Natália: `profiles.nome_empresa`
   é "EVOSEG CORRETORA" e `corretores.nome_empresa` é "EVO SEG". Além do dado, a
   sidebar **substitui** `idsToFetch` pelo resultado (vazio) das corretoras
   irmãs, em vez de somar.
4. Furo no contador de gasto de criativo: `jobs/route.ts` reserva e
   `automation.ts` dá baixa, mas `library/route.ts` não passa pelo controle. Por
   isso `gasto_usd` fica zerado e os alertas nunca disparam.
5. Qualidade de imagem configurável (`low` como padrão). Faz US$ 20 renderem 129
   criativos em vez de 36.
6. Comercial: os dois interruptores de primeiro contato estão `false`. Decidir
   entre bot e IA e religar.
7. Patrick Alan e Lucas Rodrigues receberam telefone agora, mas com **8 dígitos**
   (sem o nono). Se não receberem notificação, trocar para `98162-5459` e
   `98635-1486`.
8. Checklist só pode ser criado junto com a tarefa. Falta permitir acrescentar
   item depois, no detalhe.
9. Os checklists das predefinições "Edição de vídeo" e "Ajuste CRM" foram
   chutados; o dono ainda não confirmou os itens reais.

**Operação**
10. Código morto do ElevenLabs em `leadAiAgent.ts`.
11. Dois workflows disparam no mesmo push e rodam o mesmo deploy em paralelo.
12. O monitor alerta "Docker: 2/1" durante o deploy, que é o comportamento normal
    de `order: start-first`. A regra deveria alertar só quando réplicas < desejado.

---

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
