# Webhook do funil comercial

Use este endpoint para trocar o envio direto ao ClickUp pelo Orion Track:

```text
POST https://track.orionassessoria.com.br/api/webhooks/comercial/leads
```

Headers recomendados:

```text
Content-Type: application/json
x-orion-secret: mesmo valor de ORION_COMERCIAL_WEBHOOK_SECRET
```

Payload minimo:

```json
{
  "nome": "Maria Silva",
  "telefone": "61999999999",
  "email": "maria@email.com",
  "empresa": "Empresa da Maria",
  "origem": "Funil comercial",
  "campanha": "Formulario site",
  "observacao": "Quer falar sobre comercial da Orion"
}
```

O lead entra no CRM comercial em `Oportunidade`. O sistema tenta atribuir automaticamente para o primeiro SDR ativo e o primeiro closer ativo.

## Variaveis de ambiente

```env
ORION_COMERCIAL_WEBHOOK_SECRET=coloque-um-segredo-forte
COMMERCIAL_LEADS_SHEET_WEBHOOK_URL=https://script.google.com/macros/s/SEU_SCRIPT_ID/exec
COMMERCIAL_LEADS_SHEET_SECRET=outro-segredo-opcional
```

`COMMERCIAL_LEADS_SHEET_WEBHOOK_URL` e opcional. Se nao configurar, o lead continua caindo no CRM normalmente.

## Notificacoes de leads no grupo do WhatsApp

Defina `COMMERCIAL_LEADS_WHATSAPP_GROUP_ID` no ambiente do servidor com o JID
completo do grupo confirmado (terminado em `@g.us`). O WhatsApp da instancia
`apolo_master_sender` precisa participar do grupo e ter permissao de envio.
O nome do grupo ou o link de convite nao substituem o JID nessa variavel.

Destino confirmado: **LEADS ORION**, JID `120363410914570116@g.us`.
O stack Docker usa esse destino por padrao quando a variavel nao esta definida.
Para voltar ao privado, defina explicitamente a variavel vazia em `.env.production`
e reaplique o stack. O codigo sem configuracao de grupo tambem usa o privado.

Com a variavel preenchida, os avisos da fila e de atribuicao passam para o grupo
em vez do privado dos SDRs. Os avisos da fila incluem o botao **ASSUMIR LEAD**.
A fila continua anonima ate o START; o aviso de
atribuicao mantem os dados completos e identifica o SDR responsavel. As
notificacoes dos coordenadores continuam iguais. A regra da disputa esta descrita abaixo.
Sem a variavel, permanece o envio individual. Erros no envio ao grupo sao
reportados ao chamador, sem reenviar automaticamente ao privado.

Depois de configurar o ambiente, publique a versao com esse suporte. Valide o
destinatario pela listagem de grupos antes de enviar uma mensagem de teste.

### START pelo grupo, inclusive MQL S

Todos os novos leads, inclusive S, entram sem dono na fila (salvo atribuicao
manual explicita por quem tem permissao). A reserva automatica do S para o Leo
foi removida. Leads que ja tinham responsavel nao sao redistribuidos.

O clique usa `/api/webhooks/comercial/whatsapp?secret=...`, autenticado com um
HMAC derivado de `UAZAPI_GLOBAL_TOKEN` (funcao `commercialClaimWebhookSecret`).
Cadastre esse webhook adicional na instancia `apolo_master_sender`, evento
`messages`, filtros `wasSentByApi`, `fromMeYes`, `isGroupNo`, sem sufixos na URL.
Preserve os outros webhooks da instancia. Nunca registre a URL com segredo em logs.

O servidor confere a mensagem original na UAZAPI, o grupo, a assinatura do botao,
o participante (inclusive LID) e o telefone efetivo de um SDR ativo. Grupo e CRM
usam a mesma escrita condicional `sdr_id IS NULL`; so o vencedor recebe a
atribuicao, a timeline e o aviso com dados. Reentregas do clique nao duplicam avisos.
O teste `orion_claim_test_v1` apenas valida o recebimento, sem atribuir lead.

Testes locais: `node scripts/test-commercial-notification-group.cjs` e
`node scripts/test-commercial-claim.cjs`.

## Apps Script para a planilha

Crie um Apps Script na planilha e publique como Web App.

```javascript
const SHEET_NAME = 'Leads';
const SECRET = 'mesmo valor de COMMERCIAL_LEADS_SHEET_SECRET';

function doPost(e) {
  const payload = JSON.parse(e.postData.contents || '{}');
  if (SECRET && payload.secret !== SECRET) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'unauthorized' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  const lead = payload.lead || {};
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME)
    || SpreadsheetApp.getActiveSpreadsheet().insertSheet(SHEET_NAME);

  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      'Recebido em',
      'Nome',
      'Telefone',
      'Email',
      'Empresa',
      'Origem',
      'Campanha',
      'Status',
      'SDR',
      'Closer',
      'Observacoes',
      'ID CRM'
    ]);
  }

  sheet.appendRow([
    payload.received_at || new Date().toISOString(),
    lead.nome || '',
    lead.telefone || '',
    lead.email || '',
    lead.empresa || '',
    lead.origem || '',
    lead.campanha || '',
    lead.status || '',
    lead.sdr_id || '',
    lead.closer_id || '',
    lead.observacoes || '',
    lead.id || ''
  ]);

  return ContentService.createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}
```
