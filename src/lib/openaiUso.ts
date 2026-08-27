import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * Contabilidade das chamadas à OpenAI.
 *
 * A fatura chegava sem dono: dava para contar imagem de criativo pela tabela de
 * assets e resposta de IA pela mensagem gravada, mas chamada que falha, que
 * repete ou que nao vira registro nenhum ficava invisivel. Sem saber qual rota
 * gasta, qualquer corte e chute. Aqui toda chamada deixa rastro: origem,
 * modelo e tokens.
 *
 * O registro nunca derruba a chamada real: qualquer erro ao gravar e engolido.
 */
type UsoOpenAI = {
  origem: string;
  modelo: string;
  tokens_entrada?: number | null;
  tokens_saida?: number | null;
  imagens?: number | null;
  ok: boolean;
  erro?: string | null;
};

async function gravar(uso: UsoOpenAI) {
  try {
    await supabaseAdmin.from('openai_uso').insert({
      origem: uso.origem,
      modelo: uso.modelo || 'desconhecido',
      tokens_entrada: uso.tokens_entrada ?? null,
      tokens_saida: uso.tokens_saida ?? null,
      imagens: uso.imagens ?? null,
      ok: uso.ok,
      erro: uso.erro ? String(uso.erro).slice(0, 300) : null,
    });
  } catch {
    // Medir gasto nao pode quebrar atendimento.
  }
}

function modeloDoPedido(init: RequestInit | undefined, url: string) {
  const corpo = init?.body;
  if (typeof corpo === 'string') {
    try {
      const json = JSON.parse(corpo);
      if (json?.model) return String(json.model);
    } catch {
      // corpo nao e JSON: cai no FormData abaixo
    }
  }
  if (corpo instanceof FormData) {
    const modelo = corpo.get('model');
    if (modelo) return String(modelo);
  }
  return url.includes('/audio/transcriptions') ? 'whisper' : 'desconhecido';
}

/**
 * Mesma assinatura do fetch, com o rótulo da origem na frente. Só o
 * chat/completions tem o corpo lido de volta, porque é onde vem o `usage`;
 * imagem e áudio voltam com payload grande e não valem a cópia.
 */
export async function openaiFetch(origem: string, url: string, init?: RequestInit, timeoutMs = 60_000) {
  const modelo = modeloDoPedido(init, url);
  const ehChat = url.includes('/chat/completions');
  const ehImagem = url.includes('/images/');

  // Geracao de imagem passa de um minuto com facilidade; quem chama com o
  // proprio signal continua no controle do seu tempo.
  const controlador = new AbortController();
  const limite = setTimeout(() => controlador.abort(), ehImagem ? Math.max(timeoutMs, 180_000) : timeoutMs);

  try {
    const resposta = await fetch(url, { ...(init || {}), signal: init?.signal || controlador.signal });

    if (ehChat && resposta.ok) {
      try {
        const copia = await resposta.clone().json();
        void gravar({
          origem,
          modelo: String(copia?.model || modelo),
          tokens_entrada: Number(copia?.usage?.prompt_tokens ?? 0) || null,
          tokens_saida: Number(copia?.usage?.completion_tokens ?? 0) || null,
          ok: true,
        });
      } catch {
        void gravar({ origem, modelo, ok: true });
      }
    } else {
      void gravar({
        origem,
        modelo,
        imagens: ehImagem ? 1 : null,
        ok: resposta.ok,
        erro: resposta.ok ? null : `http ${resposta.status}`,
      });
    }

    return resposta;
  } catch (erro) {
    void gravar({
      origem,
      modelo,
      imagens: ehImagem ? 1 : null,
      ok: false,
      erro: erro instanceof Error ? erro.message : String(erro),
    });
    throw erro;
  } finally {
    clearTimeout(limite);
  }
}
