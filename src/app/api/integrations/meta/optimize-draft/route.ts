import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { rateLimit } from '@/lib/api/security';
import { isGestorLinkedToConcessionariaCorretor } from '@/lib/gestorAccess';

type CorretorMeta = {
  id: string;
  nome: string;
  gestor_trafego_id: string | null;
  nome_empresa: string | null;
  meta_ad_account_id: string | null;
  meta_ad_account_name: string | null;
  time_operacional?: unknown;
  is_orion_principal?: boolean;
};

const KRIPTO_PRINCIPAL_ACCOUNT_ID = '1531044161152262';

async function requireTrafficAccess(request: Request) {
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
    .select('id, nome, email, email_real, tipo_usuario, corretor_id')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile || !['admin', 'gestor_trafego'].includes(profile.tipo_usuario)) {
    return { error: NextResponse.json({ error: 'Acesso negado.' }, { status: 403 }) };
  }

  return { profile };
}

function normalizeAccountId(accountId?: string | null) {
  return String(accountId || '').replace(/^act_/, '').trim();
}

async function resolveScopedProfile(profile: any, requestedGestorId?: string | null) {
  if (profile.tipo_usuario !== 'admin' || !requestedGestorId) return profile;

  const { data: gestor } = await supabaseAdmin
    .from('profiles')
    .select('id, nome, email, email_real, tipo_usuario, corretor_id')
    .eq('id', requestedGestorId)
    .eq('tipo_usuario', 'gestor_trafego')
    .maybeSingle();

  return gestor || profile;
}

async function findAllowedAccount(profile: any, accountId: string, requestedGestorId?: string | null, requestedEquipe?: string | null) {
  if (requestedEquipe === 'kripto_hunters' && accountId === KRIPTO_PRINCIPAL_ACCOUNT_ID) {
    const { data: principal } = await supabaseAdmin
      .from('meta_ad_accounts')
      .select('id, meta_account_id, nome')
      .eq('meta_account_id', KRIPTO_PRINCIPAL_ACCOUNT_ID)
      .maybeSingle();
    if (principal) {
      return {
        id: String(principal.id),
        nome: principal.nome || 'CA - Orion Conta Principal',
        gestor_trafego_id: null,
        nome_empresa: principal.nome || 'CA - Orion Conta Principal',
        meta_ad_account_id: principal.meta_account_id,
        meta_ad_account_name: principal.nome || 'CA - Orion Conta Principal',
        is_orion_principal: true,
      } as CorretorMeta;
    }
  }

  const scopedProfile = await resolveScopedProfile(profile, requestedGestorId);
  const { data, error } = await supabaseAdmin
    .from('corretores')
    .select('id, nome, gestor_trafego_id, nome_empresa, meta_ad_account_id, meta_ad_account_name, time_operacional')
    .not('nome_empresa', 'is', null)
    .order('nome', { ascending: true });

  if (error) throw new Error(error.message);

  const scoped = scopedProfile.tipo_usuario === 'gestor_trafego'
    ? ((data || []) as CorretorMeta[]).filter((corretor) => isGestorLinkedToConcessionariaCorretor(corretor, scopedProfile))
    : ((data || []) as CorretorMeta[]);

  return scoped.find((corretor) => normalizeAccountId(corretor.meta_ad_account_id) === normalizeAccountId(accountId)) || null;
}

function fallbackDraft(payload: any, account: CorretorMeta) {
  const now = new Date().toISOString().slice(0, 10);
  const concessionaria = account.nome_empresa || account.nome;

  return {
    mode: 'draft',
    publish_status: 'REVIEW_REQUIRED',
    summary: `Plano de otimizacao para ${concessionaria}. Revisar antes de executar qualquer acao no Meta.`,
    actions: [
      {
        type: 'review_request',
        status_after_action: 'PAUSED_WHEN_CREATING_NEW_ITEMS',
        instruction: payload.prompt,
      },
    ],
    campaign: {
      name: `[ORION] ${concessionaria} | ${now}`,
      objective: 'OUTCOME_LEADS',
      buying_type: 'AUCTION',
      status: 'PAUSED',
      budget_mode: 'ABO',
      special_ad_categories: [],
    },
    adsets: [
      {
        name: `ABO | Publico principal | ${now}`,
        status: 'PAUSED',
        daily_budget: null,
        targeting: { geo_locations: { countries: ['BR'] } },
        billing_event: 'IMPRESSIONS',
        optimization_goal: 'LEAD_GENERATION',
      },
    ],
    ads: [
      {
        name: 'AD ou criativo citado no prompt',
        status: 'PAUSED',
        creative_reference: 'Extrair do prompt quando existir.',
        drive_folder: 'Extrair do prompt quando existir.',
        primary_text: 'Gerar ou revisar conforme pedido do gestor.',
      },
    ],
    human_review_checklist: [
      'Conferir se a acao pedida foi interpretada corretamente.',
      'Se for criacao de campanha, conjunto ou anuncio, criar sempre como PAUSED.',
      'Se for pausa/troca/verba, revisar o item exato antes de executar.',
      'Se houver Drive no prompt, conferir pasta e criativo antes de usar.',
    ],
  };
}

