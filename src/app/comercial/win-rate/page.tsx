'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle, ArrowDownUp, BadgeDollarSign, BarChart3, CalendarCheck2, CheckCircle2,
  CircleDollarSign, Handshake, Image as ImageIcon, Loader2, RefreshCw, Search,
  ShieldCheck, ShoppingCart, Target, UsersRound, X,
} from 'lucide-react';
import { useCommercial } from '@/components/commercial/CommercialShell';
import styles from './page.module.css';

type LeadSummary = {
  id: string;
  name: string;
  status: string;
  value: number;
  entered_at: string;
  closed_at: string | null;
};

type CreativeRow = {
  id: string;
  ad_ids: string[];
  ad_name: string;
  creative_name: string | null;
  creative_id: string | null;
  title: string | null;
  primary_text: string | null;
  description: string | null;
  destination_url: string | null;
  call_to_action: string | null;
  image_url: string | null;
  thumbnail_url: string | null;
  status: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  leads: number;
  meetings: number;
  negotiations: number;
  sales: number;
  revenue: number;
  cpl: number | null;
  cac: number | null;
  roas: number | null;
  meeting_rate: number;
  negotiation_rate: number;
  sales_rate: number;
  negotiation_leads: LeadSummary[];
  sale_leads: LeadSummary[];
  sample: 'confiavel' | 'moderada' | 'baixa';
};

type Payload = {
  period: { start: string; end: string; all_time: boolean };
  summary: {
    leads: number;
    attributed: number;
    attribution_rate: number;
    spend: number;
    revenue: number;
    cac: number | null;
    roas: number | null;
    meetings: number;
    negotiations: number;
    sales: number;
    attributed_meetings: number;
    attributed_negotiations: number;
    attributed_sales: number;
    meeting_rate: number;
    negotiation_rate: number;
    sales_rate: number;
  };
  creatives: CreativeRow[];
  meta_error: string | null;
  refreshed_at: string;
  criteria: { minimum_sample: number; attribution: string; period: string };
};

type SortKey = 'sales' | 'sales_rate' | 'roas' | 'leads' | 'cac' | 'negotiations';
type LeadModal = { title: string; creative: string; leads: LeadSummary[] };

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
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL', maximumFractionDigits: 0,
  }).format(value);
}

