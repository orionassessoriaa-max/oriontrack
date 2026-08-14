'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { useCommercial } from '@/components/commercial/CommercialShell';
import { useCommercialSala, type SalaPeriod } from '@/hooks/useCommercialSala';
import CockpitDeck from '@/components/commercial/sala/CockpitDeck';
import MapWindow from '@/components/commercial/sala/MapWindow';
import MetasWindow from '@/components/commercial/sala/MetasWindow';
import ReunioesWindow from '@/components/commercial/sala/ReunioesWindow';
import ArrivalFeed from '@/components/commercial/sala/ArrivalFeed';
import './sala.css';

const PERIODS: Array<{ id: SalaPeriod; label: string }> = [
  { id: 'hoje', label: 'Hoje' },
  { id: '7d', label: '7 dias' },
  { id: '30d', label: '30 dias' },
  { id: 'mes', label: 'Mes' },
  { id: 'tudo', label: 'Tudo' },
];

export default function CommercialSalaPage() {
  const { api } = useCommercial();
  const [period, setPeriod] = useState<SalaPeriod>('mes');
  const { data, loading, error, arrivals, dismissArrival, refresh, live } = useCommercialSala(api, period);

  const panels = [
    { id: 'reunioes', label: 'Reunioes', content: <ReunioesWindow data={data} /> },
    { id: 'mapa', label: 'Origem dos leads', content: <MapWindow data={data} arrivals={arrivals} /> },
    { id: 'metas', label: 'Metas', content: <MetasWindow data={data} /> },
  ];

  return (
    <div className="sala">
      <div className="sala-starfield" aria-hidden="true" />
      <div className="sala-hull" aria-hidden="true" />

      <header className="sala-hud">
        <div className="sala-hud-left">
          <Link href="/comercial" className="sala-exit">
            <ArrowLeft size={16} />
            <span>Sair da cabine</span>
          </Link>
          <span className={`sala-live ${live ? 'is-live' : ''}`}>
            <i aria-hidden="true" />
            {live ? 'Tempo real' : 'Atualizando a cada 20s'}
          </span>
        </div>

        <div className="sala-hud-center">
          {data && (
            <>
              <div>
                <b>{data.totals.leads}</b>
                <span>leads</span>
              </div>
              <div>
                <b>{data.totals.emVenda}</b>
                <span>em venda</span>
              </div>
              <div>
                <b>{data.totals.fechados}</b>
                <span>fechados</span>
              </div>
              <div>
                <b>{data.totals.reunioesHoje}</b>
                <span>reunioes hoje</span>
              </div>
            </>
          )}
        </div>

        <div className="sala-hud-right">
          <div className="sala-period" role="group" aria-label="Periodo do mapa">
            {PERIODS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={period === item.id ? 'is-active' : ''}
                onClick={() => setPeriod(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <button type="button" className="sala-refresh" onClick={() => void refresh()} aria-label="Atualizar agora">
            <RefreshCw size={15} className={loading ? 'is-spinning' : ''} />
          </button>
        </div>
      </header>

      <ArrivalFeed arrivals={arrivals} onExpire={dismissArrival} />

      {error ? (
        <div className="sala-error">
          <strong>Falha na telemetria</strong>
          <p>{error}</p>
          <button type="button" onClick={() => void refresh()}>
            Tentar de novo
          </button>
        </div>
      ) : (
        <CockpitDeck panels={panels} initial={1} />
      )}

      {loading && !data && <div className="sala-boot">Ligando os instrumentos...</div>}

      <p className="sala-help">Arraste para os lados ou use as setas do teclado para girar a cadeira.</p>
    </div>
  );
}
