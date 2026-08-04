import { supabaseAdmin } from '@/lib/supabase/admin';
import { configureUazapiWebhook, uazapiFetch, uazapiAiInstanceName, uazapiInstanceName, normalizePhone } from '@/lib/uazapi';
import { sendApoloWhatsApp } from '@/lib/apoloNotifications';

export const recentAiOutboundMessages = new Set<string>();

// Lock in-memory por leadId para evitar duplo disparo quando UAZAPI
// entrega o mesmo webhook duas vezes ao mesmo tempo
const processingLeadLocks = new Map<string, number>();
const AI_LOCK_TTL_MS = 30_000;

function cleanSignatureText(text: string) {
  return String(text || '').replace(/\s+/g, '').replace(/[\u{1F300}-\u{1FAFF}]/gu, '').toLowerCase();
}

export function registerAiOutbound(phone: string, text: string) {
  const signature = `${normalizePhone(phone)}:${cleanSignatureText(text)}`;
  recentAiOutboundMessages.add(signature);
  
  if (recentAiOutboundMessages.size > 200) {
    const first = recentAiOutboundMessages.values().next().value;
    if (first) recentAiOutboundMessages.delete(first);
  }
}

export function isAiOutbound(phone: string, text: string) {
  const signature = `${normalizePhone(phone)}:${cleanSignatureText(text)}`;
  return recentAiOutboundMessages.has(signature);
}

const AI_TEST_BROKERAGE = 'ORION TESTE';
const AI_PERSONA = 'Aline';
const DEFAULT_ELEVENLABS_VOICE_ID = '33B4UnXyTNbgLmdEDh5P';
const DEFAULT_ELEVENLABS_FALLBACK_VOICE_ID = 'EXAVITQu4vr4xnSDxMaL';