function percent(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${value.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function decimal(value: number | null | undefined, suffix = '') {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${value.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}${suffix}`;
}

function sortRows(rows: CreativeRow[], sort: SortKey, minimumSample: number) {
  return [...rows].sort((a, b) => {
    if (sort === 'sales_rate') {
      const aQualified = a.leads >= minimumSample;
      const bQualified = b.leads >= minimumSample;
      if (aQualified !== bQualified) return bQualified ? 1 : -1;
      return b.sales_rate - a.sales_rate || b.sales - a.sales || b.leads - a.leads;
    }
    if (sort === 'cac') return (a.cac ?? Number.POSITIVE_INFINITY) - (b.cac ?? Number.POSITIVE_INFINITY) || b.sales - a.sales;
    if (sort === 'roas') return (b.roas ?? -1) - (a.roas ?? -1) || b.revenue - a.revenue;
    if (sort === 'leads') return b.leads - a.leads || b.sales - a.sales;
    if (sort === 'negotiations') return b.negotiations - a.negotiations || b.sales - a.sales;
    return b.sales - a.sales || b.sales_rate - a.sales_rate || b.leads - a.leads;
  });
}

export default function CommercialWinRatePage() {
  const { api } = useCommercial();
  const [payload, setPayload] = useState<Payload | null>(null);
  const [dateStart, setDateStart] = useState(() => daysAgo(29));
  const [dateEnd, setDateEnd] = useState(() => dateValue(new Date()));
  const [fromIntegration, setFromIntegration] = useState(false);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('sales');
  const [selectedCreative, setSelectedCreative] = useState<CreativeRow | null>(null);
  const [leadModal, setLeadModal] = useState<LeadModal | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const overlayOpen = Boolean(selectedCreative || leadModal);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ ate: dateEnd });
      if (!fromIntegration) params.set('de', dateStart);
      setPayload(await api(`/api/comercial/win-rate?${params.toString()}`));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar o Win Rate.');
    } finally {
      setLoading(false);
    }
  }, [api, dateEnd, dateStart, fromIntegration]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!overlayOpen) return;
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
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelectedCreative(null);
        setLeadModal(null);
      }
    };
    document.addEventListener('keydown', escape);
    return () => {
      Object.assign(document.body.style, previous);
      window.scrollTo(0, scrollY);
      triggerRef.current?.focus({ preventScroll: true });
      document.removeEventListener('keydown', escape);
    };
  }, [overlayOpen]);

  const visibleRows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('pt-BR');
    const filtered = (payload?.creatives || []).filter((row) => !query
      || `${row.ad_name} ${row.creative_name || ''}`.toLocaleLowerCase('pt-BR').includes(query));
    return sortRows(filtered, sort, payload?.criteria.minimum_sample || 10);
  }, [payload, search, sort]);

  const summary = useMemo(() => visibleRows.reduce((acc, row) => ({
    spend: acc.spend + row.spend,
    leads: acc.leads + row.leads,
    meetings: acc.meetings + row.meetings,
    negotiations: acc.negotiations + row.negotiations,
    sales: acc.sales + row.sales,
    revenue: acc.revenue + row.revenue,
  }), { spend: 0, leads: 0, meetings: 0, negotiations: 0, sales: 0, revenue: 0 }), [visibleRows]);

  const meetingRate = summary.leads > 0 ? (summary.meetings / summary.leads) * 100 : 0;
  const negotiationRate = summary.leads > 0 ? (summary.negotiations / summary.leads) * 100 : 0;
  const salesRate = summary.leads > 0 ? (summary.sales / summary.leads) * 100 : 0;
  const cac = summary.sales > 0 ? summary.spend / summary.sales : null;
  const roas = summary.spend > 0 ? summary.revenue / summary.spend : null;
  const topFive = visibleRows.slice(0, 5);
  const topSales = Math.max(1, ...topFive.map((row) => row.sales));
  const attributionRate = payload?.summary.attribution_rate || 0;

  function applyPeriod(days: number) {
    setFromIntegration(false);
    setDateStart(daysAgo(days - 1));
    setDateEnd(dateValue(new Date()));
  }

  function openCreative(row: CreativeRow, trigger: HTMLElement) {
    triggerRef.current = trigger;
    setSelectedCreative(row);
  }

  function openLeads(row: CreativeRow, kind: 'negotiation' | 'sale', trigger: HTMLElement) {
    const leads = kind === 'sale' ? row.sale_leads : row.negotiation_leads;
    if (!leads.length) return;
    triggerRef.current = trigger;
    setSelectedCreative(null);
    setLeadModal({ title: kind === 'sale' ? 'Leads vendidos' : 'Leads em negociação', creative: row.ad_name, leads });
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div><div className={styles.eyebrow}><BarChart3 size={14} /> Inteligência de criativos · Orion</div><h1>Performance que chega até a venda.</h1><p>Investimento da Meta conectado ao avanço real dos leads do Kripto Hunter no CRM.</p></div>
        <button type="button" className={styles.refreshButton} onClick={() => void load()} disabled={loading}>{loading ? <Loader2 size={16} className={styles.spinning} /> : <RefreshCw size={16} />}Atualizar dados</button>
      </header>

      <section className={styles.filterBar} aria-label="Filtros de performance">
        <div className={styles.periodButtons}>
          <button type="button" className={fromIntegration ? styles.periodActive : ''} onClick={() => setFromIntegration(true)}>Desde integração</button>
          {[7, 30, 90].map((days) => <button type="button" key={days} className={!fromIntegration && dateStart === daysAgo(days - 1) ? styles.periodActive : ''} onClick={() => applyPeriod(days)}>{days} dias</button>)}
        </div>
        <label className={styles.field}><span>De</span><input type="date" value={dateStart} max={dateEnd} disabled={fromIntegration} onChange={(event) => { setFromIntegration(false); setDateStart(event.target.value); }} /></label>
        <label className={styles.field}><span>Até</span><input type="date" value={dateEnd} min={dateStart} onChange={(event) => setDateEnd(event.target.value)} /></label>
        <div className={styles.scope}><span>Escopo</span><strong><UsersRound size={14} /> Base interna da Orion</strong></div>
      </section>

      {error && <div className={styles.error} role="alert"><AlertCircle size={18} /><span>{error}</span><button type="button" onClick={() => void load()}>Tentar novamente</button></div>}

      <section className={styles.metricGrid} aria-label="Indicadores principais">
        <article className={styles.metricCard}><span className={styles.metricIcon}><CircleDollarSign size={17} /></span><p>Investimento</p><strong>{money(summary.spend)}</strong><small>{visibleRows.length} criativos analisados</small></article>
        <article className={styles.metricCard}><span className={styles.metricIcon}><Target size={17} /></span><p>Leads atribuídos</p><strong>{summary.leads}</strong><small>{percent(attributionRate)} de cobertura do CRM</small></article>
        <article className={styles.metricCard}><span className={styles.metricIcon}><CalendarCheck2 size={17} /></span><p>Reuniões</p><strong>{summary.meetings}</strong><small>{percent(meetingRate)} de win rate</small></article>
        <article className={styles.metricCard}><span className={styles.metricIcon}><Handshake size={17} /></span><p>Negociações</p><strong>{summary.negotiations}</strong><small>{percent(negotiationRate)} de win rate</small></article>
        <article className={styles.metricCard}><span className={styles.metricIcon}><ShoppingCart size={17} /></span><p>Vendas</p><strong>{summary.sales}</strong><small>{percent(salesRate)} de win rate · CAC {money(cac)}</small></article>
        <article className={styles.metricCard}><span className={styles.metricIcon}><BadgeDollarSign size={17} /></span><p>Receita atribuída</p><strong>{money(summary.revenue)}</strong><small>{decimal(roas, 'x')} de ROAS</small></article>
      </section>

      <div className={styles.contentGrid}>
        <section className={styles.panel}>
          <div className={styles.panelHeader}><div><span>Top 5</span><h2>Quem está vendendo</h2></div><small>Ranking por vendas</small></div>
          <div className={styles.topList}>
            {topFive.map((row, index) => <button key={row.id} type="button" className={styles.topRow} onClick={(event) => openCreative(row, event.currentTarget)}><span className={styles.position}>{String(index + 1).padStart(2, '0')}</span><div className={styles.topIdentity}><strong>{row.ad_name}</strong><small>{money(row.spend)} investidos</small></div><div className={styles.barTrack} aria-label={`${row.sales} vendas`}><span style={{ width: `${Math.max(6, (row.sales / topSales) * 100)}%` }} /></div><div className={styles.topValue}><strong>{row.sales}</strong><small>vendas</small></div></button>)}
            {!loading && topFive.length === 0 && <div className={styles.empty}>Nenhum criativo encontrado neste período.</div>}
            {loading && <div className={styles.loading}><Loader2 className={styles.spinning} /> Calculando atribuição...</div>}
          </div>
        </section>
        <aside className={styles.qualityPanel}><div className={styles.qualityIcon}><ShieldCheck size={20} /></div><span>Qualidade dos dados</span><strong>{percent(attributionRate)}</strong><p>{payload?.summary.attributed || 0} de {payload?.summary.leads || 0} leads do CRM foram ligados a um anúncio.</p><div className={styles.coverageTrack}><span style={{ width: `${Math.min(100, attributionRate)}%` }} /></div><ul><li><CheckCircle2 size={13} /> Período padrão: 30 dias</li><li><CheckCircle2 size={13} /> Venda: etapa marcada no CRM</li><li><CheckCircle2 size={13} /> Receita: valor registrado no fechamento</li></ul></aside>
      </div>

      <section className={styles.rankingPanel}>
        <div className={styles.rankingHeader}><div><span>Ranking completo</span><h2>Performance por criativo</h2></div><div className={styles.rankingControls}><label className={styles.searchBox}><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar criativo" /></label><label className={styles.sortBox}><ArrowDownUp size={15} /><select value={sort} onChange={(event) => setSort(event.target.value as SortKey)} aria-label="Ordenar ranking"><option value="sales">Mais vendas</option><option value="sales_rate">Maior win rate</option><option value="roas">Maior ROAS</option><option value="leads">Mais leads</option><option value="negotiations">Mais negociações</option><option value="cac">Menor CAC</option></select></label></div></div>
        <div className={styles.tableWrap}>
          <table>
            <thead><tr><th>#</th><th>Criativo</th><th>Investimento</th><th>Leads</th><th>Reuniões</th><th>Win reunião</th><th>Negociações</th><th>Win negociação</th><th>Vendas</th><th>Win venda</th><th>CAC</th><th>Receita</th><th>ROAS</th></tr></thead>
            <tbody>{visibleRows.map((row, index) => <tr key={row.id}><td><span className={styles.rankNumber}>{index + 1}</span></td><td><button type="button" className={styles.creativeCell} onClick={(event) => openCreative(row, event.currentTarget)} aria-label={`Abrir detalhes do criativo ${row.ad_name}`}><div className={styles.thumb}>{row.image_url || row.thumbnail_url ? <img src={row.image_url || row.thumbnail_url || ''} alt="" referrerPolicy="no-referrer" /> : <ImageIcon size={18} />}</div><div><strong>{row.ad_name}</strong><small>{row.status === 'ACTIVE' ? 'Ativo na Meta' : row.status === 'HISTORICO' ? 'Histórico do CRM' : row.status}</small></div></button></td><td>{money(row.spend)}</td><td>{row.leads}</td><td>{row.meetings}</td><td>{percent(row.meeting_rate)}</td><td><button type="button" className={styles.leadCount} disabled={!row.negotiations} onClick={(event) => openLeads(row, 'negotiation', event.currentTarget)}>{row.negotiations}</button></td><td>{percent(row.negotiation_rate)}</td><td><button type="button" className={`${styles.leadCount} ${styles.saleValue}`} disabled={!row.sales} onClick={(event) => openLeads(row, 'sale', event.currentTarget)}>{row.sales}</button></td><td><div className={styles.rateCell}><strong>{percent(row.sales_rate)}</strong><span className={row.leads >= (payload?.criteria.minimum_sample || 10) ? styles.sampleOk : styles.sampleLow}>{row.leads >= (payload?.criteria.minimum_sample || 10) ? 'amostra válida' : 'amostra baixa'}</span></div></td><td>{money(row.cac)}</td><td>{money(row.revenue)}</td><td>{decimal(row.roas, 'x')}</td></tr>)}</tbody>
          </table>
          {!loading && visibleRows.length === 0 && <div className={styles.empty}>Nenhum resultado corresponde aos filtros.</div>}
        </div>
      </section>

      {payload?.meta_error && <div className={styles.warning}><AlertCircle size={14} /> A Meta não atualizou parte dos dados agora: {payload.meta_error}</div>}
      <footer className={styles.footerNote}>Última atualização: {payload?.refreshed_at ? new Date(payload.refreshed_at).toLocaleString('pt-BR') : '—'}. Os números respeitam o período de entrada do lead e o investimento da Meta no mesmo intervalo.</footer>

      {selectedCreative && typeof document !== 'undefined' && createPortal(
        <div className={styles.modalBackdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedCreative(null); }}><section className={styles.creativeModal} role="dialog" aria-modal="true" aria-labelledby="kripto-creative-title"><header className={styles.modalHeader}><div><span>Detalhes do criativo</span><h2 id="kripto-creative-title">{selectedCreative.ad_name}</h2><p>Conta Meta da Orion</p></div><button type="button" autoFocus onClick={() => setSelectedCreative(null)} aria-label="Fechar detalhes"><X size={19} /></button></header><div className={styles.modalBody}><div className={styles.creativePreview}>{selectedCreative.image_url || selectedCreative.thumbnail_url ? <img src={selectedCreative.image_url || selectedCreative.thumbnail_url || ''} alt={`Criativo ${selectedCreative.ad_name}`} referrerPolicy="no-referrer" /> : <div className={styles.previewFallback}><ImageIcon size={34} /><span>Prévia não fornecida pela Meta</span></div>}</div><div className={styles.creativeDetails}><div className={styles.modalBadges}><span>{selectedCreative.status === 'ACTIVE' ? 'Ativo' : selectedCreative.status}</span><span>{selectedCreative.ad_ids.length > 1 ? `${selectedCreative.ad_ids.length} anúncios agrupados` : '1 anúncio'}</span></div><section className={styles.copyBlock}><span>Título</span><h3>{selectedCreative.title || 'Título não informado pela Meta'}</h3></section><section className={styles.copyBlock}><span>Legenda / texto principal</span><p>{selectedCreative.primary_text || 'Legenda não informada pela Meta.'}</p></section>{selectedCreative.description && <section className={styles.copyBlock}><span>Descrição</span><p>{selectedCreative.description}</p></section>}<dl className={styles.infoGrid}><div><dt>Nome interno</dt><dd>{selectedCreative.creative_name || '—'}</dd></div><div><dt>Chamada</dt><dd>{selectedCreative.call_to_action || '—'}</dd></div><div><dt>ID do criativo</dt><dd>{selectedCreative.creative_id || '—'}</dd></div><div><dt>ID do anúncio</dt><dd>{selectedCreative.ad_ids.join(', ') || '—'}</dd></div></dl><div className={styles.modalMetrics}><div><span>Investimento</span><strong>{money(selectedCreative.spend)}</strong></div><div><span>Leads</span><strong>{selectedCreative.leads}</strong></div><button type="button" disabled={!selectedCreative.negotiations} onClick={(event) => openLeads(selectedCreative, 'negotiation', event.currentTarget)}><span>Negociações</span><strong>{selectedCreative.negotiations}</strong></button><button type="button" disabled={!selectedCreative.sales} onClick={(event) => openLeads(selectedCreative, 'sale', event.currentTarget)}><span>Vendas</span><strong>{selectedCreative.sales}</strong></button><div><span>Receita</span><strong>{money(selectedCreative.revenue)}</strong></div><div><span>ROAS</span><strong>{decimal(selectedCreative.roas, 'x')}</strong></div></div></div></div></section></div>, document.body
      )}

      {leadModal && typeof document !== 'undefined' && createPortal(
        <div className={styles.modalBackdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) setLeadModal(null); }}><section className={styles.leadModal} role="dialog" aria-modal="true" aria-labelledby="kripto-leads-title"><header className={styles.modalHeader}><div><span>{leadModal.title}</span><h2 id="kripto-leads-title">{leadModal.creative}</h2><p>{leadModal.leads.length} {leadModal.leads.length === 1 ? 'lead encontrado' : 'leads encontrados'}</p></div><button type="button" autoFocus onClick={() => setLeadModal(null)} aria-label="Fechar lista de leads"><X size={19} /></button></header><div className={styles.leadList}>{leadModal.leads.map((lead) => <article key={lead.id}><span className={styles.leadAvatar}>{lead.name.trim().charAt(0).toUpperCase() || '?'}</span><div><strong>{lead.name}</strong><small>{lead.status}</small></div><div className={styles.leadValue}><strong>{money(lead.value)}</strong><small>{lead.closed_at ? `Fechado em ${new Date(lead.closed_at).toLocaleDateString('pt-BR')}` : `Entrada em ${new Date(lead.entered_at).toLocaleDateString('pt-BR')}`}</small></div></article>)}</div></section></div>, document.body
      )}
    </main>
  );
}
