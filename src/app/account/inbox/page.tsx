'use client';

import { useEffect, useMemo, useState } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import { useAuth } from '@/components/providers/AuthProvider';
import { useCorretoresOptions } from '@/hooks/useCorretoresOptions';
import { supabase } from '@/lib/supabase/client';
import { CheckCircle2, Copy, Loader2, MessageSquare, Phone, RefreshCw } from 'lucide-react';

type Interaction = {
  id: string;
  account_manager_profile_id: string;
  corretor_id: string;
  data: string;
  status: 'pendente' | 'feito';
  observacao: string | null;
};

type QuickReport = {
  leads: number;
  spend: number;
  cpl: number | null;
  corretorNome: string;
  date: string;
};

export default function AccountInboxPage() {
  const { profile } = useAuth();
  const { corretores, loading: loadingCorretores } = useCorretoresOptions();
  const today = new Date().toISOString().slice(0, 10);
  const [selectedCorretorId, setSelectedCorretorId] = useState('');
  const [reportCorretorId, setReportCorretorId] = useState('');
  const [reportDate, setReportDate] = useState(today);
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [report, setReport] = useState<QuickReport | null>(null);
  const [loadingReport, setLoadingReport] = useState(false);
  const [weeklyOnlyDone, setWeeklyOnlyDone] = useState(false);

  const selectedCorretor = useMemo(() => {
    return corretores.find((corretor) => corretor.id === selectedCorretorId) || corretores[0];
  }, [corretores, selectedCorretorId]);

  useEffect(() => {
    if (!selectedCorretorId && corretores[0]) setSelectedCorretorId(corretores[0].id);
    if (!reportCorretorId && corretores[0]) setReportCorretorId(corretores[0].id);
  }, [corretores, selectedCorretorId, reportCorretorId]);

  const fetchInteractions = async () => {
    if (!profile?.id) return;

    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 6);

    const { data } = await supabase
      .from('account_interacoes')
      .select('*')
      .eq('account_manager_profile_id', profile.id)
      .gte('data', weekAgo.toISOString().slice(0, 10))
      .order('data', { ascending: false });

    setInteractions((data || []) as Interaction[]);
  };

  useEffect(() => {
    fetchInteractions();
  }, [profile?.id]);

  const getTodayStatus = (corretorId: string) => {
    const item = interactions.find((interaction) => interaction.corretor_id === corretorId && interaction.data === today);
    return item?.status || 'pendente';
  };

  const toggleInteraction = async (corretorId: string) => {
    if (!profile?.id) return;

    const current = getTodayStatus(corretorId);
    const nextStatus = current === 'feito' ? 'pendente' : 'feito';

    const { error } = await supabase.from('account_interacoes').upsert({
      account_manager_profile_id: profile.id,
      corretor_id: corretorId,
      data: today,
      status: nextStatus,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'account_manager_profile_id,corretor_id,data' });

    if (error) {
      alert('Erro ao marcar interacao: ' + error.message);
      return;
    }

    await fetchInteractions();
  };

  const generateReport = async () => {
    if (!reportCorretorId) return;
    setLoadingReport(true);
    setReport(null);

    const corretor = corretores.find((item) => item.id === reportCorretorId);
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;

    const [leadsResult, spendResponse] = await Promise.all([
      supabase
        .from('leads')
        .select('id', { count: 'exact', head: true })
        .eq('corretor_id', reportCorretorId)
        .gte('data_entrada', `${reportDate}T00:00:00`)
        .lte('data_entrada', `${reportDate}T23:59:59`),
      fetch('/api/integrations/meta/spend', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          corretor_id: reportCorretorId,
          data_inicio: reportDate,
          data_fim: reportDate,
        }),
      }),
    ]);

    const spendPayload = await spendResponse.json();
    const spend = spendResponse.ok ? Number(spendPayload.spend || 0) : 0;
    const leads = leadsResult.count || 0;

    setReport({
      leads,
      spend,
      cpl: leads > 0 ? spend / leads : null,
      corretorNome: corretor?.nome || 'Corretor',
      date: reportDate,
    });
    setLoadingReport(false);
  };

  const copyReport = async () => {
    if (!report) return;
    const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
    const text = `Relatorio ${report.corretorNome} - ${report.date}\nLeads: ${report.leads}\nInvestimento: ${money.format(report.spend)}\nCPL: ${report.cpl === null ? 'N/A' : money.format(report.cpl)}`;
    await navigator.clipboard.writeText(text);
    alert('Relatorio copiado.');
  };

  const weeklyRows = interactions.filter((interaction) => !weeklyOnlyDone || interaction.status === 'feito');

  return (
    <InternalLayout>
      <div className="mb-6">
        <p className="text-xs font-black uppercase tracking-widest text-blue-600">Account manager</p>
        <h1 className="text-3xl font-black text-slate-950">Inbox e relacionamento</h1>
      </div>

      <div className="grid min-h-[680px] gap-4 xl:grid-cols-[280px_1fr_360px]">
        <aside className="border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 p-4">
            <h2 className="text-sm font-black uppercase tracking-widest text-slate-700">Interacoes de hoje</h2>
          </div>
          <div className="max-h-[620px] overflow-y-auto">
            {loadingCorretores ? (
              <div className="p-6 text-center"><Loader2 className="mx-auto animate-spin text-blue-600" /></div>
            ) : corretores.map((corretor) => {
              const status = getTodayStatus(corretor.id);
              const active = selectedCorretor?.id === corretor.id;
              return (
                <button
                  key={corretor.id}
                  onClick={() => setSelectedCorretorId(corretor.id)}
                  className={`flex w-full items-center gap-3 border-b border-slate-100 p-3 text-left transition ${active ? 'bg-blue-50' : 'hover:bg-slate-50'}`}
                >
                  <span className={`h-3 w-3 shrink-0 ${status === 'feito' ? 'bg-emerald-500' : 'bg-orange-400'}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-black text-slate-900">{corretor.nome}</span>
                    <span className="block truncate text-[11px] font-bold text-slate-500">{status === 'feito' ? 'Interacao feita' : 'Pendente hoje'}</span>
                  </span>
                  <button
                    type="button"
                    onClick={(event) => { event.stopPropagation(); toggleInteraction(corretor.id); }}
                    className={`px-2 py-1 text-[10px] font-black uppercase tracking-widest ${status === 'feito' ? 'bg-emerald-100 text-emerald-700' : 'bg-orange-100 text-orange-700'}`}
                  >
                    {status === 'feito' ? 'feito' : 'marcar'}
                  </button>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 p-4">
            <div>
              <h2 className="text-lg font-black text-slate-950">{selectedCorretor?.nome || 'Selecione um corretor'}</h2>
              <p className="text-xs font-bold text-slate-500">WhatsApp Evolution sera conectado aqui sem misturar contas.</p>
            </div>
            <button className="bg-slate-950 px-4 py-3 text-xs font-black uppercase tracking-widest text-white">Conectar WhatsApp</button>
          </div>
          <div className="flex h-[580px] flex-col items-center justify-center bg-slate-50 text-center">
            <MessageSquare className="text-slate-300" size={54} />
            <h3 className="mt-4 text-xl font-black text-slate-900">Inbox em preparacao</h3>
            <p className="mt-2 max-w-md text-sm font-bold text-slate-500">
              A estrutura ja separa atendimento por corretor. No proximo passo entra a API Evolution para QR Code, conversas e envio.
            </p>
            <div className="mt-6 flex gap-3">
              <button className="flex items-center gap-2 border border-slate-200 bg-white px-4 py-3 text-xs font-black uppercase tracking-widest text-slate-700">
                <Phone size={14} /> Ligar
              </button>
              <button className="flex items-center gap-2 border border-slate-200 bg-white px-4 py-3 text-xs font-black uppercase tracking-widest text-slate-700">
                <RefreshCw size={14} /> Sincronizar
              </button>
            </div>
          </div>
        </section>

        <aside className="space-y-4">
          <div className="border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-black text-slate-950">Gerar relatorio rapido</h2>
            <div className="mt-4 space-y-3">
              <select value={reportCorretorId} onChange={(event) => setReportCorretorId(event.target.value)} className="w-full border border-slate-200 bg-slate-50 p-3 text-sm font-bold outline-none focus:border-blue-500">
                {corretores.map((corretor) => <option key={corretor.id} value={corretor.id}>{corretor.nome}</option>)}
              </select>
              <input type="date" value={reportDate} onChange={(event) => setReportDate(event.target.value)} className="w-full border border-slate-200 bg-slate-50 p-3 text-sm font-bold outline-none focus:border-blue-500" />
              <button onClick={generateReport} disabled={loadingReport} className="flex w-full items-center justify-center gap-2 bg-blue-600 p-4 text-xs font-black uppercase tracking-widest text-white disabled:opacity-50">
                {loadingReport ? <Loader2 className="animate-spin" size={16} /> : null} Gerar relatorio
              </button>
            </div>
            {report && (
              <div className="mt-5 border border-blue-100 bg-blue-50 p-4">
                <p className="text-xs font-black uppercase tracking-widest text-blue-700">{report.corretorNome}</p>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <Metric label="Leads" value={String(report.leads)} />
                  <Metric label="Invest." value={new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(report.spend)} />
                  <Metric label="CPL" value={report.cpl === null ? 'N/A' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(report.cpl)} />
                </div>
                <button onClick={copyReport} className="mt-4 flex w-full items-center justify-center gap-2 bg-slate-950 p-3 text-xs font-black uppercase tracking-widest text-white">
                  <Copy size={14} /> Copiar pronto
                </button>
              </div>
            )}
          </div>

          <div className="border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-black text-slate-950">Semana</h2>
              <label className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-slate-500">
                <input type="checkbox" checked={weeklyOnlyDone} onChange={(event) => setWeeklyOnlyDone(event.target.checked)} />
                Feitas
              </label>
            </div>
            <div className="mt-4 max-h-56 space-y-2 overflow-y-auto">
              {weeklyRows.length === 0 ? (
                <p className="text-sm font-bold text-slate-400">Sem interacoes registradas.</p>
              ) : weeklyRows.map((interaction) => {
                const corretor = corretores.find((item) => item.id === interaction.corretor_id);
                return (
                  <div key={interaction.id} className="flex items-center gap-2 bg-slate-50 p-2 text-xs font-bold text-slate-600">
                    <CheckCircle2 size={14} className={interaction.status === 'feito' ? 'text-emerald-500' : 'text-orange-400'} />
                    <span className="flex-1 truncate">{corretor?.nome || 'Corretor'}</span>
                    <span>{interaction.data}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </aside>
      </div>
    </InternalLayout>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white p-2">
      <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">{label}</p>
      <p className="mt-1 text-sm font-black text-slate-950">{value}</p>
    </div>
  );
}