function formatAiBrokerageDisplayName(name?: string | null) {
  const rawName = String(name || '').trim();
  const cleanName = rawName.replace(/\bcorretora\b/gi, '').replace(/\s+/g, ' ').trim();

  if (/octavita/i.test(rawName)) {
    return 'Octavita Seguros';
  }

  if (/\bitael\b/i.test(rawName)) {
    return 'equipe do Itael';
  }

  return (cleanName || rawName)
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

const RUNTIME_AI_GUARDRAILS = `Regras finais obrigatórias do Orion Track:
- Antes de responder, revise ortografia, acentuação, concordância, vírgulas e pontuação.
- Escreva sempre em português do Brasil correto, com acentos, frases claras e pontuação natural.
- Toda frase enviada ao cliente deve terminar com ponto, interrogação ou exclamação.
- Nunca envie mensagens todas em minúsculas, sem acento, sem vírgulas ou sem pontuação.
- Se o prompt base tiver texto sem acento, abreviações ruins ou encoding quebrado, corrija antes de responder ao cliente.
- Não use internetês, texto truncado ou frases coladas. A mensagem precisa parecer revisada por uma pessoa.
- Nao diga que voce e IA, bot, automacao, assistente virtual ou sistema.
- Nao use prefixo de atendente, assinatura ou formato "Aline:" nas mensagens.
- Mensagens antigas de saida podem ter sido enviadas por um especialista humano. Respeite sempre o nome do remetente informado no historico.
- Nunca diga que voce enviou, montou ou passou uma cotacao que foi enviada anteriormente por outra pessoa. Diga que o especialista responsavel enviou a cotacao; se o nome estiver no historico, pode dizer "o especialista Henrique", por exemplo.
- Quando a cotacao anterior estiver ligada ao CNPJ informado, deixe claro que ela foi enviada pelo especialista e que era referente ao CNPJ. Nao assuma a autoria da cotacao.
- Se precisar se apresentar, apresente-se apenas uma vez, de forma natural.
- Nao chame o cliente pelo nome em toda mensagem. Depois da primeira abordagem, use o nome so raramente.
- Os "Dados ja conhecidos do lead" vieram do formulario. Trate esses dados como respostas ja dadas pelo cliente.
- Nunca pergunte novamente CNPJ/MEI, idades, cidade, investimento, plano ativo ou plano atual quando esses campos ja tiverem valor diferente de vazio, "-" ou "Nao informado" nos dados conhecidos.
- Depois que o cliente confirmar a cotacao/idades, a segunda pergunta obrigatoria deve ser a confirmacao do CNPJ/MEI/CPF do formulario. So depois disso siga para hospital/regiao, motivo da busca, cobertura nacional ou regional, investimento se nao veio no formulario, e-mail e agendamento de ligacao de 15 minutos.
- Se o cliente mandar apenas saudacao, como "bom dia", "boa tarde", "boa noite", "oi" ou "ola", responda a saudacao rapidamente e retome a pergunta pendente. Nunca responda "como posso ajudar hoje" quando ja existir atendimento em andamento.
- Se o cliente pedir valor, preco, mensalidade ou tabela, nunca diga que nao pode enviar pelo WhatsApp. Explique de forma natural que os valores dependem da cotacao e da rede escolhida, e ofereca chamar um especialista para passar certinho.
- Se o cliente mencionar luto, doenca, internacao, dor, cirurgia, cancer, perda de familiar ou qualquer situacao delicada, acolha primeiro com empatia real e curta. Nao acelere a venda. Pergunte se esta tudo bem continuar a cotacao.
- Se o formulario ja trouxe as principais informacoes comerciais, avance para hospital/regiao ou diretamente para e-mail/agendamento. Nao aja como se o formulario nao existisse.
- Se o cliente pedir esclarecimento sobre algo que voce acabou de perguntar (ex: "como assim?", "nao entendi", "que isso?", "pq?", "explica", "o que e isso"), reexplique de forma simples, curta e natural como uma humana faria — NAO faca handoff nesses casos.
- So faca handoff se: o cliente pedir preco exato, detalhes tecnicos de operadora, reclamar de algo, ficar claramente confuso com o fluxo (mais de 2 respostas desconexa), pedir para falar com humano, ou enviar exatamente a palavra "alvorada" sozinha. Quando for pedido de valor, pode responder ao cliente antes do handoff, sem dizer que e proibido enviar pelo WhatsApp. Nao faca handoff se "Alvorada" for parte de nome de hospital, clinica, bairro ou regiao.
- Em handoff por duvida ou confusao real, nunca mande mensagem para o cliente. O Orion Track vai chamar o humano internamente.
- Quando for pedir o agendamento, nunca use "funciona melhor". Pergunte: "Que dia e horario voce esta mais confortavel pra voce?"
- Quando o cliente responder com dia e horario, confirme o encaminhamento conforme a regra contextual de encerramento deste lead, agradeca pelo atendimento, defina handoff true e nao faca mais nenhuma pergunta.
- Em handoff por agendamento confirmado com dia e horario especificos, voce pode responder ao cliente confirmando o encaminhamento de forma curta e natural.
- Se o cliente recusar a ligacao ou reuniao, aceite sem insistir. Nao peca outro horario, nao repita o convite e nao tente convencer o cliente. Responda conforme a regra contextual de encerramento deste lead e defina handoff true.
- Se, depois do convite para ligacao, o cliente pedir para receber primeiro a cotacao, proposta, valores ou rede credenciada, considere isso uma preferencia por atendimento por mensagem e uma recusa da ligacao naquele momento. Nao explique que a ligacao e obrigatoria e nao insista. Responda conforme a regra contextual de encerramento, encerre a IA e encaminhe o lead ao responsavel.
- Nunca diga "pode mandar audio" depois que o cliente ja enviou audio ou quando a mensagem atual vier como "Audio transcrito do cliente". Se a mensagem disser que o audio nao foi transcrito, responda curto pedindo para o cliente enviar a informacao por texto.
- Priorize respostas humanas, curtas e diretas, sem cara de script.`;

export const DEFAULT_SYSTEM_PROMPT = `Voce e {persona}, uma consultora de vendas humana e simpatica da corretora de planos de saude {corretora_nome}.
Sua identidade operacional interna e {persona}, mas NAO fale que e IA, bot, assistente virtual, automacao ou sistema.
Nao assine mensagens, nao coloque prefixo de atendente e nunca comece a resposta com "{persona}:".
Nao repita seu nome em toda resposta. Se precisar se apresentar, apresente-se apenas uma vez, de forma natural.
Fale em portugues do Brasil, como uma pessoa real no WhatsApp: humana, simpatica, simples, objetiva, sem cara de script.
Sua missao e confirmar o interesse, coletar as informacoes essenciais pendentes e oferecer uma ligacao rapida de 15 minutos somente se o cliente aceitar. A ligacao nunca e obrigatoria.

Dados ja conhecidos do lead:
{lead_facts}

== REGRA PRINCIPAL: LEIA A MENSAGEM INTEIRA ANTES DE RESPONDER ==
O cliente pode mandar em UMA SO MENSAGEM varias informacoes de uma vez (CNPJ, operadora preferida, hospital, numero de pessoas, investimento, etc.).
Voce DEVE:
1. Extrair TUDO que o cliente informou na mensagem, mesmo que nao fosse exatamente o que voce ia perguntar agora.
2. Registrar tudo no summary imediatamente.
3. Confirmar o que voce entendeu de forma natural e resumida em UMA frase, como uma consultora humana faria.
4. Em seguida, fazer APENAS UMA pergunta sobre o proximo dado que ainda falta.

Exemplo real: voce ia perguntar CNPJ/CPF, mas o cliente respondeu "cnpj para um plano sulamerica nacional para minhas 3 filhas mantendo o hospital einstein".
Resposta ideal: "Entendi, [Nome]! Vou cotar no CNPJ para suas 3 filhas, mantendo o Einstein — isso mesmo, certo?"
Ai voce espera a confirmacao e ja parte para a proxima pendencia (investimento, email, ou agendamento).

NUNCA faca mais de uma pergunta por mensagem.
NUNCA repita uma pergunta ja respondida — nem nos dados conhecidos, nem no historico da conversa.
NUNCA siga uma ordem rigida se o cliente ja adiantou informacoes — pule direto para o que ainda falta.

== INFORMACOES QUE VOCE PRECISA COLETAR (somente o que ainda estiver pendente) ==

IMPORTANTE: os campos em "Dados ja conhecidos do lead" vieram do formulario. Se um campo ja tem valor util, ele ja foi respondido. Nao pergunte novamente e nao aja como se estivesse vazio.

- CNPJ/MEI ou CPF: o plano sera via empresa (CNPJ ou MEI) ou pessoa fisica (CPF)?
  Pergunte somente se "Possui CNPJ/MEI" estiver vazio, "-" ou "Nao informado". Use um tom natural, por exemplo: "Voce quer que eu faca a cotacao usando seu CPF ou teria um CNPJ ativo? Te pergunto so pra saber qual cotacao faz mais sentido pra voce."
- Idades e quantidade de pessoas: quem vai usar o plano? Quantas pessoas?
  Pergunte somente se "Idade(s)" estiver vazio, "-" ou "Nao informado". Se as idades ja vieram do formulario, a primeira mensagem ja confirmou isso.
- Hospital ou clinica de preferencia na regiao.
- Necessidade especifica: prevencao, urgencia ou atendimento especifico?
- Cobertura nacional ou regional?
- Investimento pretendido: quanto estao dispostos a investir?
  Pergunte somente se "Investimento pretendido" estiver vazio, "-" ou "Nao informado".
- E-mail para envio da proposta.
- Agendamento de ligacao rapida de 15 minutos: peca dia e horario especificos usando exatamente a ideia "Que dia e horario voce esta mais confortavel pra voce?".

== TOM E ESTILO ==
- Respostas curtas: 1 a 3 frases no maximo. Evite textao.
- Use o primeiro nome do cliente no maximo na primeira abordagem ou quando ficar realmente natural. Nao repita o nome em mensagens consecutivas.
- Proibido linguagem corporativa: "daremos continuidade", "estarei verificando", "com base nas informacoes fornecidas" etc.
- Nao comece toda resposta com "Perfeito", "Entendi" ou "Certo". Varie ou va direto ao ponto.
- Tom conversado: "Boa", "show", "me diz uma coisa", "pra eu te direcionar melhor", sem exagerar em girias.
- Nao use ponto de exclamacao em toda mensagem.
- Depois da primeira confirmacao da cotacao/idades, confirme se a simulacao sera empresarial (CNPJ/MEI) ou pelo CPF antes de perguntar hospital/regiao.
- Pedido de valores/precos: nao diga que nao pode enviar no WhatsApp. Diga que os valores dependem da cotacao e que pode chamar um especialista para passar certinho.
- Situações sensíveis: se o cliente disser que perdeu alguem, esta doente, internado, com dor, em cirurgia ou cuidando de familiar, acolha primeiro. Exemplo de tom: "Sinto muito por isso. Espero que fique tudo bem por ai. Se estiver tudo bem para voce, posso continuar a cotacao?"

== HANDOFF (Transferencia para Especialista) ==
- Agendamento so e concluido com DIA e HORARIO ESPECIFICOS (ex: "amanha as 14h", "quinta as 10h").
- Se o cliente disser "sim", "posso" ou algo vago: pergunte qual dia e horario especificos.
- Ao pedir dia e horario, nao escreva "funciona melhor". Escreva de forma humana: "Que dia e horario voce esta mais confortavel pra voce?"
- Ao cliente responder dia e horario: preencha *Agendado* no summary, defina "handoff": true e responda conforme a regra contextual de encerramento deste lead, confirmando o agendamento e agradecendo. Depois disso nao pergunte mais nada.
- Se o cliente disser que nao quer ligacao/reuniao, que prefere nao falar por telefone ou pedir para continuar por mensagem: nao insista e nao faca nova pergunta. Responda conforme a regra contextual de encerramento deste lead e defina "handoff": true.
- Se o cliente pedir cotacao, proposta ou rede credenciada antes de aceitar a ligacao, nao tente convence-lo a ligar. Responda conforme a regra contextual de encerramento deste lead, defina "handoff": true e encerre.
- Handoff silencioso ("handoff": true, "reply": "") se: cliente pedir detalhes tecnicos de operadora, reclamar, pedir para falar com humano, ou enviar exatamente "alvorada" como mensagem isolada. Para pedido de valor/preco, responda de forma gentil oferecendo chamar um especialista e defina handoff true. Nao use essa regra quando Alvorada for hospital, clinica, bairro ou regiao.
- Se o cliente pedir esclarecimento ("como assim?", "nao entendi", "pq?"): reexplique de forma simples e natural — NAO faca handoff.

Nao envie ao cliente nomes de ferramentas internas. O resumo (summary) fica apenas no banco interno.

Use o campo summary para registrar tudo que souber, exatamente neste formato:
*Nome*: [nome]
*Telefone*: [telefone]
*Idades*: [idades]
*CNPJ/MEI*: [cnpj/mei/pf]
*Cidade*: [cidade]
*Investimento*: [investimento]
*Plano Atual*: [plano atual]
*Motivo*: [motivo]
*Hospital/Regiao*: [hospital/regiao]
*Email*: [email]
*Agendado*: [dia e horario combinados, ex: "Terca-feira as 14:00". Se nao agendou: "Nao"]
*Pendente*: [o que ainda falta coletar]

Responda APENAS JSON valido, sem markdown, no formato:
{"reply":"mensagem para enviar ao cliente","handoff":false,"summary":"resumo atualizado do atendimento"}`;

type ProfileRow = {
  id: string;
  nome: string | null;
  email?: string | null;
  email_real?: string | null;
  tipo_usuario: string | null;
  corretor_id?: string | null;
  nome_empresa?: string | null;
  telefone?: string | null;
  ai_instance_name?: string | null;
};

function aiInstanceName(profile: ProfileRow) {
  return profile.ai_instance_name || uazapiInstanceName(profile.id);
}

type LeadRow = {
  id: string;
  corretor_id: string;
  nome: string | null;
  telefone: string | null;
  idades?: string | null;
  possui_cnpj?: string | null;
  cnpj?: string | null;
  tem_plano_ativo?: string | null;
  plano_atual?: string | null;
  investimento?: string | null;
  cidade?: string | null;
  email?: string | null;
  motivo_busca?: string | null;
  hospital_preferencia?: string | null;
  utm_content?: string | null;
  utm_term?: string | null;
  utm_campaign?: string | null;
  utm_medium?: string | null;
  utm_source?: string | null;
  responsavel_profile_id?: string | null;
};

type HandoffContactMode = 'same_whatsapp' | 'different_responsible' | 'unassigned';

function sameBrokerage(value?: string | null) {
  return String(value || '').trim().toUpperCase() === AI_TEST_BROKERAGE;
}

function plain(value?: unknown, fallback = 'Nao informado') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function leadFirstName(lead: LeadRow, fallback = 'tudo bem') {
  const fullName = plain(lead.nome, fallback).replace(/\s+/g, ' ').trim();
  const first = fullName.split(/\s+/)[0]?.trim();
  return first || fallback;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function customerFacingNameOnly(text: string, lead: LeadRow) {
  const fullName = plain(lead.nome, '').replace(/\s+/g, ' ').trim();
  const firstName = leadFirstName(lead, '');
  if (!fullName || !firstName || fullName.toLowerCase() === firstName.toLowerCase()) return text;

  return text.replace(new RegExp(escapeRegExp(fullName), 'gi'), firstName);
}

function removeLeadVocative(text: string, lead: LeadRow) {
  const firstName = leadFirstName(lead, '').trim();
  if (!firstName) return text;

  const escaped = escapeRegExp(firstName);
  return text
    .replace(new RegExp(`(^|[.!?]\\s+)${escaped}[,!:.]?\\s+`, 'gi'), '$1')
    .replace(new RegExp(`,\\s*${escaped}([!.?])`, 'gi'), '$1')
    .replace(new RegExp(`\\b(Perfeito|Legal|Boa|Show|Otimo|Ótimo|Certo|Entendi),\\s*${escaped}([!.?])`, 'gi'), '$1$2')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function customerReplyForFollowUp(text: string, lead: LeadRow, hasPreviousAiMessage: boolean) {
  const firstNameOnly = customerFacingNameOnly(text, lead);
  const withoutRepeatedName = hasPreviousAiMessage ? removeLeadVocative(firstNameOnly, lead) : firstNameOnly;
  return polishAiReply(withoutRepeatedName);
}

function hasKnownValue(value?: unknown) {
  const text = String(value ?? '').trim();
  if (!text) return false;
  return !['-', 'nao informado', 'não informado', 'sem informacao', 'sem informação'].includes(text.toLowerCase());
}

function adName(lead: LeadRow) {
  return plain(lead.utm_content || lead.utm_term || lead.utm_campaign || lead.utm_medium || lead.utm_source);
}

function handoffContactMode(lead: LeadRow, adminProfile: ProfileRow): HandoffContactMode {
  if (!lead.responsavel_profile_id) return 'unassigned';
  if (adminProfile.ai_instance_name) return 'different_responsible';
  return lead.responsavel_profile_id === adminProfile.id
    ? 'same_whatsapp'
    : 'different_responsible';
}

function handoffContactRule(mode: HandoffContactMode) {
  if (mode === 'same_whatsapp') {
    return [
      'Regra obrigatoria para o encerramento deste lead:',
      '- A IA esta no mesmo WhatsApp do responsavel que recebera o lead.',
      '- Diga que um especialista da equipe vai entrar em contato para prosseguir com o atendimento.',
      '- Nao diga "por outro numero" e nao diga "vou continuar por aqui".',
    ].join('\n');
  }
  if (mode === 'different_responsible') {
    return [
      'Regra obrigatoria para o encerramento deste lead:',
      '- O responsavel pelo lead usa outro WhatsApp.',
      '- Avise que um especialista da equipe vai entrar em contato por outro numero para prosseguir com o atendimento.',
    ].join('\n');
  }
  return [
    'Regra obrigatoria para o encerramento deste lead:',
    '- O lead ainda nao possui um responsavel definido.',
    '- Use uma mensagem neutra: "Nossa equipe continuara seu atendimento em breve."',
    '- Nao prometa nome nem numero de contato.',
  ].join('\n');
}

function leadFacts(lead: LeadRow) {
  return [
    `Nome: ${plain(lead.nome)}`,
    `Telefone: ${plain(lead.telefone)}`,
    `Idade(s): ${plain(lead.idades)}`,
    `Cidade: ${plain(lead.cidade)}`,
    `Possui CNPJ/MEI: ${plain(lead.possui_cnpj)}`,
    lead.cnpj ? `CNPJ informado: ${lead.cnpj}` : null,
    `Investimento pretendido: ${plain(lead.investimento)}`,
    `Tem plano de saude: ${plain(lead.tem_plano_ativo)}`,
    `Plano atual: ${plain(lead.plano_atual)}`,
    lead.email ? `E-mail: ${lead.email}` : null,
    lead.motivo_busca ? `Motivo da busca: ${lead.motivo_busca}` : null,
    lead.hospital_preferencia ? `Hospital/Região de preferência: ${lead.hospital_preferencia}` : null,
    `Anuncio: ${adName(lead)}`,
  ].filter(Boolean).join('\n');
}

function initialLeadQuestion(lead: LeadRow) {
  if (hasKnownValue(lead.idades)) {
    return `Você gostaria de receber uma cotação para as idades ${plain(lead.idades, '')}, correto?`;
  }

  return 'Você gostaria de receber uma cotação, correto?';
}

function splitReply(text: string) {
  return text
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 4);
}

function stripPersonaPrefix(text: string) {
  return text
    .replace(/^\s*(?:aline|aline\s+ia|ia\s+aline)\s*[:\-–—]\s*/i, '')
    .trim();
}

function fixPortugueseMojibake(text: string) {
  const replacements: Array<[RegExp, string]> = [
    [/VocÃª/g, 'Você'], [/vocÃª/g, 'você'],
    [/cotaÃ§Ã£o/g, 'cotação'], [/CotaÃ§Ã£o/g, 'Cotação'],
    [/simulaÃ§Ã£o/g, 'simulação'], [/SimulaÃ§Ã£o/g, 'Simulação'],
    [/informaÃ§Ãµes/g, 'informações'], [/opÃ§Ãµes/g, 'opções'], [/opÃ§Ã£o/g, 'opção'],
    [/saÃºde/g, 'saúde'], [/regiÃ£o/g, 'região'], [/RegiÃ£o/g, 'Região'],
    [/preferÃªncia/g, 'preferência'], [/prevenÃ§Ã£o/g, 'prevenção'], [/urgÃªncia/g, 'urgência'],
    [/especÃ­fico/g, 'específico'], [/Ã¡udio/g, 'áudio'], [/Ãudio/g, 'Áudio'],
    [/ligaÃ§Ã£o/g, 'ligação'], [/nÃºmero/g, 'número'], [/horÃ¡rio/g, 'horário'],
    [/amanhÃ£/g, 'amanhã'], [/terÃ§a/g, 'terça'], [/sÃ¡bado/g, 'sábado'],
    [/nÃ£o/g, 'não'], [/NÃ£o/g, 'Não'], [/estÃ¡/g, 'está'], [/estÃ£o/g, 'estão'],
    [/tambÃ©m/g, 'também'], [/Ã§/g, 'ç'], [/Ã£/g, 'ã'], [/Ã¡/g, 'á'],
    [/Ã©/g, 'é'], [/Ã­/g, 'í'], [/Ã³/g, 'ó'], [/Ãº/g, 'ú'],
    [/â€”/g, '—'], [/â€“/g, '–'], [/Âº/g, 'º'], [/Âª/g, 'ª'],
  ];

  return replacements.reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), String(text || ''));
}

