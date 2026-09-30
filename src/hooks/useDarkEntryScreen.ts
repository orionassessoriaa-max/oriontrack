'use client';

import { useEffect } from 'react';

/**
 * Telas de entrada (login, primeiro acesso, reset de senha, escolha de time)
 * sao sempre escuras: a capa e uma foto azul escura e os cartoes foram
 * desenhados para encostar nela sem emenda.
 *
 * Quem aplica .theme-claro no <html> e o InternalLayout, e ele nunca limpa a
 * classe ao desmontar. Entao quem saia de uma tela interna no tema claro
 * chegava no login com a classe ainda no documento: cartao cinza, texto branco
 * por cima, ilegivel. Aqui a classe sai enquanto a tela de entrada estiver
 * montada. O tema salvo volta sozinho assim que o InternalLayout monta de novo,
 * porque ele le o localStorage; nada e gravado aqui.
 */
export function useDarkEntryScreen() {
  useEffect(() => {
    const raiz = document.documentElement;
    const corpo = document.body;
    const tinhaClaro = raiz.classList.contains('theme-claro');
    const esquemaAnterior = raiz.style.colorScheme;

    raiz.classList.remove('theme-claro');
    corpo.classList.remove('theme-claro');
    raiz.classList.add('theme-noturno');
    corpo.classList.add('theme-noturno');
    raiz.style.colorScheme = 'dark';

    return () => {
      if (!tinhaClaro) return;
      raiz.classList.remove('theme-noturno');
      corpo.classList.remove('theme-noturno');
      raiz.classList.add('theme-claro');
      corpo.classList.add('theme-claro');
      raiz.style.colorScheme = esquemaAnterior || 'light';
    };
  }, []);
}
