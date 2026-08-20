import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { APOLO_MASTER_INSTANCE } from '@/lib/apoloNotifications';
import { normalizePhone, uazapiFetch } from '@/lib/uazapi';

/**
 * Aviso de vencimento do token da Meta.
 *
 * O token que roda a integracao hoje e de usuario, entao expira. Quando ele
 * morre, para tudo de uma vez: criacao de campanha, alertas, gasto e leads.
 * Este cron avisa no WhatsApp antes de acontecer.
 */
const DEFAULT_ALERT_PHONE = '5561984409328';
const DEFAULT_THRESHOLD_DAYS = 2;
const BUSINESS_HOUR_START = 9;
const BUSINESS_HOUR_END = 18;
const TIMEZONE = 'America/Sao_Paulo';
const DEDUPE_TABLE = 'orion_avisos_enviados';
const MISSING_TABLE = /orion_avisos_enviados|schema cache|does not exist/i;

function graphUrl(path: string) {
  const version = process.env.META_GRAPH_VERSION || 'v23.0';
  return `https://graph.facebook.com/${version}/${path.replace(/^\//, '')}`;
}

/** Horario de Brasilia, independente do fuso do servidor. */
function brasiliaParts(date: Date) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    hour: 'numeric',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    hour: Number(parts.hour),
    weekday: String(parts.weekday),
    day: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

function isBusinessHours(date: Date) {
  const { hour, weekday } = brasiliaParts(date);
  if (['Sat', 'Sun'].includes(weekday)) return false;
  return hour >= BUSINESS_HOUR_START && hour < BUSINESS_HOUR_END;
}

function formatBrasilia(date: Date) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/** Uma mensagem por dia. Se a tabela ainda nao existir, avisar duas vezes e melhor do que nao avisar. */
async function alreadyWarnedToday(key: string) {
  const { data, error } = await supabaseAdmin
    .from(DEDUPE_TABLE)
    .select('chave')
    .eq('chave', key)
    .maybeSingle();
  if (error) {
    if (!MISSING_TABLE.test(error.message)) console.error('[meta_token_alert] leitura do dedupe falhou:', error.message);
    return false;
  }
  return Boolean(data?.chave);
}

async function markWarned(key: string, metadata: Record<string, unknown>) {
  const { error } = await supabaseAdmin
    .from(DEDUPE_TABLE)
    .upsert([{ chave: key, enviado_em: new Date().toISOString(), metadata }], { onConflict: 'chave' });
  if (error && !MISSING_TABLE.test(error.message)) {
    console.error('[meta_token_alert] gravacao do dedupe falhou:', error.message);
  }
}

async function run(request: Request) {
  const authHeader = request.headers.get('Authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Nao autorizado.' }, { status: 401 });
  }

  const url = new URL(request.url);
  const force = url.searchParams.get('forcar') === '1';
  const threshold = Number(url.searchParams.get('dias') || DEFAULT_THRESHOLD_DAYS) || DEFAULT_THRESHOLD_DAYS;

  const token = process.env.META_ACCESS_TOKEN;
  if (!token) return NextResponse.json({ error: 'META_ACCESS_TOKEN nao configurado.' }, { status: 500 });

  const response = await fetch(`${graphUrl('debug_token')}?input_token=${token}&access_token=${token}`, { cache: 'no-store' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.error) {
    return NextResponse.json({ error: payload?.error?.message || 'Nao consegui consultar o token na Meta.' }, { status: 502 });
  }

  const expiresAt = Number(payload?.data?.expires_at || 0);
  const tokenType = String(payload?.data?.type || 'DESCONHECIDO');
  // System User com expiracao "nunca" volta 0. Nesse caso nao existe o que avisar.
  if (!expiresAt) {
    return NextResponse.json({ ok: true, alerted: false, reason: 'token_sem_expiracao', token_type: tokenType });
  }

  const expiresDate = new Date(expiresAt * 1000);
  const msLeft = expiresDate.getTime() - Date.now();
  const daysLeft = msLeft / 86_400_000;
  if (daysLeft > threshold) {
    return NextResponse.json({
      ok: true,
      alerted: false,
      reason: 'ainda_dentro_do_prazo',
      dias_restantes: Number(daysLeft.toFixed(2)),
      expira_em: expiresDate.toISOString(),
    });
  }

  const now = new Date();
  if (!force && !isBusinessHours(now)) {
    return NextResponse.json({ ok: true, alerted: false, reason: 'fora_do_horario_comercial', dias_restantes: Number(daysLeft.toFixed(2)) });
  }

  const phone = normalizePhone(process.env.META_TOKEN_ALERT_PHONE || DEFAULT_ALERT_PHONE);
  const dedupeKey = `meta_token_expira:${brasiliaParts(now).day}`;
  if (!force && await alreadyWarnedToday(dedupeKey)) {
    return NextResponse.json({ ok: true, alerted: false, reason: 'ja_avisado_hoje' });
  }

  const expired = msLeft <= 0;
  const restante = expired
    ? 'Ele *ja venceu*.'
    : daysLeft < 1
      ? `Faltam cerca de ${Math.max(1, Math.round(daysLeft * 24))} horas.`
      : `Faltam ${Math.floor(daysLeft)} dia(s).`;

  const text = [
    expired ? '*Token da Meta vencido*' : '*Token da Meta vencendo*',
    '',
    `O token que roda a integracao com a Meta expira em ${formatBrasilia(expiresDate)}. ${restante}`,
    '',
    'Quando vencer, para de funcionar: criacao de campanha e anuncio pelo CRM, alertas de trafego, leitura de gasto e recebimento de leads da Meta.',
    '',
    `Tipo do token atual: ${tokenType}.`,
    'Para resolver de vez, gere um token de Usuario do Sistema no Business Manager: ele nao expira.',
    '',
    '_Orion Track_',
  ].join('\n');

  try {
    await uazapiFetch('/send/text', {
      method: 'POST',
      body: JSON.stringify({ number: phone, text }),
    }, { instanceName: APOLO_MASTER_INSTANCE });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao enviar o aviso pelo WhatsApp.';
    console.error('[meta_token_alert] envio falhou:', message);
    return NextResponse.json({ ok: false, alerted: false, error: message }, { status: 502 });
  }

  await markWarned(dedupeKey, { expira_em: expiresDate.toISOString(), dias_restantes: Number(daysLeft.toFixed(2)), telefone: phone });

  return NextResponse.json({
    ok: true,
    alerted: true,
    telefone: phone,
    token_type: tokenType,
    dias_restantes: Number(daysLeft.toFixed(2)),
    expira_em: expiresDate.toISOString(),
  });
}

export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return run(request);
}