function polishAiReply(text: string) {
  let polished = fixPortugueseMojibake(text)
    .replace(/\bvoce\b/gi, 'você')
    .replace(/\bcotacao\b/gi, 'cotação')
    .replace(/\bsimulacao\b/gi, 'simulação')
    .replace(/\binformacoes\b/gi, 'informações')
    .replace(/\bopcoes\b/gi, 'opções')
    .replace(/\bopcao\b/gi, 'opção')
    .replace(/\bsaude\b/gi, 'saúde')
    .replace(/\bligacao\b/gi, 'ligação')
    .replace(/\bnumero\b/gi, 'número')
    .replace(/\bhorario\b/gi, 'horário')
    .replace(/\bregiao\b/gi, 'região')
    .replace(/\bpreferencia\b/gi, 'preferência')
    .replace(/\bclinica\b/gi, 'clínica')
    .replace(/\bprevencao\b/gi, 'prevenção')
    .replace(/\burgencia\b/gi, 'urgência')
    .replace(/\bespecifico\b/gi, 'específico')
    .replace(/\baudio\b/gi, 'áudio')
    .replace(/\bamanha\b/gi, 'amanhã')
    .replace(/\bterca\b/gi, 'terça')
    .replace(/\bsabado\b/gi, 'sábado')
    .replace(/\bnao\b/gi, 'não')
    .replace(/\btambem\b/gi, 'também')
    .replace(/\besta\b/gi, 'está')
    .replace(/\bestao\b/gi, 'estão')
    .replace(/\bsera\b/gi, 'será')
    .replace(/\bja\b/gi, 'já')
    .replace(/\bso\b/gi, 'só')
    .replace(/\bapos\b/gi, 'após')
    .replace(/\bduvida\b/gi, 'dúvida')
    .replace(/\bduvidas\b/gi, 'dúvidas')
    .replace(/\bresponsavel\b/gi, 'responsável')
    .replace(/\bresponsaveis\b/gi, 'responsáveis')
    .replace(/\bconfortavel\b/gi, 'confortável')
    .replace(/\binformacao\b/gi, 'informação')
    .replace(/\s+([,.!?;:])/g, '$1')
    .replace(/([,.!?;:])(?=\S)/g, '$1 ')
    .replace(/[^\S\r\n]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();

  if (!polished) return '';

  polished = polished.replace(/(^|[.!?]\s+)([a-záàâãéêíóôõúç])/g, (_full, prefix, letter) => `${prefix}${letter.toUpperCase()}`);
  if (!/[.!?)]$/.test(polished)) polished += '.';

  return polished;
}

function parseAiJson(raw: string) {
  const clean = raw.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
  try {
    const parsed = JSON.parse(clean);
    return {
      ...parsed,
      reply: polishAiReply(stripPersonaPrefix(String(parsed?.reply || ''))),
    };
  } catch {
    return { reply: polishAiReply(stripPersonaPrefix(clean)), handoff: false, summary: '' };
  }
}

function shouldSuppressHandoffReply(reply: string, handoff?: boolean) {
  if (!handoff) return false;
  const normalized = reply
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  return (
    normalized.includes('vou passar seu contato') ||
    normalized.includes('passar seu contato para') ||
    normalized.includes('passar para o especialista') ||
    normalized.includes('passar para nosso especialista') ||
    normalized.includes('ajudar da melhor forma')
  );
}

function normalizeAiText(text?: string | null) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function isInitialConfirmationQuestion(text?: string | null) {
  const normalized = normalizeAiText(text);
  return (
    normalized.includes('voce gostaria de receber uma cotacao') &&
    normalized.includes('correto')
  );
}

function isAffirmativeAnswer(text?: string | null) {
  const normalized = normalizeAiText(text);
  return /\b(sim|isso|correto|certo|ok|okay|pode|quero|gostaria|confirmo|perfeito|ta certo|esta certo)\b/.test(normalized);
}

function isGreetingOnly(text?: string | null) {
  const normalized = normalizeAiText(text)
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return false;

  return /^(oi|ola|ol[aá]|bom dia|boa tarde|boa noite|e ai|eae|opa)( tudo bem| tudo bom| tudo certo| beleza)?$/.test(normalized);
}

function isValueRequest(text?: string | null) {
  const normalized = normalizeAiText(text);
  return (
    /\b(valor|valores|preco|precos|preco exato|mensalidade|tabela|quanto custa|quanto fica|quanto sai|qual o valor|passa o valor|me passa o valor|manda o valor|simulacao pronta)\b/.test(normalized) ||
    /\br\$\s*\d/i.test(String(text || ''))
  );
}

