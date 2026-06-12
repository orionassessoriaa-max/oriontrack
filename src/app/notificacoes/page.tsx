'use client';

import { useEffect, useState } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import { useAuth } from '@/components/providers/AuthProvider';
import { useDialog } from '@/components/providers/DialogProvider';
import { supabase } from '@/lib/supabase/client';
import { Bell, Loader2, RefreshCw, ShieldAlert, HelpCircle, Send, Settings, Save, Sparkles, TrendingUp, DollarSign, Smartphone } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

type Notification = {
  id: string;
  titulo: string;
  mensagem: string;
  destinatario_profile_id: string | null;
  destinatario_tipo: string | null;
  lida: boolean;
  created_at: string;
};

export default function NotificacoesPage() {
  const { profile, actualProfile } = useAuth();
  const { confirmDialog } = useDialog();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    destinatario_tipo: 'todos',
    titulo: '',
    mensagem: ''
  });
  const [tema, setTema] = useState<string>('noturno');

  // Apolo dynamic thresholds states
  const [corretores, setCorretores] = useState<any[]>([]);
  const [loadingCorretores, setLoadingCorretores] = useState(false);
  const [savingCorretorId, setSavingCorretorId] = useState<string | null>(null);
  const [savedSuccessId, setSavedSuccessId] = useState<string | null>(null);
  const [thresholds, setThresholds] = useState<Record<string, { cpl: string; saldo: string }>>({});
  const [preferences, setPreferences] = useState({
    whatsapp_enabled: false,
    telefone: '',
    tipos: {
      saldo_baixo: true,
      cpl_alto: true,
      notificacao: true,
      novo_lead: true,
      suporte: true,
      demandas: true,
    } as Record<string, boolean>,
  });
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [preferencesSaved, setPreferencesSaved] = useState(false);

  useEffect(() => {
    const handleThemeChange = () => {
      setTema(window.localStorage.getItem('orion:tema_sistema') || 'noturno');
    };
    handleThemeChange();
    window.addEventListener('orion:theme_changed', handleThemeChange);
    return () => window.removeEventListener('orion:theme_changed', handleThemeChange);
  }, []);

  const isDark = tema === 'noturno';
  const preferencesTargetProfileId = profile?.id || '';
  const isSavingViewedProfile = Boolean(
    actualProfile?.tipo_usuario === 'admin' &&
    profile?.id &&
    actualProfile.id !== profile.id
  );
  const preferencesTargetLabel = `${profile?.nome || 'este usuario'}${profile?.email || profile?.email_real ? ` (${profile.email_real || profile.email})` : ''}`;
  const isTeamMemberProfile = profile?.tipo_usuario === 'corretor_membro';

  const fetchCorretores = async () => {
    if (!profile?.id || !['admin', 'gestor_trafego'].includes(profile.tipo_usuario)) return;
    setLoadingCorretores(true);
    try {
      let query = supabase
        .from('corretores')
        .select('id, nome, meta_ad_account_id, meta_ad_account_name, operadoras_info')
        .not('meta_ad_account_id', 'is', null);

      if (profile.tipo_usuario === 'gestor_trafego') {
        query = query.eq('gestor_trafego_id', profile.id);
      }

      const { data, error: fetchError } = await query;
      if (fetchError) throw fetchError;

      setCorretores(data || []);
      
      const initial: Record<string, { cpl: string; saldo: string }> = {};
      (data || []).forEach((c: any) => {
        initial[c.id] = {
          cpl: String(c.operadoras_info?.alerta_limite_cpl ?? 25),
          saldo: String(c.operadoras_info?.alerta_limite_saldo ?? 100)
        };
      });
      setThresholds(initial);
    } catch (err) {
      console.error('Error fetching corretores:', err);
    } finally {
      setLoadingCorretores(false);
    }
  };

  const fetchNotifications = async () => {
    if (!profile?.id) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      let query = supabase
        .from('notificacoes')
        .select('*')
        .order('created_at', { ascending: false });

      if (profile.tipo_usuario !== 'admin') {
        query = query.or(`destinatario_profile_id.eq.${profile.id},destinatario_tipo.eq.${profile.tipo_usuario},destinatario_tipo.eq.todos`);
      }

      const { data, error: fetchError } = await query;

      if (fetchError) throw fetchError;
      setNotifications(data || []);
    } catch (err: any) {
      console.error('Error fetching notifications:', err);
      setError('Nao foi possivel carregar notificacoes. A tabela notificacoes precisa existir no Supabase.');
    } finally {
      setLoading(false);
    }
  };

  const fetchPreferences = async () => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;

    const targetQuery = isSavingViewedProfile
      ? `?target_profile_id=${encodeURIComponent(preferencesTargetProfileId)}`
      : '';
    const response = await fetch(`/api/notificacoes/preferencias${targetQuery}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const payload = await response.json().catch(() => ({}));
    if (response.ok && payload.preferences) {
      setPreferences({
        whatsapp_enabled: Boolean(payload.preferences.whatsapp_enabled),
        telefone: payload.preferences.telefone || profile?.telefone || '',
        tipos: {
          saldo_baixo: true,
          cpl_alto: true,
          notificacao: true,
          novo_lead: true,
          suporte: true,
          demandas: true,
          ...(payload.preferences.tipos || {}),
        },
      });
    }
  };

  useEffect(() => {
    fetchNotifications();
    fetchCorretores();
    fetchPreferences();
  }, [profile?.id, profile?.tipo_usuario]);

  const markAsRead = async (id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, lida: true } : n));
    await supabase.from('notificacoes').update({ lida: true }).eq('id', id);
  };

  const sendNotification = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || profile.tipo_usuario !== 'admin') return;

    setSending(true);
    setError(null);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const response = await fetch('/api/notificacoes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(formData),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Nao foi possivel enviar notificacao.');
      setFormData({ destinatario_tipo: 'todos', titulo: '', mensagem: '' });
      fetchNotifications();
    } catch (err: any) {
      console.error('Error sending notification:', err);
      setError(err.message || 'Nao foi possivel enviar notificacao. Confira se a migration notificacoes foi aplicada.');
    } finally {
      setSending(false);
    }
  };

  const savePreferences = async () => {
    const confirmed = await confirmDialog(
      `Salvar este numero e preferencias de WhatsApp para ${preferencesTargetLabel}?`,
      {
        title: 'Confirmar notificacoes',
        confirmLabel: 'Salvar',
        cancelLabel: 'Cancelar',
      }
    );
    if (!confirmed) return;

    setSavingPreferences(true);
    setPreferencesSaved(false);
    setError(null);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const response = await fetch('/api/notificacoes/preferencias', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          ...preferences,
          target_profile_id: isSavingViewedProfile ? preferencesTargetProfileId : undefined,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Erro ao salvar preferencias.');
      setPreferencesSaved(true);
      setTimeout(() => setPreferencesSaved(false), 2500);
    } catch (err: any) {
      setError(err.message || 'Erro ao salvar preferencias.');
    } finally {
      setSavingPreferences(false);
    }
  };

  const saveThresholds = async (corretorId: string) => {
    setSavingCorretorId(corretorId);
    setSavedSuccessId(null);
    try {
      const corr = corretores.find(c => c.id === corretorId);
      if (!corr) return;

      const currentCpl = parseFloat(thresholds[corretorId]?.cpl || '25');
      const currentSaldo = parseFloat(thresholds[corretorId]?.saldo || '100');

      const updatedOperadorasInfo = {
        ...(corr.operadoras_info || {}),
        alerta_limite_cpl: isNaN(currentCpl) ? 25 : currentCpl,
        alerta_limite_saldo: isNaN(currentSaldo) ? 100 : currentSaldo
      };

      const { error: updateError } = await supabase
        .from('corretores')
        .update({ operadoras_info: updatedOperadorasInfo })
        .eq('id', corretorId);

      if (updateError) throw updateError;

      setCorretores(prev => prev.map(c => c.id === corretorId ? { ...c, operadoras_info: updatedOperadorasInfo } : c));
      setSavedSuccessId(corretorId);
      setTimeout(() => setSavedSuccessId(null), 3000);
    } catch (err) {
      console.error('Error saving thresholds:', err);
      alert('Erro ao salvar limites.');
    } finally {
      setSavingCorretorId(null);
    }
  };

  return (
    <InternalLayout>
      <div className="mb-10 flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className={`text-3xl font-black tracking-tight ${isDark ? 'text-white' : 'text-gray-900'}`}>Notificações</h1>
          <p className={`font-medium text-sm ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>Avisos e configurações globais do assistente Apolo AI.</p>
        </div>
        <button
          onClick={() => { fetchNotifications(); fetchCorretores(); }}
          className={`flex w-fit items-center gap-2 rounded-2xl border px-5 py-3 font-black transition-all ${
            isDark 
              ? 'border-white/5 bg-[#090e1a] text-slate-300 hover:bg-white/5 shadow-md' 
              : 'border-gray-100 bg-white text-gray-700 shadow-sm hover:bg-gray-50'
          }`}
        >
          <RefreshCw size={16} className={loading || loadingCorretores ? 'animate-spin' : ''} /> Atualizar
        </button>
      </div>

      {/* Central de Chamados e Suporte (Central de Ajuda CTA) */}
      <div className={`mb-8 rounded-[2rem] border p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-6 transition-all duration-300 ${
        isDark 
          ? 'border-cyan-500/10 bg-[#090e1a]/80 backdrop-blur-xl shadow-[0_12px_40px_rgba(6,182,212,0.03)]' 
          : 'border-blue-100 bg-blue-50/50 shadow-sm'
      }`}>
        <div className="flex items-start gap-4">
          <div className={`hidden sm:flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${
            isDark ? 'bg-cyan-500/10 text-cyan-400' : 'bg-blue-100 text-blue-600'
          }`}>
            <HelpCircle size={22} />
          </div>
          <div>
            <h3 className={`text-base font-black ${isDark ? 'text-white' : 'text-gray-900'}`}>
              Central de Chamados e Suporte
            </h3>
            <p className={`text-xs font-semibold leading-relaxed mt-1 max-w-xl ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>
              Precisa reportar algum problema de leads, financeiro, sistema ou solicitar alinhamentos comerciais? Abra e acompanhe chamados diretamente na nossa Central de Ajuda.
            </p>
          </div>
        </div>
        <a
          href="/ajuda"
          className="shrink-0 flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-6 py-4 text-xs font-black text-white hover:bg-blue-700 hover:scale-[1.02] active:scale-[0.98] transition-all shadow-lg shadow-blue-600/15"
        >
          Abrir Chamado <Send size={12} />
        </a>
      </div>

      <div className={`mb-8 rounded-[2rem] border p-6 transition-all duration-300 ${
        isDark
          ? 'border-white/5 bg-[#090e1a]/70 backdrop-blur-md shadow-2xl'
          : 'border-gray-100 bg-white shadow-sm'
      }`}>
        <div className="mb-6 flex flex-col gap-4 border-b border-slate-100 pb-5 dark:border-white/5 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3">
            <div className={`p-2 rounded-xl ${isDark ? 'bg-emerald-500/10 text-emerald-400' : 'bg-emerald-50 text-emerald-600'}`}>
              <Smartphone size={20} />
            </div>
            <div>
              <h3 className={`text-base font-black ${isDark ? 'text-white' : 'text-gray-900'}`}>Receber notificacoes pelo WhatsApp</h3>
              <p className={`text-xs font-bold ${isDark ? 'text-slate-400' : 'text-gray-400'}`}>
                O Apolo Notificador usa o WhatsApp oficial configurado pelo Dev. Informe o numero que vai receber os avisos.
              </p>
            </div>
          </div>
          <label className="flex items-center gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-xs font-black text-emerald-400">
            <input
              type="checkbox"
              checked={preferences.whatsapp_enabled}
              onChange={(event) => setPreferences((current) => ({ ...current, whatsapp_enabled: event.target.checked }))}
              className="h-4 w-4 rounded border-emerald-500/30 bg-transparent text-emerald-500 focus:ring-emerald-500"
            />
            Ativar WhatsApp
          </label>
        </div>

        <div className={`grid gap-5 ${isTeamMemberProfile ? 'lg:grid-cols-[minmax(0,360px)_160px]' : 'lg:grid-cols-[320px_minmax(0,1fr)_160px]'} lg:items-end`}>
          <div className="space-y-2">
            <label className={`ml-1 text-[10px] font-black uppercase tracking-widest ${isDark ? 'text-slate-500' : 'text-gray-400'}`}>Telefone receptor</label>
            <input
              value={preferences.telefone}
              onChange={(event) => setPreferences((current) => ({ ...current, telefone: event.target.value }))}
              placeholder="Ex: 5561999999999"
              className={`w-full rounded-2xl border-none px-5 py-4 text-sm font-bold focus:ring-2 focus:ring-emerald-500 ${
                isDark ? 'bg-black/40 text-white placeholder-slate-600' : 'bg-slate-50 text-gray-900'
              }`}
            />
          </div>

          {!isTeamMemberProfile && (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {[
                ['notificacao', 'Avisos gerais'],
                ['saldo_baixo', 'Saldo baixo'],
                ['cpl_alto', 'CPL alto'],
                ['novo_lead', 'Novos leads'],
                ['suporte', 'Suporte'],
                ['demandas', 'Demandas'],
              ].map(([key, label]) => (
                <label key={key} className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-[10px] font-black uppercase tracking-widest ${
                  isDark ? 'border-white/5 bg-white/[0.02] text-slate-300' : 'border-gray-100 bg-slate-50 text-gray-600'
                }`}>
                  <input
                    type="checkbox"
                    checked={Boolean(preferences.tipos[key])}
                    onChange={(event) => setPreferences((current) => ({
                      ...current,
                      tipos: { ...current.tipos, [key]: event.target.checked },
                    }))}
                    className="h-3.5 w-3.5 rounded border-slate-400 text-blue-600 focus:ring-blue-500"
                  />
                  {label}
                </label>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={savePreferences}
            disabled={savingPreferences}
            className={`flex h-12 items-center justify-center gap-2 rounded-2xl px-5 text-xs font-black text-white transition-all ${
              preferencesSaved ? 'bg-emerald-600' : 'bg-blue-600 hover:bg-blue-700'
            } disabled:opacity-60`}
          >
            {savingPreferences ? <Loader2 className="animate-spin" size={16} /> : preferencesSaved ? 'Salvo' : 'Salvar'}
          </button>
        </div>
      </div>

      {/* CONFIGURAÇÕES DE LIMITES APOLO (Meta Ads Monitor) - Visible only to admin and gestor_trafego */}
      {(profile?.tipo_usuario === 'admin' || profile?.tipo_usuario === 'gestor_trafego') && (
        <div className={`mb-8 rounded-[2rem] border p-6 transition-all duration-300 ${
          isDark 
            ? 'border-white/5 bg-[#090e1a]/70 backdrop-blur-md shadow-2xl' 
            : 'border-gray-100 bg-white shadow-sm'
        }`}>
          <div className="flex items-center gap-3 border-b border-slate-100 dark:border-white/5 pb-4 mb-6">
            <div className={`p-2 rounded-xl ${isDark ? 'bg-gradient-to-br from-blue-500/20 to-cyan-500/20 text-cyan-400' : 'bg-blue-50 text-blue-600'}`}>
              <Settings size={20} />
            </div>
            <div>
              <h3 className={`text-base font-black ${isDark ? 'text-white' : 'text-gray-900'}`}>Alertas do Apolo AI • Configuração de Limites</h3>
              <p className={`text-xs font-bold ${isDark ? 'text-slate-400' : 'text-gray-400'}`}>
                Monitore o tráfego do Meta Ads. Defina o limite de CPL e saldo baixo para envio automático de avisos via WhatsApp.
              </p>
            </div>
          </div>

          {loadingCorretores ? (
            <div className="flex justify-center py-8">
              <Loader2 className="animate-spin text-blue-600" size={24} />
            </div>
          ) : corretores.length === 0 ? (
            <p className={`text-xs font-bold text-center py-4 ${isDark ? 'text-slate-500' : 'text-gray-400'}`}>
              Nenhuma conta vinculada do Meta Ads encontrada sob sua gestão.
            </p>
          ) : (
            <div className="space-y-4">
              {corretores.map((corretor) => (
                <div 
                  key={corretor.id} 
                  className={`flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 rounded-2xl border transition-all ${
                    isDark 
                      ? 'border-white/5 bg-white/[0.01] hover:bg-white/[0.02]' 
                      : 'border-gray-100 bg-slate-50 hover:bg-slate-100/50'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className={`font-black text-sm ${isDark ? 'text-white' : 'text-gray-900'}`}>{corretor.nome}</p>
                    <p className={`text-[10px] font-bold truncate mt-1 ${isDark ? 'text-slate-400' : 'text-gray-400'}`}>
                      Conta Meta: <strong className={isDark ? 'text-cyan-400' : 'text-blue-600'}>{corretor.meta_ad_account_name || corretor.meta_ad_account_id}</strong>
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-4">
                    {/* CPL Limit Input */}
                    <div className="space-y-1">
                      <span className="block text-[9px] font-black uppercase tracking-wider text-slate-400 flex items-center gap-1">
                        <TrendingUp size={10} /> CPL Máximo
                      </span>
                      <div className="relative flex items-center">
                        <span className={`absolute left-3.5 text-xs font-bold ${isDark ? 'text-slate-500' : 'text-gray-400'}`}>R$</span>
                        <input
                          type="number"
                          placeholder="25"
                          value={thresholds[corretor.id]?.cpl || ''}
                          onChange={(e) => setThresholds({
                            ...thresholds,
                            [corretor.id]: { ...thresholds[corretor.id], cpl: e.target.value }
                          })}
                          className={`w-28 rounded-xl border-none pl-9 pr-3 py-2 text-xs font-bold text-right focus:ring-2 focus:ring-blue-500 ${
                            isDark ? 'bg-black/40 text-white' : 'bg-white text-gray-800'
                          }`}
                        />
                      </div>
                    </div>

                    {/* Balance Limit Input */}
                    <div className="space-y-1">
                      <span className="block text-[9px] font-black uppercase tracking-wider text-slate-400 flex items-center gap-1">
                        <DollarSign size={10} /> Saldo Mínimo
                      </span>
                      <div className="relative flex items-center">
                        <span className={`absolute left-3.5 text-xs font-bold ${isDark ? 'text-slate-500' : 'text-gray-400'}`}>R$</span>
                        <input
                          type="number"
                          placeholder="100"
                          value={thresholds[corretor.id]?.saldo || ''}
                          onChange={(e) => setThresholds({
                            ...thresholds,
                            [corretor.id]: { ...thresholds[corretor.id], saldo: e.target.value }
                          })}
                          className={`w-28 rounded-xl border-none pl-9 pr-3 py-2 text-xs font-bold text-right focus:ring-2 focus:ring-blue-500 ${
                            isDark ? 'bg-black/40 text-white' : 'bg-white text-gray-800'
                          }`}
                        />
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="pt-3.5 md:pt-0 self-end md:self-center">
                      <button
                        onClick={() => saveThresholds(corretor.id)}
                        disabled={savingCorretorId === corretor.id}
                        className={`flex h-9 items-center justify-center gap-1.5 rounded-xl px-4 text-xs font-black transition-all cursor-pointer shadow-md ${
                          savedSuccessId === corretor.id 
                            ? 'bg-emerald-600 text-white' 
                            : 'bg-blue-600 text-white hover:bg-blue-700'
                        }`}
                      >
                        {savingCorretorId === corretor.id ? (
                          <Loader2 className="animate-spin" size={14} />
                        ) : savedSuccessId === corretor.id ? (
                          <>Salvo! ✓</>
                        ) : (
                          <>
                            <Save size={13} />
                            <span>Salvar</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {profile?.tipo_usuario === 'admin' && (
        <form onSubmit={sendNotification} className={`mb-8 rounded-[2rem] border p-6 transition-all duration-300 ${
          isDark 
            ? 'border-white/5 bg-[#090e1a]/60 shadow-lg' 
            : 'border-gray-100 bg-white shadow-sm'
        }`}>
          <div className="mb-5 flex flex-col gap-4 md:flex-row md:items-end">
            <div className="space-y-2 md:w-56">
              <label className={`ml-1 text-[10px] font-black uppercase tracking-widest ${isDark ? 'text-slate-500' : 'text-gray-400'}`}>Enviar para</label>
              <select
                value={formData.destinatario_tipo}
                onChange={(e) => setFormData({ ...formData, destinatario_tipo: e.target.value })}
                className="w-full rounded-2xl border-none bg-slate-50 px-5 py-4 text-sm font-bold focus:ring-2 focus:ring-blue-500"
              >
                <option value="todos">Todos</option>
                <option value="corretor">Corretores</option>
                <option value="gestor_trafego">Gestores</option>
              </select>
            </div>
            <div className="flex-1 space-y-2">
              <label className={`ml-1 text-[10px] font-black uppercase tracking-widest ${isDark ? 'text-slate-500' : 'text-gray-400'}`}>Titulo</label>
              <input
                required
                value={formData.titulo}
                onChange={(e) => setFormData({ ...formData, titulo: e.target.value })}
                className="w-full rounded-2xl border-none bg-slate-50 px-5 py-4 text-sm font-bold focus:ring-2 focus:ring-blue-500"
                placeholder="Ex: Atenção aos leads novos"
              />
            </div>
          </div>
          <div className="flex flex-col gap-4 md:flex-row">
            <textarea
              required
              value={formData.mensagem}
              onChange={(e) => setFormData({ ...formData, mensagem: e.target.value })}
              className="min-h-24 flex-1 resize-none rounded-2xl border-none bg-slate-50 p-5 text-sm font-medium focus:ring-2 focus:ring-blue-500"
              placeholder="Mensagem que sera exibida na aba de notificacoes."
            />
            <button
              type="submit"
              disabled={sending}
              className="rounded-2xl bg-blue-600 px-8 py-5 font-black text-white shadow-xl shadow-blue-600/20 transition-colors hover:bg-blue-700 disabled:opacity-50"
            >
              {sending ? <Loader2 className="animate-spin" size={20} /> : 'Enviar notificacao'}
            </button>
          </div>
        </form>
      )}

      <div className={`overflow-hidden rounded-[2rem] border transition-all duration-300 ${
        isDark 
          ? 'border-white/5 bg-[#090e1a] shadow-2xl shadow-black/40' 
          : 'border-gray-100 bg-white shadow-sm'
      }`}>
        {loading ? (
          <div className="flex justify-center py-24">
            <Loader2 className="animate-spin text-blue-600" size={40} />
          </div>
        ) : error ? (
          <div className="py-24 text-center">
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
              <ShieldAlert size={30} />
            </div>
            <p className="mx-auto max-w-md font-bold text-amber-700">{error}</p>
          </div>
        ) : notifications.length === 0 ? (
          <div className="py-24 text-center">
            <div className={`mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl ${isDark ? 'bg-white/2 text-slate-500' : 'bg-slate-50 text-slate-300'}`}>
              <Bell size={30} />
            </div>
            <p className="font-bold text-slate-400">Nenhuma notificacao por enquanto.</p>
          </div>
        ) : (
          <div className={`divide-y ${isDark ? 'divide-white/5' : 'divide-gray-50'}`}>
            {notifications.map((notification) => (
              <button
                key={notification.id}
                onClick={() => markAsRead(notification.id)}
                className={`block w-full p-6 text-left transition-colors border-b ${
                  isDark 
                    ? 'hover:bg-white/2 border-white/5' 
                    : 'hover:bg-slate-50 border-gray-50'
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="mb-2 flex items-center gap-2">
                      {!notification.lida && <span className="h-2.5 w-2.5 rounded-full bg-blue-600" />}
                      <h2 className={`font-black ${isDark ? 'text-white' : 'text-gray-900'}`}>{notification.titulo}</h2>
                    </div>
                    <p className={`max-w-3xl text-sm font-medium leading-relaxed ${isDark ? 'text-slate-300' : 'text-gray-500'}`}>{notification.mensagem}</p>
                  </div>
                  <span className={`whitespace-nowrap text-[10px] font-black uppercase tracking-widest ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                    {format(new Date(notification.created_at), 'dd/MM HH:mm', { locale: ptBR })}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </InternalLayout>
  );
}
