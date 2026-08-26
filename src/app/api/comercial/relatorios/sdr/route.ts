import { NextResponse } from 'next/server';
import { requireCommercialUser } from '@/lib/api/comercial';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { signedRecordingUrl } from '@/lib/voipRecordingAccess';
import { maybeSyncVoipRecordings } from '@/lib/voipRecordingSync';

/**
 * Relatorio de esforco do SDR.
 *
 * Ligacoes fixas sao confirmadas pelo relatorio oficial da central. A cadencia
 * complementa somente as chamadas por WhatsApp.
 */
type LinhaSdr = {
  profile_id: string;
  nome: string;
  ligacoes: number;
  voip: number;
  whatsapp: number;
  telefone: number;
  atendidas: number;
  taxa_atendimento: number;
  reunioes: number;
  vendas: number;
  faturado: number;
  meta_dia: number;
  meta_periodo: number;
};

function diasUteis(inicio: Date, fim: Date) {
  let total = 0;
  const cursor = new Date(inicio);
  while (cursor <= fim) {
    const dia = cursor.getUTCDay();
    if (dia !== 0 && dia !== 6) total += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return Math.max(1, total);
}

export async function GET(request: Request) {
  const guard = await requireCommercialUser(request);
  if ('error' in guard) return guard.error;

  try {
    await maybeSyncVoipRecordings();
  } catch (error) {
    console.error('[relatorio_sdr_voip_sync]', error instanceof Error ? error.message : error);
  }

  const url = new URL(request.url);
  const hoje = new Date().toISOString().slice(0, 10);
  const start = url.searchParams.get('start') || hoje;
  const end = url.searchParams.get('end') || hoje;
  const sdrFiltro = url.searchParams.get('sdr') || '';
  const de = `${start}T00:00:00-03:00`;
  const ate = `${end}T23:59:59-03:00`;

  try {
    const [membrosResult, centralResult, cadenciaResult, leadsResult, metaResult] = await Promise.all([
      supabaseAdmin.from('comercial_membros').select('profile_id, papel, ativo'),
      supabaseAdmin
        .from('comercial_ligacoes')
        .select('id, sdr_id, lead_id, status, iniciada_at, duracao_segundos, gravacao_url, numero_destino, origem, voip_record_id')
        .in('status', ['atendida', 'nao_atendida', 'concluida'])
        .or('origem.neq.click2call,voip_record_id.not.is.null')
        .gte('iniciada_at', de)
        .lte('iniciada_at', ate)
        .limit(5000),
      supabaseAdmin
        .from('comercial_cadencia_tentativas')
        .select('autor_id, lead_id, canal, status, concluido_at')
        .eq('canal', 'ligacao_whatsapp')
        .in('status', ['atendeu', 'nao_atendeu'])
        .gte('concluido_at', de)
        .lte('concluido_at', ate)
        .limit(8000),
      supabaseAdmin
        .from('comercial_leads')
        .select('id, nome, sdr_id, closer_id, status, valor_fechado, fechado_at, reuniao_agendada_at')
        .limit(5000),
      supabaseAdmin.from('comercial_metas').select('meta_calls').eq('mes', `${start.slice(0, 7)}-01`).maybeSingle(),
    ]);

    const membros = (membrosResult.data || []).filter((membro) => membro.ativo !== false);
    const sdrIds = membros.filter((membro) => membro.papel === 'sdr').map((membro) => membro.profile_id as string);
    const alvoIds = sdrFiltro ? sdrIds.filter((id) => id === sdrFiltro) : sdrIds;

    const { data: perfis } = alvoIds.length
      ? await supabaseAdmin.from('profiles').select('id, nome').in('id', membros.map((m) => m.profile_id))
      : { data: [] as Array<{ id: string; nome: string | null }> };
    const nomePorId = new Map((perfis || []).map((perfil) => [perfil.id, perfil.nome || 'Sem nome']));

    const metaDia = Number(metaResult.data?.meta_calls || 0) || 100;
    const metaPeriodo = metaDia * diasUteis(new Date(`${start}T12:00:00Z`), new Date(`${end}T12:00:00Z`));

    const linhas = new Map<string, LinhaSdr>();
    const linha = (id: string) => {
      const atual = linhas.get(id) || {
        profile_id: id,
        nome: nomePorId.get(id) || 'Sem nome',
        ligacoes: 0,
        voip: 0,
        whatsapp: 0,
        telefone: 0,
        atendidas: 0,
        taxa_atendimento: 0,
        reunioes: 0,
        vendas: 0,
        faturado: 0,
        meta_dia: metaDia,
        meta_periodo: metaPeriodo,
      };
      linhas.set(id, atual);
      return atual;
    };
    for (const id of alvoIds) linha(id);

    for (const chamada of centralResult.data || []) {
      const id = String(chamada.sdr_id || '');
      if (!alvoIds.includes(id)) continue;
      const row = linha(id);
      row.ligacoes += 1;
      row.voip += 1;
      if (chamada.status === 'atendida' || chamada.status === 'concluida') row.atendidas += 1;
    }

    for (const tentativa of cadenciaResult.data || []) {
      const id = String(tentativa.autor_id || '');
      if (!alvoIds.includes(id)) continue;
      const row = linha(id);
      row.ligacoes += 1;
      row.whatsapp += 1;
      if (tentativa.status === 'atendeu') row.atendidas += 1;
    }

    for (const lead of leadsResult.data || []) {
      const dono = String(lead.sdr_id || '');
      if (!alvoIds.includes(dono)) continue;
      const marcada = lead.reuniao_agendada_at;
      if (marcada && marcada >= de && marcada <= ate) linha(dono).reunioes += 1;
      // Venda e o que esta na etapa de venda: valor solto de lead estornado nao
      // pode voltar a contar aqui.
      if (lead.status === 'Negócio fechado' && lead.fechado_at && lead.fechado_at >= de && lead.fechado_at <= ate) {
        const row = linha(dono);
        row.vendas += 1;
        row.faturado += Number(lead.valor_fechado || 0);
      }
    }

    const ranking = Array.from(linhas.values())
      .map((row) => ({ ...row, taxa_atendimento: row.ligacoes ? row.atendidas / row.ligacoes : 0 }))
      .sort((a, b) => b.ligacoes - a.ligacoes || b.atendidas - a.atendidas);

    // Gravacoes: so das chamadas atendidas, que e o que vale rever. A central
    // ainda esta com gravacao desativada, entao a lista vem vazia ate ligarem.
    const nomeLead = new Map((leadsResult.data || []).map((lead) => [lead.id, lead.nome || 'Lead']));
    const gravacoes = (centralResult.data || [])
      .filter((chamada) => (chamada.status === 'atendida' || chamada.status === 'concluida'))
      .filter((chamada) => !sdrFiltro || chamada.sdr_id === sdrFiltro)
      .map((chamada) => ({
        id: chamada.id,
        quando: chamada.iniciada_at,
        sdr: nomePorId.get(String(chamada.sdr_id)) || 'Sem nome',
        lead: nomeLead.get(chamada.lead_id) || 'Lead',
        numero: chamada.numero_destino,
        duracao_segundos: chamada.duracao_segundos,
        gravacao_url: chamada.voip_record_id
          ? signedRecordingUrl(Number(chamada.voip_record_id))
          : chamada.gravacao_url,
      }))
      .sort((a, b) => String(b.quando).localeCompare(String(a.quando)))
      .slice(0, 100);

    const totais = ranking.reduce(
      (acumulado, row) => ({
        ligacoes: acumulado.ligacoes + row.ligacoes,
        voip: acumulado.voip + row.voip,
        whatsapp: acumulado.whatsapp + row.whatsapp,
        telefone: acumulado.telefone + row.telefone,
        atendidas: acumulado.atendidas + row.atendidas,
        reunioes: acumulado.reunioes + row.reunioes,
        vendas: acumulado.vendas + row.vendas,
        faturado: acumulado.faturado + row.faturado,
      }),
      { ligacoes: 0, voip: 0, whatsapp: 0, telefone: 0, atendidas: 0, reunioes: 0, vendas: 0, faturado: 0 },
    );

    return NextResponse.json({
      periodo: { start, end, dias_uteis: diasUteis(new Date(`${start}T12:00:00Z`), new Date(`${end}T12:00:00Z`)) },
      meta: { por_dia: metaDia, no_periodo: metaPeriodo, do_time: metaPeriodo * Math.max(1, alvoIds.length) },
      totais: { ...totais, taxa_atendimento: totais.ligacoes ? totais.atendidas / totais.ligacoes : 0 },
      ranking,
      gravacoes,
      sdrs: sdrIds.map((id) => ({ id, nome: nomePorId.get(id) || 'Sem nome' })),
      gravacao_ativa: gravacoes.some((item) => Boolean(item.gravacao_url)),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Nao foi possivel montar o relatorio.' },
      { status: 500 },
    );
  }
}
