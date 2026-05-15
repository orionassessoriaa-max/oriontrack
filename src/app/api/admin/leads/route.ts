import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { normalizeLeadStatus } from '@/lib/leadStatus';

async function requireAdmin(request: Request) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return { error: NextResponse.json({ error: 'Nao autorizado.' }, { status: 401 }) };
  }

  const token = authHeader.split(' ')[1];
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !user) {
    return { error: NextResponse.json({ error: 'Sessao expirada.' }, { status: 401 }) };
  }

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('tipo_usuario')
    .eq('id', user.id)
    .maybeSingle();

  if (profile?.tipo_usuario !== 'admin') {
    return { error: NextResponse.json({ error: 'Acesso negado.' }, { status: 403 }) };
  }

  return { user };
}

export async function POST(request: Request) {
  const guard = await requireAdmin(request);
  if ('error' in guard) return guard.error;

  try {
    const body = await request.json();
    const corretorId = String(body.corretor_id || '').trim();
    const nome = String(body.nome || '').trim();
    const telefone = String(body.telefone || '').trim();

    if (!corretorId) {
      return NextResponse.json({ error: 'Selecione um corretor.' }, { status: 400 });
    }

    if (!nome || !telefone) {
      return NextResponse.json({ error: 'Informe nome e telefone do lead.' }, { status: 400 });
    }

    const { data: corretor } = await supabaseAdmin
      .from('corretores')
      .select('id')
      .eq('id', corretorId)
      .maybeSingle();

    if (!corretor) {
      return NextResponse.json({ error: 'Corretor nao encontrado.' }, { status: 404 });
    }

    const { data, error } = await supabaseAdmin
      .from('leads')
      .insert([{
        corretor_id: corretorId,
        nome,
        telefone,
        idades: String(body.idades || ''),
        possui_cnpj: String(body.possui_cnpj || 'Nao informado'),
        tem_plano_ativo: String(body.tem_plano_ativo || 'Nao informado'),
        plano_atual: String(body.plano_atual || ''),
        custo_plano_atual: String(body.custo_plano_atual || ''),
        investimento: String(body.investimento || ''),
        cidade: String(body.cidade || ''),
        operadora: body.operadora ? String(body.operadora) : null,
        status: normalizeLeadStatus(body.status || 'Aguardando atendimento'),
        data_entrada: body.data_entrada ? new Date(body.data_entrada).toISOString() : new Date().toISOString(),
      }])
      .select('id')
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, lead_id: data.id });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Erro ao salvar lead.' }, { status: 500 });
  }
}
