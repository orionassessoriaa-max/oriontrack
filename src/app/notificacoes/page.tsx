'use client';

import { useEffect, useState } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import { useAuth } from '@/components/providers/AuthProvider';
import { supabase } from '@/lib/supabase/client';
import { Bell, Loader2, RefreshCw, ShieldAlert, HelpCircle, Send } from 'lucide-react';
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
  const { profile } = useAuth();
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

  useEffect(() => {
    const handleThemeChange = () => {
      setTema(window.localStorage.getItem('orion:tema_sistema') || 'noturno');
    };
    handleThemeChange();
    window.addEventListener('orion:theme_changed', handleThemeChange);
    return () => window.removeEventListener('orion:theme_changed', handleThemeChange);
  }, []);

  const isDark = tema === 'noturno';

  useEffect(() => {
    fetchNotifications();
  }, [profile?.id, profile?.tipo_usuario]);

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
      const { error: insertError } = await supabase.from('notificacoes').insert([{
        titulo: formData.titulo,
        mensagem: formData.mensagem,
        destinatario_tipo: formData.destinatario_tipo,
        remetente_profile_id: profile.id,
        lida: false
      }]);

      if (insertError) throw insertError;
      setFormData({ destinatario_tipo: 'todos', titulo: '', mensagem: '' });
      fetchNotifications();
    } catch (err: any) {
      console.error('Error sending notification:', err);
      setError('Nao foi possivel enviar notificacao. Confira se a migration notificacoes foi aplicada.');
    } finally {
      setSending(false);
    }
  };

  return (
    <InternalLayout>
      <div className="mb-10 flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className={`text-3xl font-black tracking-tight ${isDark ? 'text-white' : 'text-gray-900'}`}>Notificações</h1>
          <p className={`font-medium text-sm ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>Avisos enviados pelo admin para corretores e gestores.</p>
        </div>
        <button
          onClick={fetchNotifications}
          className={`flex w-fit items-center gap-2 rounded-2xl border px-5 py-3 font-black transition-all ${
            isDark 
              ? 'border-white/5 bg-[#090e1a] text-slate-300 hover:bg-white/5 shadow-md' 
              : 'border-gray-100 bg-white text-gray-700 shadow-sm hover:bg-gray-50'
          }`}
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Atualizar
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
