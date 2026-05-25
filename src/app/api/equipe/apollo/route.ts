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

const KRIPTO_HUNTERS_FALLBACK_NAMES = ['pedro ghisolfi'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function canReadTeam(role: string) {
  return ['admin', 'gestor_trafego', 'designer', 'account_manager'].includes(role);
}

function parseMoney(value: unknown) {
  if (typeof value === 'number') return value;
  const normalized = String(value || '')
    .replace(/[^\d,.-]/g, '')
    .replace(/\.(?=\d{3}(?:\D|$))/g, '')
    .replace(',', '.');
  return Number(normalized || 0);
}

function isTeamStorageError(error: any) {
  const message = String(error?.message || '');
  const code = String(error?.code || '');
  return ['42P01', '42703', 'PGRST205', 'PGRST202'].includes(code)
    || message.includes('equipe_metas')
    || message.includes('equipe_objetivos')
    || message.includes('equipe_pontos')
    || message.includes('equipe_vendas')
    || message.includes('Could not find');
}

export async function GET(request: Request) {
  const guard = await requireApiUser(request);
  if ('error' in guard) return guard.error;
  if (!canReadTeam(guard.profile.tipo_usuario)) {
    return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  }
  if (guard.profile.tipo_usuario !== 'admin' && guard.profile.equipe_orion && guard.profile.equipe_orion !== 'apollo') {
    return NextResponse.json({ error: 'Este painel pertence ao time Apollo.' }, { status: 403 });
  }

  const membersRes = await supabaseAdmin
    .from('profiles')
    .select('id, nome, email, email_real, tipo_usuario, foto_url, equipe_orion, is_admin_master')
    .in('tipo_usuario', ['admin', 'gestor_trafego', 'designer', 'account_manager'])
    .in('status', ['active', 'ativo', 'Ativo'])
    .order('nome', { ascending: true });

  let membersData = membersRes.data || [];
  let membersError = membersRes.error;
  let missingTeamColumn = false;
  if (membersRes.error && String(membersRes.error.message || '').includes('equipe_orion')) {
    missingTeamColumn = true;
    const fallback = await supabaseAdmin
      .from('profiles')
      .select('id, nome, email, email_real, tipo_usuario, foto_url, is_admin_master')
      .in('tipo_usuario', ['admin', 'gestor_trafego', 'designer', 'account_manager'])
      .in('status', ['active', 'ativo', 'Ativo'])
      .order('nome', { ascending: true });
    membersData = (fallback.data || []).map((member: any) => ({ ...member, equipe_orion: null }));
    membersError = fallback.error;
  }

  const [metaRes, objectivesRes, pointsRes, salesRes] = await Promise.all([
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
    supabaseAdmin
      .from('equipe_vendas')
      .select('*')
      .eq('equipe', 'apollo')
      .eq('mes', APOLLO_MONTH)
      .order('created_at', { ascending: false }),
  ]);

  if (membersError) return NextResponse.json({ error: membersError.message }, { status: 500 });
  const hasTeamTables = !metaRes.error && !objectivesRes.error && !pointsRes.error;
  let auditEntries: any[] = [];

  if (!hasTeamTables || salesRes.error) {
    const auditRes = await supabaseAdmin
      .from('audit_logs')
      .select('action, entity_id, metadata, created_at')
      .in('action', ['team.objective.create', 'team.objective.update', 'team.points.add', 'team.meta.update', 'team.sale.create'])
      .order('created_at', { ascending: false })
      .limit(500);

    if (!auditRes.error) {
      auditEntries = (auditRes.data || []).filter((entry: any) =>
        entry.metadata?.equipe === 'apollo' && entry.metadata?.mes === APOLLO_MONTH
      );
    }
  }

  const latestMetaAudit = auditEntries.find((entry: any) => entry.action === 'team.meta.update');
  const meta = hasTeamTables && metaRes.data
    ? metaRes.data
    : {
        equipe: 'apollo',
        mes: APOLLO_MONTH,
        meta_valor: latestMetaAudit?.metadata?.meta_valor || 50000,
        prazo: latestMetaAudit?.metadata?.prazo || '2026-05-31',
      };

  let objectives = hasTeamTables && objectivesRes.data?.length
    ? objectivesRes.data
    : DEFAULT_OBJECTIVES.map(([titulo, valor]) => ({
        id: String(titulo),
        equipe: 'apollo',
        mes: APOLLO_MONTH,
        titulo,
        valor_estimado: valor,
        status: 'aberto',
      }));

  if (!hasTeamTables) {
    const createdObjectives = auditEntries
      .filter((entry: any) => entry.action === 'team.objective.create')
      .slice()
      .reverse()
      .map((entry: any) => ({
        id: String(entry.entity_id || entry.metadata?.objective_id || `custom:${entry.metadata?.titulo}`),
        equipe: 'apollo',
        mes: APOLLO_MONTH,
        titulo: String(entry.metadata?.titulo || 'Objetivo'),
        valor_estimado: Number(entry.metadata?.valor_estimado || 0),
        status: String(entry.metadata?.status || 'aberto'),
        created_at: entry.created_at,
      }));

    const objectiveIds = new Set(objectives.map((objective: any) => String(objective.id)));
    createdObjectives.forEach((objective: any) => {
      if (!objectiveIds.has(String(objective.id))) {
        objectiveIds.add(String(objective.id));
        objectives.push(objective);
      }
    });

    const latestStatus = new Map<string, string>();
    auditEntries
      .filter((entry: any) => entry.action === 'team.objective.update')
      .forEach((entry: any) => {
        const objectiveId = String(entry.entity_id || entry.metadata?.objective_id || '');
        const status = String(entry.metadata?.status || '');
        if (objectiveId && !latestStatus.has(objectiveId) && ['aberto', 'em_andamento', 'feito'].includes(status)) {
          latestStatus.set(objectiveId, status);
        }
      });

    objectives = objectives.map((objective: any) => ({
      ...objective,
      status: latestStatus.get(String(objective.id)) || objective.status,
    }));
  }

  const rawMembers = membersData.filter((member: any) => {
    const email = String(member.email || '').toLowerCase();
    const realEmail = String(member.email_real || '').toLowerCase();
    const name = String(member.nome || '').toLowerCase();
    const isMaster = member.is_admin_master || email === 'ewerttonherculano@gmail.com' || realEmail === 'ewerttonherculano@gmail.com';
    const belongsToKripto = KRIPTO_HUNTERS_FALLBACK_NAMES.some((blockedName) => name.includes(blockedName));

    if (belongsToKripto) return false;

    if (missingTeamColumn) {
      return isMaster || ['admin', 'gestor_trafego', 'designer', 'account_manager'].includes(member.tipo_usuario);
    }

    return member.equipe_orion === 'apollo' || isMaster;
  });

  const pointsByProfile = new Map<string, number>();
  const pointDescriptionsByProfile = new Map<string, Array<{ pontos: number; motivo: string; created_at: string }>>();

  function addPointDescription(profileId: string, pontos: number, motivo: string, createdAt: string) {
    if (!profileId || !motivo) return;
    const current = pointDescriptionsByProfile.get(profileId) || [];
    current.push({ pontos, motivo, created_at: createdAt });
    pointDescriptionsByProfile.set(profileId, current.slice(0, 4));
  }

  if (hasTeamTables) {
    (pointsRes.data || []).forEach((point: any) => {
      pointsByProfile.set(point.profile_id, (pointsByProfile.get(point.profile_id) || 0) + Number(point.pontos || 0));
      addPointDescription(
        String(point.profile_id || ''),
        Number(point.pontos || 0),
        String(point.motivo || ''),
        String(point.created_at || '')
      );
    });
  } else {
    auditEntries
      .filter((entry: any) => entry.action === 'team.points.add')
      .forEach((entry: any) => {
        const profileId = String(entry.entity_id || entry.metadata?.profile_id || '');
        if (!profileId) return;
        pointsByProfile.set(profileId, (pointsByProfile.get(profileId) || 0) + Number(entry.metadata?.pontos || 0));
        addPointDescription(
          profileId,
          Number(entry.metadata?.pontos || 0),
          String(entry.metadata?.motivo || ''),
          String(entry.created_at || '')
        );
      });
  }

  const members = rawMembers.map((member: any) => ({
    ...member,
    pontos: pointsByProfile.get(member.id) || 0,
    pontos_detalhes: pointDescriptionsByProfile.get(member.id) || [],
  })).sort((a: any, b: any) => b.pontos - a.pontos || a.nome.localeCompare(b.nome));

  const sales = !salesRes.error
    ? (salesRes.data || [])
    : auditEntries
        .filter((entry: any) => entry.action === 'team.sale.create')
        .slice()
        .reverse()
        .map((entry: any) => ({
          id: String(entry.entity_id || entry.metadata?.sale_id || `sale:${entry.created_at}`),
          equipe: 'apollo',
          mes: APOLLO_MONTH,
          nome: String(entry.metadata?.nome || ''),
          vendido: String(entry.metadata?.vendido || ''),
          valor: Number(entry.metadata?.valor || 0),
          created_at: entry.created_at,
        }));

  const totalVendas = sales.reduce((sum: number, sale: any) => sum + Number(sale.valor || 0), 0);
  const totalObjetivos = objectives.reduce((sum: number, item: any) => sum + Number(item.valor_estimado || 0), 0);
  const realizadoObjetivos = objectives
    .filter((item: any) => item.status === 'feito')
    .reduce((sum: number, item: any) => sum + Number(item.valor_estimado || 0), 0);
  const realizadoTotal = realizadoObjetivos + totalVendas;
  const emAndamentoObjetivos = objectives
    .filter((item: any) => item.status === 'em_andamento')
    .reduce((sum: number, item: any) => sum + Number(item.valor_estimado || 0), 0);
  const previsaoObjetivos = totalObjetivos;
  const previsaoAberta = Math.max(0, totalObjetivos - realizadoObjetivos);
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
    meta,
    objectives,
    sales,
    points: hasTeamTables ? pointsRes.data || [] : [],
    members,
    summary: {
      totalObjetivos,
      realizadoObjetivos,
      totalVendas,
      realizadoTotal,
      emAndamentoObjetivos,
      previsaoObjetivos,
      previsaoAberta,
      faltanteMeta: Math.max(0, Number(meta.meta_valor || 50000) - realizadoTotal),
      totalPontos,
      daysRemaining,
      progress: Math.min(100, Math.round((realizadoTotal / Number(meta.meta_valor || 50000)) * 100)),
      forecastProgress: Math.min(100, Math.round((previsaoObjetivos / Number(meta.meta_valor || 50000)) * 100)),
      dailyMessages,
    },
    isAdmin: guard.profile.tipo_usuario === 'admin',
    needsMigration: false,
  });
}

