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
