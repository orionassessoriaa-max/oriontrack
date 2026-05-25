import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { requireApiUser, writeAuditLog } from '@/lib/api/security';

const APOLLO_MONTH = '2026-05';
const DEFAULT_OBJECTIVES = [
  ['Atual', 1500],
  ['Deltreggia', 1500],
  ['Inorave', 1100],
  ['BLM (TCV)', 5000],
  ['Inova Suprema (TCV)', 5000],
  ['Priorize', 1300],
  ['Ligamar', 10000],
];

function canReadTeam(role: string) {
  return ['admin', 'gestor_trafego', 'designer', 'account_manager'].includes(role);
}

export async function GET(request: Request) {
  const guard = await requireApiUser(request);
  if ('error' in guard) return guard.error;
  if (!canReadTeam(guard.profile.tipo_usuario)) {
    return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  }
  if (guard.profile.tipo_usuario !== 'admin' && guard.profile.equipe_orion !== 'apollo') {
    return NextResponse.json({ error: 'Este painel pertence ao time Apollo.' }, { status: 403 });
  }

  const [membersRes, metaRes, objectivesRes, pointsRes] = await Promise.all([
    supabaseAdmin
      .from('profiles')
      .select('id, nome, email, email_real, tipo_usuario, foto_url, equipe_orion, is_admin_master')
      .in('tipo_usuario', ['admin', 'gestor_trafego', 'designer', 'account_manager'])
      .in('status', ['active', 'ativo', 'Ativo'])
      .order('nome', { ascending: true }),
    supabaseAdmin
      .from('equipe_metas')
      .select('*')
      .eq('equipe', 'apollo')
      .eq('mes', APOLLO_MONTH)
      .maybeSingle(),
    supabaseAdmin
      .from('equipe_objetivos')
      .select('*')
      .eq('equipe', 'apollo')
      .eq('mes', APOLLO_MONTH)
      .order('created_at', { ascending: true }),
    supabaseAdmin
      .from('equipe_pontos')
      .select('id, profile_id, pontos, motivo, created_at, profiles:profile_id(nome, foto_url)')
      .eq('equipe', 'apollo')
      .eq('mes', APOLLO_MONTH)
      .order('created_at', { ascending: false }),
  ]);

  if (membersRes.error) return NextResponse.json({ error: membersRes.error.message }, { status: 500 });
  if (metaRes.error) return NextResponse.json({ error: metaRes.error.message }, { status: 500 });
  if (objectivesRes.error) return NextResponse.json({ error: objectivesRes.error.message }, { status: 500 });
  if (pointsRes.error) return NextResponse.json({ error: pointsRes.error.message }, { status: 500 });

  const objectives = objectivesRes.data?.length
    ? objectivesRes.data
    : DEFAULT_OBJECTIVES.map(([titulo, valor]) => ({
        id: String(titulo),
        equipe: 'apollo',
        mes: APOLLO_MONTH,
        titulo,
        valor_estimado: valor,
        status: 'aberto',
      }));

  const rawMembers = (membersRes.data || []).filter((member: any) =>
    member.equipe_orion === 'apollo'
    || member.is_admin_master
    || String(member.email || '').toLowerCase() === 'ewerttonherculano@gmail.com'
    || String(member.email_real || '').toLowerCase() === 'ewerttonherculano@gmail.com'
  );

  const pointsByProfile = new Map<string, number>();
  (pointsRes.data || []).forEach((point: any) => {
    pointsByProfile.set(point.profile_id, (pointsByProfile.get(point.profile_id) || 0) + Number(point.pontos || 0));
  });

  const members = rawMembers.map((member: any) => ({
    ...member,
    pontos: pointsByProfile.get(member.id) || 0,
  })).sort((a: any, b: any) => b.pontos - a.pontos || a.nome.localeCompare(b.nome));

  const totalObjetivos = objectives.reduce((sum: number, item: any) => sum + Number(item.valor_estimado || 0), 0);
  const realizadoObjetivos = objectives
    .filter((item: any) => item.status === 'feito')
    .reduce((sum: number, item: any) => sum + Number(item.valor_estimado || 0), 0);
  const totalPontos = Array.from(pointsByProfile.values()).reduce((sum, value) => sum + value, 0);
  const deadline = new Date('2026-05-31T23:59:59-03:00');
  const daysRemaining = Math.max(0, Math.ceil((deadline.getTime() - Date.now()) / 86400000));
  const dailyMessages = members.map((member: any, index: number) => {
    const firstName = String(member.nome || 'time').split(' ')[0];
    const variants = [
      `${firstName}, faltam ${daysRemaining} dias. Uma acao bem feita hoje aproxima o Apollo da meta de R$ 50 mil.`,
      `${firstName}, hoje e dia de empurrar o placar. O ranking muda quando cada entrega vira ponto.`,
      `${firstName}, foco no que destrava receita: resolver rapido, registrar certo e puxar o proximo objetivo.`,
      `${firstName}, o Apollo vence no detalhe. Mais um passo hoje deixa a meta muito mais perto.`,
    ];
    return { profile_id: member.id, text: variants[(new Date().getDate() + index) % variants.length] };
  });

  return NextResponse.json({
    month: APOLLO_MONTH,
    meta: metaRes.data || { equipe: 'apollo', mes: APOLLO_MONTH, meta_valor: 50000, prazo: '2026-05-31' },
    objectives,
    points: pointsRes.data || [],
    members,
    summary: {
      totalObjetivos,
      realizadoObjetivos,
      totalPontos,
      daysRemaining,
      progress: Math.min(100, Math.round((realizadoObjetivos / 50000) * 100)),
      dailyMessages,
    },
    isAdmin: guard.profile.tipo_usuario === 'admin',
  });
}

