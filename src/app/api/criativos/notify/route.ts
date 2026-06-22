import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendApoloWhatsApp } from '@/lib/apoloNotifications';

async function requireUser(request: Request) {
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
    .select('id, tipo_usuario, corretor_id, nome')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile) {
    return { error: NextResponse.json({ error: 'Perfil nao encontrado.' }, { status: 403 }) };
  }

  return { user, profile };
}

export async function POST(request: Request) {
  const guard = await requireUser(request);
  if ('error' in guard) return guard.error;

  try {
    const body = await request.json().catch(() => ({}));
    const assetId = String(body.assetId || '').trim();
    const status = String(body.status || '').trim(); // 'revisao' or 'aprovado'
    const comentario = String(body.comentario || '').trim();

    if (!assetId || !['revisao', 'aprovado'].includes(status)) {
      return NextResponse.json({ error: 'Parâmetros inválidos.' }, { status: 400 });
    }

    // 1. Fetch creative asset details
    const { data: asset } = await supabaseAdmin
      .from('criativo_assets')
      .select('id, titulo, demanda_id, corretor_id')
      .eq('id', assetId)
      .maybeSingle();

    if (!asset) {
      return NextResponse.json({ error: 'Criativo não encontrado.' }, { status: 404 });
    }

    if (!asset.demanda_id) {
      return NextResponse.json({ success: true, message: 'Nenhuma demanda vinculada a este criativo.' });
    }

    // 2. Fetch the corresponding creative demand
    const { data: demanda } = await supabaseAdmin
      .from('criativo_demandas')
      .select('id, status, responsavel_profile_id, solicitante_profile_id, corretor_id')
      .eq('id', asset.demanda_id)
      .maybeSingle();

    if (!demanda) {
      return NextResponse.json({ error: 'Demanda não encontrada.' }, { status: 404 });
    }

    // 3. If there is a designer responsible, notify them
    if (demanda.responsavel_profile_id) {
      const { data: designer } = await supabaseAdmin
        .from('profiles')
        .select('id, nome, email, tipo_usuario, telefone')
        .eq('id', demanda.responsavel_profile_id)
        .maybeSingle();

      if (designer) {
        const actionLabel = status === 'revisao' ? 'solicitou revisão para' : 'aprovou';
        const title = status === 'revisao' ? 'Revisão de Criativo' : 'Criativo Aprovado';
        const corretorName = guard.profile.nome || 'Um corretor';
        
        let message = `O corretor ${corretorName} ${actionLabel} o criativo "${asset.titulo}".`;
        if (status === 'revisao' && comentario) {
          message += `\n\n*Observação:* ${comentario}`;
        }

        // Create in-app notification
        await supabaseAdmin.from('notificacoes').insert([{
          titulo: title,
          mensagem: message,
          destinatario_profile_id: designer.id,
          lida: false,
        }]);

        // Send WhatsApp notification
        try {
          await sendApoloWhatsApp({
            type: 'demandas',
            title: title,
            message: message,
            profiles: [designer],
          });
        } catch (waErr) {
          console.error('[Creative status notify] WhatsApp send failed:', waErr);
        }
      }
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Erro ao processar notificações.' }, { status: 500 });
  }
}
