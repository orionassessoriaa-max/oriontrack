import { supabaseAdmin } from '@/lib/supabase/admin';
import { normalizePhone, uazapiFetch } from '@/lib/uazapi';
import { APOLO_MASTER_INSTANCE } from '@/lib/apoloNotifications';
import { createHash } from 'node:crypto';

export type OrionCredAccount = {
  gestor_id: string;
  limite_creditos: number;
  creditos_usados: number;
  creditos_reservados: number;
  ciclo_inicio: string;
  ciclo_fim: string;
};

export type OrionCredGlobalConfig = {
  orcamento_criativos_usd: number;
  limite_diario_usd: number;
  custo_estimado_imagem_usd: number;
  gasto_usd: number;
  reservado_usd: number;
  ciclo_inicio: string;
  ciclo_fim: string;
};

export function creditSummary(account: OrionCredAccount | null) {
  const limit = Number(account?.limite_creditos || 0);
  const used = Number(account?.creditos_usados || 0);
  const reserved = Number(account?.creditos_reservados || 0);
  return {
    configured: Boolean(account),
    limit,
    used,
    reserved,
    available: Math.max(limit - used - reserved, 0),
    usage_percent: limit > 0 ? Math.min(Math.round((used / limit) * 100), 100) : 0,
    cycle_start: account?.ciclo_inicio || null,
    cycle_end: account?.ciclo_fim || null,
  };
}

export function globalCreditSummary(config: OrionCredGlobalConfig | null) {
  const budget = Number(config?.orcamento_criativos_usd || 0);
  const spent = Number(config?.gasto_usd || 0);
  const reserved = Number(config?.reservado_usd || 0);
  return {
    budget_usd: budget,
    spent_usd: spent,
    reserved_usd: reserved,
    available_usd: Math.max(budget - spent - reserved, 0),
    daily_limit_usd: Number(config?.limite_diario_usd || 0),
    estimated_image_cost_usd: Number(config?.custo_estimado_imagem_usd || 0),
    usage_percent: budget > 0 ? Math.min(Math.round((spent / budget) * 100), 100) : 0,
    cycle_start: config?.ciclo_inicio || null,
    cycle_end: config?.ciclo_fim || null,
  };
}

async function runCreditRpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await supabaseAdmin.rpc(name, args);
  if (error) throw new Error(error.message);
  return (Array.isArray(data) ? data[0] : data) as OrionCredAccount;
}

export function reserveOrionCredits(gestorId: string, quantity: number, reference: string) {
  return runCreditRpc('orion_cred_reservar', {
    p_gestor_id: gestorId,
    p_quantidade: quantity,
    p_referencia: reference,
  });
}

export async function settleOrionCredits(gestorId: string, quantity: number, reference: string) {
  const account = await runCreditRpc('orion_cred_consumir', {
    p_gestor_id: gestorId,
    p_quantidade: quantity,
    p_referencia: reference,
  });
  await notifyUsageThreshold(account).catch((error) => {
    console.error('[Orion Cred] Falha ao enviar alerta de saldo:', error);
  });
  await notifyGlobalUsageThreshold().catch((error) => {
    console.error('[Orion Cred] Falha ao enviar alerta global:', error);
  });
  return account;
}

export function releaseOrionCredits(gestorId: string, quantity: number, reference: string) {
  if (quantity <= 0) return Promise.resolve(null);
  return runCreditRpc('orion_cred_estornar', {
    p_gestor_id: gestorId,
    p_quantidade: quantity,
    p_referencia: reference,
  });
}

export function creativeRequestFingerprint(values: Array<string | number | null | undefined>) {
  const normalized = values
    .map((value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim())
    .join('|');
  return createHash('sha256').update(normalized).digest('hex');
}

export async function beginCreativeGeneration(gestorId: string, reference: string, fingerprint: string) {
  const { data: locked, error: lockError } = await supabaseAdmin.rpc('orion_cred_adquirir_lock', {
    p_gestor_id: gestorId,
    p_referencia: reference,
  });
  if (lockError) throw new Error(lockError.message);
  if (!locked) throw new Error('Ja existe uma geracao em andamento para este gestor. Aguarde a conclusao antes de iniciar outra.');

  const { data: accepted, error: requestError } = await supabaseAdmin.rpc('orion_cred_registrar_pedido', {
    p_gestor_id: gestorId,
    p_fingerprint: fingerprint,
  });
  if (requestError || !accepted) {
    await endCreativeGeneration(gestorId, reference).catch(() => null);
    if (requestError) throw new Error(requestError.message);
    throw new Error('Este pedido e igual a outro enviado nos ultimos 10 minutos. Reutilize o criativo ou altere o briefing antes de gerar novamente.');
  }
}

export async function endCreativeGeneration(gestorId: string, reference: string) {
  const { error } = await supabaseAdmin.rpc('orion_cred_liberar_lock', {
    p_gestor_id: gestorId,
    p_referencia: reference,
  });
  if (error) throw new Error(error.message);
}

export async function updateCreditLedgerContext(reference: string, context: {
  corretorId?: string | null;
  concessionaria?: string | null;
  operadora?: string | null;
  regiao?: string | null;
  prompt?: string | null;
  resultado?: string | null;
  assetId?: string | null;
}) {
  const { data: entry } = await supabaseAdmin
    .from('orion_cred_ledger')
    .select('id')
    .eq('referencia', reference)
    .eq('tipo', 'consumo')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!entry) return;
  const { error } = await supabaseAdmin
    .from('orion_cred_ledger')
    .update({
      corretor_id: context.corretorId || null,
      concessionaria: context.concessionaria || null,
      operadora: context.operadora || null,
      regiao: context.regiao || null,
      prompt: context.prompt || null,
      resultado: context.resultado || 'concluido',
      asset_id: context.assetId || null,
    })
    .eq('id', entry.id);
  if (error) throw new Error(error.message);
}