export async function POST(request: Request) {
  const guard = await requireApiUser(request, ['admin']);
  if ('error' in guard) return guard.error;

  const body = await request.json();
  const action = String(body.action || '');

  if (action === 'add_points') {
    const profileId = String(body.profile_id || '');
    const pontos = Number(body.pontos || 0);
    const motivo = String(body.motivo || '').trim();

    if (!profileId || !Number.isFinite(pontos) || pontos === 0) {
      return NextResponse.json({ error: 'Selecione um integrante e informe a pontuacao.' }, { status: 400 });
    }

    const { error } = await supabaseAdmin.from('equipe_pontos').insert([{
      equipe: 'apollo',
      mes: APOLLO_MONTH,
      profile_id: profileId,
      pontos,
      motivo,
      created_by: guard.profile.id,
    }]);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await writeAuditLog(request, guard.profile, {
      action: 'team.points.add',
      entity_type: 'profile',
      entity_id: profileId,
      metadata: { equipe: 'apollo', mes: APOLLO_MONTH, pontos, motivo },
    });

    return NextResponse.json({ success: true });
  }

  if (action === 'create_objective') {
    const titulo = String(body.titulo || '').trim();
    const valor = Number(body.valor_estimado || 0);

    if (!titulo || !Number.isFinite(valor) || valor <= 0) {
      return NextResponse.json({ error: 'Informe o objetivo e o valor estimado.' }, { status: 400 });
    }

    const { error } = await supabaseAdmin.from('equipe_objetivos').insert([{
      equipe: 'apollo',
      mes: APOLLO_MONTH,
      titulo,
      valor_estimado: valor,
      created_by: guard.profile.id,
    }]);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await writeAuditLog(request, guard.profile, {
      action: 'team.objective.create',
      entity_type: 'equipe_objetivo',
      metadata: { equipe: 'apollo', mes: APOLLO_MONTH, titulo, valor_estimado: valor },
    });
    return NextResponse.json({ success: true });
  }

  if (action === 'update_objective') {
    const id = String(body.id || '');
    const status = String(body.status || 'aberto');
    if (!id || !['aberto', 'em_andamento', 'feito'].includes(status)) {
      return NextResponse.json({ error: 'Objetivo invalido.' }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from('equipe_objetivos')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('equipe', 'apollo');

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await writeAuditLog(request, guard.profile, {
      action: 'team.objective.update',
      entity_type: 'equipe_objetivo',
      entity_id: id,
      metadata: { equipe: 'apollo', mes: APOLLO_MONTH, status },
    });
    return NextResponse.json({ success: true });
  }

  if (action === 'update_meta') {
    const metaValor = Number(body.meta_valor || 0);
    const prazo = String(body.prazo || '').trim();
    if (!Number.isFinite(metaValor) || metaValor <= 0 || !prazo) {
      return NextResponse.json({ error: 'Informe a meta e o prazo.' }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from('equipe_metas')
      .upsert({
        equipe: 'apollo',
        mes: APOLLO_MONTH,
        meta_valor: metaValor,
        prazo,
        created_by: guard.profile.id,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'equipe,mes' });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await writeAuditLog(request, guard.profile, {
      action: 'team.meta.update',
      entity_type: 'equipe_meta',
      metadata: { equipe: 'apollo', mes: APOLLO_MONTH, meta_valor: metaValor, prazo },
    });
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: 'Acao invalida.' }, { status: 400 });
}
