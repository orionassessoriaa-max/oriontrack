/**
 * Simula uma conversa da IA de uma corretora sem enviar nada no WhatsApp e sem
 * gravar nada no banco. Usa o mesmo askAline() de producao, com o prompt real
 * lido de corretora_ai_configs, para que o que aparece aqui seja o que o lead
 * receberia de verdade.
 *
 *   npm run simular-ia -- "SOMA CORRETORA"
 *   npm run simular-ia -- "SOMA CORRETORA" "sim" "sou mei" "tenho 40 anos"
 *
 * Sem falas informadas usa ROTEIRO_PADRAO. Tambem aceita um arquivo .json com
 * a lista de falas do cliente.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import {
  aiIdentity,
  aiIntroLine,
  askAline,
  formatAiBrokerageDisplayName,
  handoffContactMode,
  initialLeadQuestion,
  isCallRefusal,
  isValueRequest,
  leadFirstName,
} from '../src/lib/leadAiAgent';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const ROTEIRO_PADRAO = [
  'sim, quero sim',
  'nao tenho cnpj nao, seria pra mim e minha esposa',
  'a gente tem 34 e 31, moramos em Brasilia',
  'ja tenho a unimed mas ta muito caro, quase 1200',
  'meu pai fez uma cirurgia na rede d or e queria continuar podendo usar la',
  'quanto fica mais ou menos?',
];

const LEAD_FALSO: any = {
  id: '00000000-0000-0000-0000-000000000000',
  nome: 'Marcos Vinicius Pereira',
  telefone: '5561999990000',
  idades: null,
  cidade: null,
  possui_cnpj: null,
  cnpj: null,
  investimento: null,
  tem_plano_ativo: null,
  plano_atual: null,
  email: null,
  motivo_busca: null,
  hospital_preferencia: null,
  operadora: 'Amil',
  responsavel_profile_id: process.env.SIMULA_RESPONSAVEL || null,
  corretor_id: null,
};

function normalizarNome(valor: unknown) {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

function bloco(titulo: string) {
  console.log(`\n${'='.repeat(72)}\n${titulo}\n${'='.repeat(72)}`);
}

async function main() {
  // O npm no Windows entrega argumentos com espaco escapados com "^"
  // ("SOMA CORRETORA" chega como ^SOMA^ CORRETORA^). Limpar aqui evita ter que
  // lembrar de nao usar espaco na linha de comando.
  const limpar = (valor: string) => valor.replace(/\^/g, '').trim();
  const alvo = normalizarNome(limpar(process.argv[2] || 'SOMA CORRETORA'));
  const resto = process.argv.slice(3).map(limpar).filter(Boolean);
  // Aceita tres formas: sem argumento (roteiro padrao), um arquivo .json com a
  // lista de falas, ou as falas do cliente digitadas direto na linha de comando.
  const roteiro: string[] = resto.length === 0
    ? ROTEIRO_PADRAO
    : resto.length === 1 && resto[0].toLowerCase().endsWith('.json')
      ? JSON.parse(fs.readFileSync(resto[0], 'utf8'))
      : resto;

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const { data: corretoras } = await supabase.from('corretoras').select('id,nome');
  const candidatas = (corretoras || []).filter((item) => normalizarNome(item.nome).includes(alvo));
  if (candidatas.length === 0) {
    throw new Error(`Corretora "${alvo}" nao encontrada. Existem: ${(corretoras || []).map((item) => item.nome).join(', ')}`);
  }
  if (candidatas.length > 1) {
    throw new Error(`"${alvo}" casa com mais de uma: ${candidatas.map((item) => item.nome).join(', ')}. Seja mais especifico.`);
  }
  const corretora = candidatas[0];

  const { data: aiConfig } = await supabase
    .from('corretora_ai_configs')
    .select('*')
    .eq('corretora_id', corretora.id)
    .maybeSingle();
  if (!aiConfig) throw new Error(`Corretora "${alvo}" nao tem configuracao de IA.`);

  const nomeExibicao = formatAiBrokerageDisplayName(corretora.nome);
  const identidade = aiIdentity(aiConfig, nomeExibicao);
  const adminProfile: any = {
    id: aiConfig.sender_profile_id || null,
    ai_instance_name: aiConfig.sender_mode === 'dedicated' ? aiConfig.dedicated_instance_name : null,
  };
  const modoContato = handoffContactMode(LEAD_FALSO, adminProfile, identidade);

  bloco(`${corretora.nome} | persona ${aiConfig.persona} | status ${aiConfig.status}`);
  console.log(`identidade: ${identidade.mode} (${identidade.displayName})`);
  console.log(`encerramento: ${modoContato}`);
  console.log(`prompt do banco: ${(aiConfig.system_prompt || '').length} caracteres`);

  const abertura = [
    `Olá, ${leadFirstName(LEAD_FALSO)}! Tudo bem?`,
    aiIntroLine(identidade, aiConfig.persona),
    'Você clicou em um anúncio nosso e preencheu o formulário de interesse da Amil.',
    initialLeadQuestion(LEAD_FALSO),
  ].join('\n\n');

  bloco('MENSAGEM DE ABERTURA (texto fixo do codigo, nao passa pela IA)');
  console.log(abertura);

  const historico: any[] = [{ direction: 'outbound', remetente: aiConfig.persona, mensagem: abertura, metadata: {} }];
  let ultimaSaida = abertura;

  bloco('CONVERSA');
  for (const fala of roteiro) {
    console.log(`\nCLIENTE: ${fala}`);
    historico.push({ direction: 'inbound', remetente: null, mensagem: fala, metadata: {} });

    if (isCallRefusal(fala, ultimaSaida)) {
      console.log('[interceptado pelo codigo: recusa de ligacao -> handoff, sem chamar a IA]');
      break;
    }
    if (isValueRequest(fala)) {
      console.log('[interceptado pelo codigo: pedido de valor -> handoff, sem chamar a IA]');
      console.log('IA: Consigo pedir para um especialista te passar os valores certinhos, porque isso depende da cotacao, da rede escolhida e dos dados do perfil. Vou chamar ele para te orientar melhor.');
      break;
    }

    const resposta: any = await askAline(
      LEAD_FALSO,
      historico,
      fala,
      { persona: aiConfig.persona, system_prompt: aiConfig.system_prompt },
      nomeExibicao,
      modoContato,
      identidade.displayName,
    );
    ultimaSaida = String(resposta?.reply || '');
    console.log(`IA: ${ultimaSaida}`);
    if (resposta?.handoff) console.log('[a IA pediu handoff: o especialista assume daqui]');
    historico.push({ direction: 'outbound', remetente: aiConfig.persona, mensagem: ultimaSaida, metadata: { ai_text: ultimaSaida } });
    if (resposta?.handoff) break;
  }
  console.log('');
}

main().catch((error) => {
  console.error('falhou:', error instanceof Error ? error.message : error);
  process.exit(1);
});
