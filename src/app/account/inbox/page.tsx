'use client';

import { useEffect, useMemo, useState } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import { useAuth } from '@/components/providers/AuthProvider';
import { useCorretoresOptions } from '@/hooks/useCorretoresOptions';
import { supabase } from '@/lib/supabase/client';
import { CalendarDays, CheckCircle2, Copy, DollarSign, Loader2, MessageSquare, Phone, QrCode, RefreshCw, Smartphone, TrendingUp, Users } from 'lucide-react';

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
  dateInicio: string;
  dateFim: string;
};

export default function AccountInboxPage() {
  const { profile } = useAuth();
  const { corretores, loading: loadingCorretores } = useCorretoresOptions();
  const today = new Date().toISOString().slice(0, 10);
  const [selectedCorretorId, setSelectedCorretorId] = useState('');
  const [reportCorretorId, setReportCorretorId] = useState('');
  const [reportDateInicio, setReportDateInicio] = useState(today);
  const [reportDateFim, setReportDateFim] = useState(today);
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [report, setReport] = useState<QuickReport | null>(null);
  const [loadingReport, setLoadingReport] = useState(false);
  const [weeklyOnlyDone, setWeeklyOnlyDone] = useState(false);
  const [connectingWhatsApp, setConnectingWhatsApp] = useState(false);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);

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
        .gte('data_entrada', `${reportDateInicio}T00:00:00`)
        .lte('data_entrada', `${reportDateFim}T23:59:59`),
      fetch('/api/integrations/meta/spend', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          corretor_id: reportCorretorId,
          data_inicio: reportDateInicio,
          data_fim: reportDateFim,
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
      dateInicio: reportDateInicio,
      dateFim: reportDateFim,
    });
    setLoadingReport(false);
  };

  const copyReport = async () => {
    if (!report) return;
    const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
    const dateRangeStr = report.dateInicio === report.dateFim 
      ? new Date(`${report.dateInicio}T12:00:00`).toLocaleDateString('pt-BR')
      : `${new Date(`${report.dateInicio}T12:00:00`).toLocaleDateString('pt-BR')} a ${new Date(`${report.dateFim}T12:00:00`).toLocaleDateString('pt-BR')}`;
    const text = `Relatorio ${report.corretorNome} - ${dateRangeStr}\nLeads: ${report.leads}\nInvestimento: ${money.format(report.spend)}\nCPL: ${report.cpl === null ? 'N/A' : money.format(report.cpl)}`;
    await navigator.clipboard.writeText(text);
    alert('Relatorio copiado.');
  };

  const connectWhatsApp = async () => {
    setConnectingWhatsApp(true);
    setQrCode(null);
    setConnectError(null);

    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;

    if (!token) {
      setConnectingWhatsApp(false);
      setConnectError('Sua sessao expirou. Entre novamente para conectar o WhatsApp.');
      return;
    }

    const response = await fetch('/api/inbox/evolution/connect', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const payload = await response.json().catch(() => ({}));

    setConnectingWhatsApp(false);

    if (!response.ok) {
      setConnectError(payload.error || 'Nao consegui gerar o QR Code agora. Tente novamente em instantes.');
      return;
    }

    if (!payload.qrcode) {
      setConnectError('A conexao respondeu, mas ainda nao trouxe o QR Code. Tente novamente em alguns segundos.');
      return;
    }

    setQrCode(payload.qrcode);
  };

  const disconnectWhatsApp = async () => {
    setConnectingWhatsApp(true);
    setQrCode(null);
    setConnectError(null);

    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;

    if (!token) {
      setConnectingWhatsApp(false);
      setConnectError('Sua sessao expirou. Entre novamente.');
      return;
    }

    const response = await fetch('/api/inbox/evolution/connect', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    setConnectingWhatsApp(false);

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setConnectError(payload.error || 'Nao consegui resetar a conexao agora.');
      return;
    }

    alert('Instancia limpa e reiniciada no servidor! Clique em "Conectar WhatsApp" novamente para gerar um QR Code limpo.');
  };

  const weeklyRows = interactions.filter((interaction) => !weeklyOnlyDone || interaction.status === 'feito');

  return (
    <InternalLayout>
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-widest text-blue-600">Account manager</p>
          <h1 className="mt-2 text-4xl font-black tracking-tight text-slate-950 dark:text-white">Central de relacionamento</h1>
          <p className="mt-2 max-w-3xl text-sm font-bold leading-6 text-slate-500 dark:text-slate-300">
            Converse com clientes, marque interacoes do dia e gere resumos sem sair da tela.
          </p>
        </div>
        <button
          onClick={connectWhatsApp}
          disabled={connectingWhatsApp}
          className="flex min-h-[52px] cursor-pointer items-center justify-center gap-2 bg-blue-600 px-6 py-4 text-xs font-black uppercase tracking-widest text-white shadow-xl shadow-blue-600/20 transition-all hover:-translate-y-0.5 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {connectingWhatsApp ? <Loader2 className="animate-spin" size={17} /> : <Smartphone size={17} />}
          {connectingWhatsApp ? 'Gerando QR Code' : 'Conectar WhatsApp'}
        </button>
      </div>

      <div className="grid min-h-[680px] gap-5 xl:grid-cols-[300px_minmax(0,1fr)] 2xl:grid-cols-[300px_minmax(420px,1fr)_380px]">
        <aside className="orion-panel overflow-hidden p-0">
          <div className="border-b border-slate-200 bg-slate-950 p-5 text-white dark:border-white/10">
            <p className="text-[10px] font-black uppercase tracking-widest text-blue-300">Fila do dia</p>
            <h2 className="mt-1 text-lg font-black">Interacoes de hoje</h2>
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
                  className={`flex w-full cursor-pointer items-center gap-3 border-b border-slate-100 p-4 text-left transition dark:border-white/10 ${active ? 'bg-blue-50 text-blue-950 dark:bg-blue-500/15 dark:text-white' : 'hover:bg-slate-50 dark:hover:bg-white/5'}`}
                >
                  <span className={`h-3 w-3 shrink-0 ${status === 'feito' ? 'bg-emerald-500' : 'bg-orange-400'}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-black text-slate-900 dark:text-white">{corretor.nome}</span>
                    <span className="block truncate text-[11px] font-bold text-slate-500 dark:text-slate-300">{status === 'feito' ? 'Interacao feita' : 'Pendente hoje'}</span>
                  </span>
                  <button
                    type="button"
                    onClick={(event) => { event.stopPropagation(); toggleInteraction(corretor.id); }}
                    className={`min-w-[72px] rounded-xl px-3 py-2 text-[10px] font-black uppercase tracking-widest ${status === 'feito' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}
                  >
                    {status === 'feito' ? 'feito' : 'marcar'}
                  </button>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="orion-panel overflow-hidden p-0">
          <div className="flex flex-col gap-4 border-b border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-slate-900 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-blue-600">Cliente selecionado</p>
              <h2 className="mt-1 text-2xl font-black text-slate-950 dark:text-white">{selectedCorretor?.nome || 'Selecione um corretor'}</h2>
              <p className="text-xs font-bold text-slate-500 dark:text-slate-300">Atendimento separado por cliente, com historico e relatorio ao lado.</p>
            </div>
            <button
              onClick={connectWhatsApp}
              disabled={connectingWhatsApp}
              className="min-h-[48px] whitespace-nowrap bg-slate-950 px-5 py-3 text-xs font-black uppercase tracking-widest text-white shadow-lg shadow-slate-950/10 transition-all hover:-translate-y-0.5 hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {connectingWhatsApp ? 'Gerando QR Code...' : 'Conectar WhatsApp'}
            </button>
          </div>
          <div className="flex min-h-[580px] flex-col items-center justify-center bg-gradient-to-br from-slate-50 via-white to-blue-50 p-6 text-center dark:from-slate-950 dark:via-slate-900 dark:to-blue-950/40">
            {qrCode ? (
              <div className="w-full max-w-md border border-blue-100 bg-white p-6 shadow-xl dark:border-blue-400/20 dark:bg-slate-900">
                <QrCode className="mx-auto text-blue-600" size={34} />
                <h3 className="mt-3 text-2xl font-black text-slate-950 dark:text-white">Escaneie para conectar</h3>
                <p className="mt-2 text-sm font-bold leading-6 text-slate-500 dark:text-slate-300">
                  Abra o WhatsApp no celular, toque em aparelhos conectados e leia o QR Code.
                </p>
                <img src={qrCode.startsWith('data:') ? qrCode : `data:image/png;base64,${qrCode}`} alt="QR Code WhatsApp" className="mx-auto mt-5 h-64 w-64 bg-white object-contain p-3" />
                <button
                  type="button"
                  onClick={disconnectWhatsApp}
                  className="mt-4 w-full rounded-xl border border-red-200 bg-red-50 py-2.5 text-[11px] font-black uppercase tracking-widest text-red-600 hover:bg-red-100 transition-all cursor-pointer"
                >
                  Resetar Conexão / Gerar Novo QR Code
                </button>
              </div>
            ) : (
              <>
                <div className="flex h-20 w-20 items-center justify-center bg-blue-600 text-white shadow-2xl shadow-blue-600/25">
                  <MessageSquare size={38} />
                </div>
                <h3 className="mt-5 text-3xl font-black text-slate-900 dark:text-white">Inbox do account</h3>
                <p className="mt-3 max-w-lg text-base font-bold leading-7 text-slate-500 dark:text-slate-300">
                  Use esta central para acompanhar clientes, enviar retornos e gerar o resumo do dia com velocidade.
                </p>
                <div className="mt-7 flex flex-wrap justify-center gap-3">
                  <button className="flex cursor-pointer items-center gap-2 border border-slate-200 bg-white px-4 py-3 text-xs font-black uppercase tracking-widest text-slate-700 transition-all hover:-translate-y-0.5 hover:border-blue-200 hover:text-blue-700 dark:border-white/10 dark:bg-white/10 dark:text-white">
                    <Phone size={14} /> Ligar
                  </button>
                  <button className="flex cursor-pointer items-center gap-2 border border-slate-200 bg-white px-4 py-3 text-xs font-black uppercase tracking-widest text-slate-700 transition-all hover:-translate-y-0.5 hover:border-blue-200 hover:text-blue-700 dark:border-white/10 dark:bg-white/10 dark:text-white">
                    <RefreshCw size={14} /> Sincronizar
                  </button>
                </div>
              </>
            )}
            {connectError && (
              <div className="mt-5 max-w-xl border border-red-100 bg-red-50 px-5 py-4 text-left text-sm font-bold leading-6 text-red-700 dark:border-red-400/20 dark:bg-red-500/10 dark:text-red-200 shadow-sm">
                <p>{connectError}</p>
                <button
                  type="button"
                  onClick={disconnectWhatsApp}
                  className="mt-3 w-full rounded-xl bg-red-600 py-2.5 text-[10px] font-black uppercase tracking-widest text-white hover:bg-red-700 transition-all cursor-pointer text-center"
                >
                  Resetar Conexão (Limpar Cache do Servidor)
                </button>
              </div>
            )}
            <div className="mt-6 grid w-full max-w-2xl gap-3 sm:grid-cols-3">
              <div className="border border-blue-100 bg-white p-4 text-left dark:border-white/10 dark:bg-white/10">
                <p className="text-[10px] font-black uppercase tracking-widest text-blue-600 dark:text-blue-300">Status</p>
                <p className="mt-1 text-sm font-black text-slate-950 dark:text-white">{qrCode ? 'Aguardando leitura' : 'Pronto para conectar'}</p>
              </div>
              <div className="border border-blue-100 bg-white p-4 text-left dark:border-white/10 dark:bg-white/10">
                <p className="text-[10px] font-black uppercase tracking-widest text-blue-600 dark:text-blue-300">Hoje</p>
                <p className="mt-1 text-sm font-black text-slate-950 dark:text-white">{interactions.filter((item) => item.data === today && item.status === 'feito').length} interacoes feitas</p>
              </div>
              <div className="border border-blue-100 bg-white p-4 text-left dark:border-white/10 dark:bg-white/10">
                <p className="text-[10px] font-black uppercase tracking-widest text-blue-600 dark:text-blue-300">Clientes</p>
                <p className="mt-1 text-sm font-black text-slate-950 dark:text-white">{corretores.length} na carteira</p>
              </div>
            </div>
          </div>
        </section>

        <aside className="space-y-4 xl:col-span-2 2xl:col-span-1">
          <div className="orion-panel p-6">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-blue-600">Meta Ads</p>
                <h2 className="text-xl font-black text-slate-950">Gerar relatorio rapido</h2>
              </div>
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
                <TrendingUp size={22} />
              </div>
            </div>

            <div className="space-y-4">
              <label className="block">
                <span className="ml-1 text-[10px] font-black uppercase tracking-widest text-gray-400">Corretor / Cliente</span>
                <select
                  value={reportCorretorId}
                  onChange={(event) => setReportCorretorId(event.target.value)}
                  className="orion-control mt-2 w-full appearance-none px-5 py-4 text-sm font-black text-slate-800 outline-none"
                >
                  {corretores.map((corretor) => <option key={corretor.id} value={corretor.id}>{corretor.nome}</option>)}
                </select>
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="ml-1 text-[10px] font-black uppercase tracking-widest text-gray-400">Data Inicial</span>
                  <div className="relative mt-2">
                    <input
                      type="date"
                      value={reportDateInicio}
                      onChange={(event) => setReportDateInicio(event.target.value)}
                      className="orion-control w-full px-4 py-3.5 text-sm font-black text-slate-800 outline-none"
                    />
                  </div>
                </label>
                <label className="block">
                  <span className="ml-1 text-[10px] font-black uppercase tracking-widest text-gray-400">Data Final</span>
                  <div className="relative mt-2">
                    <input
                      type="date"
                      value={reportDateFim}
                      onChange={(event) => setReportDateFim(event.target.value)}
                      className="orion-control w-full px-4 py-3.5 text-sm font-black text-slate-800 outline-none"
                    />
                  </div>
                </label>
              </div>

              <button
                onClick={generateReport}
                disabled={loadingReport || loadingCorretores || !reportCorretorId}
                className="flex w-full cursor-pointer items-center justify-center gap-2 bg-blue-600 py-5 text-xs font-black uppercase tracking-widest text-white shadow-xl shadow-blue-600/20 transition-all hover:-translate-y-0.5 hover:bg-blue-700 disabled:opacity-50"
              >
                {loadingReport ? <Loader2 className="animate-spin" size={16} /> : null} Gerar relatorio
              </button>
            </div>

            {report && (
              <div className="mt-6 border border-blue-100 bg-blue-50 p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-blue-700">{report.corretorNome}</p>
                <p className="mt-1 text-xs font-bold text-blue-700/70">
                  {report.dateInicio === report.dateFim
                    ? new Date(`${report.dateInicio}T12:00:00`).toLocaleDateString('pt-BR')
                    : `${new Date(`${report.dateInicio}T12:00:00`).toLocaleDateString('pt-BR')} até ${new Date(`${report.dateFim}T12:00:00`).toLocaleDateString('pt-BR')}`
                  }
                </p>

                <div className="mt-4 grid grid-cols-1 gap-3">
                  <Metric icon={Users} label="Leads" value={String(report.leads)} />
                  <Metric icon={DollarSign} label="Investimento" value={new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(report.spend)} />
                  <Metric icon={TrendingUp} label="CPL medio" value={report.cpl === null ? 'N/A' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(report.cpl)} highlight />
                </div>

                <button onClick={copyReport} className="mt-4 flex w-full cursor-pointer items-center justify-center gap-2 bg-slate-950 py-4 text-xs font-black uppercase tracking-widest text-white transition-all hover:-translate-y-0.5 hover:bg-black">
                  <Copy size={14} /> Copiar pronto
                </button>
              </div>
            )}
          </div>

          <div className="orion-panel p-5">
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
                  <div key={interaction.id} className="flex items-center gap-2 border border-slate-100 bg-slate-50 p-3 text-xs font-bold text-slate-600">
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

function Metric({ label, value, icon: Icon, highlight = false }: { label: string; value: string; icon: React.ElementType; highlight?: boolean }) {
  return (
    <div className={`p-4 ${highlight ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' : 'bg-white text-slate-950'}`}>
      <p className={`flex items-center gap-2 text-[9px] font-black uppercase tracking-widest ${highlight ? 'text-blue-100' : 'text-slate-400'}`}>
        <Icon size={12} /> {label}
      </p>
      <p className="mt-2 text-lg font-black">{value}</p>
    </div>
  );
}
