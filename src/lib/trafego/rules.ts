// Fonte unica das regras de trafego. Antes elas viviam duplicadas em
// alerts/route.ts, optimizations/route.ts e no classifyMetaAccount da pagina,
// o que permitia a mesma conta receber diagnosticos diferentes em cada tela.
//
// A recomendacao e sempre deterministica: quem decide "pausar o anuncio X" e a
// regra, nunca a IA. A IA so redige o resumo da carteira. Assim o mesmo numero
// gera sempre a mesma acao e o gestor consegue confiar na fila.

export const TRAFFIC_RULES = {
  cplAttention: 20,
  cplCritical: 28,
  cpcMax: 6,
  ctrMin: 1,
  frequencyFatigue: 3.5,
  lowBalance: 100,
  // Abaixo deste investimento nao ha volume suficiente para julgar um anuncio.
  minSpendToJudge: 50,
};

export type TrackingStatus = 'ativo' | 'aguardando_integracao' | 'rastreio_quebrado';

export type RecommendationLevel = 'conta' | 'campanha' | 'conjunto' | 'anuncio';

export type RecommendationAction =
  | 'pausar_campanha'
  | 'pausar_conjunto'
  | 'pausar_anuncio'
  | 'trocar_criativo'
  | 'revisar_publico'
  | 'revisar_rastreio'
  | 'avisar_admin';

export type RecommendationSeverity = 'critico' | 'atencao' | 'informativo';

export type Recommendation = {
  chave: string;
  corretor_id: string;
  concessionaria_nome: string;
  meta_ad_account_id: string | null;
  nivel: RecommendationLevel;
  alvo_id: string | null;
  alvo_nome: string | null;
  acao: RecommendationAction;
  severidade: RecommendationSeverity;
  motivo: string;
  metricas: Record<string, unknown>;
  executavel: boolean;
};

export type AccountLike = {
  corretor_id: string;
  corretor_nome: string;
  concessionaria_nome?: string;
  meta_ad_account_id: string | null;
  spend: number;
  leads: number;
  cpl: number | null;
  ctr: number;
  cpc?: number;
  cpm?: number;
  frequency?: number;
  saldo: number | null;
  currency?: string;
  forma_pagamento?: string;
  rastreio?: TrackingStatus;
  error?: string;
};

export type CreativeLike = {
  id: string;
  ad_name: string;
  corretor_id?: string;
  concessionaria_nome: string;
  meta_ad_account_id: string | null;
  spend: number;
  leads: number;
  cpl: number | null;
  currency?: string;
  status?: string;
};

export const ACTION_LABELS: Record<RecommendationAction, string> = {
  pausar_campanha: 'Pausar campanha',
  pausar_conjunto: 'Pausar conjunto',
  pausar_anuncio: 'Pausar anúncio',
  trocar_criativo: 'Trocar criativo',
  revisar_publico: 'Revisar público e página',
  revisar_rastreio: 'Revisar rastreio de leads',
  avisar_admin: 'Avisar o admin',
};

export const TRACKING_LABELS: Record<TrackingStatus, string> = {
  ativo: 'Rastreio ativo',
  aguardando_integracao: 'Aguardando integração',
  rastreio_quebrado: 'Rastreio quebrado',
};

export function formatBRL(value: number | null | undefined, currency = 'BRL') {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 'N/A';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(Number(value));
}

