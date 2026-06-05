import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { evolutionFetch, getEvolutionInstanceApiKey, normalizePhone } from '@/lib/evolution';
import { sendApoloWhatsApp } from '@/lib/apoloNotifications';

type CorretorMeta = {
  id: string;
  nome: string;
  gestor_trafego_id: string | null;
  meta_ad_account_id: string | null;
  meta_ad_account_name: string | null;
  operadoras_info?: any;
};

function normalizeAccountId(accountId: string) {
  return accountId.replace(/^act_/, '');
}

function parseMoneyFromMetaText(value?: string | null) {
  const text = String(value || '');
  const match = text.match(/(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*(?:,\d{2})|\d+(?:\.\d{2})?)/);
  if (!match?.[1]) return null;

  const normalized = match[1].includes(',')
    ? match[1].replace(/\./g, '').replace(',', '.')
    : match[1];

  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : null;
}

function currentMonthRange() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  const local = new Date(now.getTime() - offset);
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);

  return {
    since: new Date(firstDay.getTime() - offset).toISOString().slice(0, 10),
    until: local.toISOString().slice(0, 10),
  };
}

async function fetchSheetLeadCount(corretorId: string, since: string, until: string) {
  const start = `${since}T00:00:00.000-03:00`;
  const end = `${until}T23:59:59.999-03:00`;

  const { count, error } = await supabaseAdmin
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('corretor_id', corretorId)
    .gte('data_entrada', start)
    .lte('data_entrada', end);

  if (error) throw new Error(`Erro ao contar leads da planilha: ${error.message}`);
  return count || 0;
}

async function fetchAccountMetrics(corretor: CorretorMeta, since: string, until: string, accessToken: string, graphVersion: string) {
  const accountId = normalizeAccountId(String(corretor.meta_ad_account_id));
  const insightsUrl = new URL(`https://graph.facebook.com/${graphVersion}/act_${accountId}/insights`);
  insightsUrl.searchParams.set('fields', 'spend,ctr');
  insightsUrl.searchParams.set('level', 'account');
  insightsUrl.searchParams.set('time_range', JSON.stringify({ since, until }));
  insightsUrl.searchParams.set('access_token', accessToken);

  const accountUrl = new URL(`https://graph.facebook.com/${graphVersion}/act_${accountId}`);
  accountUrl.searchParams.set('fields', 'balance,currency,amount_spent,funding_source_details');
  accountUrl.searchParams.set('access_token', accessToken);

  const [insightsResponse, accountResponse, sheetLeads] = await Promise.all([
    fetch(insightsUrl.toString(), { cache: 'no-store' }),
    fetch(accountUrl.toString(), { cache: 'no-store' }),
    fetchSheetLeadCount(corretor.id, since, until),
  ]);

  const [insightsPayload, accountPayload] = await Promise.all([
    insightsResponse.json(),
    accountResponse.json(),
  ]);

  if (!insightsResponse.ok || insightsPayload.error) {
    throw new Error(insightsPayload.error?.message || 'Erro ao consultar metricas Meta.');
  }

  const row = insightsPayload.data?.[0] || {};
  const spend = Number(row.spend || 0);
  const leads = sheetLeads;
  const cpl = leads > 0 ? spend / leads : null;
  const ctr = Number(row.ctr || 0);
  const rawBalance = accountPayload?.balance;
  const balance = rawBalance === undefined || rawBalance === null ? null : Number(rawBalance) / 100;
  const fundingDetails = accountPayload?.funding_source_details;
  const fundingText = JSON.stringify(fundingDetails || {}).toLowerCase();
  const isCard = fundingText.includes('card') || fundingText.includes('cart') || fundingText.includes('visa') || fundingText.includes('mastercard') || fundingText.includes('amex');
  const displayBalance = parseMoneyFromMetaText(fundingDetails?.display_string);
  const effectiveBalance = displayBalance ?? balance;
  const formaPagamento = isCard
    ? 'Cartao'
    : fundingDetails?.display_string || fundingDetails?.type || (balance !== null ? 'Saldo pre-pago' : 'Nao informado');

  // Dynamic alert thresholds per broker
  const cplLimit = Number(corretor.operadoras_info?.alerta_limite_cpl ?? 25);
  const balanceLimit = Number(corretor.operadoras_info?.alerta_limite_saldo ?? 100);

  return {
    corretor_id: corretor.id,
    corretor_nome: corretor.nome,
    gestor_trafego_id: corretor.gestor_trafego_id,
    meta_ad_account_id: corretor.meta_ad_account_id,
    meta_ad_account_name: corretor.meta_ad_account_name,
    spend,
    leads,
    cpl,
    ctr,
    saldo: isCard ? null : effectiveBalance,
    currency: accountPayload?.currency || 'BRL',
    forma_pagamento: formaPagamento,
    alerta_cpl_alto: cpl !== null && cpl > cplLimit,
    alerta_saldo_baixo: !isCard && effectiveBalance !== null && effectiveBalance < balanceLimit,
    error: undefined as string | undefined,
    operadoras_info: corretor.operadoras_info,
  };
}

