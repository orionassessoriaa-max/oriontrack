"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, CalendarDays, CheckCircle2, PhoneCall, RefreshCw, Target, TrendingUp, UsersRound } from "lucide-react";
import { useCommercial } from "@/components/commercial/CommercialShell";

type RevOpsData = {
  start: string;
  end: string;
  summary: Record<string, number>;
  team: Array<{ id: string; name: string; color: string; leads: number; calls: number; answeredCalls: number; meetings: number; realized: number; noShows: number; qualified: number; sales: number; revenue?: number }>;
  daily: Array<{ date: string; leads: number; calls: number; meetings: number; noShows: number; qualified: number; sales: number; revenue: number }>;
  calls: Array<{ id: string; lead_id: string; lead_name: string; lead_phone: string | null; sdr_name: string; status: string; iniciada_at: string; duracao_segundos: number | null; gravacao_url: string | null }>;
  sales: Array<{ id: string; lead_name: string; company: string | null; sdr_name: string; seller_name: string; closed_at: string; payment_model: string | null; amount?: number }>;
  canViewFinancials: boolean;
};

type Tab = "painel" | "sdrs" | "ligacoes" | "vendas";

function monthValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function monthRange(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const end = new Date(year, monthNumber, 0).getDate();
  return { start: `${month}-01`, end: `${month}-${String(end).padStart(2, "0")}` };
}

function currency(value: number | undefined) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(Number(value || 0));
}

function percent(value: number, total: number) {
  return total > 0 ? `${((value / total) * 100).toFixed(1).replace(".", ",")}%` : "0,0%";
}

