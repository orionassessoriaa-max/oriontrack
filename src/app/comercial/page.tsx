'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, ArrowUpRight, CalendarDays, Check, ChevronDown, CircleDollarSign, RefreshCw, Target, UsersRound, WalletCards } from 'lucide-react';
import { useCommercial } from '@/components/commercial/CommercialShell';
import { currency, percent } from '@/lib/comercial';

type Overview = {
  metrics: Record<string, number>;
  trend: Array<{ date: string; leads: number; mql: number; meetings: number; sales: number; revenue: number; investment: number }>;
  weeklyMeetings?: Array<{ date: string; meetings: number }>;
  team: Array<{ id: string; role: string; name: string; photo: string | null; leads: number; mql: number; meetings: number; sales: number; revenue: number }>;
  states: Array<{ state: string; leads: number; active: number }>;
  campaigns?: string[];
  updatedAt?: string;
  meta_error?: string | null;
  investment_source?: 'meta' | 'manual_fallback';
};

type GeoStateFeature = {
  properties: { sigla: string; name: string };
  geometry: { type: 'MultiPolygon' | 'Polygon'; coordinates: number[][][][] | number[][][] };
};

type BrazilRegion = 'Norte' | 'Nordeste' | 'Centro-Oeste' | 'Sudeste' | 'Sul';

const REGION_COLORS: Record<BrazilRegion, string> = {
  Norte: '#73bf45',
  Nordeste: '#10b9d7',
  'Centro-Oeste': '#f2d51b',
  Sudeste: '#4dbdbb',
  Sul: '#087eaf',
};

function regionForState(state: string): BrazilRegion {
  if (['AC', 'AP', 'AM', 'PA', 'RO', 'RR', 'TO'].includes(state)) return 'Norte';
  if (['AL', 'BA', 'CE', 'MA', 'PB', 'PE', 'PI', 'RN', 'SE'].includes(state)) return 'Nordeste';
  if (['DF', 'GO', 'MT', 'MS'].includes(state)) return 'Centro-Oeste';
  if (['ES', 'MG', 'RJ', 'SP'].includes(state)) return 'Sudeste';
  return 'Sul';
}

function rgba(hex: string, alpha: number) {
  const value = hex.replace('#', '');
  return `rgba(${Number.parseInt(value.slice(0, 2), 16)}, ${Number.parseInt(value.slice(2, 4), 16)}, ${Number.parseInt(value.slice(4, 6), 16)}, ${alpha})`;
}

function isoDate(date: Date) { return date.toISOString().slice(0, 10); }
function startOfMonth() { const date = new Date(); return isoDate(new Date(date.getFullYear(), date.getMonth(), 1)); }
type DatePreset = 'todos' | 'hoje' | 'ontem' | '7dias' | '30dias' | 'mes' | 'mes_passado' | 'personalizado';
function getPresetRange(preset: DatePreset) {
  const today = new Date(); const start = new Date(today); const end = new Date(today);
  if (preset === 'ontem') { start.setDate(start.getDate() - 1); end.setDate(end.getDate() - 1); }
  if (preset === '7dias') start.setDate(start.getDate() - 6);
  if (preset === '30dias') start.setDate(start.getDate() - 29);
  if (preset === 'mes') start.setDate(1);
  if (preset === 'mes_passado') return { start: isoDate(new Date(today.getFullYear(), today.getMonth() - 1, 1)), end: isoDate(new Date(today.getFullYear(), today.getMonth(), 0)) };
  return preset === 'todos' ? { start: '', end: '' } : { start: isoDate(start), end: isoDate(end) };
}

function shortDate(value: string) { return value ? new Date(`${value}T12:00:00`).toLocaleDateString('pt-BR') : ''; }

