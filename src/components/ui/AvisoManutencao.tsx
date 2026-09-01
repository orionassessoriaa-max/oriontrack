'use client';

import { useEffect, useState } from 'react';

/**
 * Aviso de manutencao no topo de todas as telas.
 *
 * Fica visivel apenas dentro da janela marcada e some sozinho depois, sem
 * precisar de novo deploy para tirar do ar. Nao consulta banco: durante a
 * manutencao o banco e justamente o que pode estar fora, e o aviso precisa
 * aparecer mesmo assim.
 */
// Para avisar a equipe de novo, basta preencher a janela e religar o componente
// no layout. Vazio aqui significa nenhum aviso na tela.
const JANELA = { inicio: '', fim: '' };

const INICIO = JANELA.inicio ? new Date(JANELA.inicio).getTime() : 0;
const FIM = JANELA.fim ? new Date(JANELA.fim).getTime() : 0;

export default function AvisoManutencao() {
  const [visivel, setVisivel] = useState(false);

  useEffect(() => {
    if (!INICIO || !FIM) return;
    const conferir = () => {
      const agora = Date.now();
      setVisivel(agora >= INICIO && agora <= FIM);
    };
    conferir();
    const timer = setInterval(conferir, 30_000);
    return () => clearInterval(timer);
  }, []);

  if (!visivel) return null;

  return (
    <div
      role="status"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 9999,
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0.5rem',
        padding: '0.6rem 1rem',
        background: '#facc15',
        color: '#1f2937',
        fontSize: '0.85rem',
        fontWeight: 700,
        textAlign: 'center',
        boxShadow: '0 1px 6px rgba(0,0,0,0.18)',
      }}
    >
      <span>Atualizacao programada as 12h00.</span>
      <span style={{ fontWeight: 500 }}>
        Subimos melhorias no inbox e no comercial. Se a tela demorar ou ficar estranha, atualize a
        pagina com Ctrl + Shift + R.
      </span>
    </div>
  );
}
