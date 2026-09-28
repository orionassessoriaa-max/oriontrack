'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle, ArrowDown, ArrowUp, BarChart3, CalendarDays, ChevronRight,
  Building2, CircleDollarSign, Image as ImageIcon, Loader2, MapPinned, RefreshCw,
  Search, Target, TrendingUp, UsersRound, WalletCards, X,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import styles from './RegionalCplExchange.module.css';

type Creative = {
  id: string;
  ad_id: string;
  name: string;
  client_name: string;
  spend: number;
  leads: number;
  cpl: number | null;
  impressions: number;
  clicks: number;
  ctr: number;
  image_url: string | null;
  title: string | null;
  primary_text: string | null;
  status: string;
};

type Region = {
  id: string;
  name: string;
  spend: number;
  leads: number;
  cpl: number | null;
  previous_cpl: number | null;
  variation_percent: number | null;
  impressions: number;
  clicks: number;
  ctr: number;
  client_count: number;
  clients: Array<{ id: string; name: string; spend: number; leads: number; cpl: number | null }>;
  best_creative: Creative | null;
  top_creatives: Creative[];
};

type Payload = {
  period: { since: string; until: string; previous_since: string; previous_until: string };
  summary: { spend: number; leads: number; cpl: number | null; impressions: number; clicks: number; ctr: number; regions: number; accounts: number };
  regions: Region[];
  errors: Array<{ account: string; message: string }>;
  refreshed_at: string;
  criteria: { source: string; geography: string; creative_minimum_leads: number };
};

type SortKey = 'volume' | 'cpl_low' | 'cpl_high' | 'variation';

function dateValue(date: Date) {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 10);
}

function daysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return dateValue(date);
}

function money(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 }).format(value);
}

