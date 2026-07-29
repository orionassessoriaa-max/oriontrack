import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

type Profile = { id: string; tipo_usuario: string; nome?: string | null };
type AccountManagerProfile = {
  id: string;
  nome: string | null;
  tipo_usuario: string;
};
type TeamMember = {
  nome?: string | null;
  cargo?: string | null;
  tipo_usuario?: string | null;
  profile_id?: string | null;
};
type WeeklyItem = {
  corretor_id: string;
  corretor_ids?: string[];
  concessionaria: string;
  mensagem: string;
};
type CorretorTeamRow = {
  id: string;
  nome: string;
  nome_empresa: string | null;
  time_operacional: unknown;
};

function normalize(value?: string | null) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function isAccountMember(member: TeamMember) {
  const role = normalize(member.tipo_usuario);
  const cargo = normalize(member.cargo);
  return role === 'account_manager' || cargo.includes('account') || cargo.includes('gestor de projetos');
}

async function requireAccess(request: Request) {
  const header = request.headers.get('Authorization');
  if (!header?.startsWith('Bearer ')) {
    return { error: NextResponse.json({ error: 'Não autorizado.' }, { status: 401 }) };
  }
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(header.slice(7));
  if (error || !user) return { error: NextResponse.json({ error: 'Sessão expirada.' }, { status: 401 }) };
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, tipo_usuario, nome')
    .eq('id', user.id)
    .maybeSingle();
  if (!profile || !['admin', 'gestor_trafego'].includes(profile.tipo_usuario)) {
    return { error: NextResponse.json({ error: 'Acesso negado.' }, { status: 403 }) };
  }
  return { profile: profile as Profile };
}

export async function POST(request: Request) {
  try {
    const guard = await requireAccess(request);
    if ('error' in guard) return guard.error;
    const body = await request.json().catch(() => ({}));
    const reportId = String(body.report_id || '').trim();
    if (!reportId) return NextResponse.json({ error: 'Relatório semanal obrigatório.' }, { status: 400 });

    let scopedProfile = guard.profile;
    if (guard.profile.tipo_usuario === 'admin' && body.gestor_id) {
      const { data: requestedGestor } = await supabaseAdmin
        .from('profiles')
        .select('id, tipo_usuario, nome')
        .eq('id', String(body.gestor_id))
        .eq('tipo_usuario', 'gestor_trafego')
        .maybeSingle();
      if (!requestedGestor) return NextResponse.json({ error: 'Gestor de tráfego não encontrado.' }, { status: 404 });
      scopedProfile = requestedGestor as Profile;
    }

    const { data: report, error: reportError } = await supabaseAdmin
      .from('trafego_relatorios_semanais')
      .select('id, gestor_id, data_inicio, data_fim, itens, status')
      .eq('id', reportId)
      .maybeSingle();
    if (reportError) return NextResponse.json({ error: reportError.message }, { status: 500 });
    if (!report) return NextResponse.json({ error: 'Relatório semanal não encontrado.' }, { status: 404 });
    if (scopedProfile.tipo_usuario === 'gestor_trafego' && report.gestor_id !== scopedProfile.id) {
      return NextResponse.json({ error: 'Este relatório não pertence ao gestor selecionado.' }, { status: 403 });
    }
    if (report.status === 'ENVIADO') {
      return NextResponse.json({ success: true, status: 'ENVIADO', message: 'Este relatório já foi enviado ao Account Manager.' });
    }

    const items = (Array.isArray(report.itens) ? report.itens : []) as WeeklyItem[];
    if (!items.length) return NextResponse.json({ error: 'O relatório não possui concessionárias.' }, { status: 400 });
    const corretorIds = Array.from(new Set(items.flatMap((item) => item.corretor_ids?.length ? item.corretor_ids : [item.corretor_id])));
    const [{ data: corretores, error: corretoresError }, { data: managers, error: managersError }] = await Promise.all([
      supabaseAdmin
        .from('corretores')
        .select('id, nome, nome_empresa, time_operacional')
        .in('id', corretorIds),
      supabaseAdmin
        .from('profiles')
        .select('id, nome, tipo_usuario')
        .eq('tipo_usuario', 'account_manager')
        .in('status', ['active', 'ativo', 'Ativo']),
    ]);
    if (corretoresError) return NextResponse.json({ error: corretoresError.message }, { status: 500 });
    if (managersError) return NextResponse.json({ error: managersError.message }, { status: 500 });

    const accountManagers = (managers || []) as AccountManagerProfile[];
    const brokerRows = (corretores || []) as CorretorTeamRow[];
    const itemsByManager = new Map<string, WeeklyItem[]>();
    const missing: string[] = [];

    items.forEach((item) => {
      const ids = item.corretor_ids?.length ? item.corretor_ids : [item.corretor_id];
      const teamMembers = brokerRows
        .filter((broker) => ids.includes(broker.id))
        .flatMap((broker) => Array.isArray(broker.time_operacional) ? broker.time_operacional as TeamMember[] : [])
        .filter(isAccountMember);
      const assignedManagers = accountManagers.filter((manager) =>
        teamMembers.some((member) =>
          (member.profile_id && member.profile_id === manager.id)
          || normalize(member.nome) === normalize(manager.nome)
        )
      );

      if (!assignedManagers.length) {
        missing.push(item.concessionaria);
        return;
      }
      assignedManagers.forEach((manager) => {
        itemsByManager.set(manager.id, [...(itemsByManager.get(manager.id) || []), item]);
      });
    });

    if (missing.length) {
      return NextResponse.json({
        error: `Atribua um Account Manager no time operacional destas concessionárias: ${missing.join(', ')}.`,
      }, { status: 400 });
    }

    const period = `${report.data_inicio} a ${report.data_fim}`;
    const notifications = accountManagers
      .filter((manager) => itemsByManager.has(manager.id))
      .map((manager) => {
        const managerItems = itemsByManager.get(manager.id) || [];
        const content = managerItems
          .map((item) => `${item.concessionaria}\n${item.mensagem}`)
          .join('\n\n--------------------\n\n');
        return {
          titulo: 'Relatório semanal de tráfego recebido',
          mensagem: `${scopedProfile.nome || 'O gestor de tráfego'} enviou o relatório de ${period}.\n\n${content}`,
          remetente_profile_id: guard.profile.id,
          destinatario_profile_id: manager.id,
          destinatario_tipo: null,
          lida: false,
        };
      });

    const { error: notificationError } = await supabaseAdmin.from('notificacoes').insert(notifications);
    if (notificationError) return NextResponse.json({ error: notificationError.message }, { status: 500 });

    await supabaseAdmin
      .from('trafego_relatorios_semanais')
      .update({ status: 'ENVIADO' })
      .eq('id', reportId);
    await supabaseAdmin.from('audit_logs').insert({
      actor_profile_id: guard.profile.id,
      actor_role: guard.profile.tipo_usuario,
      action: 'trafego.relatorio_semanal.enviado_account_manager',
      entity_type: 'trafego_relatorios_semanais',
      entity_id: reportId,
      metadata: {
        gestor_id: scopedProfile.id,
        account_manager_ids: Array.from(itemsByManager.keys()),
        concessionarias: items.map((item) => item.concessionaria),
      },
    });

    return NextResponse.json({
      success: true,
      status: 'ENVIADO',
      message: `Relatório enviado para ${itemsByManager.size} Account Manager(s).`,
    });
  } catch (error: unknown) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Erro ao enviar relatório para o Account Manager.',
    }, { status: 500 });
  }
}
