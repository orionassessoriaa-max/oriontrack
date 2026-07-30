'use client';

import { useEffect, useMemo, useState } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import { useAuth } from '@/components/providers/AuthProvider';
import { supabase } from '@/lib/supabase/client';
import { Corretor } from '@/types';
import { getOnboardingStatus, OPERADORAS_ONBOARDING } from '@/lib/onboarding';
import { CheckCircle2, Layers3, Loader2, Plus, Save, Search, ShieldAlert, Trash2, UserPlus } from 'lucide-react';
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

  useEffect(() => {
    fetchCorretores();
  }, [profile?.id]);

  const selectedCorretor = corretores.find(c => c.id === selectedId) || null;
  const selectedStatus = selectedCorretor ? getOnboardingStatus(selectedCorretor) : null;

  const filteredCorretores = useMemo(() => {
    return corretores.filter(c =>
      (c.nome || '').toLowerCase().includes(search.toLowerCase()) ||
      (c.email || '').toLowerCase().includes(search.toLowerCase())
    );
  }, [corretores, search]);

  const fetchCorretores = async () => {
    if (!profile?.id) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const { data, error: fetchError } = await supabase
        .from('corretores')
        .select('*')
        .in('status', ['active', 'ativo', 'Ativo'])
        .order('nome', { ascending: true });

      if (fetchError) throw fetchError;

      let filtered = data || [];
      if (profile.tipo_usuario === 'gestor_trafego') {
        filtered = filtered.filter(c => isGestorLinkedToConcessionariaCorretor(c, profile));
      }

      setCorretores(filtered);
    } catch (err: any) {
      console.error('Erro ao carregar entrada:', err);
      setError('Nao foi possivel carregar os corretores vinculados.');
    } finally {
      setLoading(false);
    }
  };

  const selectCorretor = async (corretor: Corretor) => {
    setSelectedId(corretor.id);
    setSaved(false);
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
      <div className="mb-10">
        <div className="mb-2 flex items-center gap-2 text-blue-600">
          <UserPlus size={18} />
          <span className="text-[10px] font-black uppercase tracking-widest">Onboarding operacional</span>
        </div>
        <h1 className="text-3xl font-black tracking-tight text-gray-900">Entrada de Corretor</h1>
        <p className="text-lg font-medium text-gray-500">Registre acessos, operadoras, regioes e libere campanhas ativas.</p>
      </div>

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-3">
        <div className="rounded-[2.5rem] border border-gray-100 bg-white p-6 shadow-sm">
          <div className="relative mb-5">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar corretor..."
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
            <div className="py-16 text-center font-bold text-gray-400">Nenhum corretor vinculado.</div>
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
                        <p className="font-black text-gray-900">{corretor.nome}</p>
                        <p className="text-xs font-bold text-gray-400">{corretor.email}</p>
                      </div>
                      <span className={`mt-1 h-2.5 w-2.5 rounded-full ${status.dot}`} />
                    </div>
                    <span className={`inline-flex rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-widest ${status.className}`}>
                      {status.label}
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
                <p className="font-black text-slate-400">Selecione um corretor para iniciar a entrada.</p>
              </div>
            </div>
          ) : (
            <form onSubmit={saveEntrada} className="rounded-[2.5rem] border border-gray-100 bg-white p-8 shadow-sm">
              <div className="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-start">
                <div>
                  <h2 className="text-2xl font-black text-gray-900">{selectedCorretor.nome}</h2>
                  <p className="font-medium text-gray-500">{selectedCorretor.email}</p>
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
