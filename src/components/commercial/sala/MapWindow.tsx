'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { DDD_INFO } from '@/lib/comercialGeo';
import type { SalaArrival, SalaPayload, SalaState } from '@/hooks/useCommercialSala';

type BrazilMap = {
  width: number;
  height: number;
  projection: { kx: number; ox: number; ky: number; oy: number };
  states: Array<{ sigla: string; nome: string; regiao: string; path: string; cx: number; cy: number }>;
};

// Uma cor por estado, nao por regiao: cada UF tem a propria identidade, mas o
// matiz vem da regiao dela, entao o Norte continua lendo verde, o Nordeste
// amarelo, e assim por diante. Sem isso, 27 cores soltas viram confete.
const STATE_COLOR: Record<string, string> = {
  // Norte
  AC: '#0fb87a', AM: '#17c98a', AP: '#3ad9a4', PA: '#0a9d68',
  RO: '#46e3b4', RR: '#6ff0c8', TO: '#089258',
  // Nordeste
  AL: '#ff9f1c', BA: '#f4a72a', CE: '#ffc93c', MA: '#e8871e', PB: '#ffd966',
  PE: '#fbb034', PI: '#d97706', RN: '#ffe08a', SE: '#ff8c42',
  // Centro-Oeste
  DF: '#b57bff', GO: '#8c52ff', MT: '#a06bf5', MS: '#7040d9',
  // Sudeste
  ES: '#ff6b8a', MG: '#ff2e63', RJ: '#ff8fa3', SP: '#e01e4f',
  // Sul
  PR: '#38bdf8', RS: '#0ea5e9', SC: '#7dd3fc',
};

