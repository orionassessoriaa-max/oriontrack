'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BarChart3, CalendarRange, Handshake, Image as ImageIcon, RefreshCw, Search, Target, UsersRound, X } from 'lucide-react';
import { useCommercial } from '@/components/commercial/CommercialShell';
import styles from './page.module.css';

type CreativeRow = {
  id: string;
  ad_ids: string[];
  ad_name: string;
  creative_name: string | null;
  title: string | null;
  primary_text: string | null;
  image_url: string | null;
  status: string;
  impressions: number;
  clicks: number;
  leads: number;
  meetings: number;
  negotiations: number;
  sales: number;
  meeting_rate: number;
  negotiation_rate: number;
  sales_rate: number;
};

type Payload = {
  period: { start: string; end: string; all_time: boolean };
  summary: {
    leads: number;
    attributed: number;
    attribution_rate: number;
    meetings: number;
    negotiations: number;
    sales: number;
    meeting_rate: number;
    negotiation_rate: number;
    sales_rate: number;
  };
  creatives: CreativeRow[];
  meta_error: string | null;
  refreshed_at: string;
};

type Period = 'all' | '30' | '90' | 'custom';
type SortKey = 'sales_rate' | 'negotiation_rate' | 'meeting_rate' | 'leads';

function dateValue(date: Date) {
  return date.toISOString().slice(0, 10);
}

function daysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return dateValue(date);
}

function percent(value: number) {
  return `${new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value || 0)}%`;
}