async function generateDraftWithAi(payload: any, account: CorretorMeta) {
  const apiKey = process.env.OPENAI_API_KEY;
  const base = fallbackDraft(payload, account);
  if (!apiKey) return base;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: process.env.ORION_TRAFFIC_AI_MODEL || 'gpt-4o-mini',
      temperature: 0.2,
      max_tokens: 1200,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `Voce cria rascunhos de campanhas Meta Ads para corretoras de planos de saude.
Regras obrigatorias:
- O gestor pode pedir qualquer otimizacao: criar campanha, criar conjunto, criar anuncio, pausar anuncio, pausar criativo, pausar conjunto, pausar campanha, trocar criativo, ajustar verba, duplicar, revisar copy ou reorganizar estrutura.
- Nunca execute de verdade neste endpoint. Gere apenas rascunho operacional revisavel.
- Toda criacao nova de campanha, conjunto ou anuncio deve sair com status PAUSED.
- Para permitir a criacao real depois da confirmacao, retorne campaign com name, objective, buying_type e special_ad_categories; adsets com name, daily_budget em centavos, billing_event, optimization_goal e targeting como objeto JSON; ads com name e creative_id somente quando o ID real da Meta tiver sido informado.
- Nao invente daily_budget nem creative_id. Se faltar verba, deixe daily_budget nulo e informe missing_info. Se houver apenas referencia a uma pasta do Drive, registre-a, mas nao transforme isso em creative_id.
- Acoes de pausa/troca/verba devem virar itens em actions, com alvo, motivo, risco e checklist.
- Se o usuario pedir ABO, usar budget_mode ABO e verba no conjunto.
- Leads oficiais sao do CRM, mas aqui voce esta criando estrutura de campanha, nao julgando resultado.
- Extraia do proprio prompt qualquer referencia de Drive/pasta/criativo, por exemplo "AD 2 da pasta SulAmerica DF". Se o gestor nao informar link nem nome de pasta, coloque isso em missing_info.
- Se houver link/pasta Drive, registre a pasta no campo drive_folder. Nao invente arquivo que nao foi citado.
- Retorne apenas JSON valido com: mode, publish_status, summary, actions, campaign, adsets, ads, human_review_checklist, missing_info.
- Nao invente ID do Meta.`
        },
        {
          role: 'user',
          content: JSON.stringify({
            concessionaria: account.nome_empresa || account.nome,
            meta_ad_account_name: account.meta_ad_account_name,
            meta_ad_account_id: account.meta_ad_account_id,
            prompt: payload.prompt,
            current_metrics: payload.metrics,
            fallback_shape: base,
          }).slice(0, 12000),
        },
      ],
    }),
  });

  if (!response.ok) return base;
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) return base;

  try {
    const parsed = JSON.parse(content);
    return {
      ...parsed,
      mode: 'draft',
      publish_status: parsed.publish_status || 'REVIEW_REQUIRED',
    };
  } catch {
    return base;
  }
}

export async function POST(request: Request) {
  try {
    const limited = rateLimit(request, 'meta:optimize-draft', { limit: 30, windowMs: 5 * 60_000 });
    if (limited) return limited;

    const guard = await requireTrafficAccess(request);
    if ('error' in guard) return guard.error;

    const body = await request.json();
    const accountId = normalizeAccountId(body.account_id);
    const prompt = String(body.prompt || '').trim();

    if (!accountId) return NextResponse.json({ error: 'Conta Meta obrigatoria.' }, { status: 400 });
    if (prompt.length < 12) return NextResponse.json({ error: 'Descreva melhor o que deseja criar.' }, { status: 400 });

    const account = await findAllowedAccount(
      guard.profile,
      accountId,
      body.gestor_id ? String(body.gestor_id) : null,
      body.equipe ? String(body.equipe) : null
    );

    if (!account) {
      return NextResponse.json({ error: 'Conta nao encontrada ou fora do escopo deste gestor.' }, { status: 403 });
    }

    const draft = await generateDraftWithAi(body, account);
    return NextResponse.json({ success: true, draft });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Erro ao gerar rascunho de otimizacao.' }, { status: 500 });
  }
}