function TrendChart({ rows }: { rows: Overview['trend'] }) {
  const width = 860;
  const height = 220;
  const padding = 24;
  const max = Math.max(1, ...rows.flatMap((row) => [row.leads, row.mql, row.meetings, row.sales]));
  const points = (key: 'leads' | 'mql' | 'meetings' | 'sales') => rows.map((row, index) => {
    const x = rows.length <= 1 ? width / 2 : padding + index * ((width - padding * 2) / (rows.length - 1));
    const y = height - padding - (row[key] / max) * (height - padding * 2);
    return `${x},${y}`;
  }).join(' ');

  if (!rows.length) return <div className="kh-chart-empty"><Activity size={24} /><span>Os gráficos aparecerão quando os primeiros leads forem cadastrados.</span></div>;
  return (
    <div className="kh-chart-wrap" role="img" aria-label="Evolução de leads, MQLs, reuniões e vendas no período">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        {[0, 1, 2, 3].map((line) => <line key={line} x1={padding} x2={width - padding} y1={padding + line * 54} y2={padding + line * 54} className="kh-gridline" />)}
        <polyline points={points('leads')} className="kh-line leads" />
        <polyline points={points('mql')} className="kh-line mql" />
        <polyline points={points('meetings')} className="kh-line meetings" />
        <polyline points={points('sales')} className="kh-line sales" />
      </svg>
      <div className="kh-chart-labels"><span>{new Date(`${rows[0].date}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}</span><span>{new Date(`${rows.at(-1)?.date}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}</span></div>
    </div>
  );
}

function WeeklyMeetingsChart({ rows }: { rows: Array<{ date: string; meetings: number }> }) {
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(); date.setHours(12, 0, 0, 0); date.setDate(date.getDate() - (6 - index));
    const key = isoDate(date); const row = rows.find((item) => item.date === key);
    return { key, label: date.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', ''), value: row?.meetings || 0 };
  });
  const max = Math.max(1, ...days.map((day) => day.value));
  return <div className="kh-weekly-chart" aria-label="Reuniões agendadas nos últimos sete dias"><div className="kh-weekly-y"><span>{max}</span><span>{Math.ceil(max / 2)}</span><span>0</span></div><div className="kh-weekly-bars">{days.map((day) => <div className="kh-weekly-day" key={day.key}><div className="kh-weekly-track"><i style={{ height: `${day.value ? Math.max(10, (day.value / max) * 100) : 3}%` }}><b>{day.value}</b></i></div><span>{day.label}</span></div>)}</div></div>;
}

