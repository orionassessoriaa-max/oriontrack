import assert from 'node:assert/strict';
import { isClickToWhatsAppAd } from '../src/lib/receptiveAdDetection';
import { extractAgendadoValue, isSchedulePrompt, looksLikeScheduleAnswer, parseScheduledTextToDate } from '../src/lib/leadAiScheduling';

const productionInstagramPayload = {
  message: {
    content: {
      contextInfo: {
        externalAdReply: {
          ctwaClid: 'AR_TEST_CLICK_ID',
          sourceType: 'ad',
          sourceApp: 'instagram',
          sourceURL: 'https://www.instagram.com/p/DZDKdIADOw1/',
          showAdAttribution: true,
          clickToWhatsappCall: true,
        },
        conversionSource: 'FB_Ads',
        entryPointConversionApp: 'instagram',
        entryPointConversionSource: 'ctwa_ad',
      },
    },
  },
};

assert.equal(isClickToWhatsAppAd(productionInstagramPayload), true, 'Instagram CTWA real deve ser anuncio');
assert.equal(isClickToWhatsAppAd({ contextInfo: { ctwa_clid: 'legacy-id' } }), true, 'formato legado deve continuar funcionando');
assert.equal(isClickToWhatsAppAd({ contextInfo: { entryPointConversionSource: 'global_search_new_chat', entryPointConversionApp: 'whatsapp' } }), false, 'busca organica nao e anuncio');
assert.equal(isClickToWhatsAppAd({ contextInfo: { entryPointConversionSource: 'click_to_chat_link' } }), false, 'link organico nao e anuncio');

const prompt = 'Que dia e horário você está mais confortável para uma ligação rápida?';
const answer = 'Pode ser amanhã às 14h';
assert.equal(isSchedulePrompt(prompt), true, 'pergunta final deve ser reconhecida');
assert.equal(looksLikeScheduleAnswer(answer), true, 'dia e horario devem confirmar o agendamento');
assert.equal(looksLikeScheduleAnswer('Sim'), false, 'resposta vaga nao pode criar agendamento');
assert.equal(extractAgendadoValue(`Nome: Teste\nAgendado: ${answer}`), answer);

const parsed = parseScheduledTextToDate(answer, new Date('2026-09-23T15:00:00.000Z'));
assert.equal(parsed?.toISOString(), '2026-09-24T17:00:00.000Z', '14h de Sao Paulo deve ser persistido como 17h UTC');

console.log('Unity receptive flow: 9 verificacoes aprovadas.');