function dateTime(value: string) {
  return new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export default function CommercialIntelligencePage() {
  const { api, role } = useCommercial();
  const [month, setMonth] = useState(monthValue());
  const [tab, setTab] = useState<Tab>("painel");
  const [data, setData] = useState<RevOpsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const range = useMemo(() => monthRange(month), [month]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api(`/api/comercial/revops?start=${range.start}&end=${range.end}`));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar a inteligência comercial.");
    } finally {
      setLoading(false);
    }
  }, [api, range.end, range.start]);

  // Mantém o painel sincronizado quando o período muda.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  async function updateCall(id: string, status: string) {
    try {
      await api("/api/comercial/calls", { method: "PATCH", body: JSON.stringify({ id, status }) });
      await load();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Não foi possível atualizar a ligação.");
    }
  }

  const summary = data?.summary || {};
  const maxDaily = Math.max(1, ...(data?.daily || []).map((row) => Math.max(row.leads, row.calls, row.meetings)));
  const cards = [
    { label: "Leads recebidos", value: summary.leads || 0, helper: "Entradas no período", icon: UsersRound, tone: "cyan" },
    { label: "Ligações", value: summary.calls || 0, helper: `${summary.answeredCalls || 0} atendidas`, icon: PhoneCall, tone: "blue" },
    { label: "Reuniões", value: summary.scheduled || 0, helper: `${summary.realized || 0} realizadas`, icon: CalendarDays, tone: "yellow" },
    { label: "Qualificadas", value: summary.qualified || 0, helper: `${summary.noShows || 0} no-shows`, icon: CheckCircle2, tone: "green" },
    { label: "Vendas", value: summary.sales || 0, helper: data?.canViewFinancials ? currency(summary.revenue) : "Fechamentos", icon: Target, tone: "violet" },
  ];

  return (
    <div className="kh-revops">
      <header className="kh-page-head kh-revops-head">
        <div><div className="kh-eyebrow">Inteligência comercial</div><h1>Painel de vendas</h1><p>Leads, ligações, reuniões e vendas conectados ao CRM em tempo real.</p></div>
        <div className="kh-actions"><label className="kh-month-control"><span>Mês analisado</span><input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label><button type="button" className="kh-icon-button" onClick={() => void load()} aria-label="Atualizar painel"><RefreshCw size={17} className={loading ? "kh-spin" : ""} /></button></div>
      </header>

      <nav className="kh-revops-tabs" aria-label="Seções da inteligência comercial">
        {([['painel', 'Painel'], ['sdrs', 'SDRs'], ['ligacoes', 'Ligações'], ['vendas', 'Vendas']] as Array<[Tab, string]>).map(([value, label]) => <button key={value} type="button" className={tab === value ? "active" : ""} onClick={() => setTab(value)}>{label}</button>)}
      </nav>
      {error && <div className="kh-inline-error" role="alert">{error}</div>}

      {tab === "painel" && <>
        <section className="kh-kpi-grid" aria-label="Resumo do período">{cards.map((card) => <article key={card.label} className={`kh-kpi ${card.tone}`}><div className="kh-kpi-icon"><card.icon size={19} /></div><span>{card.label}</span><strong>{loading ? "—" : card.value}</strong><small>{card.helper}</small></article>)}</section>
        <section className="kh-revops-main-grid">
          <article className="kh-panel kh-revops-chart"><div className="kh-panel-header"><div><span>Evolução diária</span><h2>Atividade do mês</h2></div><div className="kh-revops-legend"><span className="leads">Leads</span><span className="calls">Ligações</span><span className="meetings">Reuniões</span></div></div><div className="kh-revops-bars">{(data?.daily || []).map((row) => <div className="kh-revops-day" key={row.date}><div className="kh-revops-bar-track"><i className="leads" style={{ height: `${Math.max(row.leads ? 6 : 0, row.leads / maxDaily * 100)}%` }} /><i className="calls" style={{ height: `${Math.max(row.calls ? 6 : 0, row.calls / maxDaily * 100)}%` }} /><i className="meetings" style={{ height: `${Math.max(row.meetings ? 6 : 0, row.meetings / maxDaily * 100)}%` }} /></div><span>{row.date.slice(8, 10)}</span></div>)}{!data?.daily.length && <div className="kh-revops-empty"><Activity size={24} />Os dados aparecerão conforme o CRM for utilizado.</div>}</div></article>
          <article className="kh-panel"><div className="kh-panel-header"><div><span>Conversão do período</span><h2>Funil operacional</h2></div><TrendingUp size={18} /></div><div className="kh-revops-funnel">{[['Leads', summary.leads], ['Ligações', summary.calls], ['Reuniões', summary.scheduled], ['Qualificadas', summary.qualified], ['Vendas', summary.sales]].map(([label, value], index, rows) => <div key={String(label)}><span>{label}</span><strong>{Number(value || 0)}</strong><i><b style={{ width: `${Math.max(Number(value || 0) ? 5 : 0, Number(value || 0) / Math.max(1, Number(summary.leads || 0)) * 100)}%` }} /></i>{index < rows.length - 1 && <small>{percent(Number(rows[index + 1][1] || 0), Number(value || 0))}</small>}</div>)}</div></article>
        </section>
        <section className="kh-panel kh-revops-ranking"><div className="kh-panel-header"><div><span>Visão da equipe</span><h2>Ranking dos SDRs</h2></div><span>{role === "coordenador" ? "Equipe completa" : "Meu desempenho"}</span></div><div className="kh-revops-team-cards">{(data?.team || []).map((member) => <article key={member.id} style={{ "--member-color": member.color } as React.CSSProperties}><div className="kh-revops-member"><span>{member.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span><strong>{member.name}</strong></div><div><span>Ligações</span><strong>{member.calls}</strong></div><div><span>Reuniões</span><strong>{member.meetings}</strong></div><div><span>Vendas</span><strong>{member.sales}</strong></div></article>)}</div></section>
      </>}

      {tab === "sdrs" && <section className="kh-panel kh-revops-table-panel"><div className="kh-panel-header"><div><span>Comparativo individual</span><h2>Desempenho dos SDRs</h2></div></div><div className="kh-revops-table-wrap"><table className="kh-revops-table"><thead><tr><th>SDR</th><th>Leads</th><th>Ligações</th><th>Atendidas</th><th>Agendadas</th><th>Realizadas</th><th>No-show</th><th>Qualificadas</th><th>Vendas</th><th>Conv. lead/venda</th>{data?.canViewFinancials && <th>Receita</th>}</tr></thead><tbody>{(data?.team || []).map((member) => <tr key={member.id}><td><i style={{ background: member.color }} />{member.name}</td><td>{member.leads}</td><td>{member.calls}</td><td>{member.answeredCalls}</td><td>{member.meetings}</td><td>{member.realized}</td><td>{member.noShows}</td><td>{member.qualified}</td><td>{member.sales}</td><td>{percent(member.sales, member.leads)}</td>{data?.canViewFinancials && <td>{currency(member.revenue)}</td>}</tr>)}</tbody></table></div></section>}

      {tab === "ligacoes" && <section className="kh-panel kh-revops-table-panel"><div className="kh-panel-header"><div><span>Registro automático do CRM</span><h2>Histórico de ligações</h2></div><span>{data?.calls.length || 0} registros</span></div><div className="kh-revops-table-wrap"><table className="kh-revops-table"><thead><tr><th>Data</th><th>SDR</th><th>Lead</th><th>Telefone</th><th>Resultado</th><th>Duração</th><th>Gravação</th></tr></thead><tbody>{(data?.calls || []).map((call) => <tr key={call.id}><td>{dateTime(call.iniciada_at)}</td><td>{call.sdr_name}</td><td>{call.lead_name}</td><td>{call.lead_phone || "—"}</td><td><select value={call.status} onChange={(event) => void updateCall(call.id, event.target.value)}><option value="iniciada">Iniciada</option><option value="atendida">Atendida</option><option value="nao_atendida">Não atendida</option><option value="concluida">Concluída</option></select></td><td>{call.duracao_segundos ? `${Math.floor(call.duracao_segundos / 60)}m ${call.duracao_segundos % 60}s` : "—"}</td><td>{call.gravacao_url ? <a href={call.gravacao_url} target="_blank" rel="noreferrer">Ouvir</a> : "Não disponível"}</td></tr>)}{!data?.calls.length && <tr><td colSpan={7} className="kh-table-empty">Nenhuma ligação registrada neste período.</td></tr>}</tbody></table></div></section>}

      {tab === "vendas" && <section className="kh-panel kh-revops-table-panel"><div className="kh-panel-header"><div><span>Negócios fechados</span><h2>Vendas do período</h2></div>{data?.canViewFinancials && <strong>{currency(summary.revenue)}</strong>}</div><div className="kh-revops-table-wrap"><table className="kh-revops-table"><thead><tr><th>Fechamento</th><th>Cliente</th><th>Empresa</th><th>SDR</th><th>Vendedor</th><th>Modelo</th>{data?.canViewFinancials && <th>Valor</th>}</tr></thead><tbody>{(data?.sales || []).map((sale) => <tr key={sale.id}><td>{dateTime(sale.closed_at)}</td><td>{sale.lead_name}</td><td>{sale.company || "—"}</td><td>{sale.sdr_name}</td><td>{sale.seller_name}</td><td>{sale.payment_model?.toUpperCase() || "—"}</td>{data?.canViewFinancials && <td>{currency(sale.amount)}</td>}</tr>)}{!data?.sales.length && <tr><td colSpan={data?.canViewFinancials ? 7 : 6} className="kh-table-empty">Nenhuma venda fechada neste período.</td></tr>}</tbody></table></div></section>}
    </div>
  );
}
