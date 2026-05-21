import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

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

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin(request);
  if ('error' in guard) return guard.error;

  const { id } = await context.params;
  const leadId = String(id || '').trim();

  if (!leadId) {
    return NextResponse.json({ error: 'Lead invalido.' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('leads')
    .delete()
    .eq('id', leadId)
    .select('id')
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: 'Lead nao encontrado ou ja removido.' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, lead_id: data.id });
}
