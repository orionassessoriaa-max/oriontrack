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
type Compartilhado = {
  ativo: boolean;
  instancia: string | null;
  assinarMensagens: boolean;
};

export function isUnityBrokerage(nomeEmpresa?: string | null) {
  return String(nomeEmpresa || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase() === 'UNITY SAUDE';
}

export async function resolverAtendimentoCompartilhado(corretorId?: string | null): Promise<Compartilhado> {
  if (!corretorId) return { ativo: false, instancia: null, assinarMensagens: false };

  const { data: corretora, error } = await supabaseAdmin
    .from('corretores')
    .select('id, nome_empresa, atendimento_compartilhado, numero_compartilhado_profile_id')
    .eq('id', corretorId)
    .maybeSingle();

  // Antes da migration a coluna nao existe: sem ela, o comportamento e o antigo.
  if (error || !corretora?.atendimento_compartilhado) {
    return { ativo: false, instancia: null, assinarMensagens: false };
  }

  const assinarMensagens = isUnityBrokerage(corretora.nome_empresa);

  const donoId = corretora.numero_compartilhado_profile_id
    || (await donoPadraoDaConcessionaria(corretorId));
  if (!donoId) return { ativo: true, instancia: null, assinarMensagens };

  return { ativo: true, instancia: uazapiInstanceName(String(donoId)), assinarMensagens };
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
