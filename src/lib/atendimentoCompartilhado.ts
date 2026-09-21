import { supabaseAdmin } from '@/lib/supabase/admin';
import { uazapiInstanceName } from '@/lib/uazapi';

/**
 * Atendimento compartilhado: uma concessionaria, um numero, varios vendedores.
 *
 * Sete vendedores com sete chips nao faz sentido para quem atende como equipe.
 * Com a chave ligada, todo mundo envia pelo mesmo WhatsApp e a mensagem sai
 * assinada com o primeiro nome de quem escreveu, senao o cliente recebe
 * respostas de pessoas diferentes sem saber com quem esta falando.
 *
 * A chave e por concessionaria e nasce desligada: corretora que ja opera com um
 * numero por pessoa continua exatamente como esta.
 */
export type AtendimentoCompartilhado = {
  ativo: boolean;
  instancia: string | null;
  assinarMensagens: boolean;
  donoProfileId: string | null;
  donoNome: string | null;
  erroConfiguracao: string | null;
};

const DESATIVADO: AtendimentoCompartilhado = {
  ativo: false,
  instancia: null,
  assinarMensagens: false,
  donoProfileId: null,
  donoNome: null,
  erroConfiguracao: null,
};

export function isUnityBrokerage(nomeEmpresa?: string | null) {
  return String(nomeEmpresa || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase() === 'UNITY SAUDE';
}

export async function resolverAtendimentoCompartilhado(corretorId?: string | null): Promise<AtendimentoCompartilhado> {
  if (!corretorId) return DESATIVADO;

  const { data: corretora, error } = await supabaseAdmin
    .from('corretores')
    .select('id, nome_empresa, atendimento_compartilhado, numero_compartilhado_profile_id')
    .eq('id', corretorId)
    .maybeSingle();

  // Antes da migration a coluna nao existe: sem ela, o comportamento e o antigo.
  if (error || !corretora?.atendimento_compartilhado) {
    return DESATIVADO;
  }

  const assinarMensagens = isUnityBrokerage(corretora.nome_empresa);

  const donoId = corretora.numero_compartilhado_profile_id
    || (await donoPadraoDaConcessionaria(corretorId));
  if (!donoId) {
    return {
      ativo: true,
      instancia: null,
      assinarMensagens,
      donoProfileId: null,
      donoNome: null,
      erroConfiguracao: 'O WhatsApp compartilhado nao possui um perfil responsavel configurado.',
    };
  }

  // O ID salvo no banco nunca pode apontar para outra corretora. Sem esta
  // validacao, um erro de cadastro faria mensagens de uma operacao sairem pelo
  // numero de outra empresa.
  const { data: dono, error: donoError } = await supabaseAdmin
    .from('profiles')
    .select('id, nome, corretor_id, tipo_usuario, status')
    .eq('id', donoId)
    .eq('corretor_id', corretorId)
    .in('tipo_usuario', ['corretor', 'corretor_admin'])
    .in('status', ['active', 'ativo', 'Ativo'])
    .maybeSingle();

  if (donoError || !dono) {
    return {
      ativo: true,
      instancia: null,
      assinarMensagens,
      donoProfileId: null,
      donoNome: null,
      erroConfiguracao: 'O perfil responsavel pelo WhatsApp compartilhado e invalido ou esta inativo.',
    };
  }

  return {
    ativo: true,
    instancia: uazapiInstanceName(String(dono.id)),
    assinarMensagens,
    donoProfileId: String(dono.id),
    donoNome: String(dono.nome || 'Responsavel'),
    erroConfiguracao: null,
  };
}

/**
 * Sem dono escolhido, o numero e o do responsavel pela concessionaria. E o
 * perfil que ja existia antes de qualquer vendedor entrar.
 */
async function donoPadraoDaConcessionaria(corretorId: string) {
  const { data } = await supabaseAdmin
    .from('profiles')
    .select('id, tipo_usuario, created_at')
    .eq('corretor_id', corretorId)
    .in('tipo_usuario', ['corretor', 'corretor_admin'])
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  return data?.id || null;
}

/**
 * Assinatura que o cliente le no WhatsApp da Unity. Vai no texto porque o
 * cliente nao tem acesso ao CRM e varias pessoas respondem pelo mesmo numero.
 * Outras operacoes nao devem passar por esta funcao no envio.
 */
export function assinarMensagem(texto: string, nomeDoVendedor?: string | null) {
  const primeiroNome = String(nomeDoVendedor || '').trim().split(/\s+/)[0];
  const corpo = String(texto || '').trim();
  if (!primeiroNome || !corpo) return corpo;

  // Reenvio da mesma mensagem nao pode empilhar assinatura. Aceita tambem o
  // formato antigo, com dois-pontos e corpo na mesma linha.
  const nomeEscapado = primeiroNome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`^\\*${nomeEscapado}\\*:?\\s*`, 'i').test(corpo)) return corpo;

  return `*${primeiroNome}*\n${corpo}`;
}