export default function MapWindow({
  data,
  arrivals,
}: {
  data: SalaPayload | null;
  arrivals: SalaArrival[];
}) {
  const [map, setMap] = useState<BrazilMap | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    fetch('/brazil-map.json')
      .then((response) => response.json())
      .then((payload: BrazilMap) => {
        if (active) setMap(payload);
      })
      .catch(() => {
        if (active) setMap(null);
      });
    return () => {
      active = false;
    };
  }, []);

  const byUf = useMemo(() => {
    const entries = new Map<string, SalaState>();
    (data?.states || []).forEach((state) => entries.set(state.uf, state));
    return entries;
  }, [data]);

  const maxLeads = useMemo(
    () => Math.max(1, ...(data?.states || []).map((state) => state.leads)),
    [data],
  );

  const activeUfs = useMemo(
    () => new Set(arrivals.map((arrival) => arrival.lead.uf).filter(Boolean) as string[]),
    [arrivals],
  );

  const project = useMemo(() => {
    if (!map) return null;
    return (lat: number, lon: number) => ({
      x: lon * map.projection.kx + map.projection.ox,
      y: lat * map.projection.ky + map.projection.oy,
    });
  }, [map]);

  const pins = useMemo(() => {
    if (!project || !data) return [];
    return data.states
      .flatMap((state) => state.ddds.map((bucket) => ({ ...bucket, uf: state.uf })))
      .filter((bucket) => DDD_INFO[bucket.ddd])
      .sort((a, b) => b.leads - a.leads)
      .slice(0, 14)
      .map((bucket) => {
        const info = DDD_INFO[bucket.ddd];
        return { ...bucket, ...project(info.lat, info.lon) };
      });
  }, [project, data]);

  const beams = useMemo(() => {
    if (!project) return [];
    return arrivals
      .filter((arrival) => arrival.lead.ddd && DDD_INFO[arrival.lead.ddd])
      .map((arrival) => {
        const info = DDD_INFO[arrival.lead.ddd as string];
        return { key: arrival.key, ...project(info.lat, info.lon) };
      });
  }, [project, arrivals]);

  const trackPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    const tooltip = tooltipRef.current;
    const stage = stageRef.current;
    if (!tooltip || !stage) return;
    const box = stage.getBoundingClientRect();
    const x = Math.min(Math.max(event.clientX - box.left, 135), box.width - 135);
    const y = Math.min(Math.max(event.clientY - box.top, 140), box.height - 20);
    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y}px`;
  };

  const hoveredState = hovered ? byUf.get(hovered) : null;
  const hoveredMeta = map?.states.find((state) => state.sigla === hovered);

  return (
    <div className="sala-map">
      <div
        className="sala-stage"
        ref={stageRef}
        onPointerMove={trackPointer}
        onPointerLeave={() => setHovered(null)}
      >
        {!map && <div className="sala-holo-loading">Calibrando cartografia...</div>}

        {map && (
          <svg
            className="sala-brasil"
            viewBox={`0 0 ${map.width} ${map.height}`}
            role="img"
            aria-label="Mapa do Brasil com a origem dos leads por estado"
          >
            <g className="sala-uf-group">
              {map.states.map((state) => {
                const bucket = byUf.get(state.sigla);
                const color = STATE_COLOR[state.sigla] || '#7cc9ff';
                return (
                  <path
                    key={state.sigla}
                    d={state.path}
                    className={[
                      'sala-uf',
                      bucket ? 'has-leads' : 'is-idle',
                      hovered === state.sigla ? 'is-hovered' : '',
                      activeUfs.has(state.sigla) ? 'is-arriving' : '',
                    ].filter(Boolean).join(' ')}
                    style={{ '--uf-color': color } as React.CSSProperties}
                    tabIndex={0}
                    role="button"
                    aria-label={`${state.nome}: ${bucket?.leads || 0} leads, ${bucket?.perdidos || 0} perdidos, ${bucket?.fechados || 0} fechados`}
                    onPointerEnter={() => setHovered(state.sigla)}
                    onFocus={() => setHovered(state.sigla)}
                    onBlur={() => setHovered(null)}
                  />
                );
              })}
            </g>

            {/* A sigla so aparece onde ha lead: identifica a cor sem encher o
              * mapa de rotulo em estado parado. */}
            <g className="sala-uf-labels">
              {map.states
                .filter((state) => byUf.has(state.sigla))
                .map((state) => (
                  <text
                    key={state.sigla}
                    x={state.cx}
                    y={state.cy}
                    textAnchor="middle"
                    dominantBaseline="central"
                    className={hovered === state.sigla ? 'is-hovered' : ''}
                  >
                    {state.sigla}
                  </text>
                ))}
            </g>

            <g className="sala-holo-pins">
              {pins.map((pin) => (
                <g key={pin.ddd} className="sala-pin" transform={`translate(${pin.x} ${pin.y})`}>
                  <circle className="sala-pin-halo" r={4 + (pin.leads / maxLeads) * 15} />
                  <circle className="sala-pin-core" r={2.4} />
                </g>
              ))}
            </g>

            <g className="sala-holo-beams">
              {beams.map((beam) => (
                <g key={beam.key}>
                  <path
                    className="sala-beam"
                    d={`M ${beam.x} ${beam.y} C ${beam.x} ${beam.y * 0.5} ${beam.x} ${beam.y * 0.25} ${beam.x} -60`}
                  />
                  <circle className="sala-beam-origin" cx={beam.x} cy={beam.y} r={7} />
                </g>
              ))}
            </g>
          </svg>
        )}

        <div
          className={`sala-tooltip ${hovered ? 'is-visible' : ''}`}
          ref={tooltipRef}
          role="status"
        >
          {hovered && (
            <>
              <header>
                <strong>{hoveredMeta?.nome || hovered}</strong>
                <span style={{ color: STATE_COLOR[hovered] }}>{hovered}</span>
              </header>
              {hoveredState ? (
                <>
                  <div className="sala-tooltip-numbers">
                    <div>
                      <b>{hoveredState.leads}</b>
                      <span>leads</span>
                    </div>
                    <div className="is-lost">
                      <b>{hoveredState.perdidos}</b>
                      <span>perdidos</span>
                    </div>
                    <div className="is-won">
                      <b>{hoveredState.fechados}</b>
                      <span>fechados</span>
                    </div>
                  </div>
                  {hoveredState.ddds.length > 0 && (
                    <ul className="sala-tooltip-ddds">
                      {hoveredState.ddds.slice(0, 5).map((bucket) => (
                        <li key={bucket.ddd}>
                          <i>{bucket.ddd}</i>
                          <span>{bucket.cidade}</span>
                          <b>{bucket.leads}</b>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <p className="sala-tooltip-empty">Nenhum lead deste estado no periodo.</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