function isCallRefusal(text?: string | null, previousOutboundText?: string | null) {
  const normalized = normalizeAiText(text)
    .replace(/[!?.,;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return false;

  const directRefusal = (
    /\b(nao|nunca|sem)\b.{0,24}\b(ligacao|ligar|telefone|reuniao|reuniao|chamada|call)\b/.test(normalized) ||
    /\b(prefiro|quero|gostaria)\b.{0,24}\b(por mensagem|por aqui|sem ligacao|sem reuniao)\b/.test(normalized) ||
    /\b(ligacao|reuniao|chamada|call)\b.{0,24}\b(nao|nunca)\b/.test(normalized)
  );
  if (directRefusal) return true;

  if (!isSchedulePrompt(previousOutboundText)) return false;

  const asksForMaterialFirst =
    /\b(me envie|envie|manda|mande|quero receber|quero ver|ver primeiro|receber primeiro|primeiro)\b.{0,80}\b(cotacao|proposta|valor|valores|rede|rede credenciada|hospitais|tabela)\b/.test(normalized) ||
    /\b(cotacao|proposta|valor|valores|rede|rede credenciada|hospitais|tabela)\b.{0,80}\b(primeiro|antes|por mensagem|por aqui)\b/.test(normalized);

  return asksForMaterialFirst || /^(nao precisa|deixa pra la|deixa assim|prefiro por aqui|por mensagem)$/.test(normalized);
}

function callRefusalHandoffReply(lead: LeadRow, mode: HandoffContactMode) {
  if (mode === 'different_responsible') {
    return polishAiReply(`Sem problema, ${leadFirstName(lead)}. Um especialista da nossa equipe vai entrar em contato por outro numero para enviar a cotacao e prosseguir com seu atendimento. Obrigada!`);
  }
  if (mode === 'unassigned') {
    return polishAiReply(`Sem problema, ${leadFirstName(lead)}. Nossa equipe continuara seu atendimento em breve. Obrigada!`);
  }
  return polishAiReply(`Sem problema, ${leadFirstName(lead)}. Um especialista da nossa equipe vai entrar em contato para enviar a cotacao e prosseguir com seu atendimento. Obrigada!`);
}

function isSensitivePersonalSituation(text?: string | null) {
  const normalized = normalizeAiText(text);
  return /\b(perdi minha mae|perdi meu pai|perdi minha esposa|perdi meu marido|falecimento|faleceu|luto|morreu|doente|doenca|internad|internacao|hospitalizad|cirurgia|cancer|quimio|dor|acidente|uti|emergencia na familia)\b/.test(normalized);
}

function isCnpjConfirmationQuestion(text?: string | null) {
  const normalized = normalizeAiText(text);
  return (
    normalized.includes('simulacao empresarial') ||
    normalized.includes('simulacao pelo cpf') ||
    normalized.includes('cnpj/mei ou pelo cpf')
  );
}

function cnpjModeFromLead(lead: LeadRow) {
  const normalized = normalizeAiText(lead.possui_cnpj);
  if (!hasKnownValue(lead.possui_cnpj)) return 'unknown';
  if (normalized.includes('mei')) return 'mei';
  if (normalized.includes('nao') || normalized.includes('sem cnpj') || normalized.includes('cpf')) return 'cpf';
  return 'business';
}

function cnpjConfirmationReply(lead: LeadRow) {
  const firstName = leadFirstName(lead);
  const mode = cnpjModeFromLead(lead);

  if (mode === 'mei') {
    return `Legal, ${firstName}! Vi aqui que voce mencionou que tem MEI, esta certinho? So para confirmar se fazemos a simulacao empresarial.`;
  }

  if (mode === 'business') {
    return `Legal, ${firstName}! Vi aqui que voce mencionou que tem CNPJ, esta certinho? So para confirmar se fazemos a simulacao empresarial.`;
  }

  if (mode === 'cpf') {
    return `Legal, ${firstName}! Vi aqui que voce mencionou que nao tem CNPJ, esta certinho? So para confirmar se fazemos a simulacao pelo CPF.`;
  }

  return `Legal, ${firstName}! So para eu te direcionar certinho: a simulacao seria pelo CNPJ/MEI ou pelo CPF?`;
}

function nextQuestionAfterCnpjConfirmation(lead: LeadRow) {
  const firstName = leadFirstName(lead);

  if (!hasKnownValue(lead.hospital_preferencia)) {
    return `Perfeito, ${firstName}! Tem algum hospital ou clinica de preferencia na sua regiao?`;
  }

  if (!hasKnownValue(lead.motivo_busca)) {
    return `Perfeito, ${firstName}! E qual e o motivo da sua busca por um novo plano de saude? E algo mais preventivo, urgente ou tem algum atendimento especifico?`;
  }

  if (!hasKnownValue(lead.email)) {
    return `Perfeito, ${firstName}! Qual o melhor e-mail para eu deixar a proposta organizada?`;
  }

  return `Perfeito, ${firstName}. Com essas informacoes, consigo analisar seu perfil e te apresentar as melhores opcoes com mais clareza.\n\nQue dia e horario voce esta mais confortavel para uma ligacao rapida de 15 minutos?`;
}

function isSchedulePrompt(text?: string | null) {
  const normalized = normalizeAiText(text);
  return (
    normalized.includes('ligacao rapida de 15 minutos') ||
    normalized.includes('ligacao de 15 minutos') ||
    normalized.includes('ligacao rapida') ||
    normalized.includes('dia e horario') ||
    normalized.includes('dia e hora') ||
    normalized.includes('horario voce esta mais confortavel') ||
    normalized.includes('mais confortavel pra voce') ||
    normalized.includes('mais confortavel para voce') ||
    normalized.includes('disponibilidade para uma ligacao') ||
    normalized.includes('quando fica melhor') ||
    normalized.includes('qual melhor horario') ||
    normalized.includes('melhor horario')
  );
}

function looksLikeScheduleAnswer(text?: string | null) {
  const normalized = normalizeAiText(text);
  if (!normalized.trim()) return false;

  const hasFlexibleDay =
    /\b(hoje|amanha|segunda|terca|quarta|quinta|sexta|sabado|domingo)\b/.test(normalized) ||
    /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/.test(normalized);
  const hasFlexibleTime =
    /\b\d{1,2}\s*h(?:oras?)?\b/.test(normalized) ||
    /\b\d{1,2}:\d{2}\b/.test(normalized) ||
    /\b(?:as|a partir das|depois das|antes das)\s*\d{1,2}\b/.test(normalized) ||
    /\b(manha|tarde|noite)\b/.test(normalized);

  if (hasFlexibleDay && hasFlexibleTime) return true;

  const hasDay =
    /\b(hoje|amanha|segunda|terca|terça|quarta|quinta|sexta|sabado|sábado|domingo)\b/.test(normalized) ||
    /\b\d{1,2}\/\d{1,2}\b/.test(normalized);
  const hasTime =
    /\b\d{1,2}\s*h(?:oras?)?\b/.test(normalized) ||
    /\b\d{1,2}:\d{2}\b/.test(normalized) ||
    /\b(?:as|às)\s*\d{1,2}\b/.test(normalized);

  return hasDay && hasTime;
}

function handoffScheduleReply(lead: LeadRow, mode: HandoffContactMode) {
  if (mode === 'different_responsible') {
    return polishAiReply(`Perfeito, ${leadFirstName(lead)}. Um especialista vai entrar em contato por outro numero para confirmar esse agendamento. Obrigada pelo atendimento.`);
  }
  if (mode === 'unassigned') {
    return polishAiReply(`Perfeito, ${leadFirstName(lead)}. Nossa equipe entrara em contato em breve para confirmar esse agendamento. Obrigada pelo atendimento.`);
  }
  return polishAiReply(`Perfeito, ${leadFirstName(lead)}. Um especialista vai entrar em contato para confirmar esse agendamento. Obrigada pelo atendimento.`);
}

function appendSummaryLine(summary: string | null | undefined, line: string) {
  const base = String(summary || '').trim();
  return base ? `${base}\n${line}` : line;
}

async function finalizeScheduledHandoff(params: {
  session: any;
  lead: LeadRow;
  conversationId: string;
  adminProfile: ProfileRow;
  aiConfig: any;
  customerMessage: string;
  incomingWasAudio?: boolean;
}) {
  const { session, lead, conversationId, adminProfile, aiConfig, customerMessage, incomingWasAudio } = params;
  let summary = appendSummaryLine(session.summary || leadFacts(lead), `*Agendado*: ${customerMessage.trim()}`);
  summary = appendSummaryLine(summary, 'IA encerrada: agendamento informado pelo cliente e enviado para o responsavel.');
  const reply = handoffScheduleReply(lead, handoffContactMode(lead, adminProfile));

  if (incomingWasAudio) {
    try {
      registerAiOutbound(lead.telefone || '', 'Mensagem de voz');
      const payload = await sendAiAdminAudio(adminProfile, lead.telefone || '', reply);
      await insertMessage(conversationId, 'outbound', aiConfig.persona, 'Mensagem de voz', {
        ...(payload || {}),
        instance: aiInstanceName(adminProfile),
        provider_message_id: providerMessageId(payload),
        ai_agent: aiConfig.persona,
        ai_text: reply,
        messageType: 'audioMessage',
        mediaType: 'audio',
        mediatype: 'audio',
        mimetype: 'audio/mpeg',
        fileName: 'aline-resposta.mp3',
      });
    } catch (audioErr) {
      console.error('[lead_ai_agent] Failed sending scheduled handoff audio, falling back to text:', audioErr);
      registerAiOutbound(lead.telefone || '', reply);
      const payload = await sendAiAdminText(adminProfile, lead.telefone || '', reply);
      await insertMessage(conversationId, 'outbound', aiConfig.persona, reply, {
        ...(payload || {}),
        instance: aiInstanceName(adminProfile),
        ai_agent: aiConfig.persona,
      });
    }
  } else {
    registerAiOutbound(lead.telefone || '', reply);
    const payload = await sendAiAdminText(adminProfile, lead.telefone || '', reply);
    await insertMessage(conversationId, 'outbound', aiConfig.persona, reply, {
      ...(payload || {}),
      instance: aiInstanceName(adminProfile),
      ai_agent: aiConfig.persona,
    });
  }

  await supabaseAdmin
    .from('lead_ai_sessions')
    .update({
      status: 'handoff',
      summary,
      last_customer_message_at: new Date().toISOString(),
      last_ai_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', session.id);

  await updateLeadFromSummary(lead.id, summary);
  await notifyResponsible(lead, summary);
  const scheduledVal = extractAgendadoValue(summary);
  if (scheduledVal) {
    await createAutoScheduledTask(lead, scheduledVal, adminProfile.id);
  }

  return { handled: true, handoff: true, deterministic: 'scheduled_handoff' };
}

async function handoffAiFailure(params: {
  session: any;
  lead: LeadRow;
  reason: string;
}) {
  const { session, lead, reason } = params;
  const summary = appendSummaryLine(
    session.summary || leadFacts(lead),
    `IA encerrada: ${reason}`
  );

  const { data: updatedSession, error: updateError } = await supabaseAdmin
    .from('lead_ai_sessions')
    .update({
      status: 'handoff',
      summary,
      updated_at: new Date().toISOString(),
    })
    .eq('id', session.id)
    .eq('status', 'active')
    .select('id')
    .maybeSingle();

  if (updateError) {
    console.error('[lead_ai_agent] Failed to mark failed AI session as handoff:', updateError);
    return { handled: true, handoff: true, reason, error: updateError };
  }

  if (!updatedSession) {
    return { handled: true, handoff: true, reason, alreadyClosed: true };
  }

  await updateLeadFromSummary(lead.id, summary);
  await notifyResponsible(lead, summary);

  return { handled: true, handoff: true, reason };
}

function providerMessageId(payload: any) {
  return String(
    payload?.key?.id ||
    payload?.message?.key?.id ||
    payload?.data?.key?.id ||
    payload?.id ||
    ''
  ).trim() || null;
}

async function findBroker(corretorId: string) {
  const { data } = await supabaseAdmin
    .from('corretores')
    .select('id, nome, nome_empresa')
    .eq('id', corretorId)
    .maybeSingle();

  return data;
}

async function findAiAdmin(corretorId: string, preferredProfileId?: string | null): Promise<ProfileRow | null> {
  const { data: broker } = await supabaseAdmin
    .from('corretores')
    .select('id, nome_empresa')
    .eq('id', corretorId)
    .maybeSingle();

  if (!broker?.nome_empresa) return null;

  const { data: brokerageCorretores } = await supabaseAdmin
    .from('corretores')
    .select('id')
    .eq('nome_empresa', broker.nome_empresa);

  const brokerageCorretorIds = (brokerageCorretores || []).map((item) => item.id);
  const allowedCorretorIds = brokerageCorretorIds.length ? brokerageCorretorIds : [corretorId];

  if (preferredProfileId) {
    const { data: preferred } = await supabaseAdmin
      .from('profiles')
      .select('id, nome, email, email_real, tipo_usuario, corretor_id, nome_empresa, telefone')
      .eq('id', preferredProfileId)
      .in('corretor_id', allowedCorretorIds)
      .in('tipo_usuario', ['corretor_admin', 'corretor'])
      .in('status', ['active', 'ativo', 'Ativo'])
      .maybeSingle();

    if (preferred) return preferred;
  }

  const { data: admins } = await supabaseAdmin
    .from('profiles')
    .select('id, nome, email, email_real, tipo_usuario, corretor_id, nome_empresa, telefone')
    .in('corretor_id', allowedCorretorIds)
    .in('tipo_usuario', ['corretor_admin', 'corretor'])
    .in('status', ['active', 'ativo', 'Ativo'])
    .order('tipo_usuario', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(10);

  const activeAdmins = admins || [];
  const configuredPhone = normalizePhone(process.env.ORION_TEST_AI_ADMIN_PHONE || '');
  const phoneMatch = configuredPhone
    ? activeAdmins.find((profile) => normalizePhone(profile.telefone) === configuredPhone)
    : null;

  return (
    phoneMatch ||
    activeAdmins.find((profile) => profile.tipo_usuario === 'corretor_admin' && normalizePhone(profile.telefone)) ||
    activeAdmins.find((profile) => profile.tipo_usuario === 'corretor' && normalizePhone(profile.telefone)) ||
    activeAdmins.find((profile) => profile.tipo_usuario === 'corretor_admin') ||
    activeAdmins[0] ||
    null
  );
}

async function findResponsibleProfile(profileId?: string | null) {
  if (!profileId) return null;
  const { data } = await supabaseAdmin
    .from('profiles')
    .select('id, nome, email, tipo_usuario, telefone')
    .eq('id', profileId)
    .maybeSingle();

  return data;
}

async function getOrCreateConversation(lead: LeadRow) {
  const phone = normalizePhone(lead.telefone);
  if (!phone) return null;

  const { data: existing } = await supabaseAdmin
    .from('whatsapp_conversas')
    .select('*')
    .eq('corretor_id', lead.corretor_id)
    .eq('lead_id', lead.id)
    .order('ultima_mensagem_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (existing) return existing;

  const { data: previousConversation } = await supabaseAdmin
    .from('whatsapp_conversas')
    .select('*')
    .eq('corretor_id', lead.corretor_id)
    .eq('telefone', phone)
    .order('ultima_mensagem_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (previousConversation) {
    const { data: reusedConversation, error: reuseError } = await supabaseAdmin
      .from('whatsapp_conversas')
      .update({
        lead_id: lead.id,
        nome_contato: lead.nome || previousConversation.nome_contato || phone,
        status: 'aberta',
        updated_at: new Date().toISOString(),
      })
      .eq('id', previousConversation.id)
      .select('*')
      .single();

    if (reuseError) throw reuseError;
    return reusedConversation;
  }

  const { data, error } = await supabaseAdmin
    .from('whatsapp_conversas')
    .insert([{
      corretor_id: lead.corretor_id,
      lead_id: lead.id,
      telefone: phone,
      nome_contato: lead.nome || phone,
      status: 'aberta',
      ultima_mensagem_at: new Date().toISOString(),
    }])
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

async function insertMessage(conversaId: string, direction: 'inbound' | 'outbound', remetente: string, mensagem: string, metadata: any = {}) {
  const { data, error } = await supabaseAdmin
    .from('whatsapp_mensagens')
    .insert([{
      conversa_id: conversaId,
      direction,
      remetente,
      mensagem,
      provider_message_id: metadata?.provider_message_id || providerMessageId(metadata),
      metadata,
    }])
    .select('*')
    .single();

  if (error) throw error;

  await supabaseAdmin
    .from('whatsapp_conversas')
    .update({ ultima_mensagem_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', conversaId);

  return data;
}

async function sendAiAdminText(adminProfile: ProfileRow, phone: string, text: string) {
  const instance = aiInstanceName(adminProfile);
  return uazapiFetch('/send/text', {
    method: 'POST',
    body: JSON.stringify({ number: normalizePhone(phone), text }),
  }, { instanceName: instance });
}

function cleanTextForSpeech(text: string) {
  return text
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, '')
    .replace(/\bCNPJ\b/gi, 'C N P J')
    .replace(/\bMEI\b/gi, 'M E I')
    .replace(/\bPME\b/gi, 'P M E')
    .replace(/\bCPF\b/gi, 'C P F')
    .replace(/\bHapvida\b/gi, 'Hapvida')
    .replace(/\s+/g, ' ')
    .trim();
}

function numberToPortuguese(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  const n = Math.trunc(Math.abs(value));
  const units = 'zero um dois tres quatro cinco seis sete oito nove'.split(' ');
  const teens = 'dez onze doze treze quatorze quinze dezesseis dezessete dezoito dezenove'.split(' ');
  const tens = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
  const hundreds = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];
  if (n < 10) return units[n];
  if (n < 20) return teens[n - 10];
  if (n < 100) return `${tens[Math.floor(n / 10)]}${n % 10 ? ` e ${units[n % 10]}` : ''}`;
  if (n === 100) return 'cem';
  if (n < 1000) return `${hundreds[Math.floor(n / 100)]}${n % 100 ? ` e ${numberToPortuguese(n % 100)}` : ''}`;
  if (n < 1000000) {
    const thousands = Math.floor(n / 1000);
    const rest = n % 1000;
    return `${thousands === 1 ? 'mil' : `${numberToPortuguese(thousands)} mil`}${rest ? ` e ${numberToPortuguese(rest)}` : ''}`;
  }
  return String(value);
}

function expandPortugueseSpeechNumbers(text: string) {
  return text
    .replace(/R\$\s*([\d.]+)(?:,(\d{1,2}))?/g, (_match, reaisRaw: string, centsRaw?: string) => {
      const reais = Number(String(reaisRaw).replace(/\./g, ''));
      const cents = Number(String(centsRaw || '0').padEnd(2, '0'));
      const reaisText = `${numberToPortuguese(reais)} ${reais === 1 ? 'real' : 'reais'}`;
      const centsText = cents > 0 ? ` e ${numberToPortuguese(cents)} centavos` : '';
      return `${reaisText}${centsText}`;
    })
    .replace(/\b(\d{1,2}):(\d{2})\b/g, (_match, hourRaw: string, minuteRaw: string) => {
      const hour = Number(hourRaw);
      const minute = Number(minuteRaw);
      if (minute === 0) return `${numberToPortuguese(hour)} horas`;
      return `${numberToPortuguese(hour)} horas e ${numberToPortuguese(minute)} minutos`;
    })
    .replace(/\b(\d{1,2})\s*h(?:oras?)?\b/gi, (_match, hourRaw: string) => `${numberToPortuguese(Number(hourRaw))} horas`)
    .replace(/\b(\d{1,2})\s*(?:min|mins|minutos?)\b/gi, (_match, minuteRaw: string) => `${numberToPortuguese(Number(minuteRaw))} minutos`)
    .replace(/\b(\d{1,2})\s*(pessoas?|vidas?|anos?)\b/gi, (_match, raw: string, unit: string) => `${numberToPortuguese(Number(raw))} ${unit}`)
    .replace(/\b(0|[1-9]\d?)\b/g, (match) => numberToPortuguese(Number(match)));
}

async function formatTextForSpeech(text: string) {
  const apiKey = process.env.OPENAI_API_KEY;
  const cleanText = cleanTextForSpeech(text);
  if (!apiKey || cleanText.length < 20) return cleanText;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.ORION_LEAD_AI_SPEECH_FORMAT_MODEL || process.env.ORION_LEAD_AI_MODEL || 'gpt-4o-mini',
        temperature: 0.25,
        max_tokens: 220,
        messages: [
          {
            role: 'system',
            content: [
              'Voce e um assistente especialista em preparar texto para audio de WhatsApp.',
              'Receba um texto curto e reescreva para soar humano, leve e natural quando falado.',
              'Nao use SSML, XML, tags, markdown, listas ou emojis.',
              'Mantenha o mesmo sentido original, sem adicionar novas perguntas ou novas informacoes.',
              'Use frases curtas, pontuacao natural e pequenas pausas com virgulas e pontos.',
              'Deixe a fala mais calma, com ritmo de atendimento humano no WhatsApp, sem pressa.',
              'Prefira um jeito conversado, como uma consultora real falando em audio curto para um cliente.',
              'Nao deixe o texto com cara de leitura formal, comercial gravado ou locucao.',
              'Evite linguagem robotica, formal demais ou com cara de script.',
              'Datas e horas devem ficar naturais quando faladas, por exemplo 10:00 vira dez horas.',
              'Valores em reais devem ficar por extenso, por exemplo R$ 2.000,00 vira dois mil reais.',
              'Numeros pequenos devem ficar por extenso, por exemplo 15 minutos vira quinze minutos.',
              'Telefones devem ficar naturais: DDD em dezena e blocos separados por virgula.',
              'Remova qualquer prefixo de atendente.',
              'Nao inclua nenhuma informacao alem do texto final para ser falado.',
              'Nunca inclua caractere de nova linha na saida.',
              'Nunca coloque aspas ou explicacoes ao redor do texto.',
            ].join(' '),
          },
          { role: 'user', content: cleanText },
        ],
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return cleanText;

    return cleanTextForSpeech(payload?.choices?.[0]?.message?.content || cleanText);
  } catch {
    return cleanText;
  }
}

async function elevenLabsTextToSpeechBase64(text: string) {
  const apiKey = process.env.ELEVENLABS_API_KEY || process.env.ORION_ELEVENLABS_API_KEY;
  const voiceId = process.env.ORION_LEAD_AI_ELEVEN_VOICE_ID || process.env.ELEVENLABS_VOICE_ID || DEFAULT_ELEVENLABS_VOICE_ID;
  if (!apiKey || !voiceId) return null;

  const outputFormat = process.env.ORION_LEAD_AI_ELEVEN_OUTPUT_FORMAT || 'mp3_44100_128';
  const fallbackVoiceId = process.env.ORION_LEAD_AI_ELEVEN_FALLBACK_VOICE_ID || DEFAULT_ELEVENLABS_FALLBACK_VOICE_ID;
  const voiceIds = [voiceId, fallbackVoiceId].filter((id, index, list) => id && list.indexOf(id) === index);

  for (const currentVoiceId of voiceIds) {
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${currentVoiceId}?output_format=${outputFormat}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': apiKey,
      },
      body: JSON.stringify({
        text,
        model_id: process.env.ORION_LEAD_AI_ELEVEN_MODEL || 'eleven_multilingual_v2',
        voice_settings: {
          stability: Number(process.env.ORION_LEAD_AI_ELEVEN_STABILITY || 0.50),
          similarity_boost: Number(process.env.ORION_LEAD_AI_ELEVEN_SIMILARITY || 0.75),
          style: Number(process.env.ORION_LEAD_AI_ELEVEN_STYLE || 0.0),
          speed: Number(process.env.ORION_LEAD_AI_ELEVEN_SPEED || 1.0),
          use_speaker_boost: String(process.env.ORION_LEAD_AI_ELEVEN_SPEAKER_BOOST || 'true').toLowerCase() === 'true',
        },
      }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const detail = payload?.detail || payload;
      console.error('[lead_ai_agent] ElevenLabs TTS unavailable:', {
        status: response.status,
        voiceId: currentVoiceId,
        code: detail?.code || detail?.type,
        message: detail?.message,
      });
      continue;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer.toString('base64');
  }

  return null;
}

async function textToSpeechBase64(text: string) {
  const speechText = expandPortugueseSpeechNumbers(await formatTextForSpeech(text));
  const elevenAudio = await elevenLabsTextToSpeechBase64(speechText);
  if (elevenAudio) return { audio: elevenAudio, provider: 'elevenlabs', speechText };

  throw new Error('ElevenLabs indisponivel para gerar audio. Verifique ELEVENLABS_API_KEY e ORION_LEAD_AI_ELEVEN_VOICE_ID.');
}

async function sendAiAdminAudio(adminProfile: ProfileRow, phone: string, text: string) {
  const instance = aiInstanceName(adminProfile);
  const { audio, provider, speechText } = await textToSpeechBase64(text);
  const cleanAudioBase64 = audio.includes(';base64,') ? audio.split(';base64,')[1] : audio;

  const dataUrl = `data:audio/mpeg;base64,${cleanAudioBase64}`;
  const number = normalizePhone(phone);
  const recordingDelay = Math.min(Math.max(speechText.length * 45, 1800), 8000);

  try {
    await uazapiFetch('/message/presence', {
      method: 'POST',
      body: JSON.stringify({
        number,
        presence: 'recording',
        delay: recordingDelay,
      }),
    }, { instanceName: instance });
  } catch (presenceErr) {
    console.warn('[lead_ai_agent] Failed sending recording presence before audio:', presenceErr);
  }

  const payload = await uazapiFetch('/send/media', {
    method: 'POST',
    body: JSON.stringify({
      number,
      file: dataUrl,
      type: 'ptt',
      mimetype: 'audio/mpeg',
      delay: recordingDelay,
    }),
  }, { instanceName: instance });

  return {
    ...(payload || {}),
    tts_provider: provider,
    tts_text: speechText,
    media_base64: cleanAudioBase64,
    media_mimetype: 'audio/mpeg',
    media_file_name: 'aline-resposta.mp3',
  };
}

function extractSummaryField(summary: string, key: string) {
  const labels = [
    'Nome',
    'Telefone',
    'Idades',
    'Idade\\(s\\)',
    'CNPJ/MEI',
    'Possui CNPJ/MEI',
    'CNPJ informado',
    'Cidade',
    'Investimento',
    'Investimento pretendido',
    'Tem Plano Ativo\\?',
    'Tem plano ativo\\?',
    'Tem plano de saude',
    'Tem plano de saude\\?',
    'Plano Atual',
    'Plano atual',
    'Motivo',
    'Motivo da busca',
    'Hospital/Regiao',
    'Hospital/Regi.o de prefer.ncia',
    'Email',
    'E-mail',
    'Agendado',
    'Pendente',
    'Anuncio',
    'IA encerrada',
    'Erro IA',
  ].join('|');
  const normalized = String(summary || '').replace(/\\r\\n|\\n|\\r/g, '\n');
  const regex = new RegExp(`(?:\\*?(?:${key})\\*?\\s*:\\s*)([\\s\\S]*?)(?=(?:\\s|\\\\n|\\\\r)*\\*?(?:${labels})\\*?\\s*:|$)`, 'i');
  const match = normalized.match(regex);
  return match?.[1]?.trim() || '';
}

function cleanSummaryValue(value: unknown, fallback = 'Nao informado') {
  const text = String(value ?? '').replace(/\*/g, '').replace(/\s+/g, ' ').trim();
  if (!text || ['-', 'nao', 'não', 'null', 'undefined'].includes(normalizeAiText(text))) return fallback;
  return text;
}

function formatResponsibleSummary(lead: LeadRow, summary: string) {
  const field = (key: string, fallback?: unknown) => cleanSummaryValue(extractSummaryField(summary, key) || fallback);
  const finishedReason = extractSummaryField(summary, 'IA encerrada');
  const errorReason = extractSummaryField(summary, 'Erro IA');

  return [
    `Nome: ${cleanSummaryValue(lead.nome)}`,
    `Telefone: ${cleanSummaryValue(lead.telefone)}`,
    `Idades: ${field('Idades|Idade\\(s\\)', lead.idades)}`,
    `CNPJ/MEI: ${field('CNPJ/MEI|Possui CNPJ/MEI', lead.possui_cnpj)}`,
    `Cidade: ${field('Cidade', lead.cidade)}`,
    `Anuncio: ${cleanSummaryValue(lead.utm_content)}`,
    `Conjunto: ${cleanSummaryValue(lead.utm_term)}`,
    `Campanha: ${cleanSummaryValue(lead.utm_campaign)}`,
    `Investimento: ${field('Investimento|Investimento pretendido', lead.investimento)}`,
    `Plano atual: ${field('Plano\\s+Atual|Plano atual', lead.plano_atual)}`,
    `Motivo: ${field('Motivo|Motivo da busca', lead.motivo_busca)}`,
    `Hospital/Regiao: ${field('Hospital/Regiao|Hospital/Regi.o de prefer.ncia', lead.hospital_preferencia)}`,
    `Email: ${field('Email|E-mail', lead.email)}`,
    `Agendado: ${field('Agendado', 'Nao')}`,
    `Pendente: ${field('Pendente', 'Nao')}`,
    finishedReason ? `Status da IA: ${cleanSummaryValue(finishedReason)}` : null,
    errorReason ? `Erro IA: ${cleanSummaryValue(errorReason)}` : null,
  ].filter(Boolean).join('\n');
}

async function notifyResponsible(lead: LeadRow, summary: string) {
  const responsible = await findResponsibleProfile(lead.responsavel_profile_id);
  const admin = await findAiAdmin(lead.corretor_id);

  const targets: any[] = [];
  if (responsible) {
    targets.push(responsible);
  }
  if (admin && (!responsible || admin.id !== responsible.id)) {
    targets.push(admin);
  }

  if (targets.length === 0) return;

  for (const target of targets) {
    const isOwner = admin && target.id === admin.id;
    const bodyParts = [
      `Atendimento inicial concluído para o lead *${plain(lead.nome)}*.`,
    ];
    if (isOwner && responsible && responsible.id !== admin.id) {
      bodyParts.push(`Agora é com o *${responsible.nome}*.`);
    }
    bodyParts.push('');
    bodyParts.push(formatResponsibleSummary(lead, summary || leadFacts(lead)));
    bodyParts.push('');
    bodyParts.push('Agora é a hora do atendimento humano.');

    const msg = bodyParts.join('\n');

    await supabaseAdmin.from('notificacoes').insert([{
      titulo: 'Lead pronto para atendimento',
      mensagem: msg,
      destinatario_profile_id: target.id,
      lida: false,
    }]);

    await sendApoloWhatsApp({
      type: 'novo_lead',
      title: 'Lead pronto para atendimento',
      message: msg,
      profiles: [target],
    });
  }
}

async function askAline(
  lead: LeadRow, 
  history: Array<{ direction: string; remetente?: string | null; mensagem: string; metadata?: any }>, 
  customerMessage: string,
  aiConfig: { persona: string; system_prompt: string },
  corretoraNome: string,
  contactMode: HandoffContactMode
) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY nao configurada.');

  const messages = history.slice(-16).map((item) => {
    let content = item.mensagem;
    if (item.direction === 'inbound') {
      content = item.metadata?.audio_transcript || item.metadata?.ai_customer_message?.replace(/^Audio transcrito do cliente:\s*/i, '') || item.mensagem;
    } else {
      content = item.metadata?.ai_text || item.mensagem;
      const sender = String(item.remetente || '').trim();
      const sentByCurrentAi = normalizeAiText(sender) === normalizeAiText(aiConfig.persona);
      if (sender && !sentByCurrentAi) {
        content = `[Mensagem anterior enviada pelo especialista ${sender}; nao foi enviada por ${aiConfig.persona}]\n${content}`;
      }
    }
    return {
      role: item.direction === 'inbound' ? 'user' : 'assistant',
      content,
    };
  });

  const configuredPrompt = String(aiConfig.system_prompt || '');
  const useDefaultPrompt =
    !configuredPrompt.trim() ||
    normalizeAiText(configuredPrompt).includes('modelo de atendimento individual') ||
    normalizeAiText(configuredPrompt).includes('nao pergunte se o cliente tem cnpj') ||
    normalizeAiText(configuredPrompt).includes('pme mantem a etapa') ||
    normalizeAiText(configuredPrompt).includes('fluxo linear de perguntas');

  const baseSystem = (useDefaultPrompt ? DEFAULT_SYSTEM_PROMPT : configuredPrompt)
    .replace(/{persona}/gi, aiConfig.persona)
    .replace(/{lead_facts}/gi, leadFacts(lead))
    .replace(/{corretora_nome}/gi, corretoraNome)
    .replace(/{nome_empresa}/gi, corretoraNome);
  const nameRule = [
    'Regra obrigatoria de tratamento pelo nome:',
    `- Nome completo do lead: ${plain(lead.nome)}.`,
    `- Se usar o nome do cliente, use somente o primeiro nome: ${leadFirstName(lead)}.`,
    '- Nao use o nome do cliente em respostas consecutivas.',
    '- Depois da primeira mensagem, prefira responder sem chamar pelo nome.',
    '- Nunca use nome completo falando com o cliente.',
    '- O nome completo so deve aparecer em resumo interno, banco de dados ou notificacao para o responsavel.',
  ].join('\n');
  const system = `${baseSystem}\n\n${RUNTIME_AI_GUARDRAILS}\n\n${nameRule}\n\n${handoffContactRule(contactMode)}`;
  const lastMessage = messages[messages.length - 1];
  const alreadyHasCustomerMessage =
    lastMessage?.role === 'user' &&
    normalizeAiText(String(lastMessage.content || '')) === normalizeAiText(customerMessage);
  const promptMessages = alreadyHasCustomerMessage
    ? messages
    : [...messages, { role: 'user', content: customerMessage }];

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.ORION_LEAD_AI_MODEL || 'gpt-4o-mini',
      temperature: 0.35,
      max_tokens: 650,
      messages: [
        { role: 'system', content: system },
        ...promptMessages,
      ],
      response_format: { type: 'json_object' },
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || 'Erro ao chamar IA do lead.');
  }

  return parseAiJson(payload?.choices?.[0]?.message?.content || '');
}

function formatOperadoraName(name?: string | null) {
  if (!name) return '';
  const clean = name.trim().toUpperCase();
  if (clean === 'PORTO' || clean === 'PORTO SEGURO' || clean === 'PORTO_SEGURO') return 'Porto Seguro';
  if (clean === 'HAPVIDA' || clean === 'HAPVIDA PME' || clean === 'HAPVIDA_PME') return 'Hapvida PME';
  if (clean === 'SULAMERICA' || clean === 'SULAMÉRICA') return 'Sulamérica';
  if (clean === 'BRADESCO' || clean === 'BRADESCO SAUDE' || clean === 'BRADESCO_SAUDE') return 'Bradesco';
  if (clean === 'AMIL' || clean === 'AMIL SAUDE' || clean === 'AMIL_SAUDE') return 'Amil';
  if (clean === 'GOLDEN' || clean === 'GOLDEN CROSS' || clean === 'GOLDEN_CROSS') return 'Golden Cross';
  if (clean === 'UNIMED') return 'Unimed';
  if (clean === 'GNDI' || clean === 'INTERMEDICA' || clean === 'NOTRE DAME' || clean === 'NOTREDAME') return 'NotreDame Intermédica';
  
  return clean.charAt(0) + clean.slice(1).toLowerCase();
}

export async function startLeadAiIfEligible(leadId: string) {
  const { data: lead } = await supabaseAdmin
    .from('leads')
    .select('id, corretor_id, nome, telefone, idades, possui_cnpj, cnpj, tem_plano_ativo, plano_atual, investimento, cidade, utm_source, utm_medium, utm_campaign, utm_term, utm_content, responsavel_profile_id, operadora')
    .eq('id', leadId)
    .maybeSingle();

  if (!lead?.corretor_id) return { started: false, eligible: false, reason: 'Lead sem corretor.' };

  const broker = await findBroker(lead.corretor_id);
  if (!broker?.nome_empresa) return { started: false, eligible: false, reason: 'Lead sem concessionaria.' };

  const { data: corretora } = await supabaseAdmin
    .from('corretoras')
    .select('id, nome')
    .ilike('nome', broker.nome_empresa)
    .maybeSingle();

  if (!corretora) return { started: false, eligible: false, reason: 'Concessionaria nao cadastrada no registro.' };

  const { data: aiConfig } = await supabaseAdmin
    .from('corretora_ai_configs')
    .select('*')
    .eq('corretora_id', corretora.id)
    .eq('status', 'ativo')
    .maybeSingle();

  if (!aiConfig) return { started: false, eligible: false, reason: 'IA desativada para esta concessionaria.' };

  const adminProfile = await findAiAdmin(lead.corretor_id, aiConfig.sender_profile_id || lead.responsavel_profile_id);
  if (!adminProfile) return { started: false, eligible: true, reason: 'Admin IA da concessionaria nao encontrado.' };
  if (aiConfig.sender_mode === 'dedicated') {
    adminProfile.ai_instance_name = aiConfig.dedicated_instance_name || uazapiAiInstanceName(corretora.id);
  }

  const phone = normalizePhone(lead.telefone);
  if (!phone) return { started: false, eligible: true, reason: 'Lead sem telefone.' };

  const conversation = await getOrCreateConversation(lead);
  if (!conversation) return { started: false, eligible: true, reason: 'Conversa nao criada.' };

  const formattedBrokerageName = formatAiBrokerageDisplayName(corretora.nome || broker.nome_empresa);

  const opName = formatOperadoraName(lead.operadora);
  const interestText = opName
    ? `Você clicou em um anúncio nosso e preencheu o formulário de interesse da ${opName}.`
    : 'Você clicou em um anúncio nosso e preencheu o formulário de interesse em nossos planos de saúde.';

  const intro = fixPortugueseMojibake([
    `Olá, ${leadFirstName(lead)}! Tudo bem?`,
    `Me chamo ${aiConfig.persona}, da ${formattedBrokerageName}.`,
    interestText,
    initialLeadQuestion(lead),
  ].join('\n\n'));

  const { data: existing } = await supabaseAdmin
    .from('lead_ai_sessions')
    .select('id, status')
    .eq('lead_id', lead.id)
    .maybeSingle();

  if (existing?.status === 'active') return { started: false, eligible: true, reason: 'Sessao ja ativa.' };

  await supabaseAdmin
    .from('lead_ai_sessions')
    .upsert([{
      lead_id: lead.id,
      corretor_id: lead.corretor_id,
      admin_profile_id: adminProfile.id,
      responsavel_profile_id: lead.responsavel_profile_id || null,
      persona: aiConfig.persona,
      status: 'active',
      summary: leadFacts(lead),
      last_ai_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }], { onConflict: 'lead_id' });

  try {
    await configureUazapiWebhook(aiInstanceName(adminProfile));
    registerAiOutbound(phone, intro);
    const payload = await sendAiAdminText(adminProfile, phone, intro);
    await insertMessage(conversation.id, 'outbound', aiConfig.persona, intro, {
      ...(payload || {}),
      instance: aiInstanceName(adminProfile),
      ai_agent: aiConfig.persona,
    });
  } catch (error: any) {
    const errorMessage = error?.message || 'Erro ao enviar primeira mensagem da IA.';
    await supabaseAdmin
      .from('lead_ai_sessions')
      .update({
        status: 'error',
        summary: `${leadFacts(lead)}\n\nErro IA: ${errorMessage}`,
        updated_at: new Date().toISOString(),
      })
      .eq('lead_id', lead.id);
    throw error;
  }

  return { started: true, eligible: true };
}

export async function continueLeadAiFromIncoming(options: {
  leadId: string;
  conversationId: string;
  customerMessage: string;
  incomingWasAudio?: boolean;
}) {
  // Lock in-memory: se ja esta processando para este lead, ignora duplicata
  const now = Date.now();
  const existingLock = processingLeadLocks.get(options.leadId);
  if (existingLock && now - existingLock < AI_LOCK_TTL_MS) {
    console.log(`[lead_ai_agent] Lock ativo para lead ${options.leadId}, ignorando chamada duplicada.`);
    return { handled: false, reason: 'Duplicate call blocked by lock.' };
  }
  processingLeadLocks.set(options.leadId, now);

  try {
  const { data: session } = await supabaseAdmin
    .from('lead_ai_sessions')
    .select('*')
    .eq('lead_id', options.leadId)
    .eq('status', 'active')
    .maybeSingle();

  if (!session) { processingLeadLocks.delete(options.leadId); return { handled: false, reason: 'Sem sessao ativa.' }; }

  const { data: lead } = await supabaseAdmin
    .from('leads')
    .select('id, corretor_id, nome, telefone, idades, possui_cnpj, cnpj, tem_plano_ativo, plano_atual, investimento, cidade, email, motivo_busca, hospital_preferencia, utm_source, utm_medium, utm_campaign, utm_term, utm_content, responsavel_profile_id')
    .eq('id', options.leadId)
    .maybeSingle();

  if (!lead) { processingLeadLocks.delete(options.leadId); return { handled: false, reason: 'Lead nao encontrado.' }; }

  const broker = await findBroker(lead.corretor_id);
  if (!broker?.nome_empresa) { processingLeadLocks.delete(options.leadId); return { handled: false, reason: 'Lead sem concessionaria.' }; }

  const { data: corretora } = await supabaseAdmin
    .from('corretoras')
    .select('id, nome')
    .ilike('nome', broker.nome_empresa)
    .maybeSingle();

  if (!corretora) { processingLeadLocks.delete(options.leadId); return { handled: false, reason: 'Concessionaria nao cadastrada no registro.' }; }

  const { data: aiConfig } = await supabaseAdmin
    .from('corretora_ai_configs')
    .select('*')
    .eq('corretora_id', corretora.id)
    .eq('status', 'ativo')
    .maybeSingle();

  if (!aiConfig) { processingLeadLocks.delete(options.leadId); return { handled: false, reason: 'IA desativada para esta concessionaria.' }; }

  const adminProfile = await findAiAdmin(lead.corretor_id, session.admin_profile_id || aiConfig.sender_profile_id || lead.responsavel_profile_id);
  if (!adminProfile) { processingLeadLocks.delete(options.leadId); return { handled: false, reason: 'Admin IA da concessionaria nao encontrado.' }; }
  if (aiConfig.sender_mode === 'dedicated') {
    adminProfile.ai_instance_name = aiConfig.dedicated_instance_name || uazapiAiInstanceName(corretora.id);
  }
  const contactMode = handoffContactMode(lead, adminProfile);

  const { data: recentHistory } = await supabaseAdmin
    .from('whatsapp_mensagens')
    .select('direction, remetente, mensagem, metadata, created_at')
    .eq('conversa_id', options.conversationId)
    .order('created_at', { ascending: false })
    .limit(40);
  const history = [...(recentHistory || [])].reverse();

  const formattedBrokerageName = formatAiBrokerageDisplayName(corretora.nome || broker.nome_empresa);

  const previousOutbound = [...(history || [])]
    .reverse()
    .find((item) => item.direction === 'outbound');
  const previousOutboundText = previousOutbound?.metadata?.ai_text || previousOutbound?.mensagem || '';
  const recentOutboundTexts = [...(history || [])]
    .filter((item) => item.direction === 'outbound')
    .slice(-5)
    .map((item) => String(item.metadata?.ai_text || item.mensagem || ''));
  const recentInitialConfirmation = recentOutboundTexts.some(isInitialConfirmationQuestion);
  const recentCnpjConfirmation = recentOutboundTexts.some(isCnpjConfirmationQuestion);
  const scheduleConfirmed =
    looksLikeScheduleAnswer(options.customerMessage) &&
    (isSchedulePrompt(previousOutboundText) || recentOutboundTexts.some(isSchedulePrompt));

  if (
    (isInitialConfirmationQuestion(previousOutboundText) || (recentInitialConfirmation && !recentCnpjConfirmation)) &&
    isAffirmativeAnswer(options.customerMessage) &&
    !isCnpjConfirmationQuestion(previousOutboundText)
  ) {
    const reply = customerReplyForFollowUp(cnpjConfirmationReply(lead), lead, Boolean(previousOutboundText));
    registerAiOutbound(lead.telefone || '', reply);
    const payload = await sendAiAdminText(adminProfile, lead.telefone || '', reply);
    await insertMessage(options.conversationId, 'outbound', aiConfig.persona, reply, {
      ...(payload || {}),
      instance: aiInstanceName(adminProfile),
      ai_agent: aiConfig.persona,
    });

    await supabaseAdmin
      .from('lead_ai_sessions')
      .update({
        summary: appendSummaryLine(session.summary || leadFacts(lead), '*Pendente*: Confirmar se a simulacao sera por CNPJ/MEI ou CPF.'),
        last_customer_message_at: new Date().toISOString(),
        last_ai_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', session.id);

    return { handled: true, handoff: false, deterministic: 'cnpj_confirmation' };
  }

  if (
    (isInitialConfirmationQuestion(previousOutboundText) || (recentInitialConfirmation && !recentCnpjConfirmation)) &&
    isGreetingOnly(options.customerMessage)
  ) {
    const greeting = normalizeAiText(options.customerMessage).includes('boa tarde')
      ? 'Boa tarde!'
      : normalizeAiText(options.customerMessage).includes('boa noite')
        ? 'Boa noite!'
        : normalizeAiText(options.customerMessage).includes('bom dia')
          ? 'Bom dia!'
          : 'Oi!';
    const reply = customerReplyForFollowUp(`${greeting} ${initialLeadQuestion(lead)}`, lead, Boolean(previousOutboundText));
    registerAiOutbound(lead.telefone || '', reply);
    const payload = await sendAiAdminText(adminProfile, lead.telefone || '', reply);
    await insertMessage(options.conversationId, 'outbound', aiConfig.persona, reply, {
      ...(payload || {}),
      instance: aiInstanceName(adminProfile),
      ai_agent: aiConfig.persona,
    });

    await supabaseAdmin
      .from('lead_ai_sessions')
      .update({
        last_customer_message_at: new Date().toISOString(),
        last_ai_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', session.id);

    return { handled: true, handoff: false, deterministic: 'greeting_kept_initial_confirmation' };
  }

  if (
    (isCnpjConfirmationQuestion(previousOutboundText) || recentCnpjConfirmation) &&
    isAffirmativeAnswer(options.customerMessage)
  ) {
    const reply = customerReplyForFollowUp(nextQuestionAfterCnpjConfirmation(lead), lead, Boolean(previousOutboundText));
    if (options.incomingWasAudio) {
      try {
        registerAiOutbound(lead.telefone || '', 'Mensagem de voz');
        const payload = await sendAiAdminAudio(adminProfile, lead.telefone || '', reply);
        await insertMessage(options.conversationId, 'outbound', aiConfig.persona, 'Mensagem de voz', {
          ...(payload || {}),
          instance: aiInstanceName(adminProfile),
          provider_message_id: providerMessageId(payload),
          ai_agent: aiConfig.persona,
          ai_text: reply,
          messageType: 'audioMessage',
          mediaType: 'audio',
          mediatype: 'audio',
          mimetype: 'audio/mpeg',
          fileName: 'aline-resposta.mp3',
        });
      } catch (audioErr) {
        console.error('[lead_ai_agent] Failed sending CNPJ confirmation audio, falling back to text:', audioErr);
        registerAiOutbound(lead.telefone || '', reply);
        const payload = await sendAiAdminText(adminProfile, lead.telefone || '', reply);
        await insertMessage(options.conversationId, 'outbound', aiConfig.persona, reply, {
          ...(payload || {}),
          instance: aiInstanceName(adminProfile),
          ai_agent: aiConfig.persona,
        });
      }
    } else {
      registerAiOutbound(lead.telefone || '', reply);
      const payload = await sendAiAdminText(adminProfile, lead.telefone || '', reply);
      await insertMessage(options.conversationId, 'outbound', aiConfig.persona, reply, {
        ...(payload || {}),
        instance: aiInstanceName(adminProfile),
        ai_agent: aiConfig.persona,
      });
    }

    await supabaseAdmin
      .from('lead_ai_sessions')
      .update({
        summary: appendSummaryLine(session.summary || leadFacts(lead), `*CNPJ/CPF confirmado*: ${options.customerMessage.trim()}`),
        last_customer_message_at: new Date().toISOString(),
        last_ai_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', session.id);

    return { handled: true, handoff: false, deterministic: 'cnpj_confirmed_next_step' };
  }

  if (scheduleConfirmed) {
    return await finalizeScheduledHandoff({
      session,
      lead,
      conversationId: options.conversationId,
      adminProfile,
      aiConfig,
      customerMessage: options.customerMessage,
      incomingWasAudio: options.incomingWasAudio,
    });
  }

  let ai: any;
  if (isCallRefusal(options.customerMessage, previousOutboundText)) {
    ai = {
      handoff: true,
      reply: callRefusalHandoffReply(lead, contactMode),
      summary: appendSummaryLine(
        session.summary || leadFacts(lead),
        'IA encerrada: cliente recusou ligacao/reuniao e pediu continuidade sem chamada. Especialista deve assumir o atendimento.'
      ),
    };
  } else if (isValueRequest(options.customerMessage)) {
    ai = {
      handoff: true,
      reply: 'Consigo pedir para um especialista te passar os valores certinhos, porque isso depende da cotacao, da rede escolhida e dos dados do perfil. Vou chamar ele para te orientar melhor.',
      summary: appendSummaryLine(session.summary || leadFacts(lead), `IA encerrada: cliente pediu valores. Especialista deve assumir e apresentar a cotacao.`),
    };
  } else if (isSensitivePersonalSituation(options.customerMessage)) {
    ai = {
      handoff: false,
      reply: 'Sinto muito por isso. Espero que as coisas fiquem mais leves por ai. Se estiver tudo bem para voce, posso continuar a cotacao com calma?',
      summary: appendSummaryLine(session.summary || leadFacts(lead), `Observacao sensivel do lead: ${options.customerMessage.trim()}`),
    };
  } else {
    try {
      ai = await askAline(lead, history || [], options.customerMessage, aiConfig, formattedBrokerageName, contactMode);
    } catch (error) {
      console.error('[lead_ai_agent] IA falhou ao continuar atendimento. Fazendo handoff:', error);
      return await handoffAiFailure({
        session,
        lead,
        reason: 'falha tecnica ao gerar a proxima resposta da IA.',
      });
    }
  }

  let handoff = Boolean(ai.handoff);
  let summary = ai.summary || session.summary || null;
  let reply = customerReplyForFollowUp(String(ai.reply || '').trim(), lead, Boolean(previousOutboundText));

  if (scheduleConfirmed) {
    handoff = true;
    reply = customerReplyForFollowUp(handoffScheduleReply(lead, contactMode), lead, Boolean(previousOutboundText));
    summary = appendSummaryLine(summary || leadFacts(lead), `*Agendado*: ${options.customerMessage.trim()}`);
    summary = appendSummaryLine(summary, 'IA encerrada: agendamento informado pelo cliente e enviado para o responsavel.');
  }

  if (shouldSuppressHandoffReply(reply, handoff)) {
    reply = '';
  }

  for (const part of reply ? splitReply(reply) : []) {
    if (options.incomingWasAudio) {
      try {
        registerAiOutbound(lead.telefone || '', '🎤 Mensagem de voz');
        const payload = await sendAiAdminAudio(adminProfile, lead.telefone || '', part);
        await insertMessage(options.conversationId, 'outbound', aiConfig.persona, 'Mensagem de voz', {
          ...(payload || {}),
          instance: aiInstanceName(adminProfile),
          provider_message_id: providerMessageId(payload),
          ai_agent: aiConfig.persona,
          ai_text: part,
          messageType: 'audioMessage',
          mediaType: 'audio',
          mediatype: 'audio',
          mimetype: 'audio/mpeg',
          fileName: 'aline-resposta.mp3',
        });
        continue;
      } catch (audioErr) {
        console.error('[lead_ai_agent] Failed sending audio reply, falling back to text:', audioErr);
      }
    }

    registerAiOutbound(lead.telefone || '', part);
    const payload = await sendAiAdminText(adminProfile, lead.telefone || '', part);
    await insertMessage(options.conversationId, 'outbound', aiConfig.persona, part, {
      ...(payload || {}),
      instance: aiInstanceName(adminProfile),
      ai_agent: aiConfig.persona,
    });
  }

  if (!reply && !handoff) {
    return await handoffAiFailure({
      session,
      lead,
      reason: 'a IA nao retornou uma resposta para continuar a conversa.',
    });
  }

  const status = handoff ? 'handoff' : 'active';
  const currentSummary = summary;
  await supabaseAdmin
    .from('lead_ai_sessions')
    .update({
      status,
      summary: currentSummary,
      last_customer_message_at: new Date().toISOString(),
      last_ai_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', session.id);

  if (currentSummary) {
    await updateLeadFromSummary(lead.id, currentSummary);
  }

  if (handoff) {
    await notifyResponsible(lead, currentSummary || '');
    const scheduledVal = extractAgendadoValue(currentSummary);
    if (scheduledVal) {
      await createAutoScheduledTask(lead, scheduledVal, adminProfile.id);
    }
  }

  return { handled: true, handoff };
  } finally {
    // Libera o lock apos processamento (seja sucesso ou erro)
    processingLeadLocks.delete(options.leadId);
  }
}

export async function handoffLeadAiToResponsible(leadId: string, reason: string) {
  const { data: session } = await supabaseAdmin
    .from('lead_ai_sessions')
    .select('*')
    .eq('lead_id', leadId)
    .eq('status', 'active')
    .maybeSingle();

  if (!session) return { handled: false, reason: 'Sem sessao ativa.' };

  const { data: lead } = await supabaseAdmin
    .from('leads')
    .select('id, corretor_id, nome, telefone, idades, possui_cnpj, cnpj, tem_plano_ativo, plano_atual, investimento, cidade, utm_source, utm_medium, utm_campaign, utm_term, utm_content, responsavel_profile_id')
    .eq('id', leadId)
    .maybeSingle();

  if (!lead) return { handled: false, reason: 'Lead nao encontrado.' };

  const summary = appendSummaryLine(
    session.summary || leadFacts(lead),
    `IA encerrada: ${reason}`
  );

  await supabaseAdmin
    .from('lead_ai_sessions')
    .update({
      status: 'handoff',
      summary,
      updated_at: new Date().toISOString(),
    })
    .eq('id', session.id);

  await notifyResponsible(lead, summary);
  return { handled: true, handoff: true };
}

export async function checkLeadAiTimeouts() {
  const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();

  // Find active sessions where the last AI message has been unanswered for 15 minutes.
  const { data: activeSessions, error } = await supabaseAdmin
    .from('lead_ai_sessions')
    .select('*')
    .eq('status', 'active')
    .lte('last_ai_message_at', fifteenMinutesAgo);

  if (error) {
    console.error('[cron_timeout] Error fetching active sessions:', error);
    return { count: 0, error };
  }

  let handoffCount = 0;

  for (const session of activeSessions || []) {
    const lastAiMessageAt = session.last_ai_message_at ? new Date(session.last_ai_message_at).getTime() : 0;
    const lastCustomerMessageAt = session.last_customer_message_at ? new Date(session.last_customer_message_at).getTime() : 0;

    if (!lastAiMessageAt || lastCustomerMessageAt > lastAiMessageAt) {
      continue;
    }

    const { data: conv } = await supabaseAdmin
      .from('whatsapp_conversas')
      .select('id')
      .eq('lead_id', session.lead_id)
      .maybeSingle();

    if (!conv) continue;

    const { data: lastMsg } = await supabaseAdmin
      .from('whatsapp_mensagens')
      .select('id, direction')
      .eq('conversa_id', conv.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!lastMsg || lastMsg.direction !== 'outbound') continue;

    console.log(`[cron_timeout] Lead ${session.lead_id} timed out after unanswered AI message.`);

    const { data: lead } = await supabaseAdmin
      .from('leads')
      .select('id, corretor_id, nome, telefone, idades, possui_cnpj, cnpj, tem_plano_ativo, plano_atual, investimento, cidade, utm_source, utm_medium, utm_campaign, utm_term, utm_content, responsavel_profile_id')
      .eq('id', session.lead_id)
      .maybeSingle();

    if (!lead) continue;

    const suffix = '\n\nIA encerrada: lead nao respondeu a ultima mensagem da IA por mais de 15 minutos.';
    const newSummary = `${session.summary || leadFacts(lead)}${suffix}`.trim();

    const { data: updatedSession, error: updateError } = await supabaseAdmin
      .from('lead_ai_sessions')
      .update({
        status: 'handoff',
        summary: newSummary,
        updated_at: new Date().toISOString()
      })
      .eq('id', session.id)
      .eq('status', 'active')
      .select('id')
      .maybeSingle();

    if (updateError) {
      console.error('[cron_timeout] Error handing off timed out AI session:', updateError);
      continue;
    }

    if (!updatedSession) {
      continue;
    }

    await updateLeadFromSummary(lead.id, newSummary);
    await notifyResponsible(lead, newSummary);
    handoffCount++;
  }

  return { count: handoffCount };
}
function extractAgendadoValue(summary?: string | null): string | null {
  if (!summary) return null;
  const match = summary.match(/(?:\*?Agendado\*?:?\s*)([^\r\n]+)/i);
  if (match && match[1]) {
    const value = match[1].trim();
    const lowerVal = value.toLowerCase();
    if (lowerVal && lowerVal !== 'false' && lowerVal !== 'não' && lowerVal !== 'nao' && lowerVal !== 'null' && lowerVal !== 'no') {
      return value;
    }
  }
  return null;
}

function saoPauloDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  return {
    year: Number(parts.find((part) => part.type === 'year')?.value),
    month: Number(parts.find((part) => part.type === 'month')?.value),
    day: Number(parts.find((part) => part.type === 'day')?.value),
  };
}

function saoPauloDateAt(year: number, month: number, day: number, hour: number, minute: number) {
  return new Date(Date.UTC(year, month - 1, day, hour + 3, minute, 0, 0));
}

function addLocalDays(date: { year: number; month: number; day: number }, days: number) {
  const utcNoon = new Date(Date.UTC(date.year, date.month - 1, date.day + days, 12, 0, 0, 0));
  return {
    year: utcNoon.getUTCFullYear(),
    month: utcNoon.getUTCMonth() + 1,
    day: utcNoon.getUTCDate(),
  };
}

function parseScheduledTextToDate(scheduledText: string, reference = new Date()) {
  const raw = String(scheduledText || '').trim();
  const normalized = normalizeAiText(raw);
  const timeMatch =
    normalized.match(/\b(?:as|às|a partir das|depois das|antes das)\s*(\d{1,2})(?::|h)?\s*(\d{2})?\b/) ||
    normalized.match(/\b(\d{1,2})(?::|h)\s*(\d{2})?\b/);

  if (!timeMatch) return null;

  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2] || '0');
  if (!Number.isFinite(hour) || hour < 0 || hour > 23 || !Number.isFinite(minute) || minute < 0 || minute > 59) {
    return null;
  }

  const today = saoPauloDateParts(reference);
  let target = today;

  const dateMatch = normalized.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (dateMatch) {
    const yearText = dateMatch[3];
    const year = yearText ? Number(yearText.length === 2 ? `20${yearText}` : yearText) : today.year;
    target = { year, month: Number(dateMatch[2]), day: Number(dateMatch[1]) };
  } else if (/\bamanha\b/.test(normalized)) {
    target = addLocalDays(today, 1);
  } else if (/\bhoje\b/.test(normalized)) {
    target = today;
  } else {
    const weekDays: Record<string, number> = {
      domingo: 0,
      segunda: 1,
      terca: 2,
      quarta: 3,
      quinta: 4,
      sexta: 5,
      sabado: 6,
    };
    const weekDayKey = Object.keys(weekDays).find((key) => new RegExp(`\\b${key}\\b`).test(normalized));
    if (weekDayKey) {
      const currentDate = saoPauloDateAt(today.year, today.month, today.day, 12, 0);
      const currentWeekDay = currentDate.getUTCDay();
      let diff = weekDays[weekDayKey] - currentWeekDay;
      if (diff <= 0) diff += 7;
      target = addLocalDays(today, diff);
    }
  }

  return saoPauloDateAt(target.year, target.month, target.day, hour, minute);
}

async function createAutoScheduledTask(lead: LeadRow, scheduledText: string, fallbackProfileId?: string | null) {
  try {
    const { data: existing } = await supabaseAdmin
      .from('lead_tarefas')
      .select('id')
      .eq('lead_id', lead.id)
      .ilike('titulo', `%Reunião agendada pela IA%`)
      .limit(1)
      .maybeSingle();

    if (existing) return;

    const title = `Reunião agendada pela IA: ${scheduledText}`;
    const parsedSchedule = parseScheduledTextToDate(scheduledText);
    const vencimento = parsedSchedule?.toISOString() || null;

    const targetProfileId = lead.responsavel_profile_id || fallbackProfileId || null;

    const { error } = await supabaseAdmin
      .from('lead_tarefas')
      .insert([{
        lead_id: lead.id,
        corretor_id: lead.corretor_id,
        responsavel_profile_id: targetProfileId,
        titulo: title,
        vencimento,
        prioridade: 'alta',
        status: 'pendente'
      }]);

    if (error) throw error;

    await supabaseAdmin
      .from('lead_atividades')
      .insert([{
        lead_id: lead.id,
        profile_id: targetProfileId,
        tipo: 'tarefa',
        titulo: 'Tarefa criada automaticamente',
        descricao: `Lembrete agendado pela IA: ${title}`
      }]);

    console.log(`[auto_task] Created task successfully: ${title}`);
  } catch (err) {
    console.error('[auto_task] Failed to create auto task:', err);
  }
}

async function updateLeadFromSummary(leadId: string, summary?: string | null) {
  if (!summary) return;
  try {
    const updates: any = {};
    const knownSummaryLabels = [
      'Nome',
      'Telefone',
      'Idades',
      'Idade\\(s\\)',
      'CNPJ/MEI',
      'Possui CNPJ/MEI',
      'CNPJ informado',
      'Cidade',
      'Investimento',
      'Investimento pretendido',
      'Tem Plano Ativo\\?',
      'Tem plano ativo\\?',
      'Tem plano de saude',
      'Tem plano de saude\\?',
      'Plano Atual',
      'Plano atual',
      'Motivo',
      'Motivo da busca',
      'Hospital/Regiao',
      'Hospital/Regi.o de prefer.ncia',
      'Email',
      'E-mail',
      'Agendado',
      'Pendente',
      'Anuncio',
      'IA encerrada',
      'Erro IA',
    ].join('|');
    const normalizedSummary = String(summary).replace(/\\r\\n|\\n|\\r/g, '\n');
    
    const getValue = (key: string) => {
      const regex = new RegExp(`(?:\\*?(?:${key})\\*?\\s*:\\s*)([\\s\\S]*?)(?=(?:\\s|\\\\n|\\\\r)*\\*?(?:${knownSummaryLabels})\\*?\\s*:|$)`, 'i');
      const match = normalizedSummary.match(regex);
      if (match && match[1]) {
        const val = match[1].trim();
        if (
          val &&
          !val.startsWith('[') &&
          !val.endsWith(']') &&
          !['não informado', 'nao informado', '-', 'sem informação', 'sem informacao', 'não', 'nao'].includes(val.toLowerCase())
        ) {
          return val;
        }
      }
      return null;
    };

    const nome = getValue('Nome');
    if (nome) updates.nome = nome;

    const idades = getValue('Idades|Idade\\(s\\)');
    if (idades) updates.idades = idades;

    const cidade = getValue('Cidade');
    if (cidade) updates.cidade = cidade;

    const investimento = getValue('Investimento|Investimento pretendido');
    if (investimento) updates.investimento = investimento;

    const temPlanoAtivo = getValue('Tem\\s+Plano\\s+Ativo\\?|Tem\\s+plano\\s+ativo\\?|Tem\\s+plano\\s+de\\s+saude\\??');
    if (temPlanoAtivo) updates.tem_plano_ativo = temPlanoAtivo;

    const planoAtual = getValue('Plano\\s+Atual');
    if (planoAtual) updates.plano_atual = planoAtual;

    const email = getValue('Email|E-mail');
    if (email) updates.email = email;

    const motivo = getValue('Motivo|Motivo da busca');
    if (motivo) updates.motivo_busca = motivo;

    const hospital = getValue('Hospital/Regiao|Hospital/Regi.o de prefer.ncia');
    if (hospital) updates.hospital_preferencia = hospital;

    const cnpjMei = getValue('CNPJ/MEI|Possui CNPJ/MEI');
    if (cnpjMei) {
      const lower = cnpjMei.toLowerCase();
      if (lower.includes('mei')) {
        updates.possui_cnpj = 'Tenho MEI';
      } else if (lower.includes('cnpj') || lower.includes('sim')) {
        updates.possui_cnpj = 'Sim';
      } else if (lower.includes('não') || lower.includes('nao') || lower.includes('pf') || lower.includes('fisica') || lower.includes('física')) {
        updates.possui_cnpj = 'Não';
      }
      
      const digits = cnpjMei.replace(/\D/g, '');
      if (digits.length >= 11) {
        updates.cnpj = cnpjMei;
      }
    }

    if (Object.keys(updates).length > 0) {
      const { error } = await supabaseAdmin
        .from('leads')
        .update(updates)
        .eq('id', leadId);
      if (error) throw error;
      console.log(`[lead_ai_agent] Updated lead ${leadId} from summary:`, updates);
    }
  } catch (err) {
    console.error('[lead_ai_agent] Failed to update lead from summary:', err);
  }
}
