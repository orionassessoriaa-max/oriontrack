import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID || process.env.GOOGLE_DRIVE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET || process.env.GOOGLE_DRIVE_CLIENT_SECRET;
const port = Number(process.env.GOOGLE_CALENDAR_AUTH_PORT || 53682);
const redirectHost = process.env.GOOGLE_CALENDAR_AUTH_HOST || 'localhost';
const redirectUri = `http://${redirectHost}:${port}/oauth2callback`;
const tokenOutputFile = process.env.GOOGLE_CALENDAR_TOKEN_OUTPUT_FILE || '';
const loginHint = process.argv[2] || '';

if (!clientId || !clientSecret) {
  console.error('Defina as credenciais OAuth do Google Calendar ou do Google Drive antes de executar.');
  process.exit(1);
}

const state = randomUUID();
const authorizationUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
authorizationUrl.search = new URLSearchParams({
  client_id: clientId,
  redirect_uri: redirectUri,
  response_type: 'code',
  scope: [
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/meetings.space.readonly',
    'https://www.googleapis.com/auth/meetings.space.settings',
  ].join(' '),
  access_type: 'offline',
  prompt: 'consent',
  include_granted_scopes: 'true',
  state,
  ...(loginHint ? { login_hint: loginHint } : {}),
}).toString();

const server = http.createServer(async (request, response) => {
  const callback = new URL(request.url || '/', redirectUri);
  if (callback.pathname !== '/oauth2callback') {
    response.writeHead(404).end('Não encontrado.');
    return;
  }
  if (callback.searchParams.get('state') !== state) {
    response.writeHead(400).end('Estado de autorização inválido.');
    server.close();
    return;
  }
  const code = callback.searchParams.get('code');
  if (!code) {
    response.writeHead(400).end(`Google não autorizou: ${callback.searchParams.get('error') || 'código ausente'}.`);
    server.close();
    return;
  }

  try {
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        code,
      }),
    });
    const token = await tokenResponse.json();
    if (!tokenResponse.ok || !token.refresh_token) {
      throw new Error(token.error_description || token.error || 'Refresh token não retornado.');
    }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end('<h1>Agenda conectada</h1><p>Volte ao terminal para concluir a configuração.</p>');
    if (tokenOutputFile) {
      writeFileSync(tokenOutputFile, `${token.refresh_token}\n`, { encoding: 'utf8', mode: 0o600 });
      console.log('\nAutorização concluída. Token salvo no arquivo local temporário.');
    } else {
      console.log('\nAutorização concluída. Guarde este valor somente no .env.local e no .env.production da VPS:\n');
      console.log(`GOOGLE_CALENDAR_REFRESH_TOKEN=${token.refresh_token}`);
    }
  } catch (error) {
    response.writeHead(500).end('Não foi possível concluir a autorização. Veja o terminal.');
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    server.close();
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log('Abra esta URL no navegador e entre com a conta da agenda comercial:\n');
  console.log(authorizationUrl.toString());
  console.log(`\nAguardando autorização em ${redirectUri} ...`);
});
