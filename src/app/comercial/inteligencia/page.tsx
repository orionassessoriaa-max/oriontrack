"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useCommercial } from "@/components/commercial/CommercialShell";

type TeamRow = {
  id: string; name: string; color: string; leads: number; calls: number; answeredCalls: number;
  meetings: number; realized: number; noShows: number; qualified: number; disqualified: number;
  sales: number; revenue?: number; receivedRevenue?: number;
};
type DailyRow = { date: string; leads: number; calls: number; meetings: number; realized: number; noShows: number; qualified: number; disqualified: number; sales: number; revenue: number };
type SaleRow = {
  id: string; lead_name: string; company: string | null; sdr_name: string; seller_name: string;
  closed_at: string; meeting_at: string | null; origin: string; payment_model: string | null;
  amount?: number; received_amount?: number;
};
type CallRow = { id: string; lead_name: string; lead_phone: string | null; sdr_name: string; status: string; iniciada_at: string; duracao_segundos: number | null; gravacao_url: string | null };
type OriginRow = { origin: string; leads: number; scheduled: number; realized: number; noShows: number; qualified: number; disqualified: number; sales: number; revenue: number };
type RevOpsData = {
  summary: Record<string, number>; team: TeamRow[]; daily: DailyRow[]; sales: SaleRow[]; calls: CallRow[];
  origins: OriginRow[]; paymentModels: Array<{ model: string; sales: number; revenue: number }>;
  canViewFinancials: boolean;
};
type Goal = { meta_valor?: number; meta_vendas?: number; meta_calls?: number; ticket_medio?: number };
type Tab = "painel" | "preenchimento" | "vendas" | "sdrs";

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const money = (value?: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(Number(value || 0));
const percentage = (value: number, total: number) => total ? value / total * 100 : 0;
const pct = (value: number, total: number) => `${percentage(value, total).toFixed(1).replace(".", ",")}%`;
const shortDate = (value?: string | null) => value ? new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";
const currentMonth = () => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`; };
const rangeFor = (month: string) => { const [year, number] = month.split("-").map(Number); return { start: `${month}-01`, end: `${month}-${String(new Date(year, number, 0).getDate()).padStart(2, "0")}` }; };
const initials = (name: string) => name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("");
const safeWidth = (value: number) => `${Math.max(0, Math.min(100, value))}%`;

function CumulativeChart({ rows, goal }: { rows: DailyRow[]; goal: number }) {
  const series = rows.reduce<Array<{ date: string; revenue: number }>>((acc, row) => {
    acc.push({ date: row.date, revenue: (acc.at(-1)?.revenue || 0) + Number(row.revenue || 0) }); return acc;
  }, []);
  const max = Math.max(goal, ...series.map((row) => row.revenue), 1);
  const points = series.map((row, index) => `${20 + index * (760 / Math.max(series.length - 1, 1))},${180 - row.revenue / max * 145}`).join(" ");
  const goalY = 180 - goal / max * 145;
  return <div className="ki-chart-wrap"><svg viewBox="0 0 800 205" role="img" aria-label="Faturamento acumulado do mês">
    {[35, 71, 107, 143, 179].map((y) => <line key={y} x1="20" x2="780" y1={y} y2={y} className="grid" />)}
    {goal > 0 && <><line x1="20" x2="780" y1={goalY} y2={goalY} className="goal" /><text x="24" y={Math.max(13, goalY - 5)}>meta {money(goal)}</text></>}
    <polyline points={points} className="revenue" />
    {series.map((row, index) => row.revenue > 0 && <circle key={row.date} cx={20 + index * (760 / Math.max(series.length - 1, 1))} cy={180 - row.revenue / max * 145} r="2.7"><title>{row.date}: {money(row.revenue)}</title></circle>)}
  </svg><div className="ki-chart-legend"><span><i />Fechado acumulado</span><span><i className="goal" />Ritmo da meta</span></div></div>;
}

function LeaderCard({ label, member, value }: { label: string; member?: TeamRow; value: string }) {
  return <article className="ki-leader"><span>{label}</span><div><b style={{ background: member?.color }}>{member ? initials(member.name) : "—"}</b><strong>{member?.name || "Sem dados"}</strong></div><em>{member ? value : "—"}</em></article>;
}

export default function CommercialIntelligencePage() {
  const { api, role } = useCommercial();
  const [month, setMonth] = useState(currentMonth());
  const [tab, setTab] = useState<Tab>("painel");
  const [salesFilter, setSalesFilter] = useState("todos");
  const [data, setData] = useState<RevOpsData | null>(null);
  const [goal, setGoal] = useState<Goal>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const range = useMemo(() => rangeFor(month), [month]);
  const coordinator = role === "coordenador";

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const revops = await api(`/api/comercial/revops?start=${range.start}&end=${range.end}`) as RevOpsData;
      setData(revops);
      if (revops.canViewFinancials) {
        try { const metas = await api(`/api/comercial/metas?month=${month}`) as { goal?: Goal }; setGoal(metas.goal || {}); } catch { setGoal({}); }
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível carregar a inteligência comercial."); }
    finally { setLoading(false); }
  }, [api, month, range.end, range.start]);

  // A troca do período exige uma nova fotografia consolidada do CRM.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  async function saveGoals() {
    setSaving(true); setError("");
    try { await api("/api/comercial/metas", { method: "POST", body: JSON.stringify({ mes: month, ...goal }) }); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível salvar as metas."); }
    finally { setSaving(false); }
  }

  async function updateCall(id: string, status: string) {
    try { await api("/api/comercial/calls", { method: "PATCH", body: JSON.stringify({ id, status }) }); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível atualizar a ligação."); }
  }

  const summary = data?.summary || {};
  const team = data?.team || [];
  const qualifiedCandidates = team.filter((member) => member.realized > 0);
  const noShowCandidates = team.filter((member) => member.meetings > 0);
  const bestQualified = [...qualifiedCandidates].sort((a, b) => percentage(b.qualified, b.realized) - percentage(a.qualified, a.realized))[0];
  const bestNoShow = [...noShowCandidates].sort((a, b) => percentage(a.noShows, a.meetings) - percentage(b.noShows, b.meetings))[0];
  const bestMeetings = [...team].sort((a, b) => b.meetings - a.meetings)[0];
  const bestSales = [...team].sort((a, b) => b.sales - a.sales)[0];
  const metaValue = Number(goal.meta_valor || 0);
  const progress = percentage(Number(summary.revenue || 0), metaValue);
  const [year, monthNumber] = month.split("-").map(Number);
  const dailyRows = useMemo(() => {
    const count = new Date(year, monthNumber, 0).getDate();
    const map = new Map((data?.daily || []).map((row) => [row.date, row]));
    return Array.from({ length: count }, (_, index) => {
      const date = `${month}-${String(index + 1).padStart(2, "0")}`;
      return map.get(date) || { date, leads: 0, calls: 0, meetings: 0, realized: 0, noShows: 0, qualified: 0, disqualified: 0, sales: 0, revenue: 0 };
    });
  }, [data?.daily, month, monthNumber, year]);
  const filteredSales = (data?.sales || []).filter((sale) => salesFilter === "todos" || sale.payment_model === salesFilter);
  const receivedCount = Number(summary.fullyReceivedSales || 0);
  const outstanding = Math.max(0, Number(summary.revenue || 0) - Number(summary.receivedRevenue || 0));

  const conversionRows = [
    ["Comparecimento", summary.realized, summary.scheduled],
    ["No-show", summary.noShows, summary.scheduled],
    ["Qualificação", summary.qualified, summary.realized],
    ["Qualificada → venda", summary.sales, summary.qualified],
    ["Agendada → venda", summary.sales, summary.scheduled],
  ] as Array<[string, number, number]>;

  return <div className="ki-page"><div className="ki-wrap">
    <header className="ki-header"><div><span>INTELIGÊNCIA COMERCIAL</span><h1>{MONTHS[monthNumber - 1]} de {year}</h1></div><label><span>PERÍODO ANALISADO</span><input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label></header>
    <nav className="ki-tabs">{([['painel','PAINEL'],['preenchimento','PREENCHIMENTO'],['vendas','VENDAS'],['sdrs','SDRS']] as Array<[Tab,string]>).map(([key,label]) => <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>{label}</button>)}</nav>
    {error && <div className="ki-error">{error}</div>}{loading && <div className="ki-loading">Atualizando dados do CRM…</div>}

    {tab === "painel" && <>
      {data?.canViewFinancials && <section className="ki-goals ki-card"><div className="ki-section-title"><div><span>PLANEJAMENTO DO MÊS</span><h2>Metas comerciais</h2></div>{coordinator && <button onClick={() => void saveGoals()} disabled={saving}>{saving ? "SALVANDO…" : "SALVAR METAS"}</button>}</div><div className="ki-goal-grid">{[['meta_valor','Meta faturamento','R$'],['meta_vendas','Meta vendas',''],['meta_calls','Meta calls',''],['ticket_medio','Ticket médio','R$']].map(([key,label,prefix]) => <label key={key}><span>{label}</span><div>{prefix && <i>{prefix}</i>}<input type="number" min="0" value={Number(goal[key as keyof Goal] || 0)} disabled={!coordinator} onChange={(event) => setGoal((old) => ({ ...old, [key]: Number(event.target.value) }))} /></div></label>)}</div></section>}

      <section className="ki-kpis">
        <article><span>TOTAL VENDIDO</span><strong>{data?.canViewFinancials ? money(summary.revenue) : `${summary.sales || 0} vendas`}</strong><small>{summary.sales || 0} contratos fechados no mês</small></article>
        <article><span>TOTAL RECEBIDO</span><strong>{data?.canViewFinancials ? money(summary.receivedRevenue) : "Restrito"}</strong><small>{data?.canViewFinancials ? `${money(outstanding)} a receber` : `${receivedCount} recebidas`}</small></article>
        <article><span>FALTA PARA A META</span><strong>{data?.canViewFinancials ? money(Math.max(0, metaValue - Number(summary.revenue || 0))) : "Restrito"}</strong><small>{progress.toFixed(1).replace('.', ',')}% alcançado</small></article>
        <article><span>VENDAS FECHADAS × RECEBIDAS</span><strong>{summary.sales || 0} × {receivedCount}</strong><small>{pct(receivedCount, Number(summary.sales || 0))} totalmente recebido</small></article>
      </section>

      {data?.canViewFinancials && <section className="ki-progress ki-card"><div><span>PROGRESSO DA META</span><strong>{money(summary.revenue)} <em>de {money(metaValue)}</em></strong></div><div className="ki-progress-track"><i style={{ width: safeWidth(progress) }} /></div><small>{progress.toFixed(1).replace('.', ',')}%</small></section>}

      <section className="ki-card"><div className="ki-section-title"><div><span>DESEMPENHO DO TIME</span><h2>Ranking dos SDRs</h2></div><small>taxas e volumes consolidados do CRM</small></div><div className="ki-leader-grid">
        <LeaderCard label="TOP QUALIFICAÇÃO" member={bestQualified} value={bestQualified ? pct(bestQualified.qualified,bestQualified.realized) : "—"} />
        <LeaderCard label="MENOR NO-SHOW" member={bestNoShow} value={bestNoShow ? pct(bestNoShow.noShows,bestNoShow.meetings) : "—"} />
        <LeaderCard label="TOP AGENDAMENTOS" member={bestMeetings} value={String(bestMeetings?.meetings || 0)} />
        <LeaderCard label="TOP VENDAS" member={bestSales} value={String(bestSales?.sales || 0)} />
      </div></section>

      <section className="ki-two-cols">
        <article className="ki-card ki-closer"><span>PAINEL DO CLOSER · TAXA DE CONVERSÃO</span><h2>{pct(Number(summary.sales || 0), Number(summary.qualified || 0))}</h2><p>{summary.sales || 0} vendas ÷ {summary.qualified || 0} reuniões qualificadas</p><div><i style={{ width: safeWidth(percentage(Number(summary.sales || 0), Number(summary.qualified || 0))) }} /></div><small>somente reuniões qualificadas no período</small></article>
        <article className="ki-card"><div className="ki-section-title"><div><span>COMPOSIÇÃO DAS VENDAS</span><h2>Modelo de pagamento</h2></div></div><div className="ki-models">{(data?.paymentModels || []).map((model) => <div key={model.model}><b className={model.model}>{model.model.toUpperCase()}</b><strong>{model.sales}</strong><span>{money(model.revenue)}</span></div>)}</div><div className="ki-financial-foot"><span>Ticket atual <strong>{data?.canViewFinancials ? money(summary.averageTicket) : "Restrito"}</strong></span><span>Meta de ticket <strong>{money(goal.ticket_medio)}</strong></span></div></article>
      </section>

      <section className="ki-card"><div className="ki-section-title"><div><span>EVOLUÇÃO DO MÊS</span><h2>Faturamento acumulado × ritmo da meta</h2></div><strong>{data?.canViewFinancials ? money(summary.revenue) : `${summary.sales || 0} vendas`}</strong></div><CumulativeChart rows={dailyRows} goal={metaValue} /></section>

      <section className="ki-card"><div className="ki-section-title"><div><span>AQUISIÇÃO E RECEITA</span><h2>Volume por origem</h2></div><small>da entrada até a venda</small></div><div className="ki-table-wrap"><table className="ki-origin-table"><thead><tr><th>ORIGEM</th><th>LEADS</th><th>AGENDADAS</th><th>NO-SHOW</th><th>COMPARECERAM</th><th>QUALIFICADAS</th><th>DESQUALIF.</th><th>VENDAS</th>{data?.canViewFinancials && <th>RECEITA</th>}</tr></thead><tbody>{(data?.origins || []).map((origin) => <tr key={origin.origin}><td>{origin.origin}</td><td>{origin.leads}</td><td>{origin.scheduled}</td><td>{origin.noShows}</td><td>{origin.realized}</td><td>{origin.qualified}</td><td>{origin.disqualified}</td><td>{origin.sales}</td>{data?.canViewFinancials && <td>{money(origin.revenue)}</td>}</tr>)}<tr className="total"><td>GERAL</td><td>{summary.leads || 0}</td><td>{summary.scheduled || 0}</td><td>{summary.noShows || 0}</td><td>{summary.realized || 0}</td><td>{summary.qualified || 0}</td><td>{summary.disqualified || 0}</td><td>{summary.sales || 0}</td>{data?.canViewFinancials && <td>{money(summary.revenue)}</td>}</tr></tbody></table></div></section>

      <section className="ki-card"><div className="ki-section-title"><div><span>KPIS GERAIS</span><h2>Conversão do funil</h2></div></div><div className="ki-conversion-grid">{conversionRows.map(([label,value,total]) => { const valuePct = percentage(Number(value || 0),Number(total || 0)); return <article key={label} className={valuePct >= 70 ? "good" : valuePct >= 40 ? "warn" : "bad"}><span>{label}</span><strong>{pct(Number(value || 0),Number(total || 0))}</strong><small>{value || 0} ÷ {total || 0}</small></article>; })}</div></section>

      <section className="ki-card"><div className="ki-section-title"><div><span>DESEMPENHO INDIVIDUAL</span><h2>Comparativo entre SDRs</h2></div></div><div className="ki-table-wrap"><table className="ki-compare-table"><thead><tr><th>INDICADOR</th>{team.map((member) => <th key={member.id} style={{ color: member.color }}>{member.name}</th>)}</tr></thead><tbody>{[
        ["Comparecimento", (member: TeamRow) => pct(member.realized,member.meetings)], ["No-show", (member: TeamRow) => pct(member.noShows,member.meetings)], ["Qualificação", (member: TeamRow) => pct(member.qualified,member.realized)], ["Qualificada → venda", (member: TeamRow) => pct(member.sales,member.qualified)], ["Agendada → venda", (member: TeamRow) => pct(member.sales,member.meetings)],
      ].map(([label,formatter]) => <tr key={String(label)}><td>{String(label)}</td>{team.map((member) => <td key={member.id}>{(formatter as (row: TeamRow) => string)(member)}</td>)}</tr>)}</tbody></table></div></section>
    </>}

    {tab === "preenchimento" && <>
      <section className="ki-card"><div className="ki-section-title"><div><span>ACOMPANHAMENTO DIÁRIO</span><h2>Preenchimento automático pelo CRM</h2></div><small>comparecimento, qualificação e vendas já calculados</small></div><div className="ki-table-wrap"><table><thead><tr><th>DIA</th><th>LEADS</th><th>LIGAÇÕES</th><th>AGENDADAS</th><th>NO-SHOW</th><th>COMPARECERAM</th><th>QUALIFICADAS</th><th>DESQUALIF.</th><th>VENDAS</th>{data?.canViewFinancials && <th>FATURAMENTO</th>}</tr></thead><tbody>{dailyRows.map((row) => <tr key={row.date}><td>{row.date.split('-').reverse().join('/')}</td><td>{row.leads}</td><td>{row.calls}</td><td>{row.meetings}</td><td>{row.noShows}</td><td>{row.realized}</td><td>{row.qualified}</td><td>{row.disqualified}</td><td>{row.sales}</td>{data?.canViewFinancials && <td>{money(row.revenue)}</td>}</tr>)}</tbody><tfoot><tr><td>TOTAL</td><td>{summary.leads || 0}</td><td>{summary.calls || 0}</td><td>{summary.scheduled || 0}</td><td>{summary.noShows || 0}</td><td>{summary.realized || 0}</td><td>{summary.qualified || 0}</td><td>{summary.disqualified || 0}</td><td>{summary.sales || 0}</td>{data?.canViewFinancials && <td>{money(summary.revenue)}</td>}</tr></tfoot></table></div></section>
      <section className="ki-card"><div className="ki-section-title"><div><span>RASTREAMENTO</span><h2>Histórico de ligações</h2></div><small>{data?.calls.length || 0} registros</small></div><div className="ki-table-wrap"><table><thead><tr><th>DATA</th><th>SDR</th><th>LEAD</th><th>TELEFONE</th><th>RESULTADO</th><th>DURAÇÃO</th><th>GRAVAÇÃO</th></tr></thead><tbody>{(data?.calls || []).map((call) => <tr key={call.id}><td>{shortDate(call.iniciada_at)}</td><td>{call.sdr_name}</td><td>{call.lead_name}</td><td>{call.lead_phone || '—'}</td><td><select value={call.status} onChange={(event) => void updateCall(call.id,event.target.value)}><option value="iniciada">Iniciada</option><option value="atendida">Atendida</option><option value="nao_atendida">Não atendida</option><option value="concluida">Concluída</option></select></td><td>{call.duracao_segundos ? `${Math.floor(call.duracao_segundos/60)}m ${call.duracao_segundos%60}s` : '—'}</td><td>{call.gravacao_url ? <a href={call.gravacao_url} target="_blank" rel="noreferrer">OUVIR</a> : '—'}</td></tr>)}</tbody></table></div></section>
    </>}

    {tab === "vendas" && <section className="ki-card"><div className="ki-section-title"><div><span>NEGÓCIOS FECHADOS</span><h2>Vendas do período</h2></div><div className="ki-sale-filters">{["todos","tcv","mrr","mesclado"].map((filter) => <button key={filter} className={salesFilter === filter ? "active" : ""} onClick={() => setSalesFilter(filter)}>{filter.toUpperCase()}</button>)}</div></div><div className="ki-table-wrap"><table className="ki-sales-table"><thead><tr><th>CLIENTE</th><th>ORIGEM</th><th>SDR</th><th>CLOSER</th><th>MODELO</th><th>REUNIÃO</th><th>FECHAMENTO</th>{data?.canViewFinancials && <><th>VENDIDO</th><th>RECEBIDO</th><th>A RECEBER</th></>}</tr></thead><tbody>{filteredSales.map((sale) => <tr key={sale.id}><td><strong>{sale.lead_name}</strong><small>{sale.company || 'Empresa não informada'}</small></td><td>{sale.origin}</td><td>{sale.sdr_name}</td><td>{sale.seller_name}</td><td><b className={`ki-pill ${sale.payment_model}`}>{sale.payment_model?.toUpperCase() || '—'}</b></td><td>{shortDate(sale.meeting_at)}</td><td>{shortDate(sale.closed_at)}</td>{data?.canViewFinancials && <><td>{money(sale.amount)}</td><td>{money(sale.received_amount)}</td><td>{money(Math.max(0,Number(sale.amount || 0)-Number(sale.received_amount || 0)))}</td></>}</tr>)}</tbody></table></div>{data?.canViewFinancials && <div className="ki-sale-summary"><div><strong>{money(summary.revenue)}</strong><span>Total vendido</span></div><div><strong>{money(summary.receivedRevenue)}</strong><span>Total recebido</span></div><div><strong>{money(outstanding)}</strong><span>A receber</span></div><div><strong>{money(summary.averageTicket)}</strong><span>Ticket médio atual</span></div></div>}</section>}

    {tab === "sdrs" && <>
      <section className="ki-card"><div className="ki-section-title"><div><span>COMPARATIVO INDIVIDUAL</span><h2>Desempenho dos SDRs</h2></div></div><div className="ki-sdr-grid">{team.map((member) => <article key={member.id} style={{ borderTopColor: member.color }}><header><b style={{ background: member.color }}>{initials(member.name)}</b><strong>{member.name}</strong></header><dl><div><dt>Leads</dt><dd>{member.leads}</dd></div><div><dt>Ligações</dt><dd>{member.calls}</dd></div><div><dt>Atendidas</dt><dd>{member.answeredCalls}</dd></div><div><dt>Agendadas</dt><dd>{member.meetings}</dd></div><div><dt>Compareceram</dt><dd>{member.realized}</dd></div><div><dt>No-show</dt><dd>{member.noShows}</dd></div><div><dt>Qualificadas</dt><dd>{member.qualified}</dd></div><div><dt>Desqualificadas</dt><dd>{member.disqualified}</dd></div><div><dt>Vendas</dt><dd>{member.sales}</dd></div></dl><div className="ki-sdr-rates"><span>Comparecimento <b>{pct(member.realized,member.meetings)}</b></span><span>Qualificação <b>{pct(member.qualified,member.realized)}</b></span><span>Qualificada → venda <b>{pct(member.sales,member.qualified)}</b></span></div></article>)}</div></section>
      <section className="ki-card"><div className="ki-section-title"><div><span>VOLUME COMPARADO</span><h2>Produção do time</h2></div></div><div className="ki-team-bars">{team.map((member) => <div key={member.id}><strong>{member.name}</strong><span>Ligações <i><b style={{ width: safeWidth(percentage(member.calls,Math.max(1,...team.map((item)=>item.calls)))), background: member.color }} /></i>{member.calls}</span><span>Agendadas <i><b style={{ width: safeWidth(percentage(member.meetings,Math.max(1,...team.map((item)=>item.meetings)))), background: member.color }} /></i>{member.meetings}</span><span>Qualificadas <i><b style={{ width: safeWidth(percentage(member.qualified,Math.max(1,...team.map((item)=>item.qualified)))), background: member.color }} /></i>{member.qualified}</span><span>Vendas <i><b style={{ width: safeWidth(percentage(member.sales,Math.max(1,...team.map((item)=>item.sales)))), background: member.color }} /></i>{member.sales}</span></div>)}</div></section>
    </>}
  </div></div>;
}