function compact(value: number) {
  return new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

function percent(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${value.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function variationLabel(value: number | null) {
  if (value === null) return 'sem comparativo';
  if (Math.abs(value) < 0.1) return 'estável';
  return `${value > 0 ? '+' : ''}${percent(value)}`;
}

export default function RegionalCplExchange({ scope }: { scope: 'apollo' | 'kripto' }) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [dateStart, setDateStart] = useState(() => daysAgo(29));
  const [dateEnd, setDateEnd] = useState(() => dateValue(new Date()));
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('volume');
  const [selected, setSelected] = useState<Region | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('Sessão expirada. Entre novamente.');
      const params = new URLSearchParams({ de: dateStart, ate: dateEnd });
      const endpoint = scope === 'apollo' ? '/api/equipe/apollo/bolsa-cpl' : '/api/comercial/bolsa-cpl';
      const response = await fetch(`${endpoint}?${params.toString()}`, {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Não foi possível carregar os dados regionais.');
      setPayload(body as Payload);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar a Bolsa de CPL.');
    } finally {
      setLoading(false);
    }
  }, [dateEnd, dateStart, scope]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (!selected) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelected(null);
    };
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', escape);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', escape);
    };
  }, [selected]);

  const regions = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('pt-BR');
    const filtered = (payload?.regions || []).filter((region) => !query
      || region.name.toLocaleLowerCase('pt-BR').includes(query)
      || region.clients.some((client) => client.name.toLocaleLowerCase('pt-BR').includes(query))
      || region.best_creative?.name.toLocaleLowerCase('pt-BR').includes(query));
    return [...filtered].sort((a, b) => {
      if (sort === 'cpl_low') return (a.cpl ?? Number.POSITIVE_INFINITY) - (b.cpl ?? Number.POSITIVE_INFINITY);
      if (sort === 'cpl_high') return (b.cpl ?? -1) - (a.cpl ?? -1);
      if (sort === 'variation') return (b.variation_percent ?? -Infinity) - (a.variation_percent ?? -Infinity);
      return b.leads - a.leads || b.spend - a.spend;
    });
  }, [payload, search, sort]);

  const averageCpl = payload?.summary.cpl || 0;

  function status(region: Region) {
    if (region.cpl === null || !averageCpl) return 'neutral';
    if (region.cpl <= averageCpl * 0.85) return 'good';
    if (region.cpl <= averageCpl * 1.15) return 'attention';
    return 'high';
  }

  function applyDays(days: number) {
    setDateStart(daysAgo(days - 1));
    setDateEnd(dateValue(new Date()));
  }

  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <div className={styles.heroGrid}>
          <div>
            <span className={styles.eyebrow}><BarChart3 size={14} /> Inteligência regional Meta Ads</span>
            <h1>Custo médio por estado.<br /><em>Visão sem distorção.</em></h1>
            <p>Somamos investimento e leads de todas as concessionárias que anunciam em cada estado. O CPL estadual é investimento total dividido pelos leads totais.</p>
          </div>
          <button type="button" className={styles.refresh} onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 size={16} className={styles.spin} /> : <RefreshCw size={16} />} Atualizar dados
          </button>
        </div>
      </header>

      {error && <div className={styles.error} role="alert"><AlertCircle size={18} /><span>{error}</span><button type="button" onClick={() => void load()}>Tentar novamente</button></div>}

      <section className={styles.metrics} aria-label="Resumo do período">
        <article className={styles.metricCyan}><span><MapPinned size={17} /></span><p>Estados</p><strong>{payload?.summary.regions || 0}</strong><small>com investimento no período</small></article>
        <article className={styles.metricBlue}><span><Building2 size={17} /></span><p>Concessionárias</p><strong>{payload?.summary.accounts || 0}</strong><small>contas Meta consolidadas</small></article>
        <article className={styles.metricEmerald}><span><Target size={17} /></span><p>Leads Meta</p><strong>{compact(payload?.summary.leads || 0)}</strong><small>conversões reportadas</small></article>
        <article className={styles.metricCyan}><span><TrendingUp size={17} /></span><p>CPL médio geral</p><strong>{money(payload?.summary.cpl)}</strong><small>investimento dividido pelos leads</small></article>
        <article className={styles.metricSlate}><span><WalletCards size={17} /></span><p>Investimento</p><strong>{money(payload?.summary.spend)}</strong><small>todas as regiões somadas</small></article>
      </section>

      <section className={styles.board}>
        <div className={styles.boardHeader}>
          <div className={styles.boardTop}>
            <div><span>Visão consolidada</span><h2>CPL médio por estado</h2><p>Cada estado reúne todas as concessionárias com entrega naquela região.</p></div>
            <div className={styles.periodControls}>
              <div className={styles.quickPeriods}>
                {[7, 30, 90].map((days) => <button type="button" key={days} onClick={() => applyDays(days)} className={dateStart === daysAgo(days - 1) ? styles.activePeriod : ''}>{days} dias</button>)}
              </div>
              <label><span>De</span><input type="date" value={dateStart} max={dateEnd} onChange={(event) => setDateStart(event.target.value)} /></label>
              <label><span>Até</span><input type="date" value={dateEnd} min={dateStart} onChange={(event) => setDateEnd(event.target.value)} /></label>
            </div>
          </div>
          <div className={styles.boardControls}>
            <label className={styles.search}><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar estado ou concessionária..." /></label>
            <select value={sort} onChange={(event) => setSort(event.target.value as SortKey)} aria-label="Ordenar estados"><option value="volume">Mais leads</option><option value="cpl_low">Menor CPL</option><option value="cpl_high">Maior CPL</option><option value="variation">Maior alta</option></select>
          </div>
        </div>

        <div className={styles.tableWrap}>
          <table>
            <thead><tr><th>Estado</th><th className={styles.right}>Concessionárias</th><th className={styles.right}>Leads Meta</th><th className={styles.right}>CPL médio</th><th className={styles.right}>Investimento</th><th>Melhor criativo do estado</th><th /></tr></thead>
            <tbody>
              {regions.map((region) => {
                const state = status(region);
                return <tr key={region.id} onClick={() => setSelected(region)} tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter') setSelected(region); }}>
                  <td><div className={styles.regionName}><span className={`${styles.stateMark} ${styles[state]}`} /><div><strong>{region.name}</strong><small>{region.impressions.toLocaleString('pt-BR')} impressões · CTR {percent(region.ctr)}</small></div></div></td>
                  <td className={styles.right}><strong className={styles.tableNumber}>{region.client_count}</strong><small className={styles.mobileHint}> contas</small></td>
                  <td className={styles.right}><strong className={styles.tableNumber}>{region.leads}</strong></td>
                  <td className={styles.right}><span className={`${styles.cplBadge} ${styles[state]}`}>{money(region.cpl)}</span><small className={`${styles.delta} ${(region.variation_percent || 0) <= 0 ? styles.down : styles.up}`}>{region.variation_percent === null ? 'sem comparativo' : <>{region.variation_percent <= 0 ? <ArrowDown size={11} /> : <ArrowUp size={11} />}{variationLabel(region.variation_percent)}</>}</small></td>
                  <td className={styles.right}><strong className={styles.tableNumber}>{money(region.spend)}</strong></td>
                  <td><div className={styles.creativeCell}><div className={styles.thumb}>{region.best_creative?.image_url ? <img src={region.best_creative.image_url} alt="" referrerPolicy="no-referrer" /> : <ImageIcon size={17} />}</div><div><strong>{region.best_creative?.name || 'Sem lead atribuído'}</strong><small>{region.best_creative ? `${region.best_creative.client_name} · CPL ${money(region.best_creative.cpl)}` : 'Aguardando conversões na Meta'}</small></div></div></td>
                  <td><ChevronRight size={17} className={styles.chevron} /></td>
                </tr>;
              })}
              {!loading && regions.length === 0 && !error && <tr><td colSpan={7}><div className={styles.empty}><MapPinned size={28} /><strong>Nenhum estado encontrado</strong><span>A Meta não retornou investimento regional para estes filtros.</span></div></td></tr>}
              {loading && !payload && <tr><td colSpan={7}><div className={styles.empty}><Loader2 size={28} className={styles.spin} /><strong>Consolidando os estados</strong><span>Somando investimento e leads de todas as concessionárias.</span></div></td></tr>}
            </tbody>
          </table>
        </div>
        <div className={styles.boardFooter}><span>{regions.length} de {payload?.summary.regions || 0} estados exibidos</span><span>Fonte: Meta Ads · CPL ponderado por investimento e leads</span></div>
      </section>

      {payload?.errors.length ? <details className={styles.partial}><summary>{payload.errors.length} conta(s) não responderam nesta atualização</summary>{payload.errors.map((item) => <p key={item.account}><strong>{item.account}:</strong> {item.message}</p>)}</details> : null}

      <footer className={styles.note}><CalendarDays size={14} /><span>Exemplo: se três concessionárias investirem R$ 3.000 e gerarem 100 leads na Paraíba, o CPL médio do estado será R$ 30.</span></footer>

      {selected && (
        <div className={styles.overlay} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
          <section className={styles.drawer} role="dialog" aria-modal="true" aria-labelledby="region-title">
            <header><div><span>Detalhes regionais</span><h2 id="region-title">{selected.name}</h2><p>{selected.leads} leads · {money(selected.spend)} investidos · CPL {money(selected.cpl)}</p></div><button type="button" onClick={() => setSelected(null)} aria-label="Fechar"><X size={19} /></button></header>
            <div className={styles.drawerBody}>
              <div className={styles.drawerStats}>
                <article><span>CPL atual</span><strong>{money(selected.cpl)}</strong></article>
                <article><span>Período anterior</span><strong>{money(selected.previous_cpl)}</strong></article>
                <article><span>Variação</span><strong>{variationLabel(selected.variation_percent)}</strong></article>
                <article><span>CTR</span><strong>{percent(selected.ctr)}</strong></article>
              </div>

              <div className={styles.detailSection}><div className={styles.sectionTitle}><UsersRound size={15} /><div><span>Composição da cotação</span><h3>Clientes com entrega na região</h3></div></div><div className={styles.clientList}>{selected.clients.map((client) => <div key={client.id}><strong>{client.name}</strong><span>{client.leads} leads</span><span>{money(client.spend)}</span><b>{money(client.cpl)}</b></div>)}</div></div>

              <div className={styles.detailSection}><div className={styles.sectionTitle}><CircleDollarSign size={15} /><div><span>Ranking regional</span><h3>Criativos mais eficientes</h3></div></div><div className={styles.creativeList}>{selected.top_creatives.map((creative, index) => <article key={creative.id}><div className={styles.largeThumb}>{creative.image_url ? <img src={creative.image_url} alt="" referrerPolicy="no-referrer" /> : <ImageIcon size={20} />}</div><div className={styles.creativeCopy}><span>#{index + 1} · {creative.client_name}</span><strong>{creative.name}</strong>{creative.title && <p>{creative.title}</p>}<small>{creative.leads} leads · {money(creative.spend)} · CTR {percent(creative.ctr)}</small></div><div className={styles.creativePrice}><span>CPL</span><strong>{money(creative.cpl)}</strong></div></article>)}</div>{selected.top_creatives.length === 0 && <div className={styles.inlineEmpty}>Ainda não há criativo com lead atribuído nesta região.</div>}</div>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
