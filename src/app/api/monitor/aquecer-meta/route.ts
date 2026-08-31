import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { buscarInsights, diaBrasilia, type NivelInsight } from '@/lib/meta/insights';

/**
 * Aquece o cache da Meta antes de o gestor abrir a tela.
 *
 * A resposta da Meta vale meia hora em cache, entao a conta so demora na
 * primeira visita, e era justamente ela que o gestor sentia: 36 contas na
 * carteira, cada uma esperando a Meta responder. Rodando de vinte em vinte
 * minutos, a tela sempre encontra o dado pronto.
 *
 * O periodo e o mesmo que a tela abre por padrao, os ultimos sete dias em
 * Brasilia. Se abrir outro periodo, cai no caminho normal.
 */
const NIVEIS: NivelInsight[] = ['account', 'campaign', 'adset', 'ad'];
const LOTE = 6;

function autorizado(request: Request) {
  const esperado = process.env.CRON_SECRET || process.env.UAZAPI_GLOBAL_TOKEN;
  if (!esperado) return true;
  return request.headers.get('authorization') === `Bearer ${esperado}`;
}

export async function GET(request: Request) {
  if (!autorizado(request)) return NextResponse.json({ error: 'Nao autorizado.' }, { status: 401 });

  const token = process.env.META_ACCESS_TOKEN || '';
  const graphVersion = process.env.META_GRAPH_VERSION || 'v23.0';
  if (!token) return NextResponse.json({ ok: false, motivo: 'sem META_ACCESS_TOKEN' });

  const { data: corretores, error } = await supabaseAdmin
    .from('corretores')
    .select('meta_ad_account_id')
    .not('meta_ad_account_id', 'is', null)
    .in('status', ['active', 'ativo', 'Ativo']);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const contas = Array.from(new Set(
    (corretores || [])
      .map((linha) => String(linha.meta_ad_account_id || '').replace(/^act_/, '').trim())
      .filter(Boolean),
  ));

  const since = diaBrasilia(7);
  const until = diaBrasilia(0);
  let aquecidas = 0;
  let falhas = 0;

  for (let inicio = 0; inicio < contas.length; inicio += LOTE) {
    const lote = contas.slice(inicio, inicio + LOTE);
    await Promise.all(lote.map(async (conta) => {
      try {
        // Em serie por conta: o objetivo e encher o cache sem competir com o
        // gestor que estiver usando a tela nesse momento.
        for (const nivel of NIVEIS) {
          await buscarInsights(conta, nivel, since, until, token, graphVersion, (erro) => String((erro as any)?.message || erro));
        }
        aquecidas += 1;
      } catch {
        falhas += 1;
      }
    }));
  }

  return NextResponse.json({ ok: true, periodo: { since, until }, contas: contas.length, aquecidas, falhas });
}
