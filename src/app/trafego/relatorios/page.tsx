'use client';

import { useState, useEffect } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import { 
  BarChart3, 
  TrendingUp, 
  Users, 
  DollarSign, 
  Copy, 
  Save, 
  Loader2, 
  Check, 
  FileText,
  Eye,
  ShieldAlert,
  RefreshCw,
  CalendarDays,
  Send,
  MessageCircle
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/components/providers/AuthProvider';
import { format } from 'date-fns';
import { isGestorLinkedToConcessionariaCorretor } from '@/lib/gestorAccess';
import { isMissingLeadOriginColumn, isOrionLead } from '@/lib/leadOrigin';

type ReportCorretor = {
  id: string;
  nome: string;
  nome_empresa?: string | null;
  gestor_trafego_id?: string | null;
  time_operacional?: any;
  meta_ad_account_id?: string | null;
  meta_ad_account_name?: string | null;
  corretor_ids: string[];
};

interface TrafficReport {
  id: string;
  corretor_id: string;
  gestor_id: string;
  data_inicio: string;
  data_fim: string;
  quantidade_leads: number;
  valor_investido: number;
  cpl: number | null;
  observacoes: string;
  created_at: string;
  corretores: { nome: string; nome_empresa?: string | null };
}

type WeeklyReportItem = {
  corretor_id: string;
  concessionaria: string;
  meta_ad_account_name: string | null;
  leads: number | null;
  investimento: number | null;
  cpl: number | null;
  mensagem: string;
  erro_leads?: string | null;
  erro_investimento?: string | null;
};

type ReportDestination = { id: string; corretor_id: string; tipo: 'account' | 'grupo'; nome: string; destino: string; ativo: boolean };

function formatDateInput(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

export default function TrafficReportsPage() {
  const { profile, actualProfile } = useAuth();
  const [corretores, setCorretores] = useState<ReportCorretor[]>([]);
  const [reports, setReports] = useState<TrafficReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [fetchingMetaSpend, setFetchingMetaSpend] = useState(false);
  const [metaSpendError, setMetaSpendError] = useState<string | null>(null);
  const [weeklyGenerating, setWeeklyGenerating] = useState(false);
  const [weeklyPreview, setWeeklyPreview] = useState<WeeklyReportItem[] | null>(null);
  const [weeklyReportId, setWeeklyReportId] = useState<string | null>(null);
  const [weeklyError, setWeeklyError] = useState<string | null>(null);
  const [weeklySending, setWeeklySending] = useState(false);
  const [weeklySendMessage, setWeeklySendMessage] = useState<string | null>(null);
  const [weeklyRange, setWeeklyRange] = useState(() => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - 6);
    return { data_inicio: formatDateInput(start), data_fim: formatDateInput(end) };
  });
  const [destinations, setDestinations] = useState<ReportDestination[]>([]);
  const [destinationSaving, setDestinationSaving] = useState(false);
  const [destinationForm, setDestinationForm] = useState({ corretor_id: '', tipo: 'grupo' as const, nome: '', destino: '' });

  // Form State
  const [formData, setFormData] = useState({
    corretor_id: '',
    data_inicio: format(new Date(new Date().getFullYear(), new Date().getMonth(), 1), 'yyyy-MM-dd'),
    data_fim: format(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0), 'yyyy-MM-dd'),
    valor_investido: '',
    usar_leads_manuais: false,
    quantidade_leads_manual: ''
  });

  // Preview State
  const [preview, setPreview] = useState<{
    leads: number;
    corretor: ReportCorretor;
    cpl: number | null;
    fonteLeads: 'sistema' | 'manual';
    valorInvestido: number;
  } | null>(null);

  useEffect(() => {
    fetchData();
  }, [profile?.id, profile?.tipo_usuario]);

  async function fetchData() {
    if (!profile?.id) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const corretoresQuery = supabase
        .from('corretores')
        .select('id, nome, gestor_trafego_id, time_operacional, nome_empresa, meta_ad_account_id, meta_ad_account_name')
        .in('status', ['active', 'ativo', 'Ativo'])
        .order('nome', { ascending: true });

      const reportsQuery = supabase
        .from('relatorios_trafego')
        .select('*, corretores(nome, nome_empresa)')
        .order('created_at', { ascending: false });

      if (profile.tipo_usuario === 'gestor_trafego') {
        reportsQuery.eq('gestor_id', profile.id);
      }

      const [{ data: corretoresData, error: errC }, { data: reportsData, error: errR }] = await Promise.all([
        corretoresQuery,
        reportsQuery
      ]);

      if (errC || errR) {
        const supabaseError = errC || errR;
        console.error('Supabase Error:', supabaseError);
        if (supabaseError?.code === '42501' || supabaseError?.message?.toLowerCase().includes('row-level security')) {
          setError("Acesso Negado: Você não tem permissão para visualizar relatórios de tráfego.");
        } else {
          setError("Erro ao carregar dados: " + supabaseError?.message);
        }
        return;
      }

      let filteredCorretores = corretoresData || [];
      if (profile.tipo_usuario === 'gestor_trafego') {
        filteredCorretores = filteredCorretores.filter(c => isGestorLinkedToConcessionariaCorretor(c, profile));
      }

      const concessionarias = new Map<string, ReportCorretor>();
      filteredCorretores.forEach((corretor) => {
        const concessionaria = String(corretor.nome_empresa || corretor.nome || '').trim();
        if (!concessionaria) return;
        const key = concessionaria.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
        const current = concessionarias.get(key);
        if (!current) {
          concessionarias.set(key, {
            ...corretor,
            nome: concessionaria,
            nome_empresa: concessionaria,
            corretor_ids: [corretor.id],
          });
          return;
        }
        current.corretor_ids.push(corretor.id);
        if (!current.meta_ad_account_id && corretor.meta_ad_account_id) {
          current.id = corretor.id;
          current.meta_ad_account_id = corretor.meta_ad_account_id;
          current.meta_ad_account_name = corretor.meta_ad_account_name;
        }
      });

      setCorretores(Array.from(concessionarias.values()).sort((a, b) => a.nome.localeCompare(b.nome)));
      setReports((reportsData as TrafficReport[]) || []);
    } catch (err: unknown) {
      console.error('Catch Error:', err);
      setError("Erro inesperado ao carregar dados.");
    } finally {
      setLoading(false);
    }
  }

  async function fetchMetaSpend() {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) throw new Error('Sessao expirada. Entre novamente.');

    setFetchingMetaSpend(true);
    setMetaSpendError(null);

    try {
      const response = await fetch('/api/integrations/meta/spend', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          corretor_id: formData.corretor_id,
          data_inicio: formData.data_inicio,
          data_fim: formData.data_fim
        })
      });
      const payload = await response.json();

      if (!response.ok) {
        setMetaSpendError(payload.error || 'Nao foi possivel puxar o investimento Meta.');
        setFormData((current) => ({ ...current, valor_investido: '' }));
        throw new Error(payload.error || 'Nao foi possivel puxar o investimento Meta.');
      }

      const spend = Number(payload.spend || 0);
      setFormData((current) => ({ ...current, valor_investido: String(spend.toFixed(2)) }));
      return spend;
    } catch (err: any) {
      setMetaSpendError(err.message || 'Erro ao buscar investimento Meta.');
      throw err;
    } finally {
      setFetchingMetaSpend(false);
    }
  }

  const generatePreview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.corretor_id) {
      alert('Selecione a concessionária.');
      return;
    }

    if (formData.usar_leads_manuais && formData.valor_investido.trim() === '') {
      alert('Informe o valor investido manual.');
      return;
    }
    if (!corretores.some((corretor) => corretor.id === formData.corretor_id)) {
      alert('Selecione uma concessionária vinculada à sua gestão.');
      return;
    }

    setGenerating(true);
    try {
      let numLeads = 0;
      let fonteLeads: 'sistema' | 'manual' = 'sistema';
      let investido = 0;

      if (formData.usar_leads_manuais) {
        const leadsManual = Number(formData.quantidade_leads_manual);
        investido = parseFloat(formData.valor_investido || '0');
        if (formData.quantidade_leads_manual.trim() === '') {
          alert('Informe a quantidade de leads gerados.');
          return;
        }

        if (!Number.isFinite(leadsManual) || leadsManual < 0) {
          alert('Informe uma quantidade de leads valida.');
          return;
        }
        if (Number.isNaN(investido) || investido < 0) {
          alert('Informe um valor investido valido.');
          return;
        }

        numLeads = Math.floor(leadsManual);
        fonteLeads = 'manual';
      } else {
        investido = await fetchMetaSpend();
        const selectedConcessionaria = corretores.find((item) => item.id === formData.corretor_id);
        const corretorIds = selectedConcessionaria?.corretor_ids || [formData.corretor_id];
        let { data: crmLeads, error: supabaseError }: { data: any[] | null; error: any } = await supabase
          .from('leads')
          .select('id, origem, utm_source, utm_medium, utm_campaign, utm_term, utm_content, operadora, observacoes')
          .in('corretor_id', corretorIds)
          .gte('data_entrada', new Date(formData.data_inicio).toISOString())
          .lte('data_entrada', new Date(formData.data_fim + 'T23:59:59').toISOString());

        if (supabaseError && isMissingLeadOriginColumn(supabaseError)) {
          const retry = await supabase
            .from('leads')
            .select('id, utm_source, utm_medium, utm_campaign, utm_term, utm_content, operadora, observacoes')
            .in('corretor_id', corretorIds)
            .gte('data_entrada', new Date(formData.data_inicio).toISOString())
            .lte('data_entrada', new Date(formData.data_fim + 'T23:59:59').toISOString());
          crmLeads = retry.data;
          supabaseError = retry.error;
        }

        if (supabaseError) {
          alert('Erro ao buscar leads: ' + supabaseError.message);
          return;
        }

        numLeads = (crmLeads || []).filter(isOrionLead).length;
      }

      const cpl = numLeads > 0 ? investido / numLeads : null;
      const corretor = corretores.find(c => c.id === formData.corretor_id);

      if (!corretor) {
        alert('Concessionária não encontrada para este gestor.');
        return;
      }

      setPreview({
        leads: numLeads,
        corretor,
        cpl,
        fonteLeads,
        valorInvestido: investido
      });
    } catch (err: any) {
      console.error('Error generating preview:', err);
      alert(err.message || 'Erro inesperado ao gerar previa.');
    } finally {
      setGenerating(false);
    }
  };

  const saveReport = async () => {
    if (!preview || !profile) return;
    if (!corretores.some((corretor) => corretor.id === formData.corretor_id)) {
      alert('Selecione uma concessionária vinculada à sua gestão.');
      return;
    }

    setSaving(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        alert('Sessão expirada. Entre novamente.');
        return;
      }

      const response = await fetch('/api/trafego/relatorios', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          corretor_id: formData.corretor_id,
          data_inicio: formData.data_inicio,
          data_fim: formData.data_fim,
          quantidade_leads: preview.leads,
          valor_investido: preview.valorInvestido,
          cpl: preview.cpl
        })
      });
      const payload = await response.json();

      if (!response.ok) {
        alert('Erro ao salvar relatório: ' + (payload.error || 'erro desconhecido'));
      } else {
        setSaveMessage('Relatório salvo no Histórico de Relatórios abaixo.');
        fetchData();
        setPreview(null);
      }
    } catch {
      alert('Erro inesperado ao salvar.');
    } finally {
      setSaving(false);
    }
  };

  const copyToClipboard = () => {
    if (!preview) return;
    
    const dataInicioFmt = format(new Date(formData.data_inicio), 'dd/MM/yyyy');
    const dataFimFmt = format(new Date(formData.data_fim), 'dd/MM/yyyy');
    const valorFmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(preview.valorInvestido);
    const cplFmt = preview.cpl ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(preview.cpl) : 'Indisponível';

    let text = `📊 *Relatório de Leads - Orion Track*\n\n`;
    text += `Cliente: ${preview.corretor.nome}\n`;
    text += `Período: ${dataInicioFmt} a ${dataFimFmt}\n`;
    text += `Leads Gerados: ${preview.leads}\n`;
    text += `Investimento Meta: ${valorFmt}\n`;
    text += `CPL Médio: ${cplFmt}\n\n`;
    
    const origemLeads = preview.fonteLeads === 'manual' ? 'informados manualmente' : 'registrados no Orion Track';

    if (preview.leads > 0) {
      text += `Resumo: Durante o período, foram ${origemLeads} ${preview.leads} leads para ${preview.corretor.nome}. O investimento informado no Meta Ads foi de ${valorFmt}, resultando em um CPL médio de ${cplFmt}.`;
    } else {
      text += `Resumo: Durante o período, não foram ${origemLeads} leads para ${preview.corretor.nome}. O investimento informado foi de ${valorFmt}, mas o CPL não pôde ser calculado por ausência de leads no período.`;
    }

    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const copySavedReport = (report: TrafficReport) => {
    const valorFmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(report.valor_investido);
    const cplFmt = report.cpl ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(report.cpl) : 'Indisponível';
    const text = `📊 *Relatório de Leads - Orion Track*\n\nCliente: ${report.corretores?.nome || 'N/A'}\nPeríodo: ${format(new Date(report.data_inicio), 'dd/MM/yyyy')} a ${format(new Date(report.data_fim), 'dd/MM/yyyy')}\nLeads Gerados: ${report.quantidade_leads}\nInvestimento Meta: ${valorFmt}\nCPL Médio: ${cplFmt}`;
    navigator.clipboard.writeText(text);
    alert('Relatório copiado!');
  };

  const generateWeeklyReport = async () => {
    setWeeklyGenerating(true);
    setWeeklyError(null);
    setWeeklySendMessage(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error('Sessão expirada. Entre novamente.');
      const response = await fetch('/api/trafego/relatorios/semanal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          ...weeklyRange,
          gestor_id: actualProfile?.tipo_usuario === 'admin' && profile?.tipo_usuario === 'gestor_trafego'
            ? profile.id
            : null,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Não foi possível gerar o relatório semanal.');
      setWeeklyPreview(payload.items || []);
      setWeeklyReportId(payload.report_id || null);
    } catch (err: any) {
      setWeeklyError(err.message || 'Erro ao gerar relatório semanal.');
    } finally {
      setWeeklyGenerating(false);
    }
  };

  const sendWeeklyToAccount = async () => {
    if (!weeklyReportId) return;
    setWeeklySending(true);
    setWeeklyError(null);
    setWeeklySendMessage(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error('Sessão expirada. Entre novamente.');
      const response = await fetch('/api/trafego/relatorios/semanal/enviar-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          report_id: weeklyReportId,
          gestor_id: actualProfile?.tipo_usuario === 'admin' && profile?.tipo_usuario === 'gestor_trafego'
            ? profile.id
            : null,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Não foi possível enviar o relatório para o Account Manager.');
      setWeeklySendMessage(payload.message || 'Relatório enviado para o Account Manager.');
    } catch (err: any) {
      setWeeklyError(err.message || 'Erro ao enviar relatório para o Account Manager.');
    } finally {
      setWeeklySending(false);
    }
  };

  const copyWeeklyReport = () => {
    if (!weeklyPreview) return;
    const text = weeklyPreview.map((item) => `${item.concessionaria}\n${item.mensagem}`).join('\n\n--------------------\n\n');
    navigator.clipboard.writeText(text);
    alert('Relatórios semanais copiados.');
  };

  const saveDestination = async (event: React.FormEvent) => {
    event.preventDefault();
    setDestinationSaving(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error('Sessão expirada. Entre novamente.');
      const response = await fetch('/api/trafego/relatorios/destinos', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(destinationForm) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Não foi possível salvar o destino.');
      setDestinations((current) => [...current.filter((item) => item.id !== payload.destination.id), payload.destination]);
      setDestinationForm({ ...destinationForm, nome: '', destino: '' });
    } catch (err: any) {
      alert(err.message || 'Erro ao salvar destino.');
    } finally {
      setDestinationSaving(false);
    }
  };

  return (
    <InternalLayout>
      <div className="mb-10">
        <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Relatórios de Tráfego</h1>
        <p className="text-gray-500 font-medium">Gere relatórios de performance e CPL para os parceiros.</p>
      </div>

      <section className="mb-10 overflow-hidden rounded-[2.5rem] border border-slate-200 bg-slate-950 p-8 text-white shadow-xl">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="mb-2 flex items-center gap-2 text-xs font-black uppercase tracking-[0.2em] text-cyan-300"><CalendarDays size={15} /> Relatório semanal</p>
            <h2 className="text-2xl font-black">Gerar relatório para todas as concessionárias</h2>
            <p className="mt-2 max-w-2xl text-sm font-medium text-slate-400">Cria uma prévia de mensagem com leads do CRM, investimento Meta e CPL. Nada é enviado automaticamente.</p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs font-bold text-slate-400">Início<input type="date" value={weeklyRange.data_inicio} onChange={(e) => setWeeklyRange({ ...weeklyRange, data_inicio: e.target.value })} className="mt-2 block rounded-xl border border-slate-700 bg-slate-900 px-3 py-3 text-sm text-white" /></label>
            <label className="text-xs font-bold text-slate-400">Fim<input type="date" value={weeklyRange.data_fim} onChange={(e) => setWeeklyRange({ ...weeklyRange, data_fim: e.target.value })} className="mt-2 block rounded-xl border border-slate-700 bg-slate-900 px-3 py-3 text-sm text-white" /></label>
            <button type="button" onClick={generateWeeklyReport} disabled={weeklyGenerating} className="inline-flex h-[46px] items-center gap-2 rounded-xl bg-blue-600 px-5 text-sm font-black transition hover:bg-blue-500 disabled:cursor-wait disabled:opacity-60">
              {weeklyGenerating ? <Loader2 size={17} className="animate-spin" /> : <RefreshCw size={17} />}
              {weeklyGenerating ? 'Gerando...' : 'Gerar relatório semanal'}
            </button>
          </div>
        </div>
        {weeklyError && <p className="mt-5 rounded-xl border border-red-500/30 bg-red-950/30 px-4 py-3 text-sm font-bold text-red-300">{weeklyError}</p>}
      </section>

      {weeklyPreview && (
        <section className="mb-10 rounded-[2.5rem] border border-slate-200 bg-white p-8 shadow-xl">
          <div className="flex flex-col gap-4 border-b border-slate-100 pb-6 lg:flex-row lg:items-center lg:justify-between">
            <div><p className="text-xs font-black uppercase tracking-[0.2em] text-blue-600">Prévia para revisão</p><h2 className="mt-1 text-2xl font-black text-slate-900">Mensagens da semana</h2><p className="mt-1 text-sm text-slate-500">Relatório {weeklyReportId ? `#${weeklyReportId.slice(0, 8)}` : ''} salvo no histórico. Revise antes de enviar.</p></div>
            <div className="flex flex-wrap gap-3">
              <button type="button" onClick={sendWeeklyToAccount} disabled={weeklySending || !weeklyReportId} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-black text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
                {weeklySending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} Enviar para Account Manager
              </button>
              <button type="button" onClick={copyWeeklyReport} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-3 text-sm font-black text-slate-700 hover:bg-slate-50"><Copy size={16} /> Copiar prévia</button>
            </div>
          </div>
          {weeklySendMessage && <p className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">{weeklySendMessage}</p>}
          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            {weeklyPreview.map((item) => (
              <article key={item.corretor_id} className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                <div className="flex items-start justify-between gap-4"><div><h3 className="text-lg font-black text-slate-900">{item.concessionaria}</h3><p className="mt-1 text-xs font-bold uppercase tracking-wider text-slate-400">{item.meta_ad_account_name || 'Conta Meta não identificada'}</p></div><MessageCircle className="text-blue-600" size={20} /></div>
                <div className="mt-4 grid grid-cols-3 gap-2 text-center"><div className="rounded-xl bg-white p-3"><b className="block text-lg text-slate-900">{item.leads === null ? 'N/A' : item.leads}</b><span className="text-[10px] font-black uppercase text-slate-400">Leads</span></div><div className="rounded-xl bg-white p-3"><b className="block text-sm text-slate-900">{item.investimento === null ? 'N/A' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.investimento)}</b><span className="text-[10px] font-black uppercase text-slate-400">Investimento</span></div><div className="rounded-xl bg-white p-3"><b className="block text-sm text-slate-900">{item.cpl === null ? 'N/A' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.cpl)}</b><span className="text-[10px] font-black uppercase text-slate-400">CPL</span></div></div>
                {(item.erro_leads || item.erro_investimento) && (
                  <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
                    {[item.erro_leads, item.erro_investimento].filter(Boolean).join(' · ')}
                  </div>
                )}
                <pre className="mt-4 whitespace-pre-wrap rounded-xl bg-white p-4 font-sans text-sm leading-6 text-slate-700">{item.mensagem}</pre>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="mb-10 rounded-[2.5rem] border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6"><p className="text-xs font-black uppercase tracking-[0.2em] text-blue-600">Destinos WhatsApp</p><h2 className="mt-1 text-xl font-black text-slate-900">Cadastrar grupo por concessionária</h2><p className="mt-1 text-sm text-slate-500">Os grupos são destinos externos. O envio para Account Manager acontece internamente pelo usuário atribuído no time operacional.</p></div>
        <form onSubmit={saveDestination} className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <select required value={destinationForm.corretor_id} onChange={(e) => setDestinationForm({ ...destinationForm, corretor_id: e.target.value })} className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-bold text-slate-700"><option value="">Concessionária</option>{corretores.map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}</select>
          <input required value={destinationForm.nome} onChange={(e) => setDestinationForm({ ...destinationForm, nome: e.target.value })} placeholder="Nome do destino" className="rounded-xl border border-slate-200 px-3 py-3 text-sm" />
          <input required value={destinationForm.destino} onChange={(e) => setDestinationForm({ ...destinationForm, destino: e.target.value })} placeholder="ID ou número WhatsApp" className="rounded-xl border border-slate-200 px-3 py-3 text-sm" />
          <button type="submit" disabled={destinationSaving} className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-60">{destinationSaving ? 'Salvando...' : 'Adicionar destino'}</button>
        </form>
        {destinations.length > 0 && <div className="mt-5 flex flex-wrap gap-2">{destinations.map((item) => <span key={item.id} className="rounded-full bg-slate-100 px-3 py-2 text-xs font-bold text-slate-600">{item.nome} · {item.tipo === 'grupo' ? 'Grupo' : 'Conta'}</span>)}</div>}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
        {/* Form Column */}
        <div className="lg:col-span-1 space-y-8">
          <div className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm">
            <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center gap-2">
              <BarChart3 size={20} className="text-blue-600" />
              Configurar Relatório
            </h2>
            
            <form onSubmit={generatePreview} className="space-y-6">
              <div className="space-y-2">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">Concessionária</label>
                <select 
                  required
                  value={formData.corretor_id}
                  onChange={e => setFormData({...formData, corretor_id: e.target.value})}
                  className="w-full bg-slate-50 border-none rounded-2xl py-4 px-6 focus:ring-2 focus:ring-blue-500 transition-all font-bold appearance-none"
                >
                  <option value="">Selecione...</option>
                  {corretores.map(c => (
                    <option key={c.id} value={c.id}>{c.nome}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">Início</label>
                  <input 
                    type="date" 
                    required
                    value={formData.data_inicio}
                    onChange={e => setFormData({...formData, data_inicio: e.target.value})}
                    className="w-full bg-slate-50 border-none rounded-2xl py-4 px-4 focus:ring-2 focus:ring-blue-500 transition-all font-medium text-sm"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">Fim</label>
                  <input 
                    type="date" 
                    required
                    value={formData.data_fim}
                    onChange={e => setFormData({...formData, data_fim: e.target.value})}
                    className="w-full bg-slate-50 border-none rounded-2xl py-4 px-4 focus:ring-2 focus:ring-blue-500 transition-all font-medium text-sm"
                  />
                </div>
              </div>

              <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={formData.usar_leads_manuais}
                    onChange={e => setFormData({
                      ...formData,
                      usar_leads_manuais: e.target.checked,
                      quantidade_leads_manual: e.target.checked ? formData.quantidade_leads_manual : '',
                      valor_investido: e.target.checked ? formData.valor_investido : ''
                    })}
                    className="mt-1 h-5 w-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span>
                    <span className="block text-sm font-black text-gray-900">Inserir leads manualmente</span>
                    <span className="mt-1 block text-xs font-medium leading-relaxed text-gray-500">
                      Desmarcado, o relatorio puxa automaticamente os leads registrados para o corretor no periodo.
                    </span>
                  </span>
                </label>

                {formData.usar_leads_manuais && (
                  <div className="mt-4 space-y-4">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">Leads gerados</label>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        required={formData.usar_leads_manuais}
                        value={formData.quantidade_leads_manual}
                        onChange={e => setFormData({...formData, quantidade_leads_manual: e.target.value})}
                        placeholder="0"
                        className="w-full bg-white border-none rounded-2xl py-4 px-6 focus:ring-2 focus:ring-blue-500 transition-all font-bold"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">Valor investido manual</label>
                      <div className="relative">
                        <span className="absolute left-6 top-1/2 -translate-y-1/2 text-gray-400 font-bold">R$</span>
                        <input
                          type="number"
                          step="0.01"
                          value={formData.valor_investido}
                          onChange={e => setFormData({...formData, valor_investido: e.target.value})}
                          placeholder="0,00"
                          className="w-full bg-white border-none rounded-2xl py-4 pl-14 pr-6 focus:ring-2 focus:ring-blue-500 transition-all font-bold"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <button 
                type="submit"
                disabled={generating || fetchingMetaSpend}
                className="w-full bg-blue-600 text-white py-5 rounded-2xl font-black flex items-center justify-center gap-3 hover:bg-blue-700 transition-all shadow-xl shadow-blue-600/20 disabled:opacity-50"
              >
                {generating ? <Loader2 className="animate-spin" size={24} /> : 'Gerar Prévia'}
              </button>
            </form>
          </div>
        </div>

        {/* Preview Column */}
        <div className="lg:col-span-2">
          {preview ? (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="bg-white p-10 rounded-[2.5rem] border border-gray-100 shadow-xl relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-blue-50 rounded-bl-[100%] -mr-10 -mt-10" />
                
                <h2 className="text-2xl font-bold text-gray-900 mb-8 relative">Prévia do Relatório</h2>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-10 relative">
                  <div className="p-6 bg-slate-50 rounded-[2rem] border border-slate-100">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-2">
                      <Users size={12} /> Leads Gerados
                    </p>
                    <p className="text-3xl font-black text-gray-900">{preview.leads}</p>
                    <span className="mt-3 inline-flex rounded-full bg-white px-3 py-1 text-[10px] font-black uppercase tracking-widest text-slate-400">
                      {preview.fonteLeads === 'manual' ? 'Manual' : 'Sistema'}
                    </span>
                  </div>
                  <div className="p-6 bg-slate-50 rounded-[2rem] border border-slate-100">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-2">
                      <DollarSign size={12} /> Investimento
                    </p>
                    <p className="text-3xl font-black text-gray-900">
                      {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(preview.valorInvestido)}
                    </p>
                  </div>
                  <div className="p-6 bg-blue-600 text-white rounded-[2rem] shadow-xl shadow-blue-600/20">
                    <p className="text-[10px] font-black text-blue-200 uppercase tracking-widest mb-2 flex items-center gap-2">
                      <TrendingUp size={12} /> CPL Médio
                    </p>
                    <p className="text-3xl font-black">
                      {preview.cpl ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(preview.cpl) : 'N/A'}
                    </p>
                  </div>
                </div>

                <div className="bg-slate-50 p-6 rounded-2xl border border-dashed border-slate-200 mb-8">
                  <p className="text-sm text-gray-600 leading-relaxed font-medium italic">
                    Durante o período de {format(new Date(formData.data_inicio), 'dd/MM/yyyy')} até {format(new Date(formData.data_fim), 'dd/MM/yyyy')}, 
                    {preview.leads > 0 
                      ? ` foram ${preview.fonteLeads === 'manual' ? 'informados manualmente' : 'registrados no Orion Track'} ${preview.leads} leads para ${preview.corretor.nome}. O investimento informado no Meta Ads foi de ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(preview.valorInvestido)}, resultando em um CPL médio de ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(preview.cpl!)}.`
                      : ` não foram ${preview.fonteLeads === 'manual' ? 'informados manualmente' : 'registrados no Orion Track'} leads para ${preview.corretor.nome}. O investimento informado foi de ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(preview.valorInvestido)}, mas o CPL não pôde ser calculado por ausência de leads no período.`
                    }
                  </p>
                </div>

                <div className="flex flex-col md:flex-row gap-4">
                  <button 
                    onClick={copyToClipboard}
                    className="flex-1 bg-gray-900 text-white py-5 rounded-2xl font-black flex items-center justify-center gap-3 hover:bg-black transition-all"
                  >
                    {copied ? <Check size={20} className="text-green-400" /> : <Copy size={20} />}
                    {copied ? 'Copiado!' : 'Copiar para WhatsApp'}
                  </button>
                  <button 
                    onClick={saveReport}
                    disabled={saving}
                    className="flex-1 bg-blue-600 text-white py-5 rounded-2xl font-black flex items-center justify-center gap-3 hover:bg-blue-700 transition-all shadow-xl shadow-blue-600/20"
                  >
                    {saving ? <Loader2 className="animate-spin" size={20} /> : <Save size={20} />}
                    Salvar Relatório
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-slate-50 border-2 border-dashed border-slate-200 rounded-[2.5rem] p-20 flex flex-col items-center justify-center text-center opacity-60 h-full min-h-[400px]">
              <div className="w-16 h-16 bg-white rounded-2xl shadow-sm flex items-center justify-center mb-6 text-slate-300">
                <FileText size={32} />
              </div>
              <h3 className="text-xl font-bold text-slate-400">Nenhuma prévia gerada</h3>
              <p className="text-slate-400 text-sm font-medium mt-2">Configure os dados ao lado para gerar o relatório.</p>
            </div>
          )}
        </div>
      </div>

      {/* History Table */}
      <div className="mt-12 space-y-6">
        {saveMessage && (
          <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-sm font-black text-emerald-700">
            {saveMessage}
          </div>
        )}
        <h2 className="text-2xl font-bold text-gray-900">Histórico de Relatórios</h2>
        <div className="bg-white rounded-[2.5rem] border border-gray-100 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            {error ? (
              <div className="py-24 text-center">
                <div className="w-16 h-16 bg-red-50 text-red-600 rounded-2xl flex items-center justify-center mx-auto mb-6">
                  <ShieldAlert size={32} />
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-2">Acesso Restrito</h3>
                <p className="text-red-500 font-medium max-w-md mx-auto mb-6">{error}</p>
                <button 
                  onClick={fetchData}
                  className="inline-flex items-center gap-2 text-blue-600 font-black uppercase tracking-widest text-xs hover:underline"
                >
                  <RefreshCw size={14} /> Recarregar
                </button>
              </div>
            ) : (
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-50/50">
                    <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest">Geração</th>
                    <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest">Concessionária</th>
                    <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest">Período</th>
                    <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest">Leads</th>
                    <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest">Investimento</th>
                    <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest">CPL</th>
                    <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest text-right">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {loading ? (
                    <tr>
                      <td colSpan={7} className="py-20 text-center"><Loader2 className="animate-spin mx-auto text-blue-600" /></td>
                    </tr>
                  ) : reports.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-gray-400 font-medium">Nenhum relatório salvo ainda.</td>
                    </tr>
                  ) : reports.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-8 py-5 text-sm text-gray-500 font-medium">
                        {format(new Date(r.created_at), 'dd/MM/yyyy')}
                      </td>
                      <td className="px-8 py-5">
                        <p className="font-bold text-gray-900">{r.corretores?.nome_empresa || r.corretores?.nome || 'N/A'}</p>
                      </td>
                      <td className="px-8 py-5 text-xs text-gray-500 font-medium">
                        {format(new Date(r.data_inicio), 'dd/MM/yyyy')} - {format(new Date(r.data_fim), 'dd/MM/yyyy')}
                      </td>
                      <td className="px-8 py-5 font-bold text-gray-900">{r.quantidade_leads}</td>
                      <td className="px-8 py-5 text-sm text-gray-600 font-medium">
                        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(r.valor_investido)}
                      </td>
                      <td className="px-8 py-5">
                        <span className="bg-blue-50 text-blue-600 px-3 py-1 rounded-full text-xs font-black">
                          {r.cpl ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(r.cpl) : 'N/A'}
                        </span>
                      </td>
                      <td className="px-8 py-5 text-right">
                        <button
                          onClick={() => copySavedReport(r)}
                          className="inline-flex items-center gap-2 rounded-xl p-2 text-xs font-black text-slate-400 transition-colors hover:bg-blue-50 hover:text-blue-600"
                        >
                          <Eye size={18} /> Copiar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </InternalLayout>
  );
}
