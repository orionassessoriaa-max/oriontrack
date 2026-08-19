import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { startLeadAiIfEligible } from '@/lib/leadAiAgent';
import { startLeadBotIfEligible } from '@/lib/leadBot';

const LOOKBACK_MINUTES = 10;
const BATCH_LIMIT = 100;

function normalizeName(value?: string | null) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function authorized(request: Request) {
  const expected = process.env.CRON_SECRET
    || process.env.UAZAPI_GLOBAL_TOKEN
    || process.env.EVOLUTION_API_KEY;
  if (!expected) return true;
  return request.headers.get('authorization') === `Bearer ${expected}`;
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const since = new Date(Date.now() - LOOKBACK_MINUTES * 60_000).toISOString();
    const [{ data: botConfigs, error: botConfigError }, { data: aiConfigs, error: aiConfigError }] = await Promise.all([
      supabaseAdmin
        .from('corretora_bot_configs')
        .select('corretora_id, corretoras(nome)')
        .eq('status', 'ativo'),
      supabaseAdmin
        .from('corretora_ai_configs')
        .select('corretora_id, corretoras(nome)')
        .eq('status', 'ativo'),
    ]);
    if (botConfigError) throw botConfigError;
    if (aiConfigError) throw aiConfigError;

    const automatedCompanyNames = new Set(
      [...(botConfigs || []), ...(aiConfigs || [])]
        .flatMap((config) => {
          const relation = config.corretoras;
          return Array.isArray(relation) ? relation : relation ? [relation] : [];
        })
        .map((corretora) => normalizeName(corretora.nome))
        .filter(Boolean),
    );

    if (automatedCompanyNames.size === 0) {
      return NextResponse.json({ ok: true, since, checked: 0, started_ai: 0, started_bot: 0, failures: [] });
    }

    const { data: brokers, error: brokerError } = await supabaseAdmin
      .from('corretores')
      .select('id, nome_empresa');
    if (brokerError) throw brokerError;
    const automatedBrokerIds = (brokers || [])
      .filter((broker) => automatedCompanyNames.has(normalizeName(broker.nome_empresa)))
      .map((broker) => broker.id);

    if (automatedBrokerIds.length === 0) {
      return NextResponse.json({ ok: true, since, checked: 0, started_ai: 0, started_bot: 0, failures: [] });
    }

    const { data: leads, error } = await supabaseAdmin
      .from('leads')
      .select('id, created_at')
      .in('corretor_id', automatedBrokerIds)
      .gte('created_at', since)
      .order('created_at', { ascending: true })
      .limit(BATCH_LIMIT);

    if (error) throw error;

    const dryRun = new URL(request.url).searchParams.get('dry_run') === '1';
    if (dryRun) {
      return NextResponse.json({ ok: true, dry_run: true, since, candidates: (leads || []).map((lead) => lead.id) });
    }

    const results = [];
    for (const lead of leads || []) {
      try {
        const ai = await startLeadAiIfEligible(lead.id);
        const bot = ai?.eligible ? null : await startLeadBotIfEligible(lead.id);
        results.push({ lead_id: lead.id, ai, bot });
      } catch (leadError) {
        results.push({
          lead_id: lead.id,
          error: leadError instanceof Error ? leadError.message : 'Falha ao iniciar automacao.',
        });
      }
    }

    return NextResponse.json({
      ok: true,
      since,
      checked: results.length,
      started_ai: results.filter((item) => 'ai' in item && item.ai?.started).length,
      started_bot: results.filter((item) => 'bot' in item && item.bot?.started).length,
      failures: results.filter((item) => 'error' in item),
    });
  } catch (error) {
    console.error('[cron_lead_bots] Failed dispatching recent leads:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Falha ao processar automacoes de leads.' },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  return POST(request);
}
