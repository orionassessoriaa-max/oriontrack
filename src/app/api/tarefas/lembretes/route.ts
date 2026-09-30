import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/api/security';
import { sendApoloWhatsApp } from '@/lib/apoloNotifications';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const TIME_ZONE = 'America/Sao_Paulo';
const BROKER_ROLES = ['corretor', 'corretor_admin', 'corretor_membro'] as const;
const ALLOWED_ROLES = [
  'admin',
  'gestor_trafego',
  'account_manager',
  'corretor',
  'corretor_admin',
  'corretor_membro',
] as const;

type ReminderTask = {
  id: string;
  lead_id: string | null;
  corretor_id: string | null;
  responsavel_profile_id: string | null;
  titulo: string;
  descricao: string | null;
  vencimento: string;
  prioridade: string;
};

type RecipientProfile = {
  id: string;
  nome: string | null;
  email: string | null;
  tipo_usuario: string | null;
  telefone: string | null;
  status: string | null;
};

type LeadNameRow = { id: string; nome: string | null };

function saoPauloParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value || 0);
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
  };
}

function localDateKey(date = new Date()) {
  const { year, month, day } = saoPauloParts(date);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Converte meia-noite de Brasilia para UTC sem assumir um offset fixo. */
function zonedMidnightUtc(year: number, month: number, day: number) {
  const guess = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  const rendered = saoPauloParts(guess);
  const renderedAsUtc = Date.UTC(
    rendered.year,
    rendered.month - 1,
    rendered.day,
    rendered.hour,
    rendered.minute,
  );
  return new Date(guess.getTime() - (renderedAsUtc - guess.getTime()));
}

function todayBounds(now = new Date()) {
  const { year, month, day } = saoPauloParts(now);
  return {
    start: zonedMidnightUtc(year, month, day),
    end: zonedMidnightUtc(year, month, day + 1),
  };
}

function formatDue(value: string) {
  return new Date(value).toLocaleString('pt-BR', {
    timeZone: TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function stableUuid(value: string) {
  const hex = createHash('sha256').update(value).digest('hex').slice(0, 32).split('');
  hex[12] = '5';
  hex[16] = '8';
  const joined = hex.join('');
  return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20)}`;
}

async function claimReminder(task: ReminderTask, kind: 'day' | '30m') {
  const id = stableUuid(`lead-task-reminder:${kind}:${task.id}:${task.vencimento}`);
  const { error } = await supabaseAdmin.from('audit_logs').insert({
    id,
    actor_profile_id: task.responsavel_profile_id,
    action: `lead_task.reminder.${kind}`,
    entity_type: 'lead_tarefa',
    entity_id: task.id,
    metadata: { vencimento: task.vencimento, corretor_id: task.corretor_id },
  });
  if (!error) return { claimed: true, id };
  if (error.code === '23505') return { claimed: false, id };
  throw new Error(error.message);
}

async function releaseReminder(id: string) {
  await supabaseAdmin.from('audit_logs').delete().eq('id', id);
}

async function brokerScope(corretorId: string) {
  const { data: broker } = await supabaseAdmin
    .from('corretores')
    .select('id, nome_empresa')
    .eq('id', corretorId)
    .maybeSingle();
  if (!broker) return [] as string[];
  if (!broker.nome_empresa) return [broker.id];

  const { data: siblings } = await supabaseAdmin
    .from('corretores')
    .select('id')
    .eq('nome_empresa', broker.nome_empresa);
  return siblings?.length ? siblings.map((item) => item.id) : [broker.id];
}

export async function GET(request: Request) {
  const guard = await requireApiUser(request, [...ALLOWED_ROLES]);
  if ('error' in guard) return guard.error;

  const url = new URL(request.url);
  const requestedBrokerId = String(url.searchParams.get('corretor_id') || guard.profile.corretor_id || '').trim();
  if (!requestedBrokerId) {
    return NextResponse.json({ todayTasks: [], imminentTasks: [] }, { headers: { 'Cache-Control': 'private, no-store' } });
  }

  const isBroker = BROKER_ROLES.includes(guard.profile.tipo_usuario as typeof BROKER_ROLES[number]);
  if (isBroker && guard.profile.corretor_id !== requestedBrokerId) {
    return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  }

  const viewedProfileId = request.headers.get('x-orion-view-profile-id');
  let viewedRole = isBroker ? guard.profile.tipo_usuario : null;
  let responsibleProfileId = isBroker && guard.profile.tipo_usuario === 'corretor_membro'
    ? guard.profile.id
    : null;

  if (!isBroker) {
    if (!viewedProfileId) return NextResponse.json({ error: 'Perfil visualizado nao informado.' }, { status: 403 });
    const { data: viewed } = await supabaseAdmin
      .from('profiles')
      .select('id, tipo_usuario, corretor_id')
      .eq('id', viewedProfileId)
      .maybeSingle();
    if (!viewed || viewed.corretor_id !== requestedBrokerId || !BROKER_ROLES.includes(viewed.tipo_usuario as typeof BROKER_ROLES[number])) {
      return NextResponse.json({ error: 'Perfil visualizado nao autorizado.' }, { status: 403 });
    }
    viewedRole = viewed.tipo_usuario;
    if (viewed.tipo_usuario === 'corretor_membro') responsibleProfileId = viewed.id;
  }

  const brokerIds = await brokerScope(requestedBrokerId);
  if (!brokerIds.length) return NextResponse.json({ error: 'Concessionaria nao encontrada.' }, { status: 404 });

  const now = new Date();
  const { start, end } = todayBounds(now);
  let query = supabaseAdmin
    .from('lead_tarefas')
    .select('id, lead_id, corretor_id, responsavel_profile_id, titulo, descricao, vencimento, prioridade')
    .in('corretor_id', brokerIds)
    .eq('status', 'pendente')
    .gte('vencimento', start.toISOString())
    .lt('vencimento', end.toISOString())
    .order('vencimento', { ascending: true });
  if (responsibleProfileId) query = query.eq('responsavel_profile_id', responsibleProfileId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const tasks = (data || []) as ReminderTask[];
  const leadIds = Array.from(new Set(tasks.map((task) => task.lead_id).filter(Boolean))) as string[];
  const { data: leads } = leadIds.length
    ? await supabaseAdmin.from('leads').select('id, nome').in('id', leadIds)
    : { data: [] as Array<{ id: string; nome: string | null }> };
  const leadNames = new Map((leads || []).map((lead) => [lead.id, lead.nome]));
  const shaped = tasks.map((task) => ({
    ...task,
    lead_nome: task.lead_id ? leadNames.get(task.lead_id) || null : null,
    minutes_until_due: Math.ceil((new Date(task.vencimento).getTime() - now.getTime()) / 60_000),
  }));

  return NextResponse.json({
    todayTasks: shaped,
    imminentTasks: shaped.filter((task) => task.minutes_until_due >= 0 && task.minutes_until_due <= 30),
    viewedRole,
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function POST(request: Request) {
  const expected = process.env.CRON_SECRET || process.env.UAZAPI_GLOBAL_TOKEN;
  if (expected && request.headers.get('authorization') !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Nao autorizado.' }, { status: 401 });
  }

  const now = new Date();
  const nowMs = now.getTime();
  const { start, end } = todayBounds(now);
  const thirtyMinutesFromNow = new Date(nowMs + 30 * 60_000);
  const queryEnd = new Date(Math.max(end.getTime(), thirtyMinutesFromNow.getTime()));
  const { data, error } = await supabaseAdmin
    .from('lead_tarefas')
    .select('id, lead_id, corretor_id, responsavel_profile_id, titulo, descricao, vencimento, prioridade')
    .eq('status', 'pendente')
    .not('responsavel_profile_id', 'is', null)
    .not('vencimento', 'is', null)
    .gte('vencimento', start.toISOString())
    .lt('vencimento', queryEnd.toISOString())
    .order('vencimento', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const tasks = (data || []) as ReminderTask[];
  const profileIds = Array.from(new Set(tasks.map((task) => task.responsavel_profile_id).filter(Boolean))) as string[];
  const leadIds = Array.from(new Set(tasks.map((task) => task.lead_id).filter(Boolean))) as string[];
  const [profilesResult, leadsResult] = await Promise.all([
    profileIds.length
      ? supabaseAdmin.from('profiles').select('id, nome, email, tipo_usuario, telefone, status').in('id', profileIds)
      : Promise.resolve({ data: [] }),
    leadIds.length
      ? supabaseAdmin.from('leads').select('id, nome').in('id', leadIds)
      : Promise.resolve({ data: [] }),
  ]);
  const profileRows = (profilesResult.data || []) as RecipientProfile[];
  const leadRows = (leadsResult.data || []) as LeadNameRow[];
  const profiles = new Map(profileRows.map((profile) => [profile.id, profile]));
  const leadNames = new Map(leadRows.map((lead) => [lead.id, lead.nome]));
  const localNow = saoPauloParts(now);
  const todayKey = localDateKey(now);
  const results: Array<Record<string, unknown>> = [];

  for (const task of tasks) {
    const profile = task.responsavel_profile_id ? profiles.get(task.responsavel_profile_id) : null;
    if (!profile || !['active', 'ativo'].includes(String(profile.status || '').toLowerCase())) continue;

    const dueMs = new Date(task.vencimento).getTime();
    const minutesUntilDue = Math.ceil((dueMs - nowMs) / 60_000);
    const isImminent = minutesUntilDue >= 0 && minutesUntilDue <= 30;
    const isDueToday = localDateKey(new Date(task.vencimento)) === todayKey;
    const kinds: Array<'day' | '30m'> = [];
    if (isDueToday && localNow.hour >= 8 && !isImminent) kinds.push('day');
    if (isImminent) kinds.push('30m');

    for (const kind of kinds) {
      let claim: { claimed: boolean; id: string };
      try {
        claim = await claimReminder(task, kind);
      } catch (claimError) {
        results.push({ tarefa_id: task.id, tipo: kind, status: 'erro', erro: String(claimError) });
        continue;
      }
      if (!claim.claimed) continue;

      const leadName = task.lead_id ? leadNames.get(task.lead_id) : null;
      const detail = kind === '30m'
        ? `Faltam ${Math.max(0, minutesUntilDue)} minutos para o prazo.`
        : 'Esta tarefa vence hoje.';
      const message = [
        detail,
        '',
        `*${task.titulo}*`,
        `Prazo: ${formatDue(task.vencimento)}`,
        leadName ? `Lead: ${leadName}` : null,
        task.descricao ? `Detalhes: ${task.descricao.slice(0, 350)}` : null,
        '',
        'Abra o Orion Track em /tarefas.',
      ].filter(Boolean).join('\n');

      const sent = await sendApoloWhatsApp({
        type: 'demandas',
        title: kind === '30m' ? 'Tarefa em 30 minutos' : 'Tarefa para hoje',
        message,
        profiles: [profile],
        respectPreferences: false,
      });
      const succeeded = sent.some((item) => item.status === 'success');
      if (!succeeded && sent.every((item) => item.status === 'failed')) await releaseReminder(claim.id);
      results.push({ tarefa_id: task.id, tipo: kind, status: succeeded ? 'enviado' : 'nao_enviado', detalhes: sent });
    }
  }

  return NextResponse.json({ checked: tasks.length, reminders: results });
}