export default function CommercialWinRatePage() {
  const { api } = useCommercial();
  const [payload, setPayload] = useState<Payload | null>(null);
  const [period, setPeriod] = useState<Period>('all');
  const [start, setStart] = useState(daysAgo(29));
  const [end, setEnd] = useState(dateValue(new Date()));
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('sales_rate');
  const [selected, setSelected] = useState<CreativeRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('ate', end);
      if (period !== 'all') params.set('de', period === 'custom' ? start : daysAgo(Number(period) - 1));
      setPayload(await api(`/api/comercial/win-rate?${params.toString()}`));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar o Win Rate.');
    } finally {
      setLoading(false);
    }
  }, [api, end, period, start]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!selected) return;
    const scrollY = window.scrollY;
    const previous = {
      overflow: document.body.style.overflow,
      position: document.body.style.position,
      top: document.body.style.top,
      width: document.body.style.width,
    };
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = '100%';
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setSelected(null); };
    document.addEventListener('keydown', escape);
    return () => {
      Object.assign(document.body.style, previous);
      window.scrollTo(0, scrollY);
      triggerRef.current?.focus({ preventScroll: true });
      document.removeEventListener('keydown', escape);
    };
  }, [selected]);

  const rows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('pt-BR');
    return (payload?.creatives || [])
      .filter((row) => !query || `${row.ad_name} ${row.creative_name || ''}`.toLocaleLowerCase('pt-BR').includes(query))
      .sort((a, b) => b[sort] - a[sort] || b.sales - a.sales || b.leads - a.leads);
  }, [payload, search, sort]);

  const openDetails = (row: CreativeRow, trigger: HTMLElement) => {
    triggerRef.current = trigger;
    setSelected(row);
  };

  const summary = payload?.summary;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}><BarChart3 size={14} /> Kripto Hunter · Orion</span>
          <h1>Win Rate de criativos</h1>
          <p>Conversão real dos leads internos da Orion em reunião, negociação e venda.</p>
        </div>
        <button type="button" className={styles.refresh} onClick={() => void load()} disabled={loading}>
          <RefreshCw size={15} className={loading ? styles.spinning : ''} /> Atualizar
        </button>
      </header>

      <section className={styles.filters} aria-label="Filtros do relatório">
        <div className={styles.periods}>
          {([['all', 'Todo período'], ['30', '30 dias'], ['90', '90 dias'], ['custom', 'Personalizado']] as Array<[Period, string]>).map(([value, label]) => (
            <button key={value} type="button" className={period === value ? styles.active : ''} onClick={() => setPeriod(value)}>{label}</button>
          ))}
        </div>
        {period === 'custom' && (
          <div className={styles.dates}>
            <label><span>De</span><input type="date" value={start} max={end} onChange={(event) => setStart(event.target.value)} /></label>
            <label><span>Até</span><input type="date" value={end} min={start} onChange={(event) => setEnd(event.target.value)} /></label>
          </div>
        )}
        <div className={styles.periodLabel}><CalendarRange size={14} /> {payload ? `${new Date(`${payload.period.start}T12:00:00`).toLocaleDateString('pt-BR')} a ${new Date(`${payload.period.end}T12:00:00`).toLocaleDateString('pt-BR')}` : 'Carregando período'}</div>
      </section>

      {error && <div className={styles.error} role="alert">{error}</div>}

      <section className={styles.metrics} aria-label="Resumo do Win Rate">
        <article><span><UsersRound size={15} /> Leads Orion</span><strong>{summary?.leads ?? '—'}</strong><small>{summary ? `${summary.attributed} identificados por criativo` : 'Base interna'}</small></article>
        <article className={styles.meeting}><span><CalendarRange size={15} /> Reunião</span><strong>{summary ? percent(summary.meeting_rate) : '—'}</strong><small>{summary ? `${summary.meetings} reuniões realizadas` : 'Leads convertidos'}</small></article>
        <article className={styles.negotiation}><span><Handshake size={15} /> Negociação</span><strong>{summary ? percent(summary.negotiation_rate) : '—'}</strong><small>{summary ? `${summary.negotiations} negociações alcançadas` : 'Leads convertidos'}</small></article>
        <article className={styles.sale}><span><Target size={15} /> Venda</span><strong>{summary ? percent(summary.sales_rate) : '—'}</strong><small>{summary ? `${summary.sales} negócios fechados` : 'Leads convertidos'}</small></article>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div><span>Comparativo por anúncio</span><h2>Ranking de criativos</h2></div>
          <div className={styles.controls}>
            <label className={styles.search}><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar criativo" /></label>
            <select value={sort} onChange={(event) => setSort(event.target.value as SortKey)} aria-label="Ordenar criativos">
              <option value="sales_rate">Win Rate de venda</option>
              <option value="negotiation_rate">Win Rate de negociação</option>
              <option value="meeting_rate">Win Rate de reunião</option>
              <option value="leads">Quantidade de leads</option>
            </select>
          </div>
        </div>

        <div className={styles.tableWrap}>
          <table>
            <thead><tr><th>Criativo</th><th>Leads</th><th>Reuniões</th><th>Win reunião</th><th>Negociações</th><th>Win negociação</th><th>Vendas</th><th>Win venda</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td><button type="button" className={styles.creative} onClick={(event) => openDetails(row, event.currentTarget)}><span>{row.image_url ? <img src={row.image_url} alt="" referrerPolicy="no-referrer" /> : <ImageIcon size={17} />}</span><div><strong>{row.ad_name}</strong><small>{row.status === 'ACTIVE' ? 'Ativo na Meta' : row.status === 'HISTORICO' ? 'Histórico do CRM' : row.status}</small></div></button></td>
                  <td>{row.leads}</td><td>{row.meetings}</td><td className={styles.meetingValue}>{percent(row.meeting_rate)}</td><td>{row.negotiations}</td><td className={styles.negotiationValue}>{percent(row.negotiation_rate)}</td><td>{row.sales}</td><td className={styles.saleValue}>{percent(row.sales_rate)}</td>
                </tr>
              ))}
              {!loading && rows.length === 0 && <tr><td colSpan={8} className={styles.empty}>Nenhum criativo encontrado neste período.</td></tr>}
              {loading && <tr><td colSpan={8} className={styles.empty}>Calculando o Win Rate da Orion...</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <footer className={styles.note}>
        Reunião = reunião realizada. Negociação = lead que alcançou a etapa de negociação ou fechou. Venda = negócio fechado.
        {payload?.meta_error ? ` A Meta não atualizou as imagens agora: ${payload.meta_error}` : ''}
      </footer>

      {selected && typeof document !== 'undefined' && createPortal(
        <div className={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
          <section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="kripto-creative-title">
            <header><div><span>Detalhes do criativo</span><h2 id="kripto-creative-title">{selected.ad_name}</h2></div><button type="button" autoFocus onClick={() => setSelected(null)} aria-label="Fechar"><X size={19} /></button></header>
            <div className={styles.modalBody}>
              <div className={styles.preview}>{selected.image_url ? <img src={selected.image_url} alt={`Criativo ${selected.ad_name}`} referrerPolicy="no-referrer" /> : <div><ImageIcon size={32} /><span>Imagem não disponível</span></div>}</div>
              <div className={styles.detail}>
                <section><span>Título</span><h3>{selected.title || 'Título não informado pela Meta'}</h3></section>
                <section><span>Legenda / texto principal</span><p>{selected.primary_text || 'Legenda não informada pela Meta.'}</p></section>
                <div className={styles.modalRates}><div><span>Reunião</span><strong>{percent(selected.meeting_rate)}</strong></div><div><span>Negociação</span><strong>{percent(selected.negotiation_rate)}</strong></div><div><span>Venda</span><strong>{percent(selected.sales_rate)}</strong></div></div>
              </div>
            </div>
          </section>
        </div>, document.body
      )}
    </main>
  );
}
