import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { rateLimit, requireApiUser, writeAuditLog } from '@/lib/api/security';

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
const TEAM = 'apollo';

function getCurrentMonthKey() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === 'year')?.value || String(new Date().getFullYear());
  const month = parts.find((part) => part.type === 'month')?.value || String(new Date().getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function previousMonthKey(monthKey: string) {
  const [year, month] = monthKey.split('-').map(Number);
  const date = new Date(year, month - 2, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function monthDeadline(monthKey: string) {
  const [year, month] = monthKey.split('-').map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
}

function monthLabel(monthKey: string) {
  const [year, month] = monthKey.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString('pt-BR', {
    month: 'long',
    year: 'numeric',
  });
}

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

async function loadMonthSnapshot(month: string) {
  const [metaRes, objectivesRes, pointsRes, salesRes] = await Promise.all([
    supabaseAdmin
      .from('equipe_metas')
      .select('*')
      .eq('equipe', TEAM)
      .eq('mes', month)
      .maybeSingle(),
    supabaseAdmin
      .from('equipe_objetivos')
      .select('*')
      .eq('equipe', TEAM)
      .eq('mes', month),
    supabaseAdmin
      .from('equipe_pontos')
      .select('pontos')
      .eq('equipe', TEAM)
      .eq('mes', month),
    supabaseAdmin
      .from('equipe_vendas')
      .select('*')
      .eq('equipe', TEAM)
      .eq('mes', month),
  ]);

  if (metaRes.error || objectivesRes.error || pointsRes.error || salesRes.error) return null;

  const objectives = objectivesRes.data || [];
  const sales = salesRes.data || [];
  const points = pointsRes.data || [];
  const totalVendas = sales.reduce((sum: number, sale: any) => sum + Number(sale.valor || 0), 0);
  const totalObjetivos = objectives.reduce((sum: number, item: any) => sum + Number(item.valor_estimado || 0), 0);
  const realizadoObjetivos = objectives
    .filter((item: any) => item.status === 'feito')
    .reduce((sum: number, item: any) => sum + Number(item.valor_estimado || 0), 0);
  const metaValor = Number(metaRes.data?.meta_valor || 0);
  const realizadoTotal = realizadoObjetivos + totalVendas;

  return {
    month,
    label: monthLabel(month),
    meta_valor: metaValor,
    prazo: metaRes.data?.prazo || monthDeadline(month),
    totalObjetivos,
    realizadoObjetivos,
    totalVendas,
    realizadoTotal,
    totalPontos: points.reduce((sum: number, point: any) => sum + Number(point.pontos || 0), 0),
    objectivesCount: objectives.length,
    salesCount: sales.length,
    progress: metaValor > 0 ? Math.min(100, Math.round((realizadoTotal / metaValor) * 100)) : 0,
    hasData: Boolean(metaRes.data || objectives.length || sales.length || points.length),
  };
}

export async function GET(request: Request) {
  const currentMonth = getCurrentMonthKey();
  const previousMonth = previousMonthKey(currentMonth);
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
      .eq('mes', currentMonth)
      .maybeSingle(),
    supabaseAdmin
      .from('equipe_objetivos')
      .select('*')
      .eq('equipe', 'apollo')
      .eq('mes', currentMonth)
      .order('created_at', { ascending: true }),
    supabaseAdmin
      .from('equipe_pontos')
      .select('id, profile_id, pontos, motivo, created_at, profiles:profile_id(nome, foto_url)')
      .eq('equipe', 'apollo')
      .eq('mes', currentMonth)
      .order('created_at', { ascending: false }),
    supabaseAdmin
      .from('equipe_vendas')
      .select('*')
      .eq('equipe', 'apollo')
      .eq('mes', currentMonth)
      .order('created_at', { ascending: false }),
  ]);

  if (membersError) return NextResponse.json({ error: membersError.message }, { status: 500 });
  const hasTeamTables = !metaRes.error && !objectivesRes.error && !pointsRes.error;
  let auditEntries: any[] = [];

  if (!hasTeamTables || salesRes.error) {
    const auditRes = await supabaseAdmin
      .from('audit_logs')
      .select('action, entity_id, metadata, created_at')
      .in('action', ['team.objective.create', 'team.objective.update', 'team.objective.delete', 'team.points.add', 'team.points.delete', 'team.meta.update', 'team.sale.create', 'team.sale.update', 'team.sale.delete'])
      .order('created_at', { ascending: false })
      .limit(500);

    if (!auditRes.error) {
      auditEntries = (auditRes.data || []).filter((entry: any) =>
        entry.metadata?.equipe === 'apollo' && entry.metadata?.mes === currentMonth
      );
    }
  }

  const deletedObjectiveIds = new Set(
    auditEntries
      .filter((entry: any) => entry.action === 'team.objective.delete')
      .map((entry: any) => String(entry.entity_id || entry.metadata?.objective_id || ''))
      .filter(Boolean)
  );

  const latestMetaAudit = auditEntries.find((entry: any) => entry.action === 'team.meta.update');
  const meta = hasTeamTables && metaRes.data
    ? metaRes.data
    : {
        equipe: 'apollo',
        mes: currentMonth,
        meta_valor: latestMetaAudit?.metadata?.meta_valor || 0,
        prazo: latestMetaAudit?.metadata?.prazo || monthDeadline(currentMonth),
      };

  let objectives = hasTeamTables && objectivesRes.data?.length
    ? objectivesRes.data
    : !hasTeamTables ? DEFAULT_OBJECTIVES.map(([titulo, valor]) => ({
        id: String(titulo),
        equipe: 'apollo',
        mes: currentMonth,
        titulo,
        valor_estimado: valor,
        status: 'aberto',
      })) : [];

  if (!hasTeamTables) {
    const createdObjectives = auditEntries
      .filter((entry: any) => entry.action === 'team.objective.create')
      .slice()
      .reverse()
      .map((entry: any) => ({
        id: String(entry.entity_id || entry.metadata?.objective_id || `custom:${entry.metadata?.titulo}`),
        equipe: 'apollo',
        mes: currentMonth,
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
    const latestTitulo = new Map<string, string>();
    const latestValor = new Map<string, number>();

    auditEntries
      .filter((entry: any) => entry.action === 'team.objective.update')
      .forEach((entry: any) => {
        const objectiveId = String(entry.entity_id || entry.metadata?.objective_id || '');
        if (!objectiveId) return;

        const status = String(entry.metadata?.status || '');
        if (!latestStatus.has(objectiveId) && ['aberto', 'em_andamento', 'feito'].includes(status)) {
          latestStatus.set(objectiveId, status);
        }

        const titulo = String(entry.metadata?.titulo || '').trim();
        if (!latestTitulo.has(objectiveId) && titulo) {
          latestTitulo.set(objectiveId, titulo);
        }

        const valor = entry.metadata?.valor_estimado !== undefined ? Number(entry.metadata.valor_estimado) : undefined;
        if (!latestValor.has(objectiveId) && valor !== undefined && Number.isFinite(valor)) {
          latestValor.set(objectiveId, valor);
        }
      });

    objectives = objectives.map((objective: any) => ({
      ...objective,
      status: latestStatus.get(String(objective.id)) || objective.status,
      titulo: latestTitulo.get(String(objective.id)) || objective.titulo,
      valor_estimado: latestValor.has(String(objective.id)) ? latestValor.get(String(objective.id))! : objective.valor_estimado,
    }));
  }

  // Filter out deleted objectives in both standard/fallback modes if audit log lists them as deleted
  objectives = objectives.filter((objective: any) => !deletedObjectiveIds.has(String(objective.id)));

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
  const pointDescriptionsByProfile = new Map<string, Array<{ id: string; pontos: number; motivo: string; created_at: string }>>();
  const deletedPointIds = new Set(
    auditEntries
      .filter((entry: any) => entry.action === 'team.points.delete')
      .map((entry: any) => String(entry.entity_id || entry.metadata?.point_id || ''))
      .filter(Boolean)
  );

  function addPointDescription(pointId: string, profileId: string, pontos: number, motivo: string, createdAt: string) {
    if (!profileId || !motivo) return;
    if (pointId && deletedPointIds.has(pointId)) return;
    const current = pointDescriptionsByProfile.get(profileId) || [];
    current.push({ id: pointId, pontos, motivo, created_at: createdAt });
    pointDescriptionsByProfile.set(profileId, current.slice(0, 4));
  }

  if (hasTeamTables) {
    (pointsRes.data || []).forEach((point: any) => {
      if (deletedPointIds.has(String(point.id || ''))) return;
      pointsByProfile.set(point.profile_id, (pointsByProfile.get(point.profile_id) || 0) + Number(point.pontos || 0));
      addPointDescription(
        String(point.id || ''),
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
        const pointId = String(entry.metadata?.point_id || entry.entity_id || '');
        if (deletedPointIds.has(pointId)) return;
        const profileId = String(entry.metadata?.profile_id || entry.entity_id || '');
        if (!profileId) return;
        pointsByProfile.set(profileId, (pointsByProfile.get(profileId) || 0) + Number(entry.metadata?.pontos || 0));
        addPointDescription(
          pointId,
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

  const deletedSaleIds = new Set(
    auditEntries
      .filter((entry: any) => entry.action === 'team.sale.delete')
      .map((entry: any) => String(entry.entity_id || entry.metadata?.sale_id || ''))
      .filter(Boolean)
  );

  const sales = !salesRes.error
    ? (salesRes.data || [])
        .filter((sale: any) => !deletedSaleIds.has(String(sale.id || '')))
    : (() => {
        let fallbackSales = auditEntries
          .filter((entry: any) => entry.action === 'team.sale.create')
          .slice()
          .reverse()
          .map((entry: any) => ({
            id: String(entry.entity_id || entry.metadata?.sale_id || `sale:${entry.created_at}`),
            equipe: 'apollo',
            mes: currentMonth,
            nome: String(entry.metadata?.nome || ''),
            vendido: String(entry.metadata?.vendido || ''),
            valor: Number(entry.metadata?.valor || 0),
            created_at: entry.created_at,
          }));

        const latestSaleNome = new Map<string, string>();
        const latestSaleVendido = new Map<string, string>();
        const latestSaleValor = new Map<string, number>();

        auditEntries
          .filter((entry: any) => entry.action === 'team.sale.update')
          .forEach((entry: any) => {
            const saleId = String(entry.entity_id || entry.metadata?.sale_id || '');
            if (!saleId) return;

            const nome = String(entry.metadata?.nome || '').trim();
            if (!latestSaleNome.has(saleId) && nome) {
              latestSaleNome.set(saleId, nome);
            }

            const vendido = String(entry.metadata?.vendido || '').trim();
            if (!latestSaleVendido.has(saleId) && vendido) {
              latestSaleVendido.set(saleId, vendido);
            }

            const valor = entry.metadata?.valor !== undefined ? Number(entry.metadata.valor) : undefined;
            if (!latestSaleValor.has(saleId) && valor !== undefined && Number.isFinite(valor)) {
              latestSaleValor.set(saleId, valor);
            }
          });

        return fallbackSales
          .map((sale: any) => ({
            ...sale,
            nome: latestSaleNome.get(String(sale.id)) || sale.nome,
            vendido: latestSaleVendido.get(String(sale.id)) || sale.vendido,
            valor: latestSaleValor.has(String(sale.id)) ? latestSaleValor.get(String(sale.id))! : sale.valor,
          }))
          .filter((sale: any) => !deletedSaleIds.has(String(sale.id || '')));
      })();

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
  const deadline = new Date(`${meta.prazo || monthDeadline(currentMonth)}T23:59:59-03:00`);
  const daysRemaining = Math.max(0, Math.ceil((deadline.getTime() - Date.now()) / 86400000));
  const metaValue = Number(meta.meta_valor || 0);
  const previousMonthSnapshot = await loadMonthSnapshot(previousMonth);
  const dailyMessages = members.map((member: any, index: number) => {
    const firstName = String(member.nome || 'time').split(' ')[0];
    const metaLabel = metaValue > 0
      ? `meta de ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(metaValue)}`
      : 'nova meta do mes';
    const variants = [
      `${firstName}, faltam ${daysRemaining} dias. Uma acao bem feita hoje aproxima o Apollo da ${metaLabel}.`,
      `${firstName}, hoje e dia de empurrar o placar. O ranking muda quando cada entrega vira ponto.`,
      `${firstName}, foco no que destrava receita: resolver rapido, registrar certo e puxar o proximo objetivo.`,
      `${firstName}, o Apollo vence no detalhe. Mais um passo hoje deixa a meta muito mais perto.`,
    ];
    return { profile_id: member.id, text: variants[(new Date().getDate() + index) % variants.length] };
  });

  return NextResponse.json({
    month: currentMonth,
    monthLabel: monthLabel(currentMonth),
    previousMonth: previousMonthSnapshot,
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
      faltanteMeta: Math.max(0, metaValue - realizadoTotal),
      totalPontos,
      daysRemaining,
      progress: metaValue > 0 ? Math.min(100, Math.round((realizadoTotal / metaValue) * 100)) : 0,
      forecastProgress: metaValue > 0 ? Math.min(100, Math.round((previsaoObjetivos / metaValue) * 100)) : 0,
      dailyMessages,
    },
    isAdmin: guard.profile.tipo_usuario === 'admin',
    needsMonthlySetup: hasTeamTables && !metaRes.data,
    needsMigration: false,
  });
}

export async function POST(request: Request) {
  const currentMonth = getCurrentMonthKey();
  const limited = rateLimit(request, 'equipe:apollo:write', { limit: 60, windowMs: 10 * 60_000 });
  if (limited) return limited;

  const guard = await requireApiUser(request, ['admin']);
  if ('error' in guard) return guard.error;

  const body = await request.json();
  const action = String(body.action || '');

  if (action && action !== 'update_meta') {
    const { data: currentMeta, error: currentMetaError } = await supabaseAdmin
      .from('equipe_metas')
      .select('id')
      .eq('equipe', TEAM)
      .eq('mes', currentMonth)
      .maybeSingle();

    if (!currentMeta && !isTeamStorageError(currentMetaError)) {
      return NextResponse.json({ error: 'Configure a meta do mes antes de registrar objetivos, vendas ou pontuacoes.' }, { status: 400 });
    }
  }

  if (action === 'add_points') {
    const profileId = String(body.profile_id || '');
    const pontos = parseMoney(body.pontos);
    const motivo = String(body.motivo || '').trim();

    if (!profileId || !Number.isFinite(pontos) || pontos === 0) {
      return NextResponse.json({ error: 'Selecione um integrante e informe a pontuacao.' }, { status: 400 });
    }

    const { error } = await supabaseAdmin.from('equipe_pontos').insert([{
      equipe: 'apollo',
      mes: currentMonth,
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
        metadata: { equipe: 'apollo', mes: currentMonth, profile_id: profileId, pontos, motivo },
      });
      return NextResponse.json({ success: true });
    }

    await writeAuditLog(request, guard.profile, {
      action: 'team.points.add',
      entity_type: 'profile',
      entity_id: profileId,
      metadata: { equipe: 'apollo', mes: currentMonth, pontos, motivo },
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
      mes: currentMonth,
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
          mes: currentMonth,
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
      metadata: { equipe: 'apollo', mes: currentMonth, titulo, valor_estimado: valor },
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
      mes: currentMonth,
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
        metadata: { equipe: 'apollo', mes: currentMonth, sale_id: fallbackId, nome, vendido, valor },
      });
      return NextResponse.json({ success: true });
    }

    await writeAuditLog(request, guard.profile, {
      action: 'team.sale.create',
      entity_type: 'equipe_venda',
      metadata: { equipe: 'apollo', mes: currentMonth, nome, vendido, valor },
    });
    return NextResponse.json({ success: true });
  }

  if (action === 'delete_point') {
    const id = String(body.id || '');
    if (!id) return NextResponse.json({ error: 'Pontuacao invalida.' }, { status: 400 });

    if (UUID_RE.test(id)) {
      const { error } = await supabaseAdmin
        .from('equipe_pontos')
        .delete()
        .eq('id', id)
        .eq('equipe', 'apollo');

      if (error && !isTeamStorageError(error)) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }

    await writeAuditLog(request, guard.profile, {
      action: 'team.points.delete',
      entity_type: 'equipe_ponto',
      entity_id: id,
      metadata: { equipe: 'apollo', mes: currentMonth, point_id: id },
    });

    return NextResponse.json({ success: true });
  }

  if (action === 'delete_sale') {
    const id = String(body.id || '');
    if (!id) return NextResponse.json({ error: 'Venda invalida.' }, { status: 400 });

    if (UUID_RE.test(id)) {
      const { error } = await supabaseAdmin
        .from('equipe_vendas')
        .delete()
        .eq('id', id)
        .eq('equipe', 'apollo');

      if (error && !isTeamStorageError(error)) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }

    await writeAuditLog(request, guard.profile, {
      action: 'team.sale.delete',
      entity_type: 'equipe_venda',
      entity_id: id,
      metadata: { equipe: 'apollo', mes: currentMonth, sale_id: id },
    });

    return NextResponse.json({ success: true });
  }

  if (action === 'edit_sale') {
    const id = String(body.id || '');
    const nome = String(body.nome || '').trim();
    const vendido = String(body.vendido || '').trim();
    const valor = parseMoney(body.valor);

    if (!id) return NextResponse.json({ error: 'Venda invalida.' }, { status: 400 });
    if (!nome || !vendido || !Number.isFinite(valor) || valor <= 0) {
      return NextResponse.json({ error: 'Informe o cliente, o produto e o valor da venda.' }, { status: 400 });
    }

    if (!UUID_RE.test(id)) {
      await writeAuditLog(request, guard.profile, {
        action: 'team.sale.update',
        entity_type: 'equipe_venda',
        entity_id: id,
        metadata: { equipe: 'apollo', mes: currentMonth, sale_id: id, nome, vendido, valor },
      });
      return NextResponse.json({ success: true });
    }

    const { error } = await supabaseAdmin
      .from('equipe_vendas')
      .update({
        nome,
        vendido,
        valor,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('equipe', 'apollo');

    if (error) {
      if (!isTeamStorageError(error)) return NextResponse.json({ error: error.message }, { status: 500 });

      await writeAuditLog(request, guard.profile, {
        action: 'team.sale.update',
        entity_type: 'equipe_venda',
        entity_id: id,
        metadata: { equipe: 'apollo', mes: currentMonth, sale_id: id, nome, vendido, valor },
      });
      return NextResponse.json({ success: true });
    }

    await writeAuditLog(request, guard.profile, {
      action: 'team.sale.update',
      entity_type: 'equipe_venda',
      entity_id: id,
      metadata: { equipe: 'apollo', mes: currentMonth, nome, vendido, valor },
    });

    return NextResponse.json({ success: true });
  }

  if (action === 'delete_objective') {
    const id = String(body.id || '');
    if (!id) return NextResponse.json({ error: 'Objetivo invalido.' }, { status: 400 });

    if (UUID_RE.test(id)) {
      const { error } = await supabaseAdmin
        .from('equipe_objetivos')
        .delete()
        .eq('id', id)
        .eq('equipe', 'apollo');

      if (error && !isTeamStorageError(error)) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }

    await writeAuditLog(request, guard.profile, {
      action: 'team.objective.delete',
      entity_type: 'equipe_objetivo',
      entity_id: id,
      metadata: { equipe: 'apollo', mes: currentMonth, objective_id: id },
    });

    return NextResponse.json({ success: true });
  }

  if (action === 'update_objective') {
    const id = String(body.id || '');
    if (!id) return NextResponse.json({ error: 'Objetivo invalido.' }, { status: 400 });

    const status = body.status !== undefined ? String(body.status) : undefined;
    const titulo = body.titulo !== undefined ? String(body.titulo).trim() : undefined;
    const valorEstimado = body.valor_estimado !== undefined ? parseMoney(body.valor_estimado) : undefined;

    if (status !== undefined && !['aberto', 'em_andamento', 'feito'].includes(status)) {
      return NextResponse.json({ error: 'Status invalido.' }, { status: 400 });
    }
    if (titulo !== undefined && !titulo) {
      return NextResponse.json({ error: 'Titulo invalido.' }, { status: 400 });
    }
    if (valorEstimado !== undefined && (!Number.isFinite(valorEstimado) || valorEstimado <= 0)) {
      return NextResponse.json({ error: 'Valor estimado invalido.' }, { status: 400 });
    }

    const metadata: any = { equipe: 'apollo', mes: currentMonth, objective_id: id };
    if (status !== undefined) metadata.status = status;
    if (titulo !== undefined) metadata.titulo = titulo;
    if (valorEstimado !== undefined) metadata.valor_estimado = valorEstimado;

    if (!UUID_RE.test(id)) {
      await writeAuditLog(request, guard.profile, {
        action: 'team.objective.update',
        entity_type: 'equipe_objetivo',
        entity_id: id,
        metadata,
      });
      return NextResponse.json({ success: true });
    }

    const updateData: any = { updated_at: new Date().toISOString() };
    if (status !== undefined) updateData.status = status;
    if (titulo !== undefined) updateData.titulo = titulo;
    if (valorEstimado !== undefined) updateData.valor_estimado = valorEstimado;

    const { error } = await supabaseAdmin
      .from('equipe_objetivos')
      .update(updateData)
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
        metadata,
      });
      return NextResponse.json({ success: true });
    }

    await writeAuditLog(request, guard.profile, {
      action: 'team.objective.update',
      entity_type: 'equipe_objetivo',
      entity_id: id,
      metadata,
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
        mes: currentMonth,
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
        metadata: { equipe: 'apollo', mes: currentMonth, meta_valor: metaValor, prazo },
      });
      return NextResponse.json({ success: true });
    }
    await writeAuditLog(request, guard.profile, {
      action: 'team.meta.update',
      entity_type: 'equipe_meta',
      metadata: { equipe: 'apollo', mes: currentMonth, meta_valor: metaValor, prazo },
    });
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: 'Acao invalida.' }, { status: 400 });
}
