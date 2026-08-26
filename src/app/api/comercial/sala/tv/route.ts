import { NextResponse } from 'next/server';
import { requireCommercialUser } from '@/lib/api/comercial';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { maybeSyncVoipRecordings } from '@/lib/voipRecordingSync';

// Painel de parede da sala comercial. Um unico GET alimenta a TV inteira, com
// os mesmos criterios de fechamento que a Sala e as Metas ja usam, para o
// numero da parede nunca divergir do numero do Kanban.

const CLOSED_STATES = new Set(['negocio fechado', 'venda realizada']);
const TIMEZONE = 'America/Sao_Paulo';

function normalized(value: unknown) {
  return String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

function saoPauloToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

/** Dias uteis (seg a sex) entre duas datas, inclusive. */
function businessDays(from: Date, to: Date) {
  let count = 0;
  const cursor = new Date(from.getTime());
  while (cursor <= to) {
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6) count += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '??';
}

/**
 * Venda e o que esta em etapa de venda. Antes bastava ter valor gravado, e o
 * lead estornado continuava somando: o Vinicius voltou para Follow MRR com os
 * R$ 3.000 do fechamento ainda no campo e seguia contando na parede.
 */
function isClosed(lead: { status?: string | null; valor_fechado?: number | null }) {
  return CLOSED_STATES.has(normalized(lead.status));
}

/** Data em que a venda entra no mes: fechado_at quando existe, senao a ultima alteracao. */
function closedAt(lead: { fechado_at?: string | null; updated_at?: string | null; data_entrada?: string | null }) {
  return lead.fechado_at || lead.updated_at || lead.data_entrada || null;
}

export async function GET(request: Request) {
  const guard = await requireCommercialUser(request);
  if ('error' in guard) return guard.error;

  // A TV se atualiza sozinha. Aproveitamos o mesmo ciclo, com trava de 45s,
  // para trazer o relatorio oficial da central sem depender de F5.
  try {
    await maybeSyncVoipRecordings();
  } catch (error) {
    console.error('[sala_tv_voip_sync]', error instanceof Error ? error.message : error);
  }

  const today = saoPauloToday();
  const month = today.slice(0, 7);
  const monthStart = `${month}-01`;
  const lastDay = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  const monthEnd = `${month}-${String(lastDay).padStart(2, '0')}`;

  const [metaResult, leadsResult, callsResult, meetingsResult, interactionsResult, whatsappCallsResult] = await Promise.all([
    supabaseAdmin.from('comercial_metas').select('meta_valor,meta_vendas,meta_calls,ticket_medio').eq('mes', `${monthStart}`).maybeSingle(),
    // Janela larga: uma venda pode ter entrado como lead em meses anteriores.
    supabaseAdmin
      .from('comercial_leads')
      .select('id,nome,status,valor_fechado,valor_negociacao,vidas,sdr_id,closer_id,fechado_at,updated_at,data_entrada,estado,reuniao_agendada_at')
      .or(`fechado_at.gte.${monthStart}T00:00:00-03:00,data_entrada.gte.${monthStart}T00:00:00-03:00`)
      .limit(4000),
    supabaseAdmin
      .from('comercial_ligacoes')
      .select('id,sdr_id,status,iniciada_at')
      .in('status', ['atendida', 'nao_atendida', 'concluida'])
      .or('origem.neq.click2call,voip_record_id.not.is.null')
      .gte('iniciada_at', `${today}T00:00:00-03:00`)
      .lte('iniciada_at', `${today}T23:59:59-03:00`)
      .limit(2000),
    supabaseAdmin
      .from('comercial_leads')
      .select('id,nome,sdr_id,closer_id,reuniao_agendada_at')
      .gte('reuniao_agendada_at', `${today}T00:00:00-03:00`)
      .order('reuniao_agendada_at', { ascending: false })
      .limit(20),
    supabaseAdmin
      .from('comercial_lead_interacoes')
      .select('lead_id,tipo,comentario,created_at')
      .order('created_at', { ascending: false })
      .limit(20),
    // Ligacao fixa agora vem do relatorio oficial da central. A cadencia entra
    // somente para chamadas por WhatsApp, que nao existem na API da VoIP.
    supabaseAdmin
      .from('comercial_cadencia_tentativas')
      .select('autor_id,canal,status,concluido_at')
      .eq('canal', 'ligacao_whatsapp')
      .in('status', ['atendeu', 'nao_atendeu'])
      .gte('concluido_at', `${today}T00:00:00-03:00`)
      .lte('concluido_at', `${today}T23:59:59-03:00`)
      .limit(4000),
  ]);

  if (leadsResult.error) return NextResponse.json({ error: leadsResult.error.message }, { status: 500 });

  const leads = leadsResult.data || [];
  const monthClosed = leads.filter((lead) => {
    if (!isClosed(lead)) return false;
    const reference = closedAt(lead);
    return Boolean(reference) && String(reference).slice(0, 7) === month;
  });

  const fechado = monthClosed.reduce((total, lead) => total + Number(lead.valor_fechado || lead.valor_negociacao || 0), 0);
  const meta = Number(metaResult.data?.meta_valor || 0);
  const falta = Math.max(0, meta - fechado);

  // Ritmo: onde a operacao deveria estar hoje se a meta fosse distribuida
  // igualmente pelos dias uteis do mes. E a leitura que falta num placar comum.
  const firstDay = new Date(`${monthStart}T12:00:00Z`);
  const lastDayDate = new Date(`${monthEnd}T12:00:00Z`);
  const todayDate = new Date(`${today}T12:00:00Z`);
  const totalBusiness = businessDays(firstDay, lastDayDate);
  const elapsedBusiness = businessDays(firstDay, todayDate);
  const remainingBusiness = Math.max(0, totalBusiness - elapsedBusiness);
  const paceRatio = totalBusiness ? elapsedBusiness / totalBusiness : 0;
  const paceValue = meta * paceRatio;
  const progress = meta ? Math.min(1, fechado / meta) : 0;

  const ownerIds = Array.from(new Set(monthClosed.flatMap((lead) => [lead.closer_id, lead.sdr_id]).filter(Boolean) as string[]));
  const callIds = Array.from(new Set((callsResult.data || []).map((call) => call.sdr_id).filter(Boolean) as string[]));
  const { data: members } = await supabaseAdmin.from('comercial_membros').select('profile_id,papel,ativo');
  // O nome de todo membro do time entra na busca, senao o SDR zerado apareceria
  // sem nome no painel.
  const profileIds = Array.from(new Set([
    ...ownerIds,
    ...callIds,
    ...(members || []).map((member) => member.profile_id as string),
  ]));
  const { data: profiles } = profileIds.length
    ? await supabaseAdmin.from('profiles').select('id,nome').in('id', profileIds)
    : { data: [] as Array<{ id: string; nome: string | null }> };
  const nameById = new Map((profiles || []).map((profile) => [profile.id, profile.nome || 'Sem nome']));
  const roleById = new Map((members || []).map((member) => [member.profile_id, String(member.papel || '')]));

  const board = new Map<string, { id: string; fechado: number; vendas: number; ligacoes: number; atendidas: number; reunioes: number }>();
  const bump = (id: string) => {
    const current = board.get(id) || { id, fechado: 0, vendas: 0, ligacoes: 0, atendidas: 0, reunioes: 0 };
    board.set(id, current);
    return current;
  };

  // O placar e dos SDRs, e todos aparecem mesmo zerados: quem nao fechou e nao
  // ligou sumia da parede, que e justamente quem precisa ser visto.
  const sdrIds = (members || [])
    .filter((member) => String(member.papel || '') === 'sdr' && member.ativo !== false)
    .map((member) => member.profile_id as string);
  for (const id of sdrIds) bump(id);
  // O placar da sala e do turno: tudo que aparece na linha do SDR e de hoje. O
  // numero grande do topo continua sendo o mes, porque a meta e mensal.
  for (const lead of monthClosed) {
    const ownerId = (lead.closer_id || lead.sdr_id) as string | null;
    if (!ownerId) continue;
    const quando = String(closedAt(lead) || '').slice(0, 10);
    if (quando !== today) continue;
    const row = bump(ownerId);
    row.fechado += Number(lead.valor_fechado || lead.valor_negociacao || 0);
    row.vendas += 1;
  }
  for (const call of callsResult.data || []) {
    if (!call.sdr_id) continue;
    const linha = bump(call.sdr_id);
    linha.ligacoes += 1;
    if (call.status === 'atendida' || call.status === 'concluida') linha.atendidas += 1;
  }
  for (const tentativa of whatsappCallsResult.data || []) {
    if (!tentativa.autor_id) continue;
    const linha = bump(tentativa.autor_id);
    linha.ligacoes += 1;
    if (tentativa.status === 'atendeu') linha.atendidas += 1;
  }
  // Reuniao marcada hoje, para o SDR que trouxe o lead.
  for (const lead of leads) {
    const marcada = lead.reuniao_agendada_at;
    if (!marcada || String(marcada).slice(0, 10) !== today) continue;
    const dono = (lead.sdr_id || lead.closer_id) as string | null;
    if (dono) bump(dono).reunioes += 1;
  }

  const ranking = Array.from(board.values())
    .filter((row) => sdrIds.includes(row.id))
    .map((row) => {
      const nome = nameById.get(row.id) || 'Sem nome';
      const papel = roleById.get(row.id) || '';
      return {
        id: row.id,
        nome,
        iniciais: initials(nome),
        papel: papel === 'sdr' ? 'SDR' : papel === 'closer' ? 'Closer' : papel === 'coordenador' ? 'Coordenacao' : 'Comercial',
        fechado: row.fechado,
        vendas: row.vendas,
        ligacoes: row.ligacoes,
        atendidas: row.atendidas,
        reunioes: row.reunioes,
      };
    })
    .sort((a, b) => b.fechado - a.fechado || b.reunioes - a.reunioes || b.ligacoes - a.ligacoes)
    .slice(0, 6);

  const leadNameById = new Map(leads.map((lead) => [lead.id, lead.nome || 'Lead']));
  const feed = [
    ...monthClosed
      .filter((lead) => closedAt(lead))
      .map((lead) => ({
        at: String(closedAt(lead)),
        tipo: 'venda' as const,
        texto: `${(nameById.get((lead.closer_id || lead.sdr_id) as string) || 'Comercial').split(' ')[0]} fechou ${lead.nome || 'lead'} · ${Number(lead.valor_fechado || lead.valor_negociacao || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })}`,
      })),
    ...(meetingsResult.data || []).map((lead) => ({
      at: String(lead.reuniao_agendada_at),
      tipo: 'reuniao' as const,
      texto: `Reuniao com ${lead.nome || 'lead'} · ${nameById.get((lead.closer_id || lead.sdr_id) as string) || 'comercial'}`,
    })),
    ...leads
      .filter((lead) => lead.data_entrada && String(lead.data_entrada).slice(0, 10) === today)
      .slice(0, 12)
      .map((lead) => ({
        at: String(lead.data_entrada),
        tipo: 'lead' as const,
        texto: `Lead novo${lead.estado ? ` em ${lead.estado}` : ''} · ${lead.nome || 'sem nome'}`,
      })),
    ...(interactionsResult.data || [])
      .filter((item) => String(item.tipo || '').startsWith('ia_'))
      .map((item) => ({
        at: String(item.created_at),
        tipo: 'ia' as const,
        texto: String(item.comentario || `Aline atualizou ${leadNameById.get(item.lead_id) || 'um lead'}`).slice(0, 90),
      })),
  ]
    .filter((item) => item.at)
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 4);

  // Meta de ligacao do dia: vale por SDR. Fica em comercial_metas.meta_calls e,
  // enquanto ninguem preencher, usa 100, que e o combinado do time.
  const metaLigacoesDia = Number(metaResult.data?.meta_calls || 0) || 100;
  // So os SDRs entram na conta, porque a meta do dia tambem e por SDR. Ligacao
  // do closer aparece no historico do lead, nao na barra da parede.
  const linhasSdr = Array.from(board.values()).filter((linha) => sdrIds.includes(linha.id));
  const ligacoesTime = linhasSdr.reduce((total, linha) => total + linha.ligacoes, 0);
  const atendidasTime = linhasSdr.reduce((total, linha) => total + linha.atendidas, 0);

  return NextResponse.json({
    mes: month,
    hoje: today,
    fechado,
    meta,
    falta,
    ligacoes: {
      meta_por_sdr: metaLigacoesDia,
      meta_time: metaLigacoesDia * Math.max(1, sdrIds.length),
      realizadas: ligacoesTime,
      atendidas: atendidasTime,
      taxa_atendimento: ligacoesTime ? atendidasTime / ligacoesTime : 0,
    },
    vendas: monthClosed.length,
    progresso: progress,
    ritmo: {
      esperado: paceValue,
      percentual: paceRatio,
      pontos_atras: Math.round((paceRatio - progress) * 100),
      dia_util: elapsedBusiness,
    },
    dias_uteis_restantes: remainingBusiness,
    por_dia: remainingBusiness > 0 ? falta / remainingBusiness : falta,
    ranking,
    feed,
    updatedAt: new Date().toISOString(),
  });
}