export function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '0,00%';
  return `${Number(value).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

/**
 * Distingue "ainda nao integrei" de "integrei e quebrou".
 *
 * `explicitStatus` vem da coluna corretores.rastreio_status, preenchida pelo
 * admin. Quando ela ainda nao foi marcada, cai na heuristica: concessionaria
 * que nunca teve nenhum lead Orion no CRM esta aguardando integracao; a que ja
 * teve e zerou no periodo tem rastreio quebrado.
 */
export function resolveTrackingStatus(input: {
  explicitStatus?: string | null;
  everHadOrionLead: boolean;
  spend: number;
  leadsInPeriod: number;
}): TrackingStatus {
  const explicit = String(input.explicitStatus || '').trim();

  if (explicit === 'nao_configurado') return 'aguardando_integracao';
  if (explicit === 'planilha_importada') {
    return input.leadsInPeriod > 0 ? 'ativo' : 'aguardando_integracao';
  }
  if (explicit === 'automacao_ativa') {
    return input.spend > 0 && input.leadsInPeriod === 0 ? 'rastreio_quebrado' : 'ativo';
  }

  if (!input.everHadOrionLead) return 'aguardando_integracao';
  if (input.spend > 0 && input.leadsInPeriod === 0) return 'rastreio_quebrado';
  return 'ativo';
}

export function isPaymentError(account: AccountLike) {
  return Boolean(account.error) && /pagamento|payment|recusad|failed|declined|settle|cobran|cartao|cartão|card|invoice|unpaid/i.test(String(account.error));
}

export function isCardFunding(account: AccountLike) {
  const text = String(account.forma_pagamento || '').toLowerCase();
  return /cartao|cartão|card|visa|mastercard|amex/.test(text);
}

export type AccountStatus = {
  label: string;
  tone: 'red' | 'amber' | 'blue' | 'emerald' | 'slate';
  detail: string;
};

export function classifyAccount(account: AccountLike): AccountStatus {
  const tracking = account.rastreio || 'ativo';
  const card = isCardFunding(account);

  if (account.error && isPaymentError(account)) {
    return { label: 'Erro de pagamento', tone: 'red', detail: 'A Meta recusou a cobrança desta conta. Precisa de ação do admin.' };
  }
  if (account.error) {
    return { label: 'Erro na Meta', tone: 'amber', detail: account.error };
  }
  if (!card && account.saldo !== null && account.saldo <= 0) {
    return { label: 'Sem saldo', tone: 'red', detail: 'Conta pré-paga zerada. Avisar o admin para recarregar.' };
  }

  if (tracking === 'aguardando_integracao') {
    return {
      label: 'Aguardando integração',
      tone: 'slate',
      detail: 'Os leads desta concessionária ainda não entram no CRM. O CPL não pode ser calculado e nenhuma campanha deve ser julgada por ele.',
    };
  }
  if (tracking === 'rastreio_quebrado') {
    return {
      label: 'Rastreio quebrado',
      tone: 'blue',
      detail: 'Esta conta já recebeu leads Orion antes, mas está zerada no período com investimento ativo. Conferir webhook e UTM antes de mexer na campanha.',
    };
  }

  if (account.cpl !== null && account.cpl >= TRAFFIC_RULES.cplCritical) {
    return { label: 'CPL crítico', tone: 'red', detail: `CPL de ${formatBRL(account.cpl, account.currency)} contra o teto de ${formatBRL(TRAFFIC_RULES.cplCritical)}.` };
  }
  if (!card && account.saldo !== null && account.saldo < TRAFFIC_RULES.lowBalance) {
    return { label: 'Saldo baixo', tone: 'amber', detail: `Saldo de ${formatBRL(account.saldo, account.currency)}, abaixo do mínimo operacional.` };
  }
  if (account.cpl !== null && account.cpl >= TRAFFIC_RULES.cplAttention) {
    return { label: 'Em atenção', tone: 'amber', detail: `CPL de ${formatBRL(account.cpl, account.currency)} passou de ${formatBRL(TRAFFIC_RULES.cplAttention)}. Vale ler CPC, CTR e frequência.` };
  }
  if (Number(account.ctr || 0) > 0 && Number(account.ctr) < TRAFFIC_RULES.ctrMin) {
    return { label: 'Em atenção', tone: 'amber', detail: `CTR de ${formatPercent(account.ctr)}, abaixo do mínimo de ${TRAFFIC_RULES.ctrMin}%.` };
  }

  return { label: 'Saudável', tone: 'emerald', detail: 'Nenhum alerta no período selecionado.' };
}

/** Score usado só para ordenar o ranking da carteira. */
export function scoreAccount(account: AccountLike) {
  if (account.rastreio && account.rastreio !== 'ativo') return -1;

  let score = 100;
  const cpl = Number(account.cpl || 0);
  const cpc = Number(account.cpc || 0);
  const ctr = Number(account.ctr || 0);
  const frequency = Number(account.frequency || 0);

  if (account.error) score -= 35;
  if (Number(account.spend || 0) > 0 && Number(account.leads || 0) === 0) score -= 45;
  if (cpl >= TRAFFIC_RULES.cplCritical) score -= 45;
  else if (cpl >= TRAFFIC_RULES.cplAttention) score -= 22;
  if (cpc > TRAFFIC_RULES.cpcMax) score -= 14;
  if (ctr > 0 && ctr < TRAFFIC_RULES.ctrMin) score -= 14;
  if (frequency >= TRAFFIC_RULES.frequencyFatigue) score -= 8;
  score += Math.min(Number(account.leads || 0), 50) * 0.35;

  return Math.max(0, Math.round(score));
}

function recommendationKey(accountId: string | null, alvoId: string | null, acao: RecommendationAction) {
  return `${accountId || 'sem-conta'}::${alvoId || 'conta'}::${acao}`;
}

/**
 * Gera a fila de acoes a partir das metricas ja carregadas.
 *
 * Anuncios vem antes de conta: se um anuncio especifico ja explica o problema,
 * nao adianta mandar o gestor "revisar a conta". E conta sem rastreio ativo
 * nunca gera pausa, so o aviso de rastreio.
 */
export function buildRecommendations(input: {
  accounts: AccountLike[];
  creatives: CreativeLike[];
}): Recommendation[] {
  const recommendations: Recommendation[] = [];
  const accountsWithAdAction = new Set<string>();
  const topCreativeByAccount = new Map<string, CreativeLike>();

  const accountByMetaId = new Map<string, AccountLike>();
  input.accounts.forEach((account) => {
    const key = String(account.meta_ad_account_id || '');
    if (key) accountByMetaId.set(key, account);
  });
  [...input.creatives]
    .filter((creative) => String(creative.status || '').toUpperCase() === 'ACTIVE')
    .sort((a, b) => Number(b.spend || 0) - Number(a.spend || 0))
    .forEach((creative) => {
      const key = String(creative.meta_ad_account_id || '');
      if (key && !topCreativeByAccount.has(key)) topCreativeByAccount.set(key, creative);
    });

  input.creatives.forEach((creative) => {
    const account = accountByMetaId.get(String(creative.meta_ad_account_id || ''));
    if (!account) return;
    if ((account.rastreio || 'ativo') !== 'ativo') return;
    if (String(creative.status || '').toUpperCase() !== 'ACTIVE') return;

    const spend = Number(creative.spend || 0);
    const leads = Number(creative.leads || 0);
    const cpl = creative.cpl === null || creative.cpl === undefined ? null : Number(creative.cpl);
    const currency = creative.currency || account.currency || 'BRL';

    const base = {
      corretor_id: account.corretor_id,
      concessionaria_nome: creative.concessionaria_nome || account.concessionaria_nome || account.corretor_nome,
      meta_ad_account_id: creative.meta_ad_account_id,
      nivel: 'anuncio' as const,
      alvo_id: creative.id,
      alvo_nome: creative.ad_name,
      metricas: { spend, leads, cpl, currency },
      executavel: true,
    };

    if (leads === 0 && spend >= TRAFFIC_RULES.minSpendToJudge) {
      recommendations.push({
        ...base,
        chave: recommendationKey(creative.meta_ad_account_id, creative.id, 'pausar_anuncio'),
        acao: 'pausar_anuncio',
        severidade: 'critico',
        motivo: `${formatBRL(spend, currency)} investidos neste anúncio e nenhum lead Orion no CRM.`,
      });
      accountsWithAdAction.add(String(creative.meta_ad_account_id || ''));
      return;
    }

    if (cpl !== null && cpl >= TRAFFIC_RULES.cplCritical) {
      recommendations.push({
        ...base,
        chave: recommendationKey(creative.meta_ad_account_id, creative.id, 'pausar_anuncio'),
        acao: 'pausar_anuncio',
        severidade: 'critico',
        motivo: `CPL de ${formatBRL(cpl, currency)} neste anúncio, acima do teto de ${formatBRL(TRAFFIC_RULES.cplCritical)}.`,
      });
      accountsWithAdAction.add(String(creative.meta_ad_account_id || ''));
      return;
    }

    if (cpl !== null && cpl >= TRAFFIC_RULES.cplAttention) {
      recommendations.push({
        ...base,
        chave: recommendationKey(creative.meta_ad_account_id, creative.id, 'trocar_criativo'),
        acao: 'trocar_criativo',
        severidade: 'atencao',
        motivo: `CPL de ${formatBRL(cpl, currency)} neste anúncio, acima de ${formatBRL(TRAFFIC_RULES.cplAttention)}. Vale testar outro criativo antes de pausar.`,
        executavel: false,
      });
      accountsWithAdAction.add(String(creative.meta_ad_account_id || ''));
    }
  });

  input.accounts.forEach((account) => {
    const accountId = String(account.meta_ad_account_id || '');
    const tracking = account.rastreio || 'ativo';
    const currency = account.currency || 'BRL';
    const base = {
      corretor_id: account.corretor_id,
      concessionaria_nome: account.concessionaria_nome || account.corretor_nome,
      meta_ad_account_id: account.meta_ad_account_id,
      nivel: 'conta' as const,
      alvo_id: null,
      alvo_nome: account.concessionaria_nome || account.corretor_nome,
      executavel: false,
    };

    const prepaidBalanceAlert = !isCardFunding(account)
      && account.saldo !== null
      && account.saldo < TRAFFIC_RULES.lowBalance;

    if (isPaymentError(account) || prepaidBalanceAlert) {
      const noBalance = prepaidBalanceAlert && Number(account.saldo) <= 0;
      recommendations.push({
        ...base,
        chave: recommendationKey(account.meta_ad_account_id, null, 'avisar_admin'),
        acao: 'avisar_admin',
        severidade: isPaymentError(account) || noBalance ? 'critico' : 'atencao',
        motivo: isPaymentError(account)
          ? 'A Meta recusou a cobrança desta conta. As campanhas param sozinhas se ninguém resolver.'
          : noBalance
            ? 'Conta pré-paga sem saldo. As campanhas não entregam até a recarga.'
            : `Conta pré-paga com saldo abaixo de ${formatBRL(TRAFFIC_RULES.lowBalance, currency)}. Avisar antes que as campanhas parem.`,
        metricas: { saldo: account.saldo, forma_pagamento: account.forma_pagamento, currency },
      });
      return;
    }

    if (tracking === 'rastreio_quebrado') {
      recommendations.push({
        ...base,
        chave: recommendationKey(account.meta_ad_account_id, null, 'revisar_rastreio'),
        acao: 'revisar_rastreio',
        severidade: 'critico',
        motivo: `${formatBRL(account.spend, currency)} investidos no período e nenhum lead Orion no CRM, mas esta conta já recebeu leads antes. Conferir webhook e UTM antes de pausar qualquer coisa.`,
        metricas: { spend: account.spend, leads: account.leads, currency },
      });
      return;
    }

    // Aguardando integracao nao vira acao do gestor: a pendencia e da operacao,
    // e aparece como aviso separado no topo do painel.
    if (tracking !== 'ativo') return;
    if (accountsWithAdAction.has(accountId)) return;

    const cpl = account.cpl === null || account.cpl === undefined ? null : Number(account.cpl);
    const cpc = Number(account.cpc || 0);
    const ctr = Number(account.ctr || 0);
    const frequency = Number(account.frequency || 0);
    const metricas = { cpl, cpc, ctr, frequency, spend: account.spend, leads: account.leads, currency };
    const topCreative = topCreativeByAccount.get(accountId);
    const creativeSwapBase = topCreative
      ? {
          ...base,
          nivel: 'anuncio' as const,
          alvo_id: topCreative.id,
          alvo_nome: topCreative.ad_name,
        }
      : base;

    if (cpl !== null && cpl >= TRAFFIC_RULES.cplAttention && ctr > 0 && ctr < TRAFFIC_RULES.ctrMin) {
      recommendations.push({
        ...creativeSwapBase,
        chave: recommendationKey(account.meta_ad_account_id, creativeSwapBase.alvo_id, 'trocar_criativo'),
        acao: 'trocar_criativo',
        severidade: 'atencao',
        motivo: `CPL em ${formatBRL(cpl, currency)} com CTR de ${formatPercent(ctr)}. Pouca gente clica: o criativo é o gargalo.`,
        metricas,
      });
      return;
    }

    if (cpl !== null && cpl >= TRAFFIC_RULES.cplAttention && cpc > TRAFFIC_RULES.cpcMax) {
      recommendations.push({
        ...base,
        chave: recommendationKey(account.meta_ad_account_id, null, 'revisar_publico'),
        acao: 'revisar_publico',
        severidade: 'atencao',
        motivo: `CPL em ${formatBRL(cpl, currency)} com CPC de ${formatBRL(cpc, currency)}, acima do teto de ${formatBRL(TRAFFIC_RULES.cpcMax)}. O leilão está caro para este público.`,
        metricas,
      });
      return;
    }

    if (frequency >= TRAFFIC_RULES.frequencyFatigue) {
      recommendations.push({
        ...creativeSwapBase,
        chave: recommendationKey(account.meta_ad_account_id, creativeSwapBase.alvo_id, 'trocar_criativo'),
        acao: 'trocar_criativo',
        severidade: 'atencao',
        motivo: `Frequência em ${frequency.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}. O mesmo público já viu o anúncio vezes demais.`,
        metricas,
      });
    }
  });

  const severityOrder: Record<RecommendationSeverity, number> = { critico: 0, atencao: 1, informativo: 2 };
  return recommendations.sort((a, b) => severityOrder[a.severidade] - severityOrder[b.severidade]);
}
