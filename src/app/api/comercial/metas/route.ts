import { NextResponse } from 'next/server';
import { requireCommercialUser } from '@/lib/api/comercial';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { normalizarMesComercial, resolverMetasDoMes } from '@/lib/comercialMetas';

/**
 * Campos que o POST aceita. Duas telas editam a mesma linha: Metas manda so a
 * receita e Inteligencia manda o pacote inteiro. Por isso o payload do upsert e
 * montado APENAS com o que veio no body: o PostgREST gera o `on conflict do
 * update set` so para as colunas presentes, entao a tela que salva a receita
 * nao encosta em meta_vendas/meta_calls/ticket_medio/meta_conversao.
 */
const CAMPOS = {
  meta_valor: { inteiro: false, maximo: null as number | null },
  meta_vendas: { inteiro: true, maximo: null as number | null },
  meta_calls: { inteiro: true, maximo: null as number | null },
  ticket_medio: { inteiro: false, maximo: null as number | null },
  // numeric(5,2): mandar 4000 estoura a coluna, entao trava em 100.
  meta_conversao: { inteiro: false, maximo: 100 as number | null },
} as const;

type CampoMeta = keyof typeof CAMPOS;

export async function GET(request: Request) {
  // Leitura liberada para todo o time comercial: a sala imersiva mostra a meta
  // do mes para SDR tambem. A escrita segue restrita ao coordenador no POST.
  const guard = await requireCommercialUser(request);
  if ('error' in guard) return guard.error;
  const month = normalizarMesComercial(new URL(request.url).searchParams.get('month'));
  const end = new Date(new Date(`${month}T12:00:00Z`).getUTCFullYear(), new Date(`${month}T12:00:00Z`).getUTCMonth() + 1, 0).toISOString();
  const [{ data: goal }, { data: leads, error }] = await Promise.all([
    supabaseAdmin.from('comercial_metas').select('*').eq('mes', month).maybeSingle(),
    supabaseAdmin.from('comercial_leads').select('valor_fechado,valor_negociacao,status').gte('data_entrada', `${month}T00:00:00-03:00`).lte('data_entrada', end),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const rows = leads || [];
  const sold = rows.reduce((sum, lead) => sum + Number(lead.valor_fechado || 0), 0);
  const negotiation = rows.filter((lead) => !['Perdido', 'Desqualificado', 'Negócio fechado'].includes(String(lead.status))).reduce((sum, lead) => sum + Number(lead.valor_negociacao || 0), 0);
  // metasEfetivas e aditivo: cliente antigo ignora, formulario novo abre ja com
  // o numero que o telao esta usando (gravado ou padrao).
  return NextResponse.json({ goal, metasEfetivas: resolverMetasDoMes(goal), month, sold, negotiation, projection: sold + negotiation });
}

export async function POST(request: Request) {
  const guard = await requireCommercialUser(request, true);
  if ('error' in guard) return guard.error;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const mes = normalizarMesComercial(typeof body?.mes === 'string' ? body.mes : null);

  const payload: Record<string, number | string> = {};
  for (const [chave, regra] of Object.entries(CAMPOS) as [CampoMeta, (typeof CAMPOS)[CampoMeta]][]) {
    const bruto = body?.[chave];
    if (bruto === undefined || bruto === null || bruto === '') continue;
    const numero = Number(bruto);
    if (!Number.isFinite(numero)) return NextResponse.json({ error: `Valor invalido para ${chave}.` }, { status: 400 });
    if (numero < 0) return NextResponse.json({ error: `A meta ${chave} nao pode ser negativa.` }, { status: 400 });
    const limitado = regra.maximo === null ? numero : Math.min(numero, regra.maximo);
    payload[chave] = regra.inteiro ? Math.round(limitado) : limitado;
  }

  // Payload parcial e legitimo (a tela de Metas salva so a receita), entao a
  // recusa agora e "nao veio nenhum campo reconhecido", nao "tudo zero".
  if (!Object.keys(payload).length) return NextResponse.json({ error: 'Informe ao menos uma meta.' }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from('comercial_metas')
    .upsert({ ...payload, mes, updated_at: new Date().toISOString() }, { onConflict: 'mes' })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // created_by fica fora do upsert de proposito: la ele entraria no update set
  // e reescreveria o criador a cada edicao. Este update so pega a linha que
  // ainda esta sem dono, entao vale para o insert e nao toca nas ja existentes.
  let goal = data;
  if (!data?.created_by && guard.profile.id) {
    const { data: comDono } = await supabaseAdmin
      .from('comercial_metas')
      .update({ created_by: guard.profile.id })
      .eq('mes', mes)
      .is('created_by', null)
      .select('*')
      .maybeSingle();
    if (comDono) goal = comDono;
  }
  return NextResponse.json({ goal });
}
