import { NextResponse } from 'next/server';
import { requireCommercialUser } from '@/lib/api/comercial';
import { supabaseAdmin } from '@/lib/supabase/admin';

function monthStart(value?: string) { return /^\d{4}-\d{2}$/.test(value || '') ? `${value}-01` : new Date().toISOString().slice(0, 7) + '-01'; }

export async function GET(request: Request) {
  const guard = await requireCommercialUser(request);
  if ('error' in guard) return guard.error;
  if (!['coordenador', 'closer'].includes(guard.commercialRole)) {
    return NextResponse.json({ error: 'Visualizacao de metas restrita ao coordenador e ao closer.' }, { status: 403 });
  }
  const month = monthStart(new URL(request.url).searchParams.get('month') || undefined);
  const end = new Date(new Date(`${month}T12:00:00Z`).getUTCFullYear(), new Date(`${month}T12:00:00Z`).getUTCMonth() + 1, 0).toISOString();
  const [{ data: goal }, { data: leads, error }] = await Promise.all([
    supabaseAdmin.from('comercial_metas').select('*').eq('mes', month).maybeSingle(),
    supabaseAdmin.from('comercial_leads').select('valor_fechado,valor_negociacao,status').gte('data_entrada', `${month}T00:00:00-03:00`).lte('data_entrada', end),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const rows = leads || [];
  const sold = rows.reduce((sum, lead) => sum + Number(lead.valor_fechado || 0), 0);
  const negotiation = rows.filter((lead) => !['Perdido', 'Desqualificado', 'Negócio fechado'].includes(String(lead.status))).reduce((sum, lead) => sum + Number(lead.valor_negociacao || 0), 0);
  return NextResponse.json({ goal, month, sold, negotiation, projection: sold + negotiation });
}

export async function POST(request: Request) {
  const guard = await requireCommercialUser(request, true);
  if ('error' in guard) return guard.error;
  const body = await request.json();
  const mes = monthStart(String(body.mes || ''));
  const meta_valor = Math.max(0, Number(body.meta_valor || 0));
  const meta_vendas = Math.max(0, Math.round(Number(body.meta_vendas || 0)));
  const meta_calls = Math.max(0, Math.round(Number(body.meta_calls || 0)));
  const ticket_medio = Math.max(0, Number(body.ticket_medio || 0));
  if (!meta_valor && !meta_vendas && !meta_calls && !ticket_medio) return NextResponse.json({ error: 'Informe ao menos uma meta maior que zero.' }, { status: 400 });
  const { data, error } = await supabaseAdmin.from('comercial_metas').upsert({ mes, meta_valor, meta_vendas, meta_calls, ticket_medio, created_by: guard.profile.id, updated_at: new Date().toISOString() }, { onConflict: 'mes' }).select('*').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ goal: data });
}
