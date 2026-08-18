import 'server-only';

import { startCommercialBotIfEligible } from '@/lib/commercialBot';
import { startCommercialSdrOpeningIfEligible } from '@/lib/commercialSdrAgent';

/**
 * Porta unica de primeiro contato do comercial.
 *
 * Antes todos os pontos de entrada de lead chamavam so o bot, entao ligar a IA
 * SDR na tela de IA deixava o lead sem nenhuma mensagem: a IA nao tinha gatilho
 * de entrada e so acordava se o lead escrevesse primeiro. Cada uma das funcoes
 * abaixo checa a configuracao por conta propria, e IA e bot sao mutuamente
 * exclusivos, entao no maximo uma das duas envia.
 */
export async function startCommercialFirstContact(leadId: string) {
  const bot = await startCommercialBotIfEligible(leadId);
  if (bot.started) return { mode: 'bot' as const, ...bot };

  const ai = await startCommercialSdrOpeningIfEligible(leadId);
  if (ai.started) return { mode: 'ia' as const, ...ai };

  return { mode: 'nenhum' as const, started: false, reason: `bot: ${bot.reason}; ia: ${ai.reason}` };
}
