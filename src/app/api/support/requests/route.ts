import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { rateLimit, requireApiUser, writeAuditLog } from '@/lib/api/security';
import { sendApoloWhatsApp } from '@/lib/apoloNotifications';

export async function POST(request: Request) {
  try {
    const limited = rateLimit(request, 'support:requests:create', { limit: 20, windowMs: 10 * 60_000 });
    if (limited) return limited;

    const guard = await requireApiUser(request);
    if ('error' in guard) return guard.error;
    const profile = guard.profile;

    const body = await request.json();
    const categoria = String(body.categoria || body.tipo || 'outro');
    const mensagem = String(body.mensagem || '').trim();

    if (!mensagem) {
      return NextResponse.json({ error: 'Descreva seu chamado antes de enviar.' }, { status: 400 });
    }

    const { data: requestData, error: requestError } = await supabaseAdmin
      .from('solicitacoes_suporte')
      .insert([{
        corretor_id: profile.corretor_id || null,
        solicitante_profile_id: profile.id,
        solicitante_nome: profile.nome,
        solicitante_tipo: profile.tipo_usuario,
        categoria,
        tipo: categoria,
        mensagem,
        status: 'nova'
      }])
      .select()
      .single();

    if (requestError) {
      return NextResponse.json({ error: requestError.message }, { status: 500 });
    }

    const { data: admins } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('tipo_usuario', 'admin')
      .in('status', ['active', 'ativo', 'Ativo']);

    if (admins?.length) {
      await supabaseAdmin.from('notificacoes').insert(
        admins.map((admin) => ({
          titulo: 'Nova solicitação de suporte',
          mensagem: `${profile.nome} abriu um chamado de ${categoria}: ${mensagem}`,
          remetente_profile_id: profile.id,
          destinatario_profile_id: admin.id,
          destinatario_tipo: 'admin',
          lida: false
        }))
      );

      const { data: adminProfiles } = await supabaseAdmin
        .from('profiles')
        .select('id, nome, telefone, tipo_usuario')
        .in('id', admins.map((admin) => admin.id));

      await sendApoloWhatsApp({
        type: 'suporte',
        title: 'Nova solicitacao de suporte',
        message: `${profile.nome} abriu um chamado de ${categoria}: ${mensagem}`,
        profiles: adminProfiles || [],
      });
    }

    await writeAuditLog(request, profile, {
      action: 'support.request.create',
      entity_type: 'solicitacao_suporte',
      entity_id: requestData.id,
      metadata: { categoria },
    });

    return NextResponse.json({ success: true, request: requestData });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Erro ao abrir chamado.' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const limited = rateLimit(request, 'support:requests:delete', { limit: 30, windowMs: 60_000 });
    if (limited) return limited;

    const guard = await requireApiUser(request, ['admin']);
    if ('error' in guard) return guard.error;

    const { searchParams } = new URL(request.url);
    const id = String(searchParams.get('id') || '').trim();
    if (!id) {
      return NextResponse.json({ error: 'Chamado invalido.' }, { status: 400 });
    }

    const { data: requestData, error: findError } = await supabaseAdmin
      .from('solicitacoes_suporte')
      .select('id, categoria, tipo, solicitante_nome')
      .eq('id', id)
      .maybeSingle();

    if (findError) {
      return NextResponse.json({ error: findError.message }, { status: 500 });
    }

    if (!requestData) {
      return NextResponse.json({ error: 'Chamado nao encontrado.' }, { status: 404 });
    }

    const { error: deleteError } = await supabaseAdmin
      .from('solicitacoes_suporte')
      .delete()
      .eq('id', id);

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    await writeAuditLog(request, guard.profile, {
      action: 'support.request.delete',
      entity_type: 'solicitacao_suporte',
      entity_id: id,
      metadata: {
        categoria: requestData.categoria || requestData.tipo,
        solicitante_nome: requestData.solicitante_nome,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Erro ao remover chamado.' }, { status: 500 });
  }
}
