"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useCommercial } from "@/components/commercial/CommercialShell";

type TeamRow = { id: string; name: string; color: string; leads: number; calls: number; answeredCalls: number; meetings: number; realized: number; noShows: number; qualified: number; sales: number; revenue?: number };
type DailyRow = { date: string; leads: number; calls: number; meetings: number; noShows: number; qualified: number; sales: number; revenue: number };
type SaleRow = { id: string; lead_name: string; company: string | null; sdr_name: string; seller_name: string; closed_at: string; payment_model: string | null; amount?: number; received_amount?: number };
type CallRow = { id: string; lead_name: string; lead_phone: string | null; sdr_name: string; status: string; iniciada_at: string; duracao_segundos: number | null; gravacao_url: string | null };
type RevOpsData = {
  summary: Record<string, number>;
  team: TeamRow[];
  daily: DailyRow[];
  sales: SaleRow[];
  calls: CallRow[];
  origins: Array<{ origin: string; leads: number; scheduled: number; realized: number; qualified: number; sales: number }>;
  paymentModels: Array<{ model: string; sales: number; revenue: number }>;
  canViewFinancials: boolean;
};
type Goal = { meta_valor?: number; meta_vendas?: number; meta_calls?: number; ticket_medio?: number };
type Tab = "painel" | "preenchimento" | "vendas" | "sdrs";

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const money = (value?: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(Number(value || 0));
const pct = (value: number, total: number) => total ? `${(value / total * 100).toFixed(1).replace(".", ",")}%` : "0,0%";
const shortDate = (value: string) => new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

function currentMonth() { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`; }
function rangeFor(month: string) { const [year, number] = month.split("-").map(Number); return { start: `${month}-01`, end: `${month}-${String(new Date(year, number, 0).getDate()).padStart(2, "0")}` }; }
function initials(name: string) { return name.split(/\s+/).map((part) => part[0]).slice(0, 2).join(""); }

function MiniBars({ rows, field, color = "blue" }: { rows: DailyRow[]; field: keyof DailyRow; color?: string }) {
  const max = Math.max(1, ...rows.map((row) => Number(row[field]) || 0));
  return <div className="ki-mini-bars">{rows.map((row) => <i key={row.date} className={color} style={{ height: `${Math.max(Number(row[field]) ? 5 : 1, Number(row[field]) / max * 100)}%` }} title={`${row.date}: ${row[field]}`} />)}</div>;
}

function LeaderCard({ label, member, metric, suffix = "" }: { label: string; member?: TeamRow; metric: keyof TeamRow; suffix?: string }) {
  return <article className="ki-leader"><span>{label}</span><div><b style={{ background: member?.color }}>{member ? initials(member.name) : "—"}</b><strong>{member?.name || "Sem dados"}</strong></div><em>{member ? `${member[metric]}${suffix}` : "—"}</em></article>;
}

export default function CommercialIntelligencePage() {
  const { api, role } = useCommercial();
  const [month, setMonth] = useState(currentMonth());
  const [tab, setTab] = useState<Tab>("painel");
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

  // A troca de período exige uma nova fotografia dos dados consolidados.
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
  const bestQualified = [...team].sort((a, b) => b.qualified - a.qualified)[0];
  const bestNoShow = [...team].sort((a, b) => a.noShows - b.noShows)[0];
  const bestMeetings = [...team].sort((a, b) => b.meetings - a.meetings)[0];
  const bestSales = [...team].sort((a, b) => b.sales - a.sales)[0];
  const metaValue = Number(goal.meta_valor || 0);
  const progress = metaValue ? Math.min(100, Number(summary.revenue || 0) / metaValue * 100) : 0;
  const closerConversion = pct(Number(summary.sales || 0), Number(summary.qualified || 0));
  const [year, monthNumber] = month.split("-").map(Number);

  return <div className="ki-page">
    <div className="ki-wrap">
      <header className="ki-header">
        <div><span>INTELIGÊNCIA COMERCIAL</span><h1>{MONTHS[monthNumber - 1]} de {year}</h1></div>
        <label><span>PERÍODO ANALISADO</span><input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label>
      </header>
      <nav className="ki-tabs">{([['painel','PAINEL'],['preenchimento','PREENCHIMENTO'],['vendas','VENDAS'],['sdrs','SDRS']] as Array<[Tab,string]>).map(([key,label]) => <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>{label}</button>)}</nav>
      {error && <div className="ki-error">{error}</div>}
      {loading && <div className="ki-loading">Atualizando dados do CRM…</div>}

      {tab === "painel" && <>
        {data?.canViewFinancials && <section className="ki-goals ki-card">
          <div className="ki-section-title"><div><span>PLANEJAMENTO DO MÊS</span><h2>Metas comerciais</h2></div>{coordinator && <button onClick={() => void saveGoals()} disabled={saving}>{saving ? "SALVANDO…" : "SALVAR METAS"}</button>}</div>
          <div className="ki-goal-grid">
            {[['meta_valor','Meta faturamento','R$'],['meta_vendas','Meta vendas',''],['meta_calls','Meta calls',''],['ticket_medio','Ticket médio','R$']].map(([key,label,prefix]) => <label key={key}><span>{label}</span><div>{prefix && <i>{prefix}</i>}<input type="number" min="0" value={Number(goal[key as keyof Goal] || 0)} disabled={!coordinator} onChange={(event) => setGoal((old) => ({ ...old, [key]: Number(event.target.value) }))} /></div></label>)}
          </div>
        </section>}

        <section className="ki-kpis">
          <article><span>TOTAL VENDIDO</span><strong>{data?.canViewFinancials ? money(summary.revenue) : `${summary.sales || 0} vendas`}</strong><small>contratos fechados no mês</small></article>
          <article><span>TOTAL RECEBIDO</span><strong>{data?.canViewFinancials ? money(summary.receivedRevenue) : "Restrito"}</strong><small>{summary.sales || 0} vendas registradas</small></article>
          <article><span>FALTA PARA A META</span><strong>{data?.canViewFinancials ? money(Math.max(0, metaValue - Number(summary.revenue || 0))) : "Restrito"}</strong><small>{progress.toFixed(1).replace('.', ',')}% alcançado</small></article>
          <article><span>VENDAS FECHADAS × RECEBIDAS</span><strong>{summary.sales || 0} × {data?.sales.filter((sale) => Number(sale.received_amount) > 0).length || 0}</strong><small>{pct(data?.sales.filter((sale) => Number(sale.received_amount) > 0).length || 0, Number(summary.sales || 0))} recebido</small></article>
        </section>

        {data?.canViewFinancials && <section className="ki-progress ki-card"><div><span>PROGRESSO DA META</span><strong>{money(summary.revenue)} <em>de {money(metaValue)}</em></strong></div><div className="ki-progress-track"><i style={{ width: `${progress}%` }} /></div><small>{progress.toFixed(1).replace('.', ',')}%</small></section>}

        <section className="ki-card"><div className="ki-section-title"><div><span>DESEMPENHO DO TIME</span><h2>Ranking dos SDRs</h2></div><small>dados consolidados do CRM</small></div><div className="ki-leader-grid">
          <LeaderCard label="TOP QUALIFICAÇÃO" member={bestQualified} metric="qualified" />
          <LeaderCard label="MENOR NO-SHOW" member={bestNoShow} metric="noShows" />
          <LeaderCard label="TOP AGENDAMENTOS" member={bestMeetings} metric="meetings" />
          <LeaderCard label="TOP VENDAS" member={bestSales} metric="sales" />
        </div></section>

        <section className="ki-two-cols">
          <article className="ki-card ki-closer"><span>CONVERSÃO DO CLOSER</span><h2>{closerConversion}</h2><p>{summary.sales || 0} vendas em {summary.qualified || 0} reuniões qualificadas</p><div><i style={{ width: closerConversion }} /></div><small>qualificada → venda</small></article>
          <article className="ki-card"><div className="ki-section-title"><div><span>COMPOSIÇÃO DAS VENDAS</span><h2>Modelo de pagamento</h2></div></div><div className="ki-models">{(data?.paymentModels || []).map((model) => <div key={model.model}><b className={model.model}>{model.model.toUpperCase()}</b><strong>{model.sales}</strong><span>{money(model.revenue)}</span></div>)}</div></article>
        </section>

        <section className="ki-card"><div className="ki-section-title"><div><span>EVOLUÇÃO DO MÊS</span><h2>Faturamento acumulado</h2></div><strong>{data?.canViewFinancials ? money(summary.revenue) : `${summary.sales || 0} vendas`}</strong></div><MiniBars rows={data?.daily || []} field={data?.canViewFinancials ? "revenue" : "sales"} color="magenta" /></section>

        <section className="ki-two-cols">
          <article className="ki-card"><div className="ki-section-title"><div><span>AQUISIÇÃO</span><h2>Volume por origem</h2></div></div><div className="ki-origin-list">{(data?.origins || []).slice(0, 7).map((origin) => <div key={origin.origin}><span>{origin.origin}</span><i><b style={{ width: `${origin.leads / Math.max(1, data?.origins[0]?.leads || 1) * 100}%` }} /></i><strong>{origin.leads}</strong></div>)}</div></article>
          <article className="ki-card"><div className="ki-section-title"><div><span>KPIS GERAIS</span><h2>Conversão do funil</h2></div></div><div className="ki-funnel-list">{[['Lead → agendamento',summary.scheduled,summary.leads],['Agendamento → realizada',summary.realized,summary.scheduled],['Realizada → qualificada',summary.qualified,summary.realized],['Qualificada → venda',summary.sales,summary.qualified]].map(([label,value,total]) => <div key={String(label)}><span>{label}</span><strong>{pct(Number(value || 0), Number(total || 0))}</strong></div>)}</div></article>
        </section>
      </>}

      {tab === "preenchimento" && <>
        <section className="ki-card"><div className="ki-section-title"><div><span>ACOMPANHAMENTO DIÁRIO</span><h2>Preenchimento automático pelo CRM</h2></div><small>não é necessário digitar novamente</small></div><div className="ki-table-wrap"><table><thead><tr><th>DATA</th><th>LEADS</th><th>CALLS</th><th>AGENDADAS</th><th>REALIZADAS</th><th>NO-SHOW</th><th>QUALIFICADAS</th><th>VENDAS</th>{data?.canViewFinancials && <th>FATURAMENTO</th>}</tr></thead><tbody>{(data?.daily || []).map((row) => <tr key={row.date}><td>{row.date.split('-').reverse().join('/')}</td><td>{row.leads}</td><td>{row.calls}</td><td>{row.meetings}</td><td>{row.qualified + row.noShows}</td><td>{row.noShows}</td><td>{row.qualified}</td><td>{row.sales}</td>{data?.canViewFinancials && <td>{money(row.revenue)}</td>}</tr>)}</tbody></table></div></section>
        <section className="ki-card"><div className="ki-section-title"><div><span>RASTREAMENTO</span><h2>Histórico de ligações</h2></div><small>{data?.calls.length || 0} registros</small></div><div className="ki-table-wrap"><table><thead><tr><th>DATA</th><th>SDR</th><th>LEAD</th><th>TELEFONE</th><th>RESULTADO</th><th>DURAÇÃO</th><th>GRAVAÇÃO</th></tr></thead><tbody>{(data?.calls || []).map((call) => <tr key={call.id}><td>{shortDate(call.iniciada_at)}</td><td>{call.sdr_name}</td><td>{call.lead_name}</td><td>{call.lead_phone || '—'}</td><td><select value={call.status} onChange={(event) => void updateCall(call.id,event.target.value)}><option value="iniciada">Iniciada</option><option value="atendida">Atendida</option><option value="nao_atendida">Não atendida</option><option value="concluida">Concluída</option></select></td><td>{call.duracao_segundos ? `${Math.floor(call.duracao_segundos/60)}m ${call.duracao_segundos%60}s` : '—'}</td><td>{call.gravacao_url ? <a href={call.gravacao_url} target="_blank" rel="noreferrer">OUVIR</a> : '—'}</td></tr>)}</tbody></table></div></section>
      </>}

      {tab === "vendas" && <section className="ki-card"><div className="ki-section-title"><div><span>NEGÓCIOS FECHADOS</span><h2>Vendas do período</h2></div>{data?.canViewFinancials && <strong>{money(summary.revenue)}</strong>}</div><div className="ki-table-wrap"><table><thead><tr><th>FECHAMENTO</th><th>CLIENTE</th><th>EMPRESA</th><th>SDR</th><th>CLOSER</th><th>MODELO</th>{data?.canViewFinancials && <><th>VENDIDO</th><th>RECEBIDO</th></>}</tr></thead><tbody>{(data?.sales || []).map((sale) => <tr key={sale.id}><td>{shortDate(sale.closed_at)}</td><td>{sale.lead_name}</td><td>{sale.company || '—'}</td><td>{sale.sdr_name}</td><td>{sale.seller_name}</td><td><b className={`ki-pill ${sale.payment_model}`}>{sale.payment_model?.toUpperCase() || '—'}</b></td>{data?.canViewFinancials && <><td>{money(sale.amount)}</td><td>{money(sale.received_amount)}</td></>}</tr>)}</tbody></table></div></section>}

      {tab === "sdrs" && <>
        <section className="ki-card"><div className="ki-section-title"><div><span>COMPARATIVO INDIVIDUAL</span><h2>Desempenho dos SDRs</h2></div></div><div className="ki-sdr-grid">{team.map((member) => <article key={member.id} style={{ borderTopColor: member.color }}><header><b style={{ background: member.color }}>{initials(member.name)}</b><strong>{member.name}</strong></header><dl><div><dt>Leads</dt><dd>{member.leads}</dd></div><div><dt>Calls</dt><dd>{member.calls}</dd></div><div><dt>Agendadas</dt><dd>{member.meetings}</dd></div><div><dt>Qualificadas</dt><dd>{member.qualified}</dd></div><div><dt>Vendas</dt><dd>{member.sales}</dd></div><div><dt>Conversão</dt><dd>{pct(member.sales,member.leads)}</dd></div></dl></article>)}</div></section>
        <section className="ki-card"><div className="ki-section-title"><div><span>VOLUME COMPARADO</span><h2>Produção do time</h2></div></div><div className="ki-team-bars">{team.map((member) => <div key={member.id}><strong>{member.name}</strong><span>Calls <i><b style={{ width: `${member.calls / Math.max(1,...team.map((item)=>item.calls)) * 100}%`, background: member.color }} /></i>{member.calls}</span><span>Agendadas <i><b style={{ width: `${member.meetings / Math.max(1,...team.map((item)=>item.meetings)) * 100}%`, background: member.color }} /></i>{member.meetings}</span><span>Vendas <i><b style={{ width: `${member.sales / Math.max(1,...team.map((item)=>item.sales)) * 100}%`, background: member.color }} /></i>{member.sales}</span></div>)}</div></section>
      </>}
    </div>
  </div>;
}
