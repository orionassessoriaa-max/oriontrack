'use client';

import { useEffect, useMemo, useState } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import { useAuth } from '@/components/providers/AuthProvider';
import { supabase } from '@/lib/supabase/client';
import { Corretor, MetaAdAccount } from '@/types';
import { getOnboardingStatus, OPERADORAS_ONBOARDING } from '@/lib/onboarding';
import { Building2, CheckCircle2, Layers3, Link2, Loader2, Plus, Save, Search, ShieldAlert, Trash2, Unlink, UserPlus } from 'lucide-react';
import { isGestorLinkedToConcessionariaCorretor } from '@/lib/gestorAccess';

type EntradaForm = {
  facebook_login: string;
  facebook_senha: string;
  regioes_campanha: string;
  campanhas_ativas: boolean;
  operadoras: string[];
  operadora_outros: string;
  observacoes: string;
};

const emptyForm: EntradaForm = {
  facebook_login: '',
  facebook_senha: '',
  regioes_campanha: '',
  campanhas_ativas: false,
  operadoras: [],
  operadora_outros: '',
  observacoes: ''
};

type StrategyEntry = { id: string; operadora: string; regiao: string };
const REGION_OPTIONS = ['SP', 'DF', 'RJ', 'MG', 'PR', 'SC', 'RS', 'GO', 'BA', 'PE', 'CE', 'Outros'];

