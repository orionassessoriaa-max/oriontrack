import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'NÃ£o autorizado.' }, { status: 401 });
    }

    const token = authHeader.split(' ')[1];
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: 'SessÃ£o expirada.' }, { status: 401 });
    }

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('id, tipo_usuario')
      .eq('id', user.id)
      .maybeSingle();

    if (!profile || !['admin', 'gestor_trafego'].includes(profile.tipo_usuario)) {
      return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
    }

    const body = await request.json();
    const corretorId = String(body.corretor_id || '');
    const dataInicio = String(body.data_inicio || '');
    const dataFim = String(body.data_fim || '');
    const quantidadeLeads = Number(body.quantidade_leads || 0);
    const valorInvestido = Number(body.valor_investido || 0);
    const cpl = body.cpl === null || body.cpl === undefined ? null : Number(body.cpl);

    if (!corretorId || !dataInicio || !dataFim || Number.isNaN(valorInvestido)) {
      return NextResponse.json({ error: 'Dados obrigatÃ³rios ausentes.' }, { status: 400 });
    }

    if (profile.tipo_usuario === 'gestor_trafego') {
      const { data: corretor } = await supabaseAdmin
        .from('corretores')
        .select('id')
        .eq('id', corretorId)
        .eq('gestor_trafego_id', profile.id)
        .maybeSingle();

      if (!corretor) {
        return NextResponse.json({ error: 'Corretor nÃ£o vinculado ao gestor.' }, { status: 403 });
      }
    }

    const { data, error } = await supabaseAdmin
      .from('relatorios_trafego')
      .insert([{
        corretor_id: corretorId,
        gestor_id: profile.id,
        data_inicio: dataInicio,
        data_fim: dataFim,
        quantidade_leads: quantidadeLeads,
        valor_investido: valorInvestido,
        cpl
      }])
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, report: data });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Erro ao salvar relatÃ³rio.' }, { status: 500 });
  }
}
