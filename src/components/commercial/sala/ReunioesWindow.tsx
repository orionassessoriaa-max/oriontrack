'use client';

import { useMemo, useState } from 'react';
import type { SalaPayload, SalaReuniao } from '@/hooks/useCommercialSala';

// As reunioes do dia viram uma constelacao: cada estrela e uma reuniao, ligadas
// na ordem do horario. A posicao vem do proprio horario, entao a constelacao e
// estavel entre renderizacoes e o desenho conta a agenda do dia.

const VIEW_WIDTH = 1000;
const VIEW_HEIGHT = 560;

function hourLabel(value: string) {
  return new Date(value).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  });
}

function minutesOfDay(value: string) {
  const label = new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(value));
  const [hours, minutes] = label.split(':').map(Number);
  return hours * 60 + minutes;
}

/** Ruido estavel a partir do id, para as estrelas nao ficarem numa linha reta. */
function jitter(seed: string) {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 100000;
  }
  return (hash % 1000) / 1000;
}

export default function ReunioesWindow({ data }: { data: SalaPayload | null }) {
  const [selected, setSelected] = useState<string | null>(null);
  const reunioes = useMemo(() => data?.reunioes || [], [data]);

  const stars = useMemo(() => {
    if (!reunioes.length) return [];
    // O dia util ancora o eixo horizontal: 7h na esquerda, 21h na direita.
    const dayStart = 7 * 60;
    const dayEnd = 21 * 60;
    return reunioes.map((reuniao, index) => {
      const minutes = minutesOfDay(reuniao.agendada_at);
      const ratio = Math.min(1, Math.max(0, (minutes - dayStart) / (dayEnd - dayStart)));
      const noise = jitter(reuniao.id);
      return {
        reuniao,
        x: 90 + ratio * (VIEW_WIDTH - 180),
        y: 130 + noise * (VIEW_HEIGHT - 260) + (index % 2 === 0 ? -24 : 24),
      };
    });
  }, [reunioes]);

  const path = useMemo(
    () => stars.map((star, index) => `${index === 0 ? 'M' : 'L'} ${star.x.toFixed(1)} ${star.y.toFixed(1)}`).join(' '),
    [stars],
  );

  const active = selected ? reunioes.find((item) => item.id === selected) : null;
  const proxima = reunioes.find((item) => !item.realizada && !item.no_show);

  return (
    <div className="sala-reunioes">
      <header className="sala-window-head">
        <span className="sala-window-tag">Constelacao do dia</span>
        <h2>
          {reunioes.length} {reunioes.length === 1 ? 'reuniao hoje' : 'reunioes hoje'}
        </h2>
        {proxima && (
          <p className="sala-window-sub">
            Proxima as {hourLabel(proxima.agendada_at)} com {proxima.nome || 'lead sem nome'}
          </p>
        )}
      </header>

      {!reunioes.length ? (
        <div className="sala-empty-sky">
          <span className="sala-empty-star" aria-hidden="true" />
          <p>Nenhuma reuniao agendada para hoje.</p>
          <small>O ceu esta limpo. Agende no Kanban para acender a constelacao.</small>
        </div>
      ) : (
        <div className="sala-constellation">
          <svg viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`} role="img" aria-label="Constelacao das reunioes de hoje">
            <path className="sala-constellation-line" d={path} />
            {stars.map((star) => (
              <g
                key={star.reuniao.id}
                className={[
                  'sala-star',
                  star.reuniao.realizada ? 'is-done' : '',
                  star.reuniao.no_show ? 'is-noshow' : '',
                  selected === star.reuniao.id ? 'is-selected' : '',
                ].filter(Boolean).join(' ')}
                transform={`translate(${star.x.toFixed(1)} ${star.y.toFixed(1)})`}
                role="button"
                tabIndex={0}
                aria-label={`${hourLabel(star.reuniao.agendada_at)} com ${star.reuniao.nome || 'lead sem nome'}`}
                onPointerEnter={() => setSelected(star.reuniao.id)}
                onFocus={() => setSelected(star.reuniao.id)}
                onBlur={() => setSelected(null)}
              >
                <circle className="sala-star-halo" r={26} />
                <circle className="sala-star-core" r={6} />
                <text className="sala-star-hour" y={-34} textAnchor="middle">
                  {hourLabel(star.reuniao.agendada_at)}
                </text>
              </g>
            ))}
          </svg>
        </div>
      )}

      {active ? (
        <ReuniaoCard reuniao={active} />
      ) : (
        reunioes.length > 0 && <p className="sala-hint">Passe o mouse sobre uma estrela para abrir a reuniao.</p>
      )}
    </div>
  );
}

function ReuniaoCard({ reuniao }: { reuniao: SalaReuniao }) {
  return (
    <div className="sala-reuniao-card">
      <div className="sala-reuniao-hour">{hourLabel(reuniao.agendada_at)}</div>
      <div className="sala-reuniao-body">
        <strong>{reuniao.nome || 'Lead sem nome'}</strong>
        <span>
          {reuniao.telefone || 'sem telefone'}
          {reuniao.uf && ` · ${reuniao.uf}`}
        </span>
        <small>
          SDR {reuniao.sdr || 'nao atribuido'}
          {reuniao.closer && ` · Closer ${reuniao.closer}`}
        </small>
      </div>
      <div className="sala-reuniao-tags">
        <span className={`sala-mql is-${String(reuniao.mql).toLowerCase()}`}>MQL {reuniao.mql}</span>
        {reuniao.realizada && <span className="sala-tag is-done">realizada</span>}
        {reuniao.no_show && <span className="sala-tag is-noshow">no-show</span>}
      </div>
    </div>
  );
}
