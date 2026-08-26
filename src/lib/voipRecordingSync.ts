import { supabaseAdmin } from '@/lib/supabase/admin';
import { listarGravacoesVoip, type GravacaoVoip } from '@/lib/voip';

const TIMEZONE = 'America/Sao_Paulo';
const MATCH_WINDOW_MS = 10 * 60 * 1000;
const SYNC_INTERVAL_MS = 45 * 1000;

type Lead = { id: string; telefone: string | null; sdr_id: string | null; closer_id: string | null; updated_at: string | null };
type Profile = { id: string; voip_ramal: string | null };
type ExistingCall = {
  id: string;
  lead_id: string | null;
  sdr_id: string;
  iniciada_at: string;
  numero_destino: string | null;
  voip_record_id: number | null;
  status: string;
  duracao_segundos: number | null;
};

let lastSyncAt = 0;
let currentSync: Promise<VoipSyncResult> | null = null;

export type VoipSyncResult = {
  recebidas: number;
  inseridas: number;
  atualizadas: number;
  inalteradas: number;
  ignoradas_sem_sdr: number;
  sem_lead: number;
};

function localDate(date: Date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function recordingDateToIso(value: string) {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) return null;
  return new Date(`${value.replace(' ', 'T')}-03:00`).toISOString();
}

export function normalizeVoipPhone(value: unknown) {
  let digits = String(value || '').replace(/\D/g, '').replace(/^0+/, '');
  if (digits.startsWith('55') && digits.length > 11) digits = digits.slice(2);
  if (digits.length > 11) digits = digits.slice(-11);
  return digits;
}

function phoneKeys(value: unknown) {
  const normalized = normalizeVoipPhone(value);
  return Array.from(new Set([normalized, normalized.slice(-10)].filter((key) => key.length >= 10)));
}

async function allLeads() {
  const results: Lead[] = [];
  for (let start = 0; start < 20_000; start += 1000) {
    const { data, error } = await supabaseAdmin
      .from('comercial_leads')
      .select('id,telefone,sdr_id,closer_id,updated_at')
      .not('telefone', 'is', null)
      .order('updated_at', { ascending: false })
      .range(start, start + 999);
    if (error) throw new Error(error.message);
    const rows = (data || []) as Lead[];
    results.push(...rows);
    if (rows.length < 1000) break;
  }
  return results;
}

function chooseLead(candidates: Lead[], sdrId: string) {
  return candidates.find((lead) => lead.sdr_id === sdrId || lead.closer_id === sdrId) || candidates[0] || null;
}

function nearestPendingCall(recording: GravacaoVoip, startedAt: string, sdrId: string, calls: ExistingCall[]) {
  const destination = normalizeVoipPhone(recording.destination);
  const at = new Date(startedAt).getTime();
  return calls
    .filter((call) => call.sdr_id === sdrId && !call.voip_record_id && normalizeVoipPhone(call.numero_destino) === destination)
    .map((call) => ({ call, distance: Math.abs(new Date(call.iniciada_at).getTime() - at) }))
    .filter((item) => item.distance <= MATCH_WINDOW_MS)
    .sort((a, b) => a.distance - b.distance)[0]?.call || null;
}

