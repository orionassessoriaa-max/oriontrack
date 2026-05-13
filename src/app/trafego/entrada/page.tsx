'use client';

import { useEffect, useMemo, useState } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import { useAuth } from '@/components/providers/AuthProvider';
import { supabase } from '@/lib/supabase/client';
import { Corretor } from '@/types';
import { getOnboardingStatus, OPERADORAS_ONBOARDING } from '@/lib/onboarding';
import { CheckCircle2, Loader2, Save, Search, ShieldAlert, UserPlus } from 'lucide-react';

type EntradaForm = {
  facebook_login: string;
  facebook_senha: string;
  regioes_campanha: string;
  campanhas_ativas: boolean;
  operadoras: string[];
};

const emptyForm: EntradaForm = {
  facebook_login: '',
  facebook_senha: '',
  regioes_campanha: '',
  campanhas_ativas: false,
  operadoras: []
};

export default function EntradaGestorPage() {
  const { profile } = useAuth();
  const [corretores, setCorretores] = useState<Corretor[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [search, setSearch] = useState('');
  const [formData, setFormData] = useState<EntradaForm>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

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
        .eq('gestor_trafego_id', profile.id)
        .order('nome', { ascending: true });

      if (fetchError) throw fetchError;
      setCorretores(data || []);
    } catch (err: any) {
      console.error('Erro ao carregar entrada:', err);
      setError('Nao foi possivel carregar os corretores vinculados.');
    } finally {
      setLoading(false);
    }
  };

  const selectCorretor = (corretor: Corretor) => {
    setSelectedId(corretor.id);
    setSaved(false);
    setFormData({
      facebook_login: corretor.facebook_login || '',
      facebook_senha: corretor.facebook_senha || '',
      regioes_campanha: corretor.regioes_campanha || '',
      campanhas_ativas: Boolean(corretor.campanhas_ativas),
      operadoras: Array.isArray(corretor.operadoras_info?.selecionadas)
        ? corretor.operadoras_info.selecionadas
        : Object.entries(corretor.operadoras_info || {})
            .filter(([, value]) => Boolean(value))
            .map(([key]) => key)
    });
  };

  const dataComplete = Boolean(
    formData.facebook_login.trim() &&
    formData.facebook_senha.trim() &&
    formData.regioes_campanha.trim() &&
    formData.operadoras.length > 0
  );

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

    const { error: updateError } = await supabase
      .from('corretores')
      .update({
        facebook_login: formData.facebook_login || null,
        facebook_senha: formData.facebook_senha || null,
        regioes_campanha: formData.regioes_campanha || null,
        operadoras_info: { selecionadas: formData.operadoras },
        campanhas_ativas: formData.campanhas_ativas,
        onboarding_status,
      })
      .eq('id', selectedId);

    setSaving(false);
    if (updateError) {
      alert('Erro ao salvar entrada: ' + updateError.message);
      return;
    }

    setSaved(true);
    setCorretores(prev => prev.map(c => c.id === selectedId ? {
      ...c,
      facebook_login: formData.facebook_login,
      facebook_senha: formData.facebook_senha,
      regioes_campanha: formData.regioes_campanha,
      campanhas_ativas: formData.campanhas_ativas,
      operadoras_info: { selecionadas: formData.operadoras },
      onboarding_status,
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
                <label className="ml-1 text-[10px] font-black uppercase tracking-widest text-gray-400">Regiões que vao rodar</label>
                <textarea
                  value={formData.regioes_campanha}
                  onChange={(e) => setFormData({ ...formData, regioes_campanha: e.target.value })}
                  rows={3}
                  className="w-full resize-none rounded-2xl border-none bg-slate-50 p-5 text-sm font-medium focus:ring-2 focus:ring-blue-500"
                  placeholder="Ex: Sao Paulo capital, ABC, Guarulhos..."
                />
              </div>

              <div className="mt-8">
                <h3 className="mb-4 text-sm font-black uppercase tracking-widest text-gray-900">Operadoras</h3>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                  {OPERADORAS_ONBOARDING.map(operadora => (
                    <label
                      key={operadora}
                      className={`flex cursor-pointer items-center gap-3 rounded-2xl border px-4 py-4 text-sm font-black transition-all ${
                        formData.operadoras.includes(operadora)
                          ? 'border-blue-200 bg-blue-50 text-blue-700'
                          : 'border-slate-100 bg-slate-50 text-slate-600 hover:border-blue-100'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={formData.operadoras.includes(operadora)}
                        onChange={(e) => {
                          const nextOperadoras = e.target.checked
                            ? [...formData.operadoras, operadora]
                            : formData.operadoras.filter(item => item !== operadora);

                          setFormData({ ...formData, operadoras: nextOperadoras });
                        }}
                        className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      {operadora}
                    </label>
                  ))}
                </div>
              </div>

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