export async function POST(request: Request) {
  try {
    // 1. Validar Token de Segurança da Cron
    const authHeader = request.headers.get('Authorization');
    const cronSecret = process.env.CRON_SECRET || process.env.EVOLUTION_API_KEY;
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
    }

    const accessToken = process.env.META_ACCESS_TOKEN;
    if (!accessToken) {
      return NextResponse.json({ error: 'META_ACCESS_TOKEN não configurado no servidor.' }, { status: 500 });
    }

    // 2. Coletar todos os corretores que possuem conta vinculada
    const { data: corretores, error: dbError } = await supabaseAdmin
      .from('corretores')
      .select('id, nome, gestor_trafego_id, meta_ad_account_id, meta_ad_account_name, operadoras_info')
      .not('meta_ad_account_id', 'is', null)
      .not('gestor_trafego_id', 'is', null);

    if (dbError) throw dbError;

    if (!corretores || corretores.length === 0) {
      return NextResponse.json({ success: true, message: 'Nenhuma conta vinculada encontrada.' });
    }

    // 3. Buscar gasto mensal do Meta Ads e dividir pelos leads importados no Orion no mesmo mes.
    const { since, until } = currentMonthRange();
    const graphVersion = process.env.META_GRAPH_VERSION || 'v23.0';

    const settled = await Promise.allSettled(
      corretores.map((c) => fetchAccountMetrics(c, since, until, accessToken, graphVersion))
    );

    const accountsWithMetrics = settled.map((result, index) => {
      if (result.status === 'fulfilled') return result.value;
      const c = corretores[index];
      return {
        corretor_id: c.id,
        corretor_nome: c.nome,
        gestor_trafego_id: c.gestor_trafego_id,
        meta_ad_account_id: c.meta_ad_account_id,
        meta_ad_account_name: c.meta_ad_account_name,
        spend: 0,
        leads: 0,
        cpl: null,
        ctr: 0,
        saldo: null,
        currency: 'BRL',
        forma_pagamento: 'Não informado',
        alerta_cpl_alto: false,
        alerta_saldo_baixo: false,
        error: result.reason?.message || 'Erro ao consultar a conta.',
        operadoras_info: c.operadoras_info,
      };
    });

    // 4. Agrupar os alertas críticos por Gestor de Tráfego
    const { data: allProfiles, error: profilesError } = await supabaseAdmin
      .from('profiles')
      .select('id, nome, telefone, corretor_id, tipo_usuario')
      .in('status', ['active', 'ativo', 'Ativo']);

    if (profilesError) throw profilesError;

    const alertsByGestor: Record<string, string[]> = {};
    const balanceAlertsByCorretor: Record<string, string[]> = {};

    accountsWithMetrics.forEach((acc) => {
      if (!acc.gestor_trafego_id) return;

      const isCard = String(acc.forma_pagamento || '').toLowerCase().includes('cartao') || 
                     String(acc.forma_pagamento || '').toLowerCase().includes('cartão') ||
                     String(acc.forma_pagamento || '').toLowerCase().includes('card') ||
                     String(acc.forma_pagamento || '').toLowerCase().includes('visa') ||
                     String(acc.forma_pagamento || '').toLowerCase().includes('mastercard');
      const hasPaymentError = acc.error && (
        /pagamento|payment|recusad|failed|declined|settle|cobrança|cobranca|cartao|cartão|card|invoice|unpaid|error/i.test(String(acc.error))
      );

      // Fetch dynamic thresholds for message formatting
      const cplLimit = Number(acc.operadoras_info?.alerta_limite_cpl ?? 25);
      const balanceLimit = Number(acc.operadoras_info?.alerta_limite_saldo ?? 100);

      let alertMessage = '';

      if (acc.cpl !== null && acc.cpl > cplLimit) {
        alertMessage = `🔴 CPL ALTO: R$ ${acc.cpl.toFixed(2).replace('.', ',')} (Meta de R$ ${cplLimit.toFixed(2).replace('.', ',')})`;
      } else if (isCard && hasPaymentError) {
        alertMessage = `🔴 ERRO NO PAGAMENTO: Cobrança falhou no cartão de crédito.`;
      } else if (!isCard && acc.saldo !== null && acc.saldo <= 0) {
        alertMessage = `🔴 SEM SALDO: Conta zerada, campanhas pausadas.`;
      } else if (!isCard && acc.saldo !== null && acc.saldo < balanceLimit) {
        alertMessage = `🟡 SALDO BAIXO: Restam R$ ${acc.saldo.toFixed(2).replace('.', ',')} (Abaixo de R$ ${balanceLimit.toFixed(2).replace('.', ',')})`;
      } else if (acc.error && !isCard) {
        alertMessage = `🟡 ERRO DE INTEGRAÇÃO: ${acc.error}`;
      }

      if (alertMessage) {
        const formattedAlert = `👉 *${acc.corretor_nome}* (${acc.meta_ad_account_name || acc.meta_ad_account_id})\n   ${alertMessage}`;
        if (!alertsByGestor[acc.gestor_trafego_id]) {
          alertsByGestor[acc.gestor_trafego_id] = [];
        }
        alertsByGestor[acc.gestor_trafego_id].push(formattedAlert);
      }

      const hasBalanceAlert = !isCard && (
        (acc.saldo !== null && acc.saldo < balanceLimit) ||
        Boolean(acc.error)
      );
      if (hasBalanceAlert) {
        const balanceText = alertMessage || `Revise o saldo da conta ${acc.meta_ad_account_name || acc.meta_ad_account_id}.`;
        if (!balanceAlertsByCorretor[acc.corretor_id]) balanceAlertsByCorretor[acc.corretor_id] = [];
        balanceAlertsByCorretor[acc.corretor_id].push(balanceText);
      }
    });

    // 5. Enviar as mensagens para cada gestor via WhatsApp
    const sendResults: any[] = [];
    const gestorIds = Object.keys(alertsByGestor);

    if (false && gestorIds.length > 0) {
      // Carregar os perfis dos gestores para obter os telefones
      const { data: gestores, error: gError } = await supabaseAdmin
        .from('profiles')
        .select('id, nome, telefone')
        .in('id', gestorIds);

      if (gError) throw gError;

      const evolutionInstance = 'apolo_master_sender';
      const evolutionApiKey = await getEvolutionInstanceApiKey(evolutionInstance);

      for (const gestor of (gestores || [])) {
        const rawPhone = gestor.telefone;
        const normalizedPhone = normalizePhone(rawPhone);
        
        if (!normalizedPhone) {
          sendResults.push({ gestor_id: gestor.id, status: 'failed', reason: 'Gestor sem telefone cadastrado.' });
          continue;
        }

        const alertsList = alertsByGestor[gestor.id];
        const messageText = 
`🔔 *ORION TRACK - MONITORAMENTO META ADS* 🔔

Olá, *${gestor.nome.split(' ')[0]}*! Identificamos contas vinculadas sob sua gestão que necessitam de atenção imediata:

${alertsList.join('\n\n')}

_Por favor, acesse o painel Orion Track em https://oriontrack.com.br/trafego/avisos-meta para mais detalhes._`;

        try {
          await evolutionFetch(`/message/sendText/${evolutionInstance}`, {
            method: 'POST',
            body: JSON.stringify({
              number: normalizedPhone,
              text: messageText,
            }),
          }, evolutionApiKey);

          sendResults.push({ gestor_id: gestor.id, status: 'success', phone: normalizedPhone });
        } catch (err: any) {
          console.error(`Erro ao disparar WhatsApp de alerta para gestor ${gestor.id}:`, err);
          sendResults.push({ gestor_id: gestor.id, status: 'failed', reason: err.message || 'Erro Evolution API' });
        }
      }
    }

    if (gestorIds.length > 0) {
      const gestores = (allProfiles || []).filter((profile: any) => gestorIds.includes(profile.id));

      for (const gestor of gestores) {
        const alertsList = alertsByGestor[gestor.id];
        const messageText =
`Identificamos contas vinculadas sob sua gestao que necessitam de atencao imediata:

${alertsList.join('\n\n')}

Acesse o painel Orion Track em https://oriontrack.com.br/trafego/avisos-meta para mais detalhes.`;

        const result = await sendApoloWhatsApp({
          type: 'cpl_alto',
          title: 'Orion Track - Monitoramento Meta Ads',
          message: messageText,
          profiles: [gestor],
        });
        sendResults.push({ gestor_id: gestor.id, results: result });
      }
    }

    for (const corretorId of Object.keys(balanceAlertsByCorretor)) {
      const targets = (allProfiles || []).filter((profile: any) =>
        profile.corretor_id === corretorId &&
        ['corretor', 'corretor_admin'].includes(profile.tipo_usuario)
      );

      const result = await sendApoloWhatsApp({
        type: 'saldo_baixo',
        title: 'Orion Track - Alerta de saldo Meta Ads',
        message: balanceAlertsByCorretor[corretorId].join('\n\n'),
        profiles: targets,
      });
      sendResults.push({ corretor_id: corretorId, results: result });
    }

    return NextResponse.json({
      success: true,
      processed_accounts: accountsWithMetrics.length,
      alerts_sent: sendResults,
    });
  } catch (error: any) {
    console.error('[CRON META ALERTS ERROR]:', error);
    return NextResponse.json({ error: error.message || 'Erro ao processar cron job de alertas Meta.' }, { status: 500 });
  }
}
