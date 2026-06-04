'use client';

import { useEffect, useMemo, useState } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import { useAuth } from '@/components/providers/AuthProvider';
import { supabase } from '@/lib/supabase/client';
import { Corretor, MetaAdAccount } from '@/types';
import { AlertTriangle, CheckCircle2, Link2, Loader2, RefreshCw, Search, ShieldCheck, Unlink, Zap } from 'lucide-react';

export default function AdminMetaPage() {
  const { actualProfile } = useAuth();
  const [accounts, setAccounts] = useState<MetaAdAccount[]>([]);
  const [corretores, setCorretores] = useState<Corretor[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const isAdmin = actualProfile?.tipo_usuario === 'admin';

  async function fetchData() {
    if (!isAdmin) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const [accountsRes, corretoresRes] = await Promise.all([
      supabase.from('meta_ad_accounts').select('*').order('nome'),
      supabase.from('corretores').select('*').order('nome'),
    ]);

    const firstError = accountsRes.error || corretoresRes.error;
    if (firstError) {
      setError(firstError.message);
    } else {
      setAccounts((accountsRes.data || []) as MetaAdAccount[]);
      setCorretores((corretoresRes.data || []) as Corretor[]);
    }

    setLoading(false);
  }

  useEffect(() => {
    void fetchData();
  }, [isAdmin]);

  const filteredCorretores = useMemo(() => {
    const term = search.toLowerCase();
    return corretores.filter((corretor) =>
      `${corretor.nome} ${corretor.email} ${corretor.meta_ad_account_name || ''}`.toLowerCase().includes(term)
    );
  }, [corretores, search]);

  const linkedCorretores = filteredCorretores.filter((corretor) => corretor.meta_ad_account_id);
  const unlinkedCorretores = filteredCorretores.filter((corretor) => !corretor.meta_ad_account_id);
  const linkedAccountIds = new Set(corretores.map((corretor) => corretor.meta_ad_account_id).filter(Boolean));
  const unlinkedAccounts = accounts.filter((account) => !linkedAccountIds.has(account.meta_account_id));

  async function syncMetaAccounts() {
    setSyncing(true);
    setError(null);
    setSuccess(null);

    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      setError('Sessao expirada. Entre novamente.');
      setSyncing(false);
      return;
    }

    const response = await fetch('/api/integrations/meta/accounts', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const payload = await response.json();

    setSyncing(false);
    if (!response.ok) {
      setError(payload.error || 'Erro ao sincronizar contas Meta.');
      return;
    }

    setSuccess(`${payload.count || 0} conta(s) Meta sincronizada(s).`);
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

  if (!isAdmin) {
    return (
      <InternalLayout>
        <div className="rounded-[2rem] border border-amber-100 bg-amber-50 p-8">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-amber-600">
            <ShieldCheck size={26} />
          </div>
          <h1 className="text-2xl font-black text-amber-950">Acesso restrito</h1>
          <p className="mt-2 text-sm font-bold text-amber-800">A tela de contas Meta fica disponivel apenas para administradores.</p>
        </div>
      </InternalLayout>
    );
  }

  return (
    <InternalLayout>
      <div className="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-blue-600">Admin Orion</p>
          <h1 className="text-3xl font-black tracking-tight text-gray-900">Contas Meta</h1>
          <p className="font-medium text-gray-500">Controle quais contas de anuncio estao vinculadas aos corretores.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={syncMetaAccounts}
            disabled={syncing}
            className="flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 py-3 text-sm font-black text-white shadow-lg shadow-blue-600/20 transition-all hover:bg-blue-700 disabled:opacity-60"
          >
            {syncing ? <Loader2 className="animate-spin" size={16} /> : <Zap size={16} />} Sincronizar contas
          </button>
          <button
            onClick={fetchData}
            className="flex items-center justify-center gap-2 rounded-2xl border border-gray-100 bg-white px-5 py-3 text-sm font-black text-slate-600 shadow-sm transition-all hover:bg-slate-50"
          >
            <RefreshCw size={16} /> Atualizar
          </button>
        </div>
      </div>

      {error && <div className="mb-6 rounded-2xl border border-red-100 bg-red-50 p-4 text-sm font-bold text-red-600">{error}</div>}
      {success && <div className="mb-6 rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-sm font-bold text-emerald-700">{success}</div>}

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <Counter label="Contas sincronizadas" value={accounts.length} tone="blue" />
        <Counter label="Corretores vinculados" value={corretores.filter((corretor) => corretor.meta_ad_account_id).length} tone="emerald" />
        <Counter label="Corretores sem conta" value={corretores.filter((corretor) => !corretor.meta_ad_account_id).length} tone="amber" />
      </div>

      <div className="mb-6 rounded-[2rem] border border-gray-100 bg-white p-5 shadow-sm">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar corretor ou conta..."
            className="w-full rounded-2xl border-none bg-slate-50 py-4 pl-11 pr-4 text-sm font-bold focus:ring-2 focus:ring-blue-500/20"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center rounded-[2rem] bg-white py-24 shadow-sm">
          <Loader2 className="animate-spin text-blue-600" size={42} />
        </div>
      ) : (
        <div className="grid gap-6 xl:grid-cols-2">
          <section className="rounded-[2rem] border border-emerald-100 bg-white shadow-sm">
            <div className="border-b border-gray-50 p-5">
              <h2 className="flex items-center gap-2 text-lg font-black text-gray-900">
                <CheckCircle2 size={18} className="text-emerald-600" /> Vinculados
              </h2>
            </div>
            <div className="divide-y divide-gray-50">
              {linkedCorretores.map((corretor) => (
                <AccountRow key={corretor.id} corretor={corretor} accounts={accounts} onChange={bindAccount} />
              ))}
              {linkedCorretores.length === 0 && <Empty text="Nenhum corretor vinculado ainda." />}
            </div>
          </section>

          <section className="rounded-[2rem] border border-amber-100 bg-white shadow-sm">
            <div className="border-b border-gray-50 p-5">
              <h2 className="flex items-center gap-2 text-lg font-black text-gray-900">
                <AlertTriangle size={18} className="text-amber-500" /> Sem conta vinculada
              </h2>
            </div>
            <div className="divide-y divide-gray-50">
              {unlinkedCorretores.map((corretor) => (
                <AccountRow key={corretor.id} corretor={corretor} accounts={accounts} onChange={bindAccount} />
              ))}
              {unlinkedCorretores.length === 0 && <Empty text="Todos os corretores filtrados estao vinculados." />}
            </div>
          </section>

          <section className="rounded-[2rem] border border-gray-100 bg-white p-5 shadow-sm xl:col-span-2">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-black text-gray-900">
              <Unlink size={18} className="text-slate-500" /> Contas Meta ainda sem corretor
            </h2>
            <div className="grid gap-3 md:grid-cols-3">
              {unlinkedAccounts.map((account) => (
                <div key={account.id} className="rounded-2xl border border-gray-100 bg-slate-50 p-4">
                  <p className="font-black text-gray-900">{account.nome}</p>
                  <p className="mt-1 text-xs font-bold text-slate-500">act_{account.meta_account_id}</p>
                </div>
              ))}
              {unlinkedAccounts.length === 0 && <p className="text-sm font-bold text-slate-400">Nenhuma conta sobrando sem corretor.</p>}
            </div>
          </section>
        </div>
      )}
    </InternalLayout>
  );
}

