'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import { supabase } from '@/lib/supabase/client';
import { Corretor, MetaAdAccount, MetaCampaign, MetaMetricaDiaria } from '@/types';
import {
  BarChart3,
  CheckCircle2,
  Link2,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Target,
  Zap
} from 'lucide-react';

const emptyAccount = {
  meta_account_id: '',
  nome: '',
  currency: 'BRL',
  timezone_name: 'America/Sao_Paulo',
  status: 'ativo',
};

function money(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export default function AdminMetaPage() {
  const [accounts, setAccounts] = useState<MetaAdAccount[]>([]);
  const [corretores, setCorretores] = useState<Corretor[]>([]);
  const [campaigns, setCampaigns] = useState<MetaCampaign[]>([]);
  const [metrics, setMetrics] = useState<MetaMetricaDiaria[]>([]);
  const [form, setForm] = useState(emptyAccount);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function fetchData() {
    setLoading(true);
    setError(null);

    const [accountsRes, corretoresRes, campaignsRes, metricsRes] = await Promise.all([
      supabase.from('meta_ad_accounts').select('*').order('nome'),
      supabase.from('corretores').select('*').order('nome'),
      supabase.from('meta_campaigns').select('*').order('nome').limit(100),
      supabase.from('meta_metricas_diarias').select('*').order('data', { ascending: false }).limit(100),
    ]);

    const firstError = accountsRes.error || corretoresRes.error || campaignsRes.error || metricsRes.error;
    if (firstError) {
      setError(firstError.message);
    } else {
      setAccounts((accountsRes.data || []) as MetaAdAccount[]);
      setCorretores((corretoresRes.data || []) as Corretor[]);
      setCampaigns((campaignsRes.data || []) as MetaCampaign[]);
      setMetrics((metricsRes.data || []) as MetaMetricaDiaria[]);
    }

    setLoading(false);
  }

  useEffect(() => {
    void fetchData();
  }, []);

  const totals = useMemo(() => {
    return metrics.reduce(
      (acc, metric) => {
        acc.spend += Number(metric.spend || 0);
        acc.leads += Number(metric.leads || 0);
        acc.clicks += Number(metric.clicks || 0);
        acc.impressions += Number(metric.impressions || 0);
        return acc;
      },
      { spend: 0, leads: 0, clicks: 0, impressions: 0 }
    );
  }, [metrics]);

  const filteredCorretores = corretores.filter((corretor) => {
    const target = `${corretor.nome} ${corretor.email} ${corretor.meta_ad_account_name || ''}`.toLowerCase();
    return target.includes(search.toLowerCase());
  });

  async function createAccount(event: FormEvent) {
    event.preventDefault();
    if (!form.meta_account_id.trim() || !form.nome.trim()) return;

    setSaving(true);
    setError(null);
    setSuccess(null);

    const { error: insertError } = await supabase.from('meta_ad_accounts').upsert({
      meta_account_id: form.meta_account_id.trim().replace(/^act_/, ''),
      nome: form.nome.trim(),
      currency: form.currency || null,
      timezone_name: form.timezone_name || null,
      status: form.status || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'meta_account_id' });

    setSaving(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }

    setForm(emptyAccount);
    setSuccess('Conta Meta salva. Agora voce ja pode vincular a um corretor.');
    await fetchData();
  }

  async function bindAccount(corretor: Corretor, accountId: string) {
    const account = accounts.find((item) => item.meta_account_id === accountId);

    const { error: updateError } = await supabase
      .from('corretores')
      .update({
        meta_ad_account_id: account?.meta_account_id || null,
        meta_ad_account_name: account?.nome || null,
      })
      .eq('id', corretor.id);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setSuccess(account ? `${corretor.nome} vinculado a ${account.nome}.` : `Conta removida de ${corretor.nome}.`);
    await fetchData();
  }

  return (
    <InternalLayout>
      <div className="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-blue-600">Integrações</p>
          <h1 className="text-3xl font-black tracking-tight text-gray-900">Meta Ads Orion</h1>
          <p className="font-medium text-gray-500">Mapeie contas de anúncio por corretor e prepare a sincronização de métricas.</p>
        </div>
        <button
          onClick={fetchData}
          className="flex items-center justify-center gap-2 rounded-2xl border border-gray-100 bg-white px-5 py-3 text-sm font-black text-slate-600 shadow-sm transition-all hover:bg-slate-50"
        >
          <RefreshCw size={16} /> Atualizar
        </button>
      </div>

      {error && <div className="mb-6 rounded-2xl border border-red-100 bg-red-50 p-4 text-sm font-bold text-red-600">{error}</div>}
      {success && <div className="mb-6 rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-sm font-bold text-emerald-700">{success}</div>}

      <div className="mb-8 grid gap-4 md:grid-cols-4">
        <Stat icon={ShieldCheck} label="Contas cadastradas" value={String(accounts.length)} tone="blue" />
        <Stat icon={Target} label="Corretores vinculados" value={String(corretores.filter((item) => item.meta_ad_account_id).length)} tone="emerald" />
        <Stat icon={Zap} label="Criativos/campanhas" value={String(campaigns.length)} tone="amber" />
        <Stat icon={BarChart3} label="Investimento sincronizado" value={money(totals.spend)} tone="slate" />
      </div>

      <div className="mb-8 rounded-[2rem] border border-blue-100 bg-blue-50 p-6">
        <div className="grid gap-5 lg:grid-cols-[1fr_360px] lg:items-center">
          <div>
            <h2 className="mb-2 text-xl font-black text-blue-950">Como isso vai funcionar no CRM completo</h2>
            <p className="max-w-3xl text-sm font-bold leading-relaxed text-blue-800">
              A Orion conecta o portfólio Meta uma vez. O sistema puxa somente as contas de anúncio que a Orion tem acesso, salva a lista aqui e o admin vincula cada conta ao corretor certo. Depois a rotina de sincronização busca investimento, CPL, campanhas e nomes dos criativos sem passar pelo n8n.
            </p>
          </div>
          <div className="rounded-[1.5rem] bg-white p-4 text-sm font-black text-blue-950 shadow-sm">
            Proximo passo tecnico: criar OAuth/token do Meta no backend e o endpoint seguro de sincronização.
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[380px_1fr]">
        <div className="rounded-[2rem] border border-gray-100 bg-white p-6 shadow-sm">
          <h2 className="mb-5 flex items-center gap-2 text-lg font-black text-gray-900">
            <Plus size={18} className="text-blue-600" /> Conta de anúncio
          </h2>
          <form onSubmit={createAccount} className="space-y-4">
            <Field label="ID da conta Meta">
              <input
                value={form.meta_account_id}
                onChange={(e) => setForm((prev) => ({ ...prev, meta_account_id: e.target.value }))}
                placeholder="Ex: act_123456789 ou 123456789"
                className="w-full rounded-2xl border-none bg-slate-50 px-4 py-4 text-sm font-bold focus:ring-2 focus:ring-blue-500/20"
              />
            </Field>
            <Field label="Nome da conta">
              <input
                value={form.nome}
                onChange={(e) => setForm((prev) => ({ ...prev, nome: e.target.value }))}
                placeholder="Ex: Leonardo Corretor"
                className="w-full rounded-2xl border-none bg-slate-50 px-4 py-4 text-sm font-bold focus:ring-2 focus:ring-blue-500/20"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Moeda">
                <input
                  value={form.currency}
                  onChange={(e) => setForm((prev) => ({ ...prev, currency: e.target.value }))}
                  className="w-full rounded-2xl border-none bg-slate-50 px-4 py-4 text-sm font-bold focus:ring-2 focus:ring-blue-500/20"
                />
              </Field>
              <Field label="Status">
                <select
                  value={form.status}
                  onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value }))}
                  className="w-full rounded-2xl border-none bg-slate-50 px-4 py-4 text-sm font-bold focus:ring-2 focus:ring-blue-500/20"
                >
                  <option value="ativo">Ativo</option>
                  <option value="pausado">Pausado</option>
                  <option value="inativo">Inativo</option>
                </select>
              </Field>
            </div>
            <button
              disabled={saving}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 py-4 text-sm font-black text-white shadow-lg shadow-blue-600/20 transition-all hover:bg-blue-700 disabled:opacity-60"
            >
              {saving ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle2 size={16} />} Salvar conta
            </button>
          </form>

          <div className="mt-6 rounded-[1.5rem] border border-dashed border-gray-200 p-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Contas disponíveis</p>
            <div className="mt-3 space-y-2">
              {accounts.map((account) => (
                <div key={account.id} className="rounded-2xl bg-slate-50 p-3">
                  <p className="text-sm font-black text-gray-900">{account.nome}</p>
                  <p className="text-xs font-bold text-slate-500">act_{account.meta_account_id}</p>
                </div>
              ))}
              {!loading && accounts.length === 0 && <p className="text-sm font-bold text-slate-400">Nenhuma conta cadastrada ainda.</p>}
            </div>
          </div>
        </div>

        <div className="rounded-[2rem] border border-gray-100 bg-white shadow-sm">
          <div className="border-b border-gray-50 p-5">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-lg font-black text-gray-900">Vincular corretor</h2>
                <p className="text-sm font-bold text-slate-500">Cada corretor pode receber uma conta Meta principal.</p>
              </div>
              <div className="relative w-full md:w-80">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar corretor..."
                  className="w-full rounded-2xl border-none bg-slate-50 py-3 pl-11 pr-4 text-sm font-bold focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
            </div>
          </div>

          <div className="divide-y divide-gray-50">
            {loading ? (
              <div className="flex justify-center py-20"><Loader2 className="animate-spin text-blue-600" /></div>
            ) : filteredCorretores.map((corretor) => (
              <div key={corretor.id} className="grid gap-4 p-5 lg:grid-cols-[1fr_320px] lg:items-center">
                <div>
                  <p className="font-black text-gray-900">{corretor.nome}</p>
                  <p className="text-sm font-bold text-slate-500">{corretor.email}</p>
                  {corretor.meta_ad_account_name && (
                    <p className="mt-2 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-black uppercase tracking-widest text-emerald-700">
                      <Link2 size={12} /> {corretor.meta_ad_account_name}
                    </p>
                  )}
                </div>
                <select
                  value={corretor.meta_ad_account_id || ''}
                  onChange={(e) => bindAccount(corretor, e.target.value)}
                  className="w-full rounded-2xl border-none bg-slate-50 px-4 py-4 text-sm font-black text-slate-700 focus:ring-2 focus:ring-blue-500/20"
                >
                  <option value="">Sem conta vinculada</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.meta_account_id}>{account.nome}</option>
                  ))}
                </select>
              </div>
            ))}
            {!loading && filteredCorretores.length === 0 && (
              <div className="p-10 text-center text-sm font-bold text-slate-400">Nenhum corretor encontrado.</div>
            )}
          </div>
        </div>
      </div>
    </InternalLayout>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-[10px] font-black uppercase tracking-widest text-gray-400">{label}</span>
      {children}
    </label>
  );
}

function Stat({ icon: Icon, label, value, tone }: { icon: typeof BarChart3; label: string; value: string; tone: 'blue' | 'emerald' | 'amber' | 'slate' }) {
  const tones = {
    blue: 'border-blue-100 bg-blue-50 text-blue-700',
    emerald: 'border-emerald-100 bg-emerald-50 text-emerald-700',
    amber: 'border-amber-100 bg-amber-50 text-amber-700',
    slate: 'border-gray-100 bg-white text-slate-600',
  };

  return (
    <div className={`rounded-[2rem] border p-5 shadow-sm ${tones[tone]}`}>
      <p className="mb-3 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest">
        <Icon size={15} /> {label}
      </p>
      <p className="text-2xl font-black text-gray-950">{value}</p>
    </div>
  );
}