export default function EntradaGestorPage() {
  const { profile, actualProfile } = useAuth();
  const [corretores, setCorretores] = useState<Corretor[]>([]);
  const [metaAccounts, setMetaAccounts] = useState<MetaAdAccount[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [search, setSearch] = useState('');
  const [formData, setFormData] = useState<EntradaForm>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [strategies, setStrategies] = useState<StrategyEntry[]>([]);
  const [operatorChoice, setOperatorChoice] = useState('');
  const [operatorOther, setOperatorOther] = useState('');
  const [regionChoice, setRegionChoice] = useState('');
  const [regionOther, setRegionOther] = useState('');
  const [metaAccountId, setMetaAccountId] = useState('');
  const [linkingMeta, setLinkingMeta] = useState(false);
  const [metaFeedback, setMetaFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    void fetchCorretores();
    const refresh = () => void fetchCorretores(true);
    const interval = window.setInterval(refresh, 60_000);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
    };
  }, [profile?.id]);

  const selectedCorretor = corretores.find(c => c.id === selectedId) || null;
  const selectedStatus = selectedCorretor ? getOnboardingStatus(selectedCorretor) : null;

  const concessionarias = useMemo(() => {
    const byName = new Map<string, Corretor>();
    corretores.forEach((corretor) => {
      const name = String(corretor.nome_empresa || '').trim();
      if (!name) return;
      const key = name.toLocaleLowerCase('pt-BR');
      const existing = byName.get(key);
      if (!existing || (!existing.meta_ad_account_id && corretor.meta_ad_account_id)) {
        byName.set(key, corretor);
      }
    });
    return Array.from(byName.values()).sort((a, b) => {
      const accountOrder = Number(Boolean(a.meta_ad_account_id)) - Number(Boolean(b.meta_ad_account_id));
      if (accountOrder !== 0) return accountOrder;
      return String(a.nome_empresa).localeCompare(String(b.nome_empresa), 'pt-BR');
    });
  }, [corretores]);

  const filteredCorretores = useMemo(() => {
    return concessionarias.filter(c =>
      (c.nome_empresa || '').toLowerCase().includes(search.toLowerCase()) ||
      (c.nome || '').toLowerCase().includes(search.toLowerCase()) ||
      (c.email || '').toLowerCase().includes(search.toLowerCase())
    );
  }, [concessionarias, search]);

  const fetchCorretores = async (silent = false) => {
    if (!profile?.id) {
      setLoading(false);
      return;
    }

    if (!silent) setLoading(true);
    setError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error('Sessao expirada.');
      const [corretoresResponse, accountsResponse] = await Promise.all([
        fetch('/api/corretores/options', {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        }),
        fetch('/api/integrations/meta/accounts', {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        }),
      ]);
      const [corretoresPayload, accountsPayload] = await Promise.all([
        corretoresResponse.json().catch(() => ({})),
        accountsResponse.json().catch(() => ({})),
      ]);
      if (!corretoresResponse.ok) throw new Error(corretoresPayload.error || 'Erro ao carregar concessionarias.');
      if (!accountsResponse.ok) throw new Error(accountsPayload.error || 'Erro ao carregar contas Meta.');

      let filtered = (corretoresPayload.corretores || []) as Corretor[];
      filtered = filtered.filter((item) => ['active', 'ativo', 'Ativo'].includes(item.status));
      if (profile.tipo_usuario === 'gestor_trafego') {
        filtered = filtered.filter(c => isGestorLinkedToConcessionariaCorretor(c, profile));
      }

      setCorretores(filtered);
      setMetaAccounts((accountsPayload.accounts || []) as MetaAdAccount[]);
    } catch (err: unknown) {
      console.error('Erro ao carregar entrada:', err);
      setError(err instanceof Error ? err.message : 'Nao foi possivel carregar as concessionarias vinculadas.');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const selectCorretor = async (corretor: Corretor) => {
    setSelectedId(corretor.id);
    setSaved(false);
    setMetaFeedback(null);
    setMetaAccountId(corretor.meta_ad_account_id || '');
    const selectedOperadoras = Array.isArray(corretor.operadoras_info?.selecionadas)
      ? corretor.operadoras_info.selecionadas
      : Object.entries(corretor.operadoras_info || {})
          .filter(([, value]) => Boolean(value))
          .map(([key]) => key);
    const customOperadora = selectedOperadoras.find((item) => !OPERADORAS_ONBOARDING.includes(item));

    setFormData({
      facebook_login: corretor.facebook_login || '',
      facebook_senha: corretor.facebook_senha || '',
      regioes_campanha: corretor.regioes_campanha || '',
      campanhas_ativas: Boolean(corretor.campanhas_ativas),
      operadoras: customOperadora
        ? [...selectedOperadoras.filter((item) => item !== customOperadora), 'Outros']
        : selectedOperadoras,
      operadora_outros: customOperadora || '',
      observacoes: corretor.observacoes || ''
    });
    setOperatorChoice('');
    setOperatorOther('');
    setRegionChoice('');
    setRegionOther('');
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) return setStrategies([]);
    const params = new URLSearchParams({ corretor_id: corretor.id });
    if (actualProfile?.tipo_usuario === 'admin' && profile?.tipo_usuario === 'gestor_trafego') {
      params.set('gestor_id', profile.id);
    }
    const response = await fetch(`/api/trafego/estrategias?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const payload = await response.json().catch(() => ({}));
    setStrategies((payload.estrategias || []).map((item: StrategyEntry) => ({
      id: item.id,
      operadora: item.operadora,
      regiao: item.regiao,
    })));
  };

  const bindMetaAccount = async () => {
    if (!selectedCorretor) return;
    setLinkingMeta(true);
    setMetaFeedback(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error('Sessao expirada. Entre novamente.');
      const response = await fetch('/api/integrations/meta/accounts', {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          corretor_id: selectedCorretor.id,
          meta_account_id: metaAccountId || null,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Nao foi possivel vincular a conta.');

      const companyName = String(selectedCorretor.nome_empresa || '').trim().toLocaleLowerCase('pt-BR');
      setCorretores((current) => current.map((item) => (
        String(item.nome_empresa || '').trim().toLocaleLowerCase('pt-BR') === companyName
          ? {
              ...item,
              meta_ad_account_id: payload.meta_ad_account_id,
              meta_ad_account_name: payload.meta_ad_account_name,
            }
          : item
      )));
      setMetaFeedback({
        tone: 'success',
        message: payload.meta_ad_account_id
          ? `Conta ${payload.meta_ad_account_name} vinculada com sucesso.`
          : 'Conta de anuncios removida desta concessionaria.',
      });
    } catch (bindError: unknown) {
      setMetaFeedback({
        tone: 'error',
        message: bindError instanceof Error ? bindError.message : 'Erro ao vincular conta de anuncios.',
      });
    } finally {
      setLinkingMeta(false);
    }
  };

  const dataComplete = Boolean(
    formData.facebook_login.trim() &&
    formData.facebook_senha.trim() &&
    strategies.length > 0
  );

  const addStrategy = () => {
    const operadora = operatorChoice === 'Outros' ? operatorOther.trim() : operatorChoice;
    const regiao = regionChoice === 'Outros' ? regionOther.trim() : regionChoice;
    if (!operadora || !regiao) return setError('Escolha ou informe a operadora e a regiao.');
    if (strategies.some((item) =>
      item.operadora.localeCompare(operadora, 'pt-BR', { sensitivity: 'base' }) === 0
      && item.regiao.localeCompare(regiao, 'pt-BR', { sensitivity: 'base' }) === 0
    )) {
      return setError('Essa combinacao de operadora e regiao ja foi adicionada.');
    }
    setError(null);
    setStrategies((current) => [...current, { id: `new-${crypto.randomUUID()}`, operadora, regiao }]);
    setOperatorChoice('');
    setOperatorOther('');
    setRegionChoice('');
    setRegionOther('');
  };

  const saveEntrada = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedId) return;

    setSaving(true);
    setSaved(false);
    const onboarding_status = formData.campanhas_ativas
      ? 'campanhas_ativas'
      : dataComplete
        ? 'dados_completos'
        : 'pendente';

    if (!strategies.length) {
      setSaving(false);
      return setError('Adicione pelo menos uma combinacao de operadora e regiao.');
    }
    const operadoras = Array.from(new Set(strategies.map((item) => item.operadora)));
    const regioes = Array.from(new Set(strategies.map((item) => item.regiao)));

    const { error: updateError } = await supabase
      .from('corretores')
      .update({
        facebook_login: formData.facebook_login || null,
        facebook_senha: formData.facebook_senha || null,
        regioes_campanha: regioes.join(', ') || null,
        operadoras_info: { selecionadas: operadoras },
        campanhas_ativas: formData.campanhas_ativas,
        onboarding_status,
        observacoes: formData.observacoes || null,
      })
      .eq('id', selectedId);

    if (updateError) {
      setSaving(false);
      alert('Erro ao salvar entrada: ' + updateError.message);
      return;
    }

    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) {
      setSaving(false);
      return setError('Sessao expirada ao sincronizar a estrategia.');
    }
    const strategyResponse = await fetch('/api/trafego/estrategias', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        corretor_id: selectedId,
        gestor_id: actualProfile?.tipo_usuario === 'admin' && profile?.tipo_usuario === 'gestor_trafego'
          ? profile.id
          : undefined,
        estrategias: strategies.map(({ operadora, regiao }) => ({ operadora, regiao })),
        briefing: formData.observacoes,
      }),
    });
    const strategyPayload = await strategyResponse.json().catch(() => ({}));
    setSaving(false);
    if (!strategyResponse.ok) return setError(strategyPayload.error || 'Entrada salva, mas a estrategia nao foi sincronizada.');
    setSaved(true);
    setCorretores(prev => prev.map(c => c.id === selectedId ? {
      ...c,
      facebook_login: formData.facebook_login,
      facebook_senha: formData.facebook_senha,
      regioes_campanha: regioes.join(', '),
      campanhas_ativas: formData.campanhas_ativas,
      operadoras_info: { selecionadas: operadoras },
      onboarding_status,
      observacoes: formData.observacoes,
    } : c));
  };

  return (
    <InternalLayout>
      <div className="mb-10 overflow-hidden rounded-[28px] border border-cyan-400/15 bg-[radial-gradient(circle_at_top_right,rgba(6,182,212,0.16),transparent_38%),linear-gradient(135deg,#071521,#0b172b_58%,#07111f)] p-6 shadow-xl shadow-slate-950/20 sm:p-8">
        <div className="mb-3 flex items-center gap-2 text-cyan-400">
          <Building2 size={18} />
          <span className="text-[10px] font-black uppercase tracking-[0.2em]">Fila de onboarding</span>
        </div>
        <h1 className="text-3xl font-black tracking-tight text-white sm:text-4xl">Entrada das concessionárias</h1>
        <p className="mt-3 max-w-3xl text-sm font-semibold leading-6 text-slate-300 sm:text-base">
          Toda concessionária atribuída pelo admin chega automaticamente aqui. Vincule a conta de anúncios e conclua a entrada operacional.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-3">
        <div className="rounded-[2.5rem] border border-gray-100 bg-white p-6 shadow-sm">
          <div className="relative mb-5">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar concessionária..."
              className="w-full rounded-2xl border-none bg-slate-50 py-4 pl-12 pr-4 text-sm font-bold focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {loading ? (
            <div className="flex justify-center py-20">
              <Loader2 className="animate-spin text-blue-600" size={36} />
            </div>
          ) : error ? (
            <div className="rounded-2xl bg-red-50 p-6 text-center font-bold text-red-600">
              <ShieldAlert className="mx-auto mb-3" />
              {error}
            </div>
          ) : filteredCorretores.length === 0 ? (
            <div className="py-16 text-center font-bold text-gray-400">Nenhuma concessionária atribuída a este gestor.</div>
          ) : (
            <div className="space-y-3">
              {filteredCorretores.map(corretor => {
                const status = getOnboardingStatus(corretor);
                return (
                  <button
                    key={corretor.id}
                    onClick={() => selectCorretor(corretor)}
                    className={`w-full rounded-2xl border p-4 text-left transition-all hover:border-blue-200 hover:bg-blue-50/40 ${
                      selectedId === corretor.id ? 'border-blue-200 bg-blue-50' : 'border-gray-100 bg-white'
                    }`}
                  >
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <div>
                        <p className="font-black text-gray-900">{corretor.nome_empresa || corretor.nome}</p>
                        <p className="text-xs font-bold text-gray-400">{corretor.meta_ad_account_name || 'Conta de anúncios pendente'}</p>
                      </div>
                      <span className={`mt-1 h-2.5 w-2.5 rounded-full ${status.dot}`} />
                    </div>
                    <span className={`inline-flex rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-widest ${status.className}`}>
                      {status.label}
                    </span>
                    <span className={`ml-2 inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-widest ${
                      corretor.meta_ad_account_id
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : 'border-amber-200 bg-amber-50 text-amber-700'
                    }`}>
                      {corretor.meta_ad_account_id ? <Link2 size={11} /> : <Unlink size={11} />}
                      {corretor.meta_ad_account_id ? 'Meta conectada' : 'Conectar Meta'}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="xl:col-span-2">
          {!selectedCorretor ? (
            <div className="flex min-h-[480px] items-center justify-center rounded-[2.5rem] border border-dashed border-slate-200 bg-slate-50 text-center">
              <div>
                <UserPlus className="mx-auto mb-4 text-slate-300" size={42} />
                <p className="font-black text-slate-400">Selecione uma concessionária para iniciar a entrada.</p>
              </div>
            </div>
          ) : (
            <form onSubmit={saveEntrada} className="rounded-[2.5rem] border border-gray-100 bg-white p-8 shadow-sm">
              <div className="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-start">
                <div>
                  <h2 className="text-2xl font-black text-gray-900">{selectedCorretor.nome_empresa || selectedCorretor.nome}</h2>
                  <p className="font-medium text-gray-500">Responsável cadastrado: {selectedCorretor.nome}</p>
                </div>
                {selectedStatus && (
                  <span className={`rounded-full border px-4 py-2 text-[10px] font-black uppercase tracking-widest ${selectedStatus.className}`}>
                    {selectedStatus.label}
                  </span>
                )}
              </div>

              {saved && (
                <div className="mb-6 flex items-center gap-3 rounded-2xl border border-green-100 bg-green-50 p-4 text-sm font-bold text-green-700">
                  <CheckCircle2 size={18} /> Entrada salva com sucesso.
                </div>
              )}

              <section className="mb-8 rounded-3xl border border-cyan-100 bg-cyan-50/60 p-5 sm:p-6">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                  <div className="max-w-xl">
                    <div className="flex items-center gap-2 text-cyan-700">
                      <Link2 size={18} />
                      <h3 className="text-base font-black">Conta de anúncios da concessionária</h3>
                    </div>
                    <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">
                      Escolha a conta Meta correta. O vínculo será aplicado a toda a concessionária e ficará visível também para o admin em Meta Ads.
                    </p>
                  </div>
                  {selectedCorretor.meta_ad_account_name && (
                    <span className="inline-flex w-fit items-center gap-2 rounded-full border border-emerald-200 bg-white px-4 py-2 text-xs font-black text-emerald-700">
                      <CheckCircle2 size={15} />
                      {selectedCorretor.meta_ad_account_name}
                    </span>
                  )}
                </div>
                <div className="mt-5 grid gap-3 lg:grid-cols-[1fr_auto]">
                  <label className="block">
                    <span className="sr-only">Conta de anúncios Meta</span>
                    <select
                      value={metaAccountId}
                      onChange={(event) => {
                        setMetaAccountId(event.target.value);
                        setMetaFeedback(null);
                      }}
                      className="min-h-12 w-full rounded-2xl border border-cyan-200 bg-white px-4 text-base font-bold text-slate-800 outline-none transition focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/10"
                    >
                      <option value="">Sem conta vinculada</option>
                      {metaAccounts.map((account) => (
                        <option key={account.id} value={account.meta_account_id}>
                          {account.nome} · act_{account.meta_account_id}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={bindMetaAccount}
                    disabled={linkingMeta || metaAccountId === (selectedCorretor.meta_ad_account_id || '')}
                    className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-cyan-600 px-6 py-3 text-sm font-black text-white shadow-lg shadow-cyan-600/20 transition duration-200 hover:bg-cyan-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cyan-400/30 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    {linkingMeta ? <Loader2 className="animate-spin" size={18} /> : <Link2 size={18} />}
                    {linkingMeta ? 'Vinculando...' : metaAccountId ? 'Vincular conta' : 'Remover vínculo'}
                  </button>
                </div>
                {metaFeedback && (
                  <div
                    role={metaFeedback.tone === 'error' ? 'alert' : 'status'}
                    className={`mt-4 rounded-2xl border p-4 text-sm font-bold ${
                      metaFeedback.tone === 'success'
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : 'border-red-200 bg-red-50 text-red-700'
                    }`}
                  >
                    {metaFeedback.message}
                  </div>
                )}
              </section>

              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="ml-1 text-[10px] font-black uppercase tracking-widest text-gray-400">Login Facebook</label>
                  <input
                    value={formData.facebook_login}
                    onChange={(e) => setFormData({ ...formData, facebook_login: e.target.value })}
                    className="w-full rounded-2xl border-none bg-slate-50 px-5 py-4 text-sm font-bold focus:ring-2 focus:ring-blue-500"
                    placeholder="email ou usuario"
                  />
                </div>
                <div className="space-y-2">
                  <label className="ml-1 text-[10px] font-black uppercase tracking-widest text-gray-400">Senha Facebook</label>
                  <input
                    value={formData.facebook_senha}
                    onChange={(e) => setFormData({ ...formData, facebook_senha: e.target.value })}
                    className="w-full rounded-2xl border-none bg-slate-50 px-5 py-4 text-sm font-bold focus:ring-2 focus:ring-blue-500"
                    placeholder="senha recebida no onboarding"
                  />
                </div>
              </div>

              <div className="mt-6 space-y-2">
                <label className="ml-1 text-[10px] font-black uppercase tracking-widest text-gray-400">Observações</label>
                <textarea
                  value={formData.observacoes}
                  onChange={(e) => setFormData({ ...formData, observacoes: e.target.value })}
                  rows={3}
                  className="w-full resize-none rounded-2xl border-none bg-slate-50 p-5 text-sm font-medium focus:ring-2 focus:ring-blue-500"
                  placeholder="Informações adicionais, observações de campanha ou notas gerais..."
                />
              </div>

              <fieldset className="mt-8 rounded-3xl border border-blue-100 bg-blue-50/40 p-5">
                <legend className="px-2 text-sm font-black uppercase tracking-widest text-gray-900">
                  Estratégia de criativos
                </legend>
                <p className="mb-5 text-sm font-medium text-slate-500">
                  Cada entrada cria a pasta Região / Operadora e coloca 4 criativos nela em segundo plano.
                </p>
                <div className="grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
                  <div className="space-y-2">
                    <label htmlFor="strategy-operator" className="text-[10px] font-black uppercase tracking-widest text-gray-500">Operadora</label>
                    <select
                      id="strategy-operator"
                      value={operatorChoice}
                      onChange={(event) => setOperatorChoice(event.target.value)}
                      className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-4 text-sm font-bold focus:border-blue-500 focus:ring-blue-500"
                    >
                      <option value="">Selecione...</option>
                      {OPERADORAS_ONBOARDING.map((operadora) => <option key={operadora} value={operadora}>{operadora}</option>)}
                    </select>
                    {operatorChoice === 'Outros' && (
                      <input value={operatorOther} onChange={(event) => setOperatorOther(event.target.value)} placeholder="Nome da operadora" className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold focus:border-blue-500 focus:ring-blue-500" />
                    )}
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="strategy-region" className="text-[10px] font-black uppercase tracking-widest text-gray-500">Região</label>
                    <select
                      id="strategy-region"
                      value={regionChoice}
                      onChange={(event) => setRegionChoice(event.target.value)}
                      className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-4 text-sm font-bold focus:border-blue-500 focus:ring-blue-500"
                    >
                      <option value="">Selecione...</option>
                      {REGION_OPTIONS.map((regiao) => <option key={regiao} value={regiao}>{regiao}</option>)}
                    </select>
                    {regionChoice === 'Outros' && (
                      <input value={regionOther} onChange={(event) => setRegionOther(event.target.value)} placeholder="Digite qualquer região" className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold focus:border-blue-500 focus:ring-blue-500" />
                    )}
                  </div>
                  <button type="button" onClick={addStrategy} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 py-3 text-sm font-black text-white transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2">
                    <Plus size={17} /> Adicionar
                  </button>
                </div>
                <div className="mt-5 space-y-2">
                  {strategies.length === 0 ? (
                    <p className="rounded-2xl border border-dashed border-slate-200 bg-white p-4 text-center text-sm font-bold text-slate-400">Nenhuma combinação adicionada.</p>
                  ) : strategies.map((strategy, index) => (
                    <div key={strategy.id || `${strategy.operadora}-${strategy.regiao}-${index}`} className="flex items-center justify-between gap-4 rounded-2xl border border-slate-100 bg-white p-4">
                      <div className="flex items-center gap-3">
                        <span className="rounded-xl bg-blue-50 p-2 text-blue-600"><Layers3 size={18} /></span>
                        <div>
                          <p className="font-black text-slate-900">{strategy.regiao} / {strategy.operadora}</p>
                          <p className="text-xs font-bold text-slate-400">4 criativos na criação desta entrada</p>
                        </div>
                      </div>
                      <button type="button" aria-label={`Remover ${strategy.operadora} de ${strategy.regiao}`} onClick={() => setStrategies((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="rounded-xl p-2 text-slate-400 transition hover:bg-red-50 hover:text-red-600 focus:outline-none focus:ring-2 focus:ring-red-500">
                        <Trash2 size={18} />
                      </button>
                    </div>
                  ))}
                </div>
              </fieldset>

              <label className="mt-8 flex cursor-pointer items-start gap-3 rounded-2xl border border-emerald-100 bg-emerald-50 p-5">
                <input
                  type="checkbox"
                  checked={formData.campanhas_ativas}
                  onChange={(e) => setFormData({ ...formData, campanhas_ativas: e.target.checked })}
                  className="mt-1 h-5 w-5 rounded border-emerald-300 text-emerald-600 focus:ring-emerald-500"
                />
                <span>
                  <span className="block font-black text-emerald-900">Campanhas ativas</span>
                  <span className="mt-1 block text-sm font-bold text-emerald-700">
                    Marque somente depois que as campanhas forem subidas. Isso deixa o status verde.
                  </span>
                </span>
              </label>

              <div className="mt-8 flex justify-end">
                <button
                  disabled={saving}
                  className="flex items-center gap-3 rounded-2xl bg-blue-600 px-8 py-5 font-black text-white shadow-xl shadow-blue-600/20 hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? <Loader2 className="animate-spin" size={20} /> : <><Save size={20} /> Salvar entrada</>}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </InternalLayout>
  );
}
