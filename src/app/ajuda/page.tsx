'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import InternalLayout from '@/components/layout/InternalLayout';
import {
  Users,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Send,
  History,
  X,
  DollarSign,
  Settings,
  HelpCircle,
  Cpu,
  Sparkles
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/components/providers/AuthProvider';
import { SolicitacaoSuporte } from '@/types';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { motion, AnimatePresence } from 'framer-motion';

const SUPPORT_OPTIONS = [
  {
    id: 'lead',
    title: 'Lead',
    description: 'Qualidade, duplicidade, perfil, dados incompletos ou duvidas de atendimento.',
    icon: Users,
    color: 'blue'
  },
  {
    id: 'sistema',
    title: 'Sistema',
    description: 'Erros, acesso, painel, kanban, relatorios, links ou comportamento estranho.',
    icon: Settings,
    color: 'indigo'
  },
  {
    id: 'financeiro',
    title: 'Financeiro',
    description: 'Cobranca, investimento, pagamentos, notas ou alinhamentos financeiros.',
    icon: DollarSign,
    color: 'green'
  },
  {
    id: 'outro',
    title: 'Outro',
    description: 'Quando o assunto nao se encaixa nas categorias acima e precisa do admin.',
    icon: HelpCircle,
    color: 'slate'
  },
  {
    id: 'treinamento_comercial',
    title: 'Treinamento',
    description: 'Peça apoio para melhorar abordagem, atendimento e conversao dos leads.',
    icon: Users,
    color: 'blue'
  },
  {
    id: 'alinhamento_leads',
    title: 'Reuniao de alinhamento',
    description: 'Solicite uma conversa para ajustar perfil, qualidade e estrategia dos leads.',
    icon: HelpCircle,
    color: 'indigo'
  },
] as const;

type SupportOption = typeof SUPPORT_OPTIONS[number];

function AjudaContent() {
  const { profile } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialType = searchParams.get('tipo');

  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [history, setHistory] = useState<SolicitacaoSuporte[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [selectedOption, setSelectedOption] = useState<SupportOption | null>(null);
  const [message, setMessage] = useState('');
  const [isLaunchingApoloOne, setIsLaunchingApoloOne] = useState(false);
  const [apoloLaunchStep, setApoloLaunchStep] = useState(0);
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

  const handleLaunchApoloOne = () => {
    setIsLaunchingApoloOne(true);
    setApoloLaunchStep(0);
    
    const t1 = setTimeout(() => setApoloLaunchStep(1), 600);
    const t2 = setTimeout(() => setApoloLaunchStep(2), 1200);
    const t3 = setTimeout(() => setApoloLaunchStep(3), 1800);
    const t4 = setTimeout(() => {
      router.push('/apolo-one');
    }, 2500);
  };

  useEffect(() => {
    fetchHistory();
    if (initialType) {
      const option = SUPPORT_OPTIONS.find(o => o.id === initialType);
      if (option) {
        setSelectedOption(option);
        setShowModal(true);
      }
    }
  }, [profile?.id, profile?.corretor_id, initialType]);

  const fetchHistory = async () => {
    if (!profile?.id) {
      setFetching(false);
      return;
    }

    setFetching(true);
    try {
      let query = supabase
        .from('solicitacoes_suporte')
        .select('*')
        .order('created_at', { ascending: false });

      if (profile.corretor_id) {
        query = query.or(`corretor_id.eq.${profile.corretor_id},solicitante_profile_id.eq.${profile.id}`);
      } else {
        query = query.eq('solicitante_profile_id', profile.id);
      }

      const { data, error: fetchError } = await query;

      if (fetchError) throw fetchError;
      setHistory(data || []);
    } catch (err) {
      console.error('Error fetching support history:', err);
      if (profile?.corretor_id) {
        const { data } = await supabase
          .from('solicitacoes_suporte')
          .select('*')
          .eq('corretor_id', profile.corretor_id)
          .order('created_at', { ascending: false });
        setHistory(data || []);
      }
    } finally {
      setFetching(false);
    }
  };

  const handleRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOption || !profile?.id) return;

    setLoading(true);
    setError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        throw new Error('SessÃ£o expirada. Entre novamente.');
      }

      const response = await fetch('/api/support/requests', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          categoria: selectedOption.id,
          tipo: selectedOption.id,
          mensagem: message
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Erro ao enviar chamado.');

      setSuccess(`Chamado de "${selectedOption.title}" enviado com sucesso!`);
      setShowModal(false);
      setMessage('');
      fetchHistory();
      setTimeout(() => setSuccess(null), 5000);
    } catch (err: any) {
      setError(err.message || 'Erro ao enviar chamado.');
    } finally {
      setLoading(false);
    }
  };

  const openRequest = (option: SupportOption) => {
    setSelectedOption(option);
    setShowModal(true);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'nova':
      case 'pending':
        return <span className="rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-blue-600">Nova</span>;
      case 'em andamento':
        return <span className="rounded-full border border-orange-100 bg-orange-50 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-orange-600">Em analise</span>;
      case 'resolvida':
      case 'completed':
        return <span className="rounded-full border border-green-100 bg-green-50 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-green-600">Concluida</span>;
      default:
        return <span className="rounded-full border border-gray-100 bg-gray-50 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-gray-400">{status}</span>;
    }
  };

  return (
    <InternalLayout>
      <div className="mb-12">
        <h1 className={`mb-2 text-4xl font-black tracking-tight ${isDark ? 'text-white' : 'text-gray-900'}`}>Como a Orion pode te ajudar?</h1>
        <p className={`text-lg font-medium ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>Abra um chamado para o admin acompanhar sua solicitacao.</p>
      </div>

      {/* Prominent Box Apolo One */}
      <div className={`mb-12 rounded-[2.5rem] border p-8 flex flex-col lg:flex-row items-center justify-between gap-8 relative overflow-hidden transition-all duration-300 ${
        isDark 
          ? 'border-cyan-500/20 bg-gradient-to-br from-indigo-950/40 via-[#090e1a]/90 to-blue-950/40 shadow-[0_15px_50px_rgba(6,182,212,0.06)]' 
          : 'border-blue-100 bg-gradient-to-br from-blue-50 via-white to-cyan-50/50 shadow-md'
      }`}>
        <div className="absolute top-0 right-0 w-80 h-80 bg-cyan-500/5 rounded-full blur-3xl pointer-events-none" />
        
        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6 relative z-10 text-center sm:text-left">
          <div className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-[1.5rem] shadow-lg ${
            isDark 
              ? 'bg-gradient-to-br from-cyan-400 to-blue-600 text-white shadow-cyan-500/20 animate-pulse' 
              : 'bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-blue-500/20'
          }`}>
            <Cpu size={32} />
          </div>
          <div>
            <div className="flex flex-col sm:flex-row sm:items-center justify-center sm:justify-start gap-2.5">
              <h2 className={`text-2xl font-black ${isDark ? 'text-white' : 'text-gray-900'}`}>
                Falar com Apolo One
              </h2>
              <span className="w-fit mx-auto sm:mx-0 rounded-full bg-cyan-400/10 border border-cyan-400/25 px-2.5 py-0.5 text-[9px] font-black text-cyan-300 uppercase tracking-widest animate-pulse">
                Jarvis AI
              </span>
            </div>
            <p className={`text-sm font-medium leading-relaxed mt-2 max-w-2xl ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>
              Inicie uma conversa em tela cheia com o nosso co-piloto de inteligência artificial central. Um cérebro digital avançado treinado com domínio total da plataforma, pronto para resolver suas dúvidas e orientar sua operação em tempo recorde!
            </p>
          </div>
        </div>
        <button
          onClick={handleLaunchApoloOne}
          className="w-full lg:w-auto shrink-0 flex items-center justify-center gap-3 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 px-8 py-5 font-black text-white transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] cursor-pointer shadow-lg shadow-blue-600/15 relative z-10"
        >
          Iniciar Apolo One <Sparkles size={16} />
        </button>
      </div>

      {/* Futuristic Launcher Loading Overlay */}
      <AnimatePresence>
        {isLaunchingApoloOne && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[99999] flex flex-col items-center justify-center bg-slate-950 p-6"
          >
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(6,182,212,0.1),transparent_70%)] pointer-events-none" />
            <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.01)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.01)_1px,transparent_1px)] bg-[size:30px_30px] opacity-20 pointer-events-none" />

            <div className="relative mb-10 flex h-36 w-36 items-center justify-center">
              <div className="absolute inset-0 rounded-full border border-cyan-500/20 border-t-cyan-400 border-b-blue-500 animate-spin [animation-duration:3s]" />
              <div className="absolute -inset-4 rounded-full border border-indigo-500/10 border-l-purple-500 border-r-pink-500 animate-spin [animation-duration:6s] [animation-direction:reverse]" />
              
              <div className="h-20 w-20 rounded-full bg-gradient-to-br from-cyan-400 via-blue-600 to-purple-600 shadow-[0_0_50px_rgba(6,182,212,0.6)] animate-pulse flex items-center justify-center">
                <Cpu size={32} className="text-white animate-spin [animation-duration:15s]" />
              </div>
            </div>

            <div className="text-center space-y-3 max-w-sm">
              <h3 className="text-lg font-black tracking-widest text-white uppercase flex items-center justify-center gap-2">
                <span className="h-2 w-2 rounded-full bg-cyan-400 animate-ping" />
                Carregando Apolo One
              </h3>
              
              <div className="h-1.5 w-60 bg-white/5 rounded-full overflow-hidden mx-auto border border-white/10 shadow-inner">
                <motion.div 
                  initial={{ width: 0 }}
                  animate={{ width: '100%' }}
                  transition={{ duration: 2.3, ease: 'easeInOut' }}
                  className="h-full bg-gradient-to-r from-cyan-400 via-blue-500 to-indigo-500 shadow-[0_0_8px_rgba(6,182,212,0.5)]" 
                />
              </div>

              <div className="min-h-[24px] text-2xs font-extrabold uppercase tracking-widest text-cyan-400">
                {apoloLaunchStep === 0 && <span className="animate-pulse">Iniciando protocolo Apolo One...</span>}
                {apoloLaunchStep === 1 && <span className="animate-pulse">Carregando matriz de sinapses Jarvis...</span>}
                {apoloLaunchStep === 2 && <span className="animate-pulse">Sincronizando base de dados do Orion Track...</span>}
                {apoloLaunchStep === 3 && <span className="animate-pulse">Conexão segura estabelecida. Iniciando...</span>}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {success && (
        <div className="mb-10 flex items-center gap-4 rounded-[2rem] border border-green-100 bg-green-50 p-6 font-bold text-green-700">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-100">
            <CheckCircle2 size={24} />
          </div>
          {success}
        </div>
      )}

      <div className="mb-20 grid grid-cols-1 gap-8 md:grid-cols-2 xl:grid-cols-4">
        {SUPPORT_OPTIONS.map((option) => (
          <div
            key={option.id}
            className="flex flex-col justify-between rounded-[2.5rem] border border-gray-100 bg-white p-8 shadow-sm transition-all hover:border-blue-200 hover:shadow-xl"
          >
            <div>
              <div className={`mb-6 inline-block rounded-2xl p-4 shadow-sm ${
                option.color === 'blue' ? 'bg-blue-50 text-blue-600' :
                option.color === 'indigo' ? 'bg-indigo-50 text-indigo-600' :
                option.color === 'green' ? 'bg-green-50 text-green-600' :
                'bg-slate-50 text-slate-600'
              }`}>
                <option.icon size={28} />
              </div>
              <h3 className="mb-3 text-xl font-black text-gray-900">{option.title}</h3>
              <p className="mb-8 text-sm font-medium leading-relaxed text-gray-500">{option.description}</p>
            </div>
            <button
              onClick={() => openRequest(option)}
              className="flex w-full items-center justify-center gap-3 rounded-2xl bg-slate-900 py-5 font-black text-white transition-all hover:bg-blue-600"
            >
              Abrir chamado <Send size={18} />
            </button>
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-[3rem] border border-gray-100 bg-white shadow-sm">
        <div className="flex items-center gap-3 border-b border-gray-50 p-10">
          <History className="text-gray-400" size={24} />
          <h2 className="text-2xl font-black tracking-tight text-gray-900">Minhas solicitacoes</h2>
        </div>
        <div className="overflow-x-auto">
          {fetching ? (
            <div className="flex justify-center py-20">
              <Loader2 className="animate-spin text-blue-600" size={40} />
            </div>
          ) : history.length === 0 ? (
            <div className="py-20 text-center italic text-gray-400">
              Nenhuma solicitacao encontrada.
            </div>
          ) : (
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="bg-gray-50/50">
                  <th className="px-10 py-6 text-[10px] font-black uppercase tracking-widest text-gray-400">Data</th>
                  <th className="px-10 py-6 text-[10px] font-black uppercase tracking-widest text-gray-400">Categoria</th>
                  <th className="px-10 py-6 text-[10px] font-black uppercase tracking-widest text-gray-400">Mensagem</th>
                  <th className="px-10 py-6 text-[10px] font-black uppercase tracking-widest text-gray-400">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {history.map((req) => (
                  <tr key={req.id} className="transition-colors hover:bg-slate-50/50">
                    <td className="whitespace-nowrap px-10 py-6 text-sm font-bold text-slate-500">
                      {format(new Date(req.created_at), 'dd/MM/yyyy HH:mm', { locale: ptBR })}
                    </td>
                    <td className="px-10 py-6">
                      <span className="block whitespace-nowrap text-sm font-black text-gray-900">
                        {SUPPORT_OPTIONS.find(o => o.id === req.tipo)?.title || req.categoria || req.tipo.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-10 py-6">
                      <p className="line-clamp-1 max-w-xs text-sm font-medium text-gray-500">{req.mensagem || '-'}</p>
                    </td>
                    <td className="px-10 py-6">
                      {getStatusBadge(req.status)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {showModal && selectedOption && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 p-6 backdrop-blur-md">
          <div className="w-full max-w-xl overflow-hidden rounded-[2.5rem] bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-100 bg-slate-50/50 p-8">
              <div>
                <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-blue-600">Novo chamado</p>
                <h3 className="font-black text-gray-900">{selectedOption.title}</h3>
              </div>
              <button onClick={() => setShowModal(false)} className="rounded-full p-2 text-gray-400 transition-colors hover:bg-white hover:text-red-500">
                <X size={24} />
              </button>
            </div>
            <form onSubmit={handleRequest} className="space-y-6 p-8">
              {error && (
                <div className="flex items-center gap-3 rounded-2xl border border-red-100 bg-red-50 p-4 text-sm font-bold text-red-600">
                  <AlertCircle size={18} /> {error}
                </div>
              )}
              <div className="space-y-3">
                <label className="ml-1 text-xs font-black uppercase tracking-widest text-gray-400">Descreva seu chamado</label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Conte o que aconteceu, qual lead ou tela esta envolvida e o que voce precisa que o admin avalie."
                  rows={5}
                  className="w-full resize-none rounded-2xl border-none bg-slate-50 p-6 text-sm font-medium transition-all focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
              <div className="flex gap-4">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 rounded-2xl border border-gray-100 py-5 font-black text-gray-500 transition-all hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex flex-1 items-center justify-center gap-3 rounded-2xl bg-blue-600 py-5 font-black text-white shadow-xl shadow-blue-600/20 transition-all hover:bg-blue-700 disabled:opacity-50"
                >
                  {loading ? <Loader2 className="animate-spin" size={20} /> : <><Send size={18} /> Enviar</>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </InternalLayout>
  );
}

export default function HelpPage() {
  return (
    <Suspense fallback={
      <InternalLayout>
        <div className="flex h-screen items-center justify-center">
          <Loader2 className="animate-spin text-blue-600" size={40} />
        </div>
      </InternalLayout>
    }>
      <AjudaContent />
    </Suspense>
  );
}
