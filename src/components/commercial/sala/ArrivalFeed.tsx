'use client';

import { useEffect, useRef } from 'react';
import { Radio } from 'lucide-react';
import type { SalaArrival } from '@/hooks/useCommercialSala';

// Cada lead que entra sobe pela linha do mapa e aparece aqui no topo, com o que
// o time precisa para agir: quem e, telefone, SDR responsavel e o perfil de MQL.

const ARRIVAL_TTL = 11000;

export default function ArrivalFeed({
  arrivals,
  onExpire,
}: {
  arrivals: SalaArrival[];
  onExpire: (key: string) => void;
}) {
  // Cada card tem o proprio relogio. Reagendar todos a cada chegada nova faria
  // o card antigo viver mais do que devia.
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const timers = timersRef.current;
    arrivals.forEach((arrival) => {
      if (timers.has(arrival.key)) return;
      timers.set(
        arrival.key,
        setTimeout(() => {
          timers.delete(arrival.key);
          onExpire(arrival.key);
        }, ARRIVAL_TTL),
      );
    });
  }, [arrivals, onExpire]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach(clearTimeout);
      timers.clear();
    };
  }, []);

  if (!arrivals.length) return null;

  return (
    <div className="sala-arrivals" role="log" aria-live="polite" aria-label="Leads chegando agora">
      {arrivals.map((arrival) => {
        const { lead } = arrival;
        return (
          <article key={arrival.key} className="sala-arrival">
            <div className="sala-arrival-mark" aria-hidden="true">
              <Radio size={15} />
            </div>
            <div className="sala-arrival-body">
              <header>
                <strong>{lead.nome || 'Lead sem nome'}</strong>
                <span className={`sala-mql is-${String(lead.mql).toLowerCase()}`}>MQL {lead.mql}</span>
              </header>
              <p>
                {lead.telefone || 'sem telefone'}
                {lead.cidade && <em> · {lead.cidade}</em>}
                {lead.uf && <em> · {lead.uf}</em>}
              </p>
              <small>SDR {lead.sdr || 'aguardando distribuicao'}</small>
            </div>
          </article>
        );
      })}
    </div>
  );
}
