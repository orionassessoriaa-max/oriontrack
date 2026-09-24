'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import { supabase } from '@/lib/supabase/client';
import {
  AlertCircle,
  ArrowDownUp,
  BadgeDollarSign,
  BarChart3,
  CheckCircle2,
  CircleDollarSign,
  Filter,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  ShoppingCart,
  Target,
  TrendingUp,
} from 'lucide-react';
import styles from './page.module.css';

type CreativeRow = {
  id: string;
  ad_ids: string[];
  ad_name: string;
  creative_name?: string | null;
  title?: string | null;
  image_url?: string | null;
  client_id: string;
  client_name: string;
  account_name?: string | null;
  status: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  leads: number;
  quotes: number;
  negotiations: number;
  sales: number;
  revenue: number;
  cpl: number | null;
  cost_per_sale: number | null;
  win_rate: number;
  quote_rate: number;
  negotiation_rate: number;
  roas: number | null;
  sample: 'confiavel' | 'moderada' | 'baixa';
};

type ClientOption = {
  id: string;
  name: string;
  leads_total: number;
  attributed_leads: number;
};

type Payload = {
  success: boolean;
  data_inicio: string;
  data_fim: string;
  desde_integracao?: boolean;
  refreshed_at: string;
  clients: ClientOption[];
  creatives: CreativeRow[];
  summary: {
    spend: number;
    leads: number;
    quotes: number;
    negotiations: number;
    sales: number;
    revenue: number;
    win_rate: number;
    roas: number | null;
    cost_per_sale: number | null;
    total_crm_leads: number;
    attributed_leads: number;
    attribution_rate: number;
  };
  errors: Array<{ client: string; message: string }>;
  criteria: { minimum_sample: number; attribution: string; sale: string };
};

type SortKey = 'sales' | 'win_rate' | 'roas' | 'leads' | 'cost_per_sale';

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
    if (sort === 'win_rate') {
      const aQualified = a.leads >= minimumSample;
      const bQualified = b.leads >= minimumSample;
      if (aQualified !== bQualified) return bQualified ? 1 : -1;
      return b.win_rate - a.win_rate || b.sales - a.sales || b.leads - a.leads;
    }
    if (sort === 'cost_per_sale') {
      const aValue = a.cost_per_sale ?? Number.POSITIVE_INFINITY;
      const bValue = b.cost_per_sale ?? Number.POSITIVE_INFINITY;
      return aValue - bValue || b.sales - a.sales;
    }
    if (sort === 'roas') return (b.roas ?? -1) - (a.roas ?? -1) || b.revenue - a.revenue;
    if (sort === 'leads') return b.leads - a.leads || b.sales - a.sales;
    return b.sales - a.sales || b.win_rate - a.win_rate || b.leads - a.leads;
  });
}