function StateMapFlat({ states, selected, onSelect }: { states: Overview['states']; selected: string | null; onSelect: (state: string) => void }) {
  const [features, setFeatures] = useState<GeoStateFeature[]>([]);
  const [hovered, setHovered] = useState<string | null>(null);
  useEffect(() => { fetch('/brazil-states.geojson').then((response) => response.json()).then((payload) => setFeatures(payload.features || [])).catch(() => setFeatures([])); }, []);
  const values = new Map(states.map((item) => [item.state, item]));
  const max = Math.max(1, ...states.map((item) => item.leads));
  function project(point: number[]) { return `${((point[0] + 75) / 42) * 1000},${((5 - point[1]) / 40) * 720}`; }
  function pathFor(feature: GeoStateFeature) {
    const polygons = (feature.geometry.type === 'MultiPolygon' ? feature.geometry.coordinates : [feature.geometry.coordinates]) as number[][][][];
    return polygons.flatMap((polygon: number[][][]) => polygon.map((ring: number[][]) => `M ${ring.map((point) => project(point)).join(' L ')} Z`)).join(' ');
  }
  const hoveredData = hovered ? values.get(hovered) : null;
  return <div className="kh-state-map" aria-label="Mapa de origem dos leads por estado"><div className="kh-map-canvas">{features.length ? <svg viewBox="0 0 1000 720" role="img" aria-label="Mapa do Brasil dividido por estados">{features.map((feature) => { const state = feature.properties.sigla; const item = values.get(state); const intensity = item ? 0.35 + (item.leads / max) * 0.65 : 0.08; return <g key={state} className={`kh-map-state ${selected === state ? 'selected' : ''}`} onClick={() => onSelect(state)} onMouseEnter={() => setHovered(state)} onMouseLeave={() => setHovered(null)} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') onSelect(state); }} aria-label={`${state}: ${item?.leads || 0} leads, ${item?.active || 0} ativos`}><path d={pathFor(feature)} style={{ fill: `rgba(34, 155, 235, ${intensity})` }}><title>{`${feature.properties.name}: ${item?.leads || 0} leads, ${item?.active || 0} ativos`}</title></path></g>; })}</svg> : <div className="kh-map-loading">Carregando mapa...</div>}{hovered && <div className="kh-map-tooltip"><strong>{hovered}</strong><span>{hoveredData?.leads || 0} leads recebidos</span><b>{hoveredData?.active || 0} ativos na Orion</b><small>Região estimada</small></div>}</div></div>;
}

function StateMap3D({ states, selected, onSelect }: { states: Overview['states']; selected: string | null; onSelect: (state: string) => void }) {
  const [features, setFeatures] = useState<GeoStateFeature[]>([]);
  const [hovered, setHovered] = useState<string | null>(null);
  useEffect(() => { fetch('/brazil-states.geojson').then((response) => response.json()).then((payload) => setFeatures(payload.features || [])).catch(() => setFeatures([])); }, []);
  const values = new Map(states.map((item) => [item.state, item]));
  const max = Math.max(1, ...states.map((item) => item.leads));
  function project(point: number[]) { return `${((point[0] + 75) / 42) * 1000},${((5 - point[1]) / 40) * 720}`; }
  function pathFor(feature: GeoStateFeature) {
    const polygons = (feature.geometry.type === 'MultiPolygon' ? feature.geometry.coordinates : [feature.geometry.coordinates]) as number[][][][];
    return polygons.flatMap((polygon: number[][][]) => polygon.map((ring: number[][]) => `M ${ring.map((point) => project(point)).join(' L ')} Z`)).join(' ');
  }
  const hoveredData = hovered ? values.get(hovered) : null;
  return <div className="kh-state-map kh-state-map-3d" aria-label="Mapa 3D de origem dos leads por estado"><div className="kh-map-canvas">{features.length ? <svg viewBox="0 0 1000 720" role="img" aria-label="Mapa 3D do Brasil dividido por estados">{features.map((feature) => { const state = feature.properties.sigla; const item = values.get(state); const region = regionForState(state); const color = REGION_COLORS[region]; const intensity = item ? 0.5 + (item.leads / max) * 0.5 : 0.18; const path = pathFor(feature); return <g key={state} className={`kh-map-state ${selected === state ? 'selected' : ''}`} onClick={() => onSelect(state)} onMouseEnter={() => setHovered(state)} onMouseLeave={() => setHovered(null)} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') onSelect(state); }} aria-label={`${state}: ${item?.leads || 0} leads, ${item?.active || 0} ativos`}><path className="kh-map-extrusion" d={path} transform="translate(0 18)" style={{ fill: rgba(color, 0.5) }} /><path className="kh-map-front" d={path} style={{ fill: rgba(color, intensity) }}><title>{`${feature.properties.name} (${region}): ${item?.leads || 0} leads, ${item?.active || 0} ativos`}</title></path></g>; })}</svg> : <div className="kh-map-loading">Carregando mapa...</div>}{hovered && <div className="kh-map-tooltip"><strong>{hovered}</strong><span>{hoveredData?.leads || 0} leads recebidos</span><b>{hoveredData?.active || 0} ativos na Orion</b><small>{regionForState(hovered)} · passe o mouse para ver o relevo</small></div>}</div><div className="kh-map-legend" aria-label="Legenda das regiões do Brasil">{(Object.keys(REGION_COLORS) as BrazilRegion[]).map((region) => <span key={region}><i style={{ background: REGION_COLORS[region] }} />{region}</span>)}</div></div>;
}

export default function CommercialDashboardPage() {
  const { api, role, currentProfileId, canViewCommercialFinancials } = useCommercial();
  const [start, setStart] = useState(startOfMonth());
  const [end, setEnd] = useState(isoDate(new Date()));
  const [datePreset, setDatePreset] = useState<DatePreset>('mes');
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedState, setSelectedState] = useState<string | null>(null);
  const [selectedCampaigns, setSelectedCampaigns] = useState<string[]>([]);
  const [periodOpen, setPeriodOpen] = useState(false);
  const [draftPreset, setDraftPreset] = useState<DatePreset>(datePreset);
  const [draftStart, setDraftStart] = useState(start);
  const [draftEnd, setDraftEnd] = useState(end);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const campaigns = selectedCampaigns.map((campaign) => encodeURIComponent(campaign)).join(',');
      setData(await api(`/api/comercial/overview?start=${start}&end=${end}${campaigns ? `&campaigns=${campaigns}` : ''}`));
    }
    catch (err) { setError(err instanceof Error ? err.message : 'Erro ao carregar indicadores.'); }
    finally { setLoading(false); }
  }, [api, end, selectedCampaigns, start]);
  // This effect keeps dashboard metrics synchronized with the active filters.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  function openPeriod() {
    setDraftPreset(datePreset); setDraftStart(start); setDraftEnd(end); setPeriodOpen((current) => !current);
  }

  function choosePreset(next: DatePreset) {
    setDraftPreset(next);
    if (next !== 'personalizado') { const range = getPresetRange(next); setDraftStart(range.start); setDraftEnd(range.end); }
  }

  function applyPeriod() {
    setDatePreset(draftPreset); setStart(draftStart); setEnd(draftEnd); setPeriodOpen(false);
  }

  const periodText = datePreset === 'todos' ? 'Todo o periodo' : `${({ hoje: 'Hoje', ontem: 'Ontem', '7dias': 'Ultimos 7 dias', '30dias': 'Ultimos 30 dias', mes: 'Este mes', mes_passado: 'Mes passado', personalizado: 'Periodo personalizado', todos: 'Todo o periodo' } as Record<DatePreset, string>)[datePreset]} (${shortDate(start)} a ${shortDate(end)})`;

  function toggleCampaign(campaign: string) {
    setSelectedCampaigns((current) => current.includes(campaign) ? current.filter((item) => item !== campaign) : [...current, campaign]);
  }

  const m = data?.metrics || {};
  const selectedStateData = data?.states?.find((item) => item.state === selectedState);
  const primary = [
    ...(canViewCommercialFinancials ? [{ label: 'Investimento', value: currency(m.investment), helper: 'No período selecionado', icon: WalletCards, tone: 'blue' }] : []),
    { label: 'Leads', value: String(m.leads || 0), helper: `${m.qualified || 0} qualificados`, icon: UsersRound, tone: 'cyan' },
    ...(canViewCommercialFinancials ? [{ label: 'Custo por lead', value: currency(m.cpl), helper: `MQL ${currency(m.costPerMql)}`, icon: CircleDollarSign, tone: 'green' }] : []),
    { label: 'Reuniões', value: String(m.scheduled || 0), helper: `${m.realized || 0} realizadas`, icon: CalendarDays, tone: 'yellow' },
    { label: 'Clientes fechados', value: String(m.closed || 0), helper: canViewCommercialFinancials ? `CAC ${currency(m.cac)}` : 'Vendas no período', icon: Target, tone: 'violet' },
  ];
  const funnel = [
    ['Leads', m.leads], ['MQLs', m.qualified], ['Agendadas', m.scheduled], ['Realizadas', m.realized], ['Qualificadas', m.qualifiedMeetings], ['Vendas', m.closed],
  ];
  const maxFunnel = Math.max(1, Number(m.leads || 0));
  const detailMetrics = useMemo(() => [
    ['Em negociação', currency(m.negotiation)], ['Faturamento', currency(m.revenue)], ['Ticket médio', currency(m.averageTicket)],
    ...(canViewCommercialFinancials ? [
      ['ROI', percent(m.roi)], ['ROAS', `${Number(m.roas || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}x`],
      ['Custo por reunião', currency(m.costPerMeeting)], ['Custo por reunião qualificada', currency(m.costPerQualifiedMeeting)],
    ] : []),
    ['Conversão por leads', percent(m.conversionLeads)], ['Conversão por reuniões', percent(m.conversionMeetings)],
    ['Conversão por reuniões qualificadas', percent(m.conversionQualifiedMeetings)], ['Taxa de agendamento', percent(m.schedulingRate)],
    ['Agendamento qualificado', percent(m.qualifiedSchedulingRate)], ['No-show', String(m.noShow || 0)],
    ['Reuniões desqualificadas', String(m.disqualifiedMeetings || 0)], ['Tempo médio de fechamento', `${Number(m.averageCloseDays || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} dias`],
  ], [canViewCommercialFinancials, m]);

  return (
    <div>
      <header className="kh-page-head">
        <div><div className="kh-eyebrow">Performance comercial</div><h1>Visão geral</h1><p>Da entrada do lead ao faturamento, com os números reais da operação.</p></div>
        <div className="kh-actions kh-date-actions">
            <div className="kh-period-control">
              <button type="button" className="kh-period-trigger" onClick={openPeriod} aria-expanded={periodOpen}><CalendarDays size={15} /><strong>{periodText}</strong><ChevronDown size={14} /></button>
              {periodOpen && <div className="kh-period-popover">
                <div className="kh-period-quick"><span>Atalhos rapidos</span>{([['todos', 'Todo o periodo'], ['hoje', 'Hoje'], ['ontem', 'Ontem'], ['7dias', 'Ultimos 7 dias'], ['30dias', 'Ultimos 30 dias'], ['mes', 'Este mes'], ['mes_passado', 'Mes passado']] as Array<[DatePreset, string]>).map(([value, label]) => <button type="button" key={value} className={draftPreset === value ? 'active' : ''} onClick={() => choosePreset(value)}>{label}</button>)}</div>
                <div className="kh-period-custom"><span>Periodo personalizado</span><label>Data de inicio<input type="date" value={draftStart} onChange={(event) => { setDraftPreset('personalizado'); setDraftStart(event.target.value); }} /></label><label>Data de fim<input type="date" value={draftEnd} onChange={(event) => { setDraftPreset('personalizado'); setDraftEnd(event.target.value); }} /></label><div className="kh-period-footer"><button type="button" onClick={() => setPeriodOpen(false)}>Cancelar</button><button type="button" className="primary" onClick={applyPeriod}>Aplicar</button></div></div>
              </div>}
            </div>
            {canViewCommercialFinancials && <details className="kh-campaign-filter"><summary>Campanhas{selectedCampaigns.length ? ` (${selectedCampaigns.length})` : ''}</summary><div className="kh-campaign-menu"><button type="button" onClick={() => setSelectedCampaigns([])}>Todas as campanhas</button>{(data?.campaigns || []).map((campaign) => <label key={campaign}><input type="checkbox" checked={selectedCampaigns.includes(campaign)} onChange={() => toggleCampaign(campaign)} /><span>{selectedCampaigns.includes(campaign) && <Check size={12} />}{campaign}</span></label>)}{!data?.campaigns?.length && <small>Nenhuma campanha encontrada.</small>}</div></details>}
          <button className="kh-icon-button" type="button" onClick={() => void load()} aria-label="Atualizar indicadores"><RefreshCw size={17} className={loading ? 'kh-spin' : ''} /></button>
        </div>
      </header>
      {error && <div className="kh-inline-error">{error}</div>}
      {data?.meta_error && <div className="kh-inline-error">{data.meta_error}</div>}

      <section className={`kh-kpi-grid ${canViewCommercialFinancials ? '' : 'restricted'}`} aria-label="Indicadores principais">
        {primary.map((item) => <article key={item.label} className={`kh-kpi ${item.tone}`}><div className="kh-kpi-icon"><item.icon size={19} /></div><span>{item.label}</span><strong>{loading ? '—' : item.value}</strong><small>{item.helper}</small></article>)}
      </section>

      <section className="kh-dashboard-grid">
        <article className="kh-panel kh-revenue-panel">
          <div className="kh-panel-header"><div><span>Resultado no período</span><h2>Receita e evolução comercial</h2></div><div className="kh-chart-legend"><span className="l1">Leads</span><span className="l2">MQL</span><span className="l3">Reuniões</span><span className="l4">Vendas</span></div></div>
          <div className="kh-revenue-hero"><div><span>Receita fechada</span><strong>{currency(m.revenue)}</strong></div><div><span>Em negociação</span><strong>{currency(m.negotiation)}</strong></div><ArrowUpRight size={26} /></div>
          <TrendChart rows={data?.trend || []} />
        </article>

        <article className="kh-panel kh-funnel-panel">
          <div className="kh-panel-header"><div><span>Conversão</span><h2>Funil comercial</h2></div><span>{percent(m.conversionLeads)} total</span></div>
          <div className="kh-funnel-list">{funnel.map(([label, value], index) => <div key={String(label)}><div><span>{label}</span><strong>{Number(value || 0)}</strong></div><div className="kh-progress"><i style={{ width: `${Math.max(Number(value || 0) ? 5 : 0, (Number(value || 0) / maxFunnel) * 100)}%` }} /></div>{index < funnel.length - 1 && <small>{Number(value || 0) ? percent((Number(funnel[index + 1][1] || 0) / Number(value || 1)) * 100) : '0,0%'}</small>}</div>)}</div>
        </article>
      </section>

      <section className="kh-live-grid">
        <article className="kh-panel kh-live-meetings"><div className="kh-panel-header"><div><span>Atualização automática a cada 30 segundos</span><h2>Reuniões da semana</h2></div><span className="kh-live-dot">Ao vivo</span></div><WeeklyMeetingsChart rows={data?.weeklyMeetings || []} /></article>
        <article className="kh-panel kh-origin-panel"><div className="kh-panel-header"><div><span>Origem geográfica dos leads</span><h2>Leads por estado</h2></div><span>{data?.states?.reduce((sum, item) => sum + item.leads, 0) || 0} mapeados</span></div><StateMap3D states={data?.states || []} selected={selectedState} onSelect={setSelectedState} />{selectedStateData ? <div className="kh-state-detail"><strong>{selectedStateData.state}</strong><span>{selectedStateData.leads} leads recebidos</span><b>{selectedStateData.active} ativos na Orion</b></div> : <div className="kh-state-hint">Selecione um estado para ver os leads recebidos e os que continuam ativos.</div>}</article>
      </section>

      <section className="kh-bottom-grid">
        <article className="kh-panel"><div className="kh-panel-header"><h2>Indicadores avançados</h2><span>Visão completa do período</span></div><div className="kh-detail-grid">{detailMetrics.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div></article>
        <article className="kh-panel"><div className="kh-panel-header"><h2>Equipe comercial</h2><span>{role === 'coordenador' ? 'Visão da equipe' : 'Meu desempenho'}</span></div><div className="kh-team-list">{(data?.team || []).filter((member) => member.role !== 'coordenador' && (role === 'coordenador' || member.id === currentProfileId)).map((member) => <div key={member.id}><div className="kh-avatar">{member.name.split(' ').slice(0, 2).map((part) => part[0]).join('')}</div><div className="kh-team-name"><strong>{member.name}</strong><span>{member.role.toUpperCase()}</span></div><div><span>Leads</span><strong>{member.leads}</strong></div><div><span>Reuniões</span><strong>{member.meetings}</strong></div><div><span>Vendas</span><strong>{member.sales}</strong></div><div><span>Receita</span><strong>{currency(member.revenue)}</strong></div></div>)}{!data?.team?.some((member) => member.role !== 'coordenador') && <div className="kh-empty-row">Vincule o SDR e o closer na página Usuários.</div>}</div></article>
      </section>
    </div>
  );
}