function AccountRow({ corretor, accounts, onChange }: { corretor: Corretor; accounts: MetaAdAccount[]; onChange: (corretor: Corretor, accountId: string) => void }) {
  return (
    <div className="grid gap-4 p-5 lg:grid-cols-[1fr_280px] lg:items-center">
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
        onChange={(event) => onChange(corretor, event.target.value)}
        className="w-full rounded-2xl border-none bg-slate-50 px-4 py-4 text-sm font-black text-slate-700 focus:ring-2 focus:ring-blue-500/20"
      >
        <option value="">Sem conta vinculada</option>
        {accounts.map((account) => (
          <option key={account.id} value={account.meta_account_id}>{account.nome}</option>
        ))}
      </select>
    </div>
  );
}

function Counter({ label, value, tone }: { label: string; value: number; tone: 'blue' | 'emerald' | 'amber' }) {
  const colors = {
    blue: 'border-blue-100 bg-blue-50 text-blue-700',
    emerald: 'border-emerald-100 bg-emerald-50 text-emerald-700',
    amber: 'border-amber-100 bg-amber-50 text-amber-700',
  };

  return (
    <div className={`rounded-[2rem] border p-5 shadow-sm ${colors[tone]}`}>
      <p className="mb-2 text-[10px] font-black uppercase tracking-widest">{label}</p>
      <p className="text-3xl font-black text-gray-950">{value}</p>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="p-8 text-center text-sm font-bold text-slate-400">{text}</div>;
}
