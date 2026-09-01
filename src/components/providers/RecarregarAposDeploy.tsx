'use client';

import { useEffect } from 'react';

/**
 * Recarrega a pagina quando o build muda por baixo do usuario.
 *
 * O CRM fica aberto o dia inteiro e o deploy troca os arquivos de codigo no
 * servidor. Quem estava com a aba aberta continua pedindo o pedaco antigo, que
 * nao existe mais: a tela fica girando para sempre, e foi o que aconteceu com o
 * inbox do Danilo depois de uma sequencia de deploys.
 *
 * Aqui a falha de carregar pedaco de codigo vira um recarregamento unico. O
 * marcador na sessao evita virar laco de recarga quando o erro for outro.
 */
const MARCA_RECARGA = 'orion:recarga-por-deploy';
const PADRAO_CHUNK = /loading chunk|chunkloaderror|failed to fetch dynamically imported module|importing a module script failed/i;

export default function RecarregarAposDeploy() {
  useEffect(() => {
    const jaTentou = () => {
      try {
        return sessionStorage.getItem(MARCA_RECARGA) === '1';
      } catch {
        return false;
      }
    };

    const marcar = () => {
      try {
        sessionStorage.setItem(MARCA_RECARGA, '1');
      } catch {
        // navegador sem storage: recarrega mesmo assim, uma vez por aba
      }
    };

    const recarregarSePreciso = (mensagem: unknown) => {
      if (!PADRAO_CHUNK.test(String(mensagem || ''))) return;
      if (jaTentou()) return;
      marcar();
      window.location.reload();
    };

    const aoErro = (evento: ErrorEvent) => recarregarSePreciso(evento.message || evento.error);
    const aoRejeitar = (evento: PromiseRejectionEvent) => recarregarSePreciso(
      (evento.reason as { message?: string })?.message || evento.reason,
    );

    window.addEventListener('error', aoErro);
    window.addEventListener('unhandledrejection', aoRejeitar);

    // Carregou inteiro: a proxima falha de pedaco pode recarregar de novo.
    const limpar = window.setTimeout(() => {
      try {
        sessionStorage.removeItem(MARCA_RECARGA);
      } catch {
        // sem storage nao ha o que limpar
      }
    }, 10_000);

    return () => {
      window.removeEventListener('error', aoErro);
      window.removeEventListener('unhandledrejection', aoRejeitar);
      window.clearTimeout(limpar);
    };
  }, []);

  return null;
}
