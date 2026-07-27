import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { isGestorLinkedToConcessionariaCorretor } from '@/lib/gestorAccess';

async function access(request: Request) {
  const header = request.headers.get('Authorization');
  if (!header?.startsWith('Bearer ')) return { error: NextResponse.json({ error: 'Não autorizado.' }, { status: 401 }) };
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(header.slice(7));
  if (error || !user) return { error: NextResponse.json({ error: 'Sessão expirada.' }, { status: 401 }) };
  const { data: profile } = await supabaseAdmin.from('profiles').select('id, tipo_usuario').eq('id', user.id).maybeSingle();
  if (!profile || !['admin', 'gestor_trafego', 'account_manager'].includes(profile.tipo_usuario)) return { error: NextResponse.json({ error: 'Acesso negado.' }, { status: 403 }) };
  return { profile };
}

export async function GET(request: Request) {
  try {
    const guard = await access(request);
    if ('error' in guard) return guard.error;
    const { data, error } = await supabaseAdmin.from('trafego_relatorio_destinos').select('id, corretor_id, tipo, nome, destino, ativo').eq('ativo', true).order('nome');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    let destinations = data || [];
    if (guard.profile.tipo_usuario === 'gestor_trafego') {
      const { data: corretores } = await supabaseAdmin.from('corretores').select('id, gestor_trafego_id, time_operacional, nome_empresa');
      const allowed = new Set((corretores || []).filter((item) => isGestorLinkedToConcessionariaCorretor(item, guard.profile)).map((item) => item.id));
      destinations = destinations.filter((item) => allowed.has(item.corretor_id));
    }
    return NextResponse.json({ destinations });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Erro ao carregar destinos.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const guard = await access(request);
    if ('error' in guard) return guard.error;
    const body = await request.json();
    const corretorId = String(body.corretor_id || '');
    const tipo = body.tipo === 'grupo' ? 'grupo' : 'account';
    const nome = String(body.nome || '').trim();
    const destino = String(body.destino || '').trim();
    if (!corretorId || !nome || !destino) return NextResponse.json({ error: 'Informe concessionária, nome e destino.' }, { status: 400 });
    const { data: corretor } = await supabaseAdmin.from('corretores').select('id, gestor_trafego_id, time_operacional, nome_empresa').eq('id', corretorId).maybeSingle();
    if (!corretor) return NextResponse.json({ error: 'Concessionária não encontrada.' }, { status: 404 });
    if (guard.profile.tipo_usuario === 'gestor_trafego' && !isGestorLinkedToConcessionariaCorretor(corretor, guard.profile)) return NextResponse.json({ error: 'Concessionária fora do seu escopo.' }, { status: 403 });
    const { data, error } = await supabaseAdmin.from('trafego_relatorio_destinos').upsert({ corretor_id: corretorId, tipo, nome, destino, ativo: true, updated_at: new Date().toISOString() }, { onConflict: 'corretor_id,tipo,destino' }).select('id, corretor_id, tipo, nome, destino, ativo').single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, destination: data });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Erro ao salvar destino.' }, { status: 500 });
  }
}
