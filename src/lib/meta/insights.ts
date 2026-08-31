import 'server-only';
import { metaCachedFetch } from '@/lib/meta/cachedFetch';

/**
 * Insights de conta da Meta, com a chave de cache que as telas usam.
 *
 * A funcao morava dentro da rota de otimizacoes. Foi trazida para ca porque o
 * aquecimento do cache precisa montar a URL exatamente igual: a chave e a
 * propria URL, entao um parametro fora de ordem ou um campo a menos gera outra
 * entrada e o aquecimento nao serve para nada.
 */
export type NivelInsight = 'account' | 'campaign' | 'adset' | 'ad';

export function urlDeInsights(
  accountId: string,
  level: NivelInsight,
  since: string,
  until: string,
  token: string,
  graphVersion: string,
) {
  const url = new URL(`https://graph.facebook.com/${graphVersion}/act_${accountId}/insights`);
  const identityFields = level === 'campaign'
    ? ',campaign_id,campaign_name'
    : level === 'adset'
      ? ',campaign_id,campaign_name,adset_id,adset_name'
      : level === 'ad'
        ? ',campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name'
        : '';
  url.searchParams.set('fields', `spend,ctr,cpc,cpm,frequency,clicks,inline_link_clicks,actions${identityFields}`);
  url.searchParams.set('level', level);
  url.searchParams.set('limit', '500');
  url.searchParams.set('time_range', JSON.stringify({ since, until }));
  url.searchParams.set('access_token', token);
  return url.toString();
}

export async function buscarInsights(
  accountId: string,
  level: NivelInsight,
  since: string,
  until: string,
  token: string,
  graphVersion: string,
  descreverErro: (erro: unknown, conta: string) => string,
) {
  const response = await metaCachedFetch(urlDeInsights(accountId, level, since, until, token, graphVersion), {
    ttlSeconds: 1800,
    resourceKind: `optimization-${level}`,
  });
  const payload = await response.json();
  if (!response.ok || payload.error) throw new Error(descreverErro(payload.error, accountId));
  return payload.data || [];
}

/**
 * A tela calcula o periodo no fuso do navegador. O aquecimento roda no
 * servidor, em UTC: sem converter para Brasilia, a partir das 21h ele gravaria
 * o cache de outro dia e o gestor continuaria esperando.
 */
export function diaBrasilia(diasAtras = 0) {
  const agora = new Date(Date.now() - diasAtras * 86400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(agora);
}