async function notifyUsageThreshold(account: OrionCredAccount) {
  const summary = creditSummary(account);
  const threshold = summary.usage_percent >= 100 ? 100
    : summary.usage_percent >= 90 ? 90
      : summary.usage_percent >= 80 ? 80
        : summary.usage_percent >= 60 ? 60 : 0;
  if (!threshold) return;

  const { data: claimed, error } = await supabaseAdmin.rpc('orion_cred_marcar_alerta', {
    p_gestor_id: account.gestor_id,
    p_percentual: threshold,
  });
  if (error || !claimed) return;

  const { data: gestor } = await supabaseAdmin
    .from('profiles')
    .select('id, nome')
    .eq('id', account.gestor_id)
    .maybeSingle();
  const gestorName = gestor?.nome || 'Gestor sem nome';
  const title = threshold === 100 ? 'Orion Cred esgotado' : `Orion Cred em ${threshold}%`;
  const message = threshold === 100
    ? `O saldo de criativos de ${gestorName} chegou a zero. Novas geracoes foram bloqueadas.`
    : `${gestorName} usou ${summary.usage_percent}% do limite de criativos. Restam ${summary.available} creditos.`;

  await supabaseAdmin.from('notificacoes').insert({
    titulo: title,
    mensagem: message,
    destinatario_profile_id: account.gestor_id,
    destinatario_tipo: 'gestor_trafego',
  });

  const phone = normalizePhone('61984409328');
  if (phone) {
    await uazapiFetch('/send/text', {
      method: 'POST',
      body: JSON.stringify({
        number: phone,
        text: `*${title}*\n\n${message}\n\n_Apolo Notificador - Orion Track_`,
      }),
    }, { instanceName: APOLO_MASTER_INSTANCE });
  }
}

async function notifyGlobalUsageThreshold() {
  const { data, error } = await supabaseAdmin
    .from('orion_cred_global_config')
    .select('orcamento_criativos_usd, limite_diario_usd, custo_estimado_imagem_usd, gasto_usd, reservado_usd, ciclo_inicio, ciclo_fim')
    .eq('id', 1)
    .maybeSingle();
  if (error || !data) return;
  const summary = globalCreditSummary(data);
  const threshold = summary.usage_percent >= 100 ? 100
    : summary.usage_percent >= 90 ? 90
      : summary.usage_percent >= 80 ? 80
        : summary.usage_percent >= 60 ? 60 : 0;
  if (!threshold) return;
  const { data: claimed, error: claimError } = await supabaseAdmin.rpc('orion_cred_marcar_alerta_global', {
    p_percentual: threshold,
  });
  if (claimError || !claimed) return;

  const title = threshold === 100 ? 'Orcamento de criativos esgotado' : `Orcamento de criativos em ${threshold}%`;
  const message = threshold === 100
    ? 'O limite global estimado de US$ 12 foi atingido. Novos criativos foram bloqueados, sem afetar a IA dos corretores.'
    : `O Orion Track consumiu ${summary.usage_percent}% do limite de criativos. Gasto estimado: US$ ${summary.spent_usd.toFixed(2)}. Saldo estimado: US$ ${summary.available_usd.toFixed(2)}.`;
  const phone = normalizePhone('61984409328');
  if (!phone) return;
  await uazapiFetch('/send/text', {
    method: 'POST',
    body: JSON.stringify({
      number: phone,
      text: `*${title}*\n\n${message}\n\n_Apolo Notificador - Orion Track_`,
    }),
  }, { instanceName: APOLO_MASTER_INSTANCE });
}