async function syncRange(dateIni: string, dateEnd: string): Promise<VoipSyncResult> {
  const recordings = await listarGravacoesVoip({ dateIni, dateEnd });
  const result: VoipSyncResult = {
    recebidas: recordings.length,
    inseridas: 0,
    atualizadas: 0,
    inalteradas: 0,
    ignoradas_sem_sdr: 0,
    sem_lead: 0,
  };
  if (!recordings.length) return result;

  const firstDate = `${dateIni}T00:00:00-03:00`;
  const lastDate = `${dateEnd}T23:59:59-03:00`;
  const [{ data: profiles, error: profileError }, leads, { data: calls, error: callError }] = await Promise.all([
    supabaseAdmin.from('profiles').select('id,voip_ramal').not('voip_ramal', 'is', null),
    allLeads(),
    supabaseAdmin
      .from('comercial_ligacoes')
      .select('id,lead_id,sdr_id,iniciada_at,numero_destino,voip_record_id,status,duracao_segundos')
      .gte('iniciada_at', firstDate)
      .lte('iniciada_at', lastDate)
      .limit(5000),
  ]);
  if (profileError) throw new Error(profileError.message);
  if (callError) throw new Error(callError.message);

  const profileBySource = new Map<string, Profile>();
  for (const profile of (profiles || []) as Profile[]) {
    const key = normalizeVoipPhone(profile.voip_ramal);
    if (key) profileBySource.set(key, profile);
  }
  const leadByPhone = new Map<string, Lead[]>();
  for (const lead of leads) {
    for (const key of phoneKeys(lead.telefone)) leadByPhone.set(key, [...(leadByPhone.get(key) || []), lead]);
  }
  const existingCalls = (calls || []) as ExistingCall[];
  const existingByRecord = new Map(existingCalls.filter((call) => call.voip_record_id).map((call) => [Number(call.voip_record_id), call]));

  for (const recording of recordings) {
    const startedAt = recordingDateToIso(recording.calldate);
    if (!startedAt) continue;
    const profile = profileBySource.get(normalizeVoipPhone(recording.source));
    if (!profile) {
      result.ignoradas_sem_sdr += 1;
      continue;
    }
    const leadCandidates = phoneKeys(recording.destination).flatMap((key) => leadByPhone.get(key) || []);
    const lead = chooseLead(Array.from(new Map(leadCandidates.map((item) => [item.id, item])).values()), profile.id);
    if (!lead) result.sem_lead += 1;
    const status = recording.duration > 0 ? 'atendida' : 'nao_atendida';
    const finalizadaAt = new Date(new Date(startedAt).getTime() + recording.duration * 1000).toISOString();
    const values = {
      lead_id: lead?.id || null,
      sdr_id: profile.id,
      status,
      iniciada_at: startedAt,
      finalizada_at: finalizadaAt,
      duracao_segundos: recording.duration,
      gravacao_url: null,
      origem: 'voip_cdr',
      numero_origem: recording.source,
      numero_destino: recording.destination,
      voip_record_id: recording.recordId,
      voip_clid: recording.clid || null,
      voip_source: recording.source,
      voip_destination: recording.destination,
      voip_recording_size: recording.size,
      voip_sincronizada_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const existing = existingByRecord.get(recording.recordId);
    if (
      existing
      && existing.status === status
      && Number(existing.duracao_segundos || 0) === recording.duration
      && (existing.lead_id || null) === (lead?.id || null)
    ) {
      result.inalteradas += 1;
      continue;
    }
    const pending = existing || nearestPendingCall(recording, startedAt, profile.id, existingCalls);
    if (pending) {
      let update = supabaseAdmin.from('comercial_ligacoes').update(values).eq('id', pending.id);
      // A condicao impede que duas instancias conciliem gravacoes diferentes
      // sobre a mesma solicitacao Click2Call ainda pendente.
      if (!existing) update = update.is('voip_record_id', null);
      const { data, error } = await update.select('id').maybeSingle();
      if (error) throw new Error(error.message);
      if (data) {
        Object.assign(pending, values);
        existingByRecord.set(recording.recordId, pending);
        result.atualizadas += 1;
        continue;
      }
    }

    const { data, error } = await supabaseAdmin.from('comercial_ligacoes').insert(values).select('id').single();
    if (error) {
      // O indice unico e a ultima barreira entre processos/replicas. Se outra
      // sincronizacao gravou o mesmo record_id primeiro, o resultado ja esta
      // correto e esta execucao vira um no-op idempotente.
      if (error.code === '23505') {
        result.inalteradas += 1;
        continue;
      }
      throw new Error(error.message);
    }
    const inserted = { id: data.id, ...values } as ExistingCall;
    existingCalls.push(inserted);
    existingByRecord.set(recording.recordId, inserted);
    result.inseridas += 1;
  }
  return result;
}

export async function syncVoipRecordings(days = 2) {
  const safeDays = Math.min(7, Math.max(1, Math.floor(days)));
  const end = new Date();
  const start = new Date(end.getTime());
  start.setDate(start.getDate() - (safeDays - 1));
  return syncRange(localDate(start), localDate(end));
}

/** Evita que cada atualizacao da TV dispare outra consulta na operadora. */
export async function maybeSyncVoipRecordings() {
  if (currentSync) return currentSync;
  if (Date.now() - lastSyncAt < SYNC_INTERVAL_MS) return null;
  currentSync = syncVoipRecordings(2).finally(() => {
    lastSyncAt = Date.now();
    currentSync = null;
  });
  return currentSync;
}
