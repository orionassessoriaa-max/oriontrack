export type OptimizationDraftRecord = Record<string, unknown>;

export type NormalizedOptimizationDraft = {
  mode: 'draft';
  publish_status: 'REVIEW_REQUIRED';
  summary?: string;
  actions: OptimizationDraftRecord[];
  campaign: OptimizationDraftRecord;
  adsets: OptimizationDraftRecord[];
  ads: OptimizationDraftRecord[];
  human_review_checklist: string[];
  missing_info: string[];
  [key: string]: unknown;
};

function isRecord(value: unknown): value is OptimizationDraftRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function records(value: unknown): OptimizationDraftRecord[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (isRecord(item)) return [item];
      const name = text(item);
      return name ? [{ name }] : [];
    });
  }
  if (isRecord(value)) return [value];
  const name = text(value);
  return name ? [{ name }] : [];
}

function strings(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => text(item)).filter(Boolean)
    : text(value) ? [text(value)] : [];
}

function parseTargeting(value: unknown) {
  if (isRecord(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (isRecord(parsed)) return parsed;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function normalizeCampaignObjective(value: unknown) {
  const requestedObjective = text(value).toUpperCase();

  // LEAD_GENERATION was the legacy campaign objective. Meta's ODAX campaign
  // endpoint now expects OUTCOME_LEADS, while LEAD_GENERATION remains valid as
  // the ad set optimization goal.
  if (requestedObjective === 'LEAD_GENERATION') return 'OUTCOME_LEADS';

  return requestedObjective || 'OUTCOME_TRAFFIC';
}

export function normalizeOptimizationDraft(value: unknown): NormalizedOptimizationDraft {
  const source = isRecord(value) ? value : {};
  const campaignSource = isRecord(source.campaign)
    ? source.campaign
    : text(source.campaign)
      ? { name: text(source.campaign) }
      : {};
  const objective = normalizeCampaignObjective(campaignSource.objective);
  const campaign: OptimizationDraftRecord = {
    ...campaignSource,
    name: text(campaignSource.name) || `[ORION] Campanha | ${new Date().toISOString().slice(0, 10)}`,
    objective,
    buying_type: text(campaignSource.buying_type).toUpperCase() || 'AUCTION',
    special_ad_categories: Array.isArray(campaignSource.special_ad_categories)
      ? campaignSource.special_ad_categories
      : [],
    status: 'PAUSED',
  };

  const adsets: OptimizationDraftRecord[] = records(source.adsets).map((item, index): OptimizationDraftRecord => {
    const targeting = parseTargeting(item.targeting);
    const requestedGoal = text(item.optimization_goal).toUpperCase();
    return {
      ...item,
      name: text(item.name) || `Conjunto ${index + 1}`,
      status: 'PAUSED',
      billing_event: text(item.billing_event).toUpperCase() || 'IMPRESSIONS',
      optimization_goal: requestedGoal || (objective === 'OUTCOME_TRAFFIC' ? 'LINK_CLICKS' : 'LEAD_GENERATION'),
      ...(targeting ? { targeting } : {}),
      ads: undefined,
    };
  });

  const ads: OptimizationDraftRecord[] = records(source.ads).map((item, index): OptimizationDraftRecord => ({
    ...item,
    name: text(item.name) || `Anuncio ${index + 1}`,
    primary_text: text(item.primary_text) || text(item.body) || undefined,
    headline: text(item.headline) || text(item.title) || undefined,
    status: 'PAUSED',
  }));

  const missing = new Set(strings(source.missing_info));
  const newAdsets = adsets.filter((item) => !item.existing_id && !item.adset_id);
  if (newAdsets.length > 0 && newAdsets.every((item) => item.daily_budget === null || item.daily_budget === undefined || item.daily_budget === '')) {
    missing.add('Informe a verba diaria de pelo menos um conjunto.');
  }

  return {
    ...source,
    mode: 'draft',
    publish_status: 'REVIEW_REQUIRED',
    summary: text(source.summary) || undefined,
    actions: records(source.actions),
    campaign,
    adsets,
    ads,
    human_review_checklist: strings(source.human_review_checklist),
    missing_info: [...missing],
  };
}