export async function POST(request: Request) {
  const guard = await requireApiUser(request, ['admin']);
  if ('error' in guard) return guard.error;

  const body = await request.json();
  const action = String(body.action || '');

  if (action === 'add_points') {
    const profileId = String(body.profile_id || '');
    const pontos = parseMoney(body.pontos);
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

    if (error) {
      if (!isTeamStorageError(error)) return NextResponse.json({ error: error.message }, { status: 500 });

      await writeAuditLog(request, guard.profile, {
        action: 'team.points.add',
        entity_type: 'profile',
        entity_id: profileId,
        metadata: { equipe: 'apollo', mes: APOLLO_MONTH, profile_id: profileId, pontos, motivo },
      });
      return NextResponse.json({ success: true });
    }

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
    const valor = parseMoney(body.valor_estimado);

    if (!titulo || !Number.isFinite(valor) || valor <= 0) {
      return NextResponse.json({ error: 'Informe o objetivo e o valor estimado.' }, { status: 400 });
    }

    const fallbackId = `custom:${Date.now()}:${titulo.toLowerCase().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')}`;

    const { error } = await supabaseAdmin.from('equipe_objetivos').insert([{
      equipe: 'apollo',
      mes: APOLLO_MONTH,
      titulo,
      valor_estimado: valor,
      created_by: guard.profile.id,
    }]);

    if (error) {
      if (!isTeamStorageError(error)) return NextResponse.json({ error: error.message }, { status: 500 });

      await writeAuditLog(request, guard.profile, {
        action: 'team.objective.create',
        entity_type: 'equipe_objetivo',
        entity_id: fallbackId,
        metadata: {
          equipe: 'apollo',
          mes: APOLLO_MONTH,
          objective_id: fallbackId,
          titulo,
          valor_estimado: valor,
          status: 'aberto',
        },
      });
      return NextResponse.json({ success: true });
    }
    await writeAuditLog(request, guard.profile, {
      action: 'team.objective.create',
      entity_type: 'equipe_objetivo',
      metadata: { equipe: 'apollo', mes: APOLLO_MONTH, titulo, valor_estimado: valor },
    });
    return NextResponse.json({ success: true });
  }

  if (action === 'create_sale') {
    const nome = String(body.nome || '').trim();
    const vendido = String(body.vendido || '').trim();
    const valor = parseMoney(body.valor);

    if (!nome || !vendido || !Number.isFinite(valor) || valor <= 0) {
      return NextResponse.json({ error: 'Informe o cliente, o produto e o valor da venda.' }, { status: 400 });
    }

    const fallbackId = `sale:${Date.now()}:${nome.toLowerCase().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')}`;
    const { error } = await supabaseAdmin.from('equipe_vendas').insert([{
      equipe: 'apollo',
      mes: APOLLO_MONTH,
      nome,
      vendido,
      valor,
      created_by: guard.profile.id,
    }]);

    if (error) {
      if (!isTeamStorageError(error)) return NextResponse.json({ error: error.message }, { status: 500 });

      await writeAuditLog(request, guard.profile, {
        action: 'team.sale.create',
        entity_type: 'equipe_venda',
        entity_id: fallbackId,
        metadata: { equipe: 'apollo', mes: APOLLO_MONTH, sale_id: fallbackId, nome, vendido, valor },
      });
      return NextResponse.json({ success: true });
    }

    await writeAuditLog(request, guard.profile, {
      action: 'team.sale.create',
      entity_type: 'equipe_venda',
      metadata: { equipe: 'apollo', mes: APOLLO_MONTH, nome, vendido, valor },
    });
    return NextResponse.json({ success: true });
  }

  if (action === 'update_objective') {
    const id = String(body.id || '');
    const status = String(body.status || 'aberto');
    if (!id || !['aberto', 'em_andamento', 'feito'].includes(status)) {
      return NextResponse.json({ error: 'Objetivo invalido.' }, { status: 400 });
    }

    if (!UUID_RE.test(id)) {
      await writeAuditLog(request, guard.profile, {
        action: 'team.objective.update',
        entity_type: 'equipe_objetivo',
        entity_id: id,
        metadata: { equipe: 'apollo', mes: APOLLO_MONTH, objective_id: id, status },
      });
      return NextResponse.json({ success: true });
    }

    const { error } = await supabaseAdmin
      .from('equipe_objetivos')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('equipe', 'apollo');

    if (error) {
      const canFallback = ['42P01', '42703', 'PGRST205', 'PGRST202'].includes(String(error.code || ''))
        || String(error.message || '').includes('equipe_objetivos');
      if (!canFallback) return NextResponse.json({ error: error.message }, { status: 500 });

      await writeAuditLog(request, guard.profile, {
        action: 'team.objective.update',
        entity_type: 'equipe_objetivo',
        entity_id: id,
        metadata: { equipe: 'apollo', mes: APOLLO_MONTH, objective_id: id, status },
      });
      return NextResponse.json({ success: true });
    }
    await writeAuditLog(request, guard.profile, {
      action: 'team.objective.update',
      entity_type: 'equipe_objetivo',
      entity_id: id,
      metadata: { equipe: 'apollo', mes: APOLLO_MONTH, status },
    });
    return NextResponse.json({ success: true });
  }

  if (action === 'update_meta') {
    const metaValor = parseMoney(body.meta_valor);
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

    if (error) {
      if (!isTeamStorageError(error)) return NextResponse.json({ error: error.message }, { status: 500 });

      await writeAuditLog(request, guard.profile, {
        action: 'team.meta.update',
        entity_type: 'equipe_meta',
        metadata: { equipe: 'apollo', mes: APOLLO_MONTH, meta_valor: metaValor, prazo },
      });
      return NextResponse.json({ success: true });
    }
    await writeAuditLog(request, guard.profile, {
      action: 'team.meta.update',
      entity_type: 'equipe_meta',
      metadata: { equipe: 'apollo', mes: APOLLO_MONTH, meta_valor: metaValor, prazo },
    });
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: 'Acao invalida.' }, { status: 400 });
}