export default function ApolloCreativePerformancePage() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [dateStart, setDateStart] = useState(() => daysAgo(29));
  const [dateEnd, setDateEnd] = useState(() => dateValue(new Date()));
  const [clientId, setClientId] = useState('todos');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('sales');
  const [fromIntegration, setFromIntegration] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('Sessao expirada. Entre novamente.');
      const params = new URLSearchParams({ de: dateStart, ate: dateEnd });
      if (fromIntegration) params.set('desde_integracao', '1');
      const response = await fetch(`/api/equipe/apollo/criativos?${params.toString()}`, {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${token}` },
      });
      const nextPayload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(nextPayload.error || 'Nao foi possivel carregar a performance.');
      setPayload(nextPayload);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Erro ao carregar a pagina.');
    } finally {
      setLoading(false);
    }
  }, [dateEnd, dateStart, fromIntegration]);

  useEffect(() => {
    void load();
  }, [load]);

  const visibleRows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('pt-BR');
    const filtered = (payload?.creatives || []).filter((row) => {
      const matchesClient = clientId === 'todos' || row.client_id === clientId;
      const matchesSearch = !query || `${row.ad_name} ${row.creative_name || ''} ${row.client_name}`
        .toLocaleLowerCase('pt-BR')
        .includes(query);
      return matchesClient && matchesSearch;
    });
    return sortRows(filtered, sort, payload?.criteria.minimum_sample || 10);
  }, [clientId, payload, search, sort]);

  const filteredSummary = useMemo(() => visibleRows.reduce((summary, row) => ({
    spend: summary.spend + row.spend,
    leads: summary.leads + row.leads,
    quotes: summary.quotes + row.quotes,
    negotiations: summary.negotiations + row.negotiations,
    sales: summary.sales + row.sales,
    revenue: summary.revenue + row.revenue,
  }), { spend: 0, leads: 0, quotes: 0, negotiations: 0, sales: 0, revenue: 0 }), [visibleRows]);

  const selectedClient = payload?.clients.find((client) => client.id === clientId);
  const crmLeads = selectedClient?.leads_total ?? payload?.summary.total_crm_leads ?? 0;
  const attributedLeads = selectedClient?.attributed_leads ?? payload?.summary.attributed_leads ?? 0;
  const attributionRate = crmLeads > 0 ? (attributedLeads / crmLeads) * 100 : 0;
  const winRate = filteredSummary.leads > 0 ? (filteredSummary.sales / filteredSummary.leads) * 100 : 0;
  const roas = filteredSummary.spend > 0 ? filteredSummary.revenue / filteredSummary.spend : null;
  const costPerSale = filteredSummary.sales > 0 ? filteredSummary.spend / filteredSummary.sales : null;
  const topFive = visibleRows.slice(0, 5);
  const topSales = Math.max(1, ...topFive.map((row) => row.sales));

  function applyPeriod(days: number) {
    setFromIntegration(false);
    setDateStart(daysAgo(days - 1));
    setDateEnd(dateValue(new Date()));
  }

  return (
    <InternalLayout>
      <div className={styles.page}>
        <header className={styles.header}>
          <div>
            <div className={styles.eyebrow}><BarChart3 size={14} /> Inteligência de criativos</div>
            <h1>Performance que chega até a venda.</h1>
            <p>Investimento da Meta conectado ao avanço real de cada lead no CRM.</p>
          </div>
          <button type="button" className={styles.refreshButton} onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            Atualizar dados
          </button>
        </header>

        <section className={styles.filterBar} aria-label="Filtros de performance">
          <div className={styles.periodButtons}>
            <button
              type="button"
              className={fromIntegration ? styles.periodActive : ''}
              onClick={() => setFromIntegration(true)}
            >
              Desde integração
            </button>
            {[7, 30, 90].map((days) => (
              <button
                type="button"
                key={days}
                className={!fromIntegration && dateStart === daysAgo(days - 1) ? styles.periodActive : ''}
                onClick={() => applyPeriod(days)}
              >
                {days} dias
              </button>
            ))}
          </div>
          <label className={styles.field}>
            <span>De</span>
            <input type="date" value={dateStart} max={dateEnd} disabled={fromIntegration} onChange={(event) => { setFromIntegration(false); setDateStart(event.target.value); }} />
          </label>
          <label className={styles.field}>
            <span>Até</span>
            <input type="date" value={dateEnd} min={dateStart} onChange={(event) => setDateEnd(event.target.value)} />
          </label>
          <label className={styles.fieldWide}>
            <span>Cliente</span>
            <select value={clientId} onChange={(event) => setClientId(event.target.value)}>
              <option value="todos">Toda a Orion</option>
              {(payload?.clients || []).map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
            </select>
          </label>
        </section>

        {error && (
          <div className={styles.error} role="alert">
            <AlertCircle size={18} />
            <span>{error}</span>
            <button type="button" onClick={() => void load()}>Tentar novamente</button>
          </div>
        )}

        <section className={styles.metricGrid} aria-label="Indicadores principais">
          <article className={styles.metricCard}>
            <span className={styles.metricIcon}><CircleDollarSign size={17} /></span>
            <p>Investimento</p><strong>{money(filteredSummary.spend)}</strong>
            <small>{visibleRows.length} criativos analisados</small>
          </article>
          <article className={styles.metricCard}>
            <span className={styles.metricIcon}><Target size={17} /></span>
            <p>Leads atribuídos</p><strong>{filteredSummary.leads}</strong>
            <small>{percent(attributionRate)} de cobertura do CRM</small>
          </article>
          <article className={styles.metricCard}>
            <span className={styles.metricIcon}><ShoppingCart size={17} /></span>
            <p>Vendas</p><strong>{filteredSummary.sales}</strong>
            <small>{percent(winRate)} de win rate</small>
          </article>
          <article className={styles.metricCard}>
            <span className={styles.metricIcon}><BadgeDollarSign size={17} /></span>
            <p>Receita atribuída</p><strong>{money(filteredSummary.revenue)}</strong>
            <small>{decimal(roas, 'x')} de ROAS</small>
          </article>
          <article className={styles.metricCard}>
            <span className={styles.metricIcon}><TrendingUp size={17} /></span>
            <p>Custo por venda</p><strong>{money(costPerSale)}</strong>
            <small>{filteredSummary.negotiations} em negociação ou venda</small>
          </article>
        </section>

        <div className={styles.contentGrid}>
          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <div><span>Top 5</span><h2>Quem está vendendo</h2></div>
              <small>Ranking por vendas</small>
            </div>
            <div className={styles.topList}>
              {topFive.map((row, index) => (
                <article key={row.id} className={styles.topRow}>
                  <span className={styles.position}>{String(index + 1).padStart(2, '0')}</span>
                  <div className={styles.topIdentity}>
                    <strong>{row.ad_name}</strong><small>{row.client_name}</small>
                  </div>
                  <div className={styles.barTrack} aria-label={`${row.sales} vendas`}>
                    <span style={{ width: `${Math.max(6, (row.sales / topSales) * 100)}%` }} />
                  </div>
                  <div className={styles.topValue}><strong>{row.sales}</strong><small>vendas</small></div>
                </article>
              ))}
              {!loading && topFive.length === 0 && <div className={styles.empty}>Nenhum criativo encontrado neste período.</div>}
              {loading && <div className={styles.loading}><Loader2 className="animate-spin" /> Calculando atribuição...</div>}
            </div>
          </section>

          <aside className={styles.qualityPanel}>
            <div className={styles.qualityIcon}><ShieldCheck size={20} /></div>
            <span>Qualidade dos dados</span>
            <strong>{percent(attributionRate)}</strong>
            <p>{attributedLeads} de {crmLeads} leads do CRM foram ligados a um anúncio.</p>
            <div className={styles.coverageTrack}><span style={{ width: `${Math.min(100, attributionRate)}%` }} /></div>
            <ul>
              <li><CheckCircle2 size={13} /> Venda: etapa marcada no CRM</li>
              <li><CheckCircle2 size={13} /> Win rate mínimo: 10 leads</li>
              <li><CheckCircle2 size={13} /> Receita: valor da venda registrada</li>
            </ul>
          </aside>
        </div>

        <section className={styles.rankingPanel}>
          <div className={styles.rankingHeader}>
            <div><span>Ranking completo</span><h2>Performance por criativo</h2></div>
            <div className={styles.rankingControls}>
              <label className={styles.searchBox}>
                <Search size={15} />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar criativo ou cliente" />
              </label>
              <label className={styles.sortBox}>
                <ArrowDownUp size={15} />
                <select value={sort} onChange={(event) => setSort(event.target.value as SortKey)} aria-label="Ordenar ranking">
                  <option value="sales">Mais vendas</option>
                  <option value="win_rate">Maior win rate</option>
                  <option value="roas">Maior ROAS</option>
                  <option value="leads">Mais leads</option>
                  <option value="cost_per_sale">Menor custo por venda</option>
                </select>
              </label>
            </div>
          </div>

          <div className={styles.tableWrap}>
            <table>
              <thead><tr>
                <th>#</th><th>Criativo</th><th>Investimento</th><th>Leads</th><th>Cotações</th>
                <th>Negociações</th><th>Vendas</th><th>Win rate</th><th>Custo/venda</th><th>Receita</th><th>ROAS</th>
              </tr></thead>
              <tbody>
                {visibleRows.map((row, index) => (
                  <tr key={row.id}>
                    <td><span className={styles.rankNumber}>{index + 1}</span></td>
                    <td>
                      <div className={styles.creativeCell}>
                        <div className={styles.thumb}>
                          {row.image_url ? <img src={row.image_url} alt="" /> : <ImageIcon size={18} />}
                        </div>
                        <div><strong>{row.ad_name}</strong><small>{row.client_name}</small></div>
                      </div>
                    </td>
                    <td>{money(row.spend)}</td><td>{row.leads}</td><td>{row.quotes}</td><td>{row.negotiations}</td>
                    <td><strong className={styles.saleValue}>{row.sales}</strong></td>
                    <td>
                      <div className={styles.rateCell}><strong>{percent(row.win_rate)}</strong>
                        <span className={row.leads >= (payload?.criteria.minimum_sample || 10) ? styles.sampleOk : styles.sampleLow}>
                          {row.leads >= (payload?.criteria.minimum_sample || 10) ? 'amostra válida' : 'amostra baixa'}
                        </span>
                      </div>
                    </td>
                    <td>{money(row.cost_per_sale)}</td><td>{money(row.revenue)}</td><td>{decimal(row.roas, 'x')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!loading && visibleRows.length === 0 && <div className={styles.empty}>Nenhum resultado corresponde aos filtros.</div>}
          </div>
        </section>

        {(payload?.errors.length || 0) > 0 && (
          <details className={styles.warningDetails}>
            <summary><Filter size={14} /> {payload?.errors.length} conta(s) não entraram no cálculo</summary>
            <ul>{payload?.errors.map((item) => <li key={`${item.client}-${item.message}`}><strong>{item.client}:</strong> {item.message}</li>)}</ul>
          </details>
        )}

        <footer className={styles.footerNote}>
          Última atualização: {payload?.refreshed_at ? new Date(payload.refreshed_at).toLocaleString('pt-BR') : '—'}.
          Os números respeitam o período de entrada do lead e não estimam vendas sem identificação no CRM.
        </footer>
      </div>
    </InternalLayout>
  );
}
