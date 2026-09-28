import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { OPERATIONAL_COORDINATOR_PROFILE_IDS } from '@/lib/users';

type Profile = { id: string; tipo_usuario: string; nome?: string | null };
type ReportRecipientProfile = {
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

function isReportRecipientMember(member: TeamMember) {
  const role = normalize(member.tipo_usuario);
  const cargo = normalize(member.cargo);
  return (
    role === 'account_manager'
    || cargo.includes('account')
    || cargo.includes('gestor de projetos')
    || Boolean(member.profile_id && OPERATIONAL_COORDINATOR_PROFILE_IDS.has(member.profile_id))
  );
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
      return NextResponse.json({ success: true, status: 'ENVIADO', message: 'Este relatório já foi enviado aos responsáveis do Apollo.' });
    }

    const items = (Array.isArray(report.itens) ? report.itens : []) as WeeklyItem[];
    if (!items.length) return NextResponse.json({ error: 'O relatório não possui concessionárias.' }, { status: 400 });
    const corretorIds = Array.from(new Set(items.flatMap((item) => item.corretor_ids?.length ? item.corretor_ids : [item.corretor_id])));
    const [
      { data: corretores, error: corretoresError },
      { data: managers, error: managersError },
      { data: coordinators, error: coordinatorsError },
    ] = await Promise.all([
      supabaseAdmin
        .from('corretores')
        .select('id, nome, nome_empresa, time_operacional')
        .in('id', corretorIds),
      supabaseAdmin
        .from('profiles')
        .select('id, nome, tipo_usuario')
        .eq('tipo_usuario', 'account_manager')
        .in('status', ['active', 'ativo', 'Ativo']),
      supabaseAdmin
        .from('profiles')
        .select('id, nome, tipo_usuario')
        .in('id', Array.from(OPERATIONAL_COORDINATOR_PROFILE_IDS))
        .in('status', ['active', 'ativo', 'Ativo']),
    ]);
    if (corretoresError) return NextResponse.json({ error: corretoresError.message }, { status: 500 });
    if (managersError) return NextResponse.json({ error: managersError.message }, { status: 500 });
    if (coordinatorsError) return NextResponse.json({ error: coordinatorsError.message }, { status: 500 });

    const activeCoordinators = (coordinators || []) as ReportRecipientProfile[];
    const coordinatorProfileIds = new Set(activeCoordinators.map((profile) => profile.id));
    const recipients = Array.from(new Map(
      [...(managers || []), ...activeCoordinators]
        .map((profile) => [profile.id, profile as ReportRecipientProfile])
    ).values());
    const brokerRows = (corretores || []) as CorretorTeamRow[];
    // O Coordenador Operacional acompanha a operacao inteira do Apollo, nao
    // apenas as concessionarias onde ainda consta como antigo Account Manager.
    const itemsByRecipient = new Map<string, WeeklyItem[]>(
      activeCoordinators.map((profile) => [profile.id, [...items]])
    );
    const missing: string[] = [];

    items.forEach((item) => {
      const ids = item.corretor_ids?.length ? item.corretor_ids : [item.corretor_id];
      const teamMembers = brokerRows
        .filter((broker) => ids.includes(broker.id))
        .flatMap((broker) => Array.isArray(broker.time_operacional) ? broker.time_operacional as TeamMember[] : [])
        .filter(isReportRecipientMember);
      const assignedRecipients = recipients.filter((recipient) =>
        !coordinatorProfileIds.has(recipient.id) &&
        teamMembers.some((member) =>
          (member.profile_id && member.profile_id === recipient.id)
          || normalize(member.nome) === normalize(recipient.nome)
        )
      );

      if (!assignedRecipients.length && !activeCoordinators.length) {
        missing.push(item.concessionaria);
        return;
      }
      assignedRecipients.forEach((recipient) => {
        itemsByRecipient.set(recipient.id, [...(itemsByRecipient.get(recipient.id) || []), item]);
      });
    });

    if (missing.length) {
      return NextResponse.json({
        error: `Atribua um Account Manager ou Coordenador Operacional no time destas concessionárias: ${missing.join(', ')}.`,
      }, { status: 400 });
    }

    const period = `${report.data_inicio} a ${report.data_fim}`;
    const notifications = recipients
      .filter((recipient) => itemsByRecipient.has(recipient.id))
      .map((recipient) => {
        const recipientItems = itemsByRecipient.get(recipient.id) || [];
        const content = recipientItems
          .map((item) => `${item.concessionaria}\n${item.mensagem}`)
          .join('\n\n--------------------\n\n');
        return {
          titulo: 'Relatório semanal de tráfego recebido',
          mensagem: `${scopedProfile.nome || 'O gestor de tráfego'} enviou o relatório de ${period}.\n\n${content}`,
          remetente_profile_id: guard.profile.id,
          destinatario_profile_id: recipient.id,
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
        account_manager_ids: Array.from(itemsByRecipient.keys()),
        recipient_profile_ids: Array.from(itemsByRecipient.keys()),
        concessionarias: items.map((item) => item.concessionaria),
      },
    });

    return NextResponse.json({
      success: true,
      status: 'ENVIADO',
      message: `Relatório enviado para ${itemsByRecipient.size} responsável(is) do Apollo.`,
    });
  } catch (error: unknown) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Erro ao enviar relatório para os responsáveis do Apollo.',
    }, { status: 500 });
  }
}
