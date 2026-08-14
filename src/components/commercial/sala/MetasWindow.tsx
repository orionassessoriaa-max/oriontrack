'use client';

import { useMemo } from 'react';
import { currency } from '@/lib/comercial';
import type { SalaPayload } from '@/hooks/useCommercialSala';

// A meta vira uma rota de viagem: a nave sai da origem do mes e o que falta ate
// o destino e a distancia. Os numeros sao os mesmos da tela de metas, so que
// lidos como trajeto.

function compact(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}M`;
  if (value >= 1000) return `${(value / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}k`;
  return value.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
}

export default function MetasWindow({ data }: { data: SalaPayload | null }) {
  const metas = data?.metas;

  const rota = useMemo(() => {
    const meta = Number(metas?.meta_valor || 0);
    const vendido = Number(metas?.vendido || 0);
    const negociacao = Number(metas?.emNegociacao || 0);
    const projecao = vendido + negociacao;
    const falta = Math.max(0, meta - vendido);
    const percentual = meta > 0 ? Math.min(100, (vendido / meta) * 100) : 0;
    const percentualProjecao = meta > 0 ? Math.min(100, (projecao / meta) * 100) : 0;
    return { meta, vendido, negociacao, projecao, falta, percentual, percentualProjecao };
  }, [metas]);

  const mesLabel = metas?.mes
    ? new Date(`${metas.mes}T12:00:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
    : '';

  if (!metas) return <div className="sala-window-loading">Carregando rota...</div>;

  return (
    <div className="sala-metas">
      <header className="sala-window-head">
        <span className="sala-window-tag">Rota de destino</span>
        <h2>Meta de {mesLabel}</h2>
      </header>

      <div className="sala-route" role="img" aria-label={`Progresso de ${rota.percentual.toFixed(0)}% da meta do mes`}>
        <div className="sala-route-track">
          <div className="sala-route-line" />
          <div className="sala-route-projection" style={{ width: `${rota.percentualProjecao}%` }} />
          <div className="sala-route-done" style={{ width: `${rota.percentual}%` }} />
          <div className="sala-route-ship" style={{ left: `${rota.percentual}%` }}>
            <span className="sala-route-ship-glyph" aria-hidden="true" />
            <b>{rota.percentual.toFixed(0)}%</b>
          </div>
          <div className="sala-route-node is-origin">
            <i />
            <span>Origem</span>
          </div>
          <div className="sala-route-node is-target">
            <i />
            <span>{rota.meta > 0 ? compact(rota.meta) : 'Sem meta'}</span>
          </div>
        </div>
      </div>

      <div className="sala-distance">
        <span>Distancia restante</span>
        <strong>{rota.meta > 0 ? currency(rota.falta) : '--'}</strong>
        <small>
          {rota.meta > 0 && rota.projecao >= rota.meta
            ? 'A projecao ja cobre o destino'
            : rota.meta > 0
              ? `Faltam ${compact(rota.falta)} para chegar`
              : 'Defina a meta do mes na tela de Metas'}
        </small>
      </div>

      <div className="sala-metrics">
        <div>
          <span>Percorrido</span>
          <strong>{currency(rota.vendido)}</strong>
          <small>fechado no mes</small>
        </div>
        <div>
          <span>Em rota</span>
          <strong>{currency(rota.negociacao)}</strong>
          <small>em negociacao</small>
        </div>
        <div>
          <span>Projecao</span>
          <strong>{currency(rota.projecao)}</strong>
          <small>fechado + rota</small>
        </div>
        <div>
          <span>Vendas</span>
          <strong>
            {metas.vendas}
            {metas.meta_vendas > 0 && <em> / {metas.meta_vendas}</em>}
          </strong>
          <small>{metas.ticket_medio > 0 ? `ticket ${compact(metas.ticket_medio)}` : 'no mes'}</small>
        </div>
      </div>
    </div>
  );
}
