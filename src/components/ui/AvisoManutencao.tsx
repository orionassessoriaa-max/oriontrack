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
const INICIO = new Date('2026-08-29T13:00:00-03:00').getTime();
const FIM = new Date('2026-08-29T14:00:00-03:00').getTime();

export default function AvisoManutencao() {
  const [visivel, setVisivel] = useState(false);

  useEffect(() => {
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
      <span>Manutencao programada agora, as 13h03.</span>
      <span style={{ fontWeight: 500 }}>
        Estamos ampliando o servidor do banco de dados para deixar o CRM mais rapido. O sistema pode
        ficar alguns minutos indisponivel. Se der erro, aguarde e atualize a pagina.
      </span>
    </div>
  );
}
