'use client';

import { useEffect, useState } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import { useAuth } from '@/components/providers/AuthProvider';
import { supabase } from '@/lib/supabase/client';
import { 
  CheckCircle2, 
  Loader2, 
  QrCode, 
  RefreshCw, 
  Smartphone, 
  Trash2, 
  AlertTriangle,
  Bot,
  Send,
  Sliders,
  Settings
} from 'lucide-react';

export default function AdminConfiguracoesPage() {
  const { profile, loading: authLoading } = useAuth();
  
  // Conexão WhatsApp Chave Mestra
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [isWhatsAppConnected, setIsWhatsAppConnected] = useState(false);
  const [whatsappStatus, setWhatsappStatus] = useState<'checking' | 'open' | 'connecting' | 'close'>('checking');
  
  // Teste de Notificação
  const [testPhone, setTestPhone] = useState('');
  const [testMessage, setTestMessage] = useState(
    `🤖 *APOLO AI • ORION TRACK*\n*Notificação Oficial de Atualização de Sistema*\n\nOlá! ⚡\n\nPassando para informar que acabo de sincronizar e atualizar as tabelas de preços e coparticipações no seu painel do *Simulador*!\n\nAs seguintes operadoras sofreram reajustes e já estão 100% atualizadas para cotação:\n🟢 *Amil Saúde* (Tabelas Linear e Coparticipativa - Nacional)\n🔵 *Bradesco Saúde* (Novas tabelas SP/DF/RJ com reajuste de operadora)\n🔴 *SulAmérica* (Atualização de tabelas PME e Empresarial)\n\n_Apolo AI • Seu co-piloto supremo no Orion Track._`
  );
  const [sendingTest, setSendingTest] = useState(false);
  const [testSuccess, setTestSuccess] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);

  // Limpeza Geral
  const [clearingEnv, setClearingEnv] = useState(false);
  const [clearSuccess, setClearSuccess] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || '';
  }

  async function fetchConnectionStatus() {
    const token = await getToken();
    if (!token) return;

    try {
      const response = await fetch('/api/admin/configuracoes/evolution', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const payload = await response.json().catch(() => ({}));
      if (response.ok && payload.success) {
        setIsWhatsAppConnected(payload.connected);
        setWhatsappStatus(payload.state || 'close');
        if (payload.connected) {
          setQrCode(null);
          setConnectError(null);
        }
      }
    } catch (err) {
      console.error('Erro ao buscar status da conexao mestre:', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (profile?.tipo_usuario === 'admin') {
      void fetchConnectionStatus();
    }
  }, [profile]);

  useEffect(() => {
    // Polling a cada 5 segundos se estiver gerando QR Code ou conectando
    if (!isWhatsAppConnected && (qrCode || whatsappStatus === 'connecting')) {
      const interval = setInterval(() => {
        void fetchConnectionStatus();
      }, 5000);
      return () => clearInterval(interval);
    }
  }, [isWhatsAppConnected, qrCode, whatsappStatus]);

  async function connectWhatsApp() {
    setConnecting(true);
    setConnectError(null);
    setQrCode(null);

    const token = await getToken();
    if (!token) {
      setConnectError('Sessão expirada. Faça login novamente.');
      setConnecting(false);
      return;
    }

    try {
      const response = await fetch('/api/admin/configuracoes/evolution', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          accepted_terms: acceptedTerms,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      setConnecting(false);

      if (!response.ok) {
        setConnectError(payload.error || 'Não consegui conectar ao servidor do WhatsApp agora.');
        return;
      }

      setQrCode(payload.qrcode || null);
      setWhatsappStatus('connecting');
    } catch (err: any) {
      setConnectError(err.message || 'Erro de conexão.');
      setConnecting(false);
    }
  }

  async function disconnectWhatsApp() {
    if (!confirm('Deseja realmente desconectar a Chave Mestra do WhatsApp? Todas as notificações automáticas do sistema serão suspensas até uma nova conexão.')) {
      return;
    }

    setDisconnecting(true);
    const token = await getToken();
    if (!token) {
      setDisconnecting(false);
      return;
    }

    try {
      const response = await fetch('/api/admin/configuracoes/evolution', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        setIsWhatsAppConnected(false);
        setWhatsappStatus('close');
        setQrCode(null);
        setAcceptedTerms(false);
      } else {
        alert('Erro ao desconectar WhatsApp.');
      }
    } catch (err) {
      console.error('Erro ao desconectar:', err);
    } finally {
      setDisconnecting(false);
    }
  }

  async function handleSendTest(e: React.FormEvent) {
    e.preventDefault();
    if (!testPhone.trim() || !testMessage.trim()) return;

    setSendingTest(true);
    setTestSuccess(false);
    setTestError(null);

    const token = await getToken();
    try {
      const response = await fetch('/api/admin/configuracoes/evolution/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          telefone: testPhone,
          mensagem: testMessage,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (response.ok) {
        setTestSuccess(true);
        setTestPhone('');
      } else {
        setTestError(payload.error || 'Falha ao disparar mensagem de teste.');
      }
    } catch (err: any) {
      setTestError(err.message || 'Erro inesperado ao enviar teste.');
    } finally {
      setSendingTest(false);
    }
  }

  async function handleClearEnvironment() {
    if (!confirm('ATENÇÃO: Isso desconectará TODOS os WhatsApps dos corretores integrados a este CRM e apagará todo o histórico de mensagens e conversas anteriores do banco. Esta ação é irreversível e serve apenas para fins de novos testes. Deseja prosseguir?')) {
      return;
    }

    setClearingEnv(true);
    setClearSuccess(false);
    setClearError(null);

    const token = await getToken();
    try {
      const response = await fetch('/api/admin/clean-whatsapp', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const payload = await response.json().catch(() => ({}));
      if (response.ok) {
        setClearSuccess(true);
        // Recarrega o status do master caso tenha sido excluído
        void fetchConnectionStatus();
      } else {
        setClearError(payload.error || 'Falha ao resetar o ambiente.');
      }
    } catch (err: any) {
      setClearError(err.message || 'Erro ao processar limpeza.');
    } finally {
      setClearingEnv(false);
    }
  }

  if (authLoading) {
    return (
      <InternalLayout>
        <div className="flex justify-center py-20">
          <Loader2 className="animate-spin text-blue-600" size={40} />
        </div>
      </InternalLayout>
    );
  }

  return (
    <InternalLayout>
      <div className="mb-10">
        <h1 className="text-3xl font-black tracking-tight text-gray-900">Configurações do Sistema</h1>
        <p className="font-medium text-slate-400">Gerencie a infraestrutura global da plataforma e parametrize o Apolo AI.</p>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        {/* Lado Esquerdo: WhatsApp Chave Mestra e Testador */}
        <div className="space-y-8 lg:col-span-2">
          {/* Card de Conexão WhatsApp */}
          <div className="orion-panel p-8">
            <div className="flex items-center gap-3 border-b border-white/5 pb-4 mb-6">
              <div className="p-2 rounded-xl bg-gradient-to-br from-blue-500/20 to-cyan-500/20 border border-blue-500/30 text-cyan-400 shadow-inner">
                <Bot size={22} />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Apolo Chave Mestra</h3>
                <p className="text-xs text-slate-400 font-semibold leading-relaxed">Configuração da conexão de WhatsApp responsável por enviar todas as notificações para os corretores.</p>
              </div>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="animate-spin text-blue-500" size={30} />
              </div>
            ) : isWhatsAppConnected ? (
              // Conectado com sucesso
              <div className="rounded-2xl border border-emerald-500/10 bg-emerald-500/5 p-6 shadow-[0_12px_40px_rgba(16,185,129,0.02)] space-y-6">
                <div className="flex items-start gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-400">
                    <CheckCircle2 size={24} />
                  </div>
                  <div>
                    <h4 className="text-base font-black text-white">Chave Mestra Conectada!</h4>
                    <p className="text-xs font-semibold text-slate-400 mt-1.5 leading-relaxed">
                      A conta está ativa e sincronizada com sucesso no Orion Track. O Apolo AI está pronto para disparar notificações instantâneas no celular de todos os corretores.
                    </p>
                  </div>
                </div>

                <div className="border-t border-white/5 pt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">Status da Conexão</span>
                    <p className="text-xs font-bold text-emerald-400 flex items-center gap-1.5 mt-1">
                      <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                      Ativo • Pronto para notificar
                    </p>
                  </div>

                  <button
                    onClick={disconnectWhatsApp}
                    disabled={disconnecting}
                    className="rounded-xl bg-rose-600/10 hover:bg-rose-600/20 border border-rose-500/20 px-5 py-3.5 text-xs font-black text-rose-400 transition-all cursor-pointer disabled:opacity-50"
                  >
                    {disconnecting ? <Loader2 className="animate-spin" size={14} /> : 'Desconectar WhatsApp'}
                  </button>
                </div>
              </div>
            ) : (
              // Não Conectado
              <div className="space-y-6">
                {connectError && (
                  <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-2xl flex items-center gap-3 text-rose-400 text-xs font-bold">
                    <AlertTriangle size={16} className="shrink-0" />
                    <p>{connectError}</p>
                  </div>
                )}

                {!qrCode && (
                  <div className="space-y-5">
                    <p className="text-xs leading-relaxed font-semibold text-slate-300">
                      Para configurar a **Chave Mestra do Apolo**, você deve conectar uma conta de WhatsApp dedicada ao envio de notificações do Orion Track. Os corretores receberão avisos de leads, atualizações de tabelas de saúde e interações diretamente desse número.
                    </p>

                    <label className="flex items-start gap-3 rounded-2xl border border-white/5 bg-white/2 p-5 cursor-pointer hover:bg-white/5 transition-all">
                      <input
                        type="checkbox"
                        checked={acceptedTerms}
                        onChange={(e) => setAcceptedTerms(e.target.checked)}
                        className="mt-1 h-4 w-4 rounded border-white/10 bg-white/5 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-xs leading-relaxed font-semibold text-slate-300">
                        Eu aceito vincular a conta de WhatsApp Master para fins de disparos automáticos de notificações no Orion Track e estou ciente que a integridade dos envios depende da conexão ativa desta instância.
                      </span>
                    </label>

                    <div className="flex justify-end">
                      <button
                        onClick={connectWhatsApp}
                        disabled={!acceptedTerms || connecting}
                        className="flex items-center gap-2 rounded-xl bg-blue-600 px-6 py-4 text-xs font-black text-white hover:bg-blue-700 disabled:opacity-50 cursor-pointer shadow-lg shadow-blue-600/15"
                      >
                        {connecting ? (
                          <Loader2 className="animate-spin" size={16} />
                        ) : (
                          <>
                            <QrCode size={16} />
                            <span>Gerar QR Code da Chave Mestra</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}

                {qrCode && (
                  <div className="flex flex-col md:flex-row items-center gap-8 p-6 rounded-2xl border border-white/5 bg-white/2">
                    <div className="flex flex-col items-center justify-center p-4 bg-white rounded-2xl shrink-0 shadow-xl">
                      <img src={qrCode.startsWith('data:') ? qrCode : `data:image/png;base64,${qrCode}`} alt="WhatsApp QR Code" className="h-44 w-44 object-contain" />
                      <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 mt-3 animate-pulse">Aguardando leitura...</span>
                    </div>

                    <div className="space-y-4">
                      <h4 className="text-sm font-black text-white flex items-center gap-2">
                        <Smartphone size={16} className="text-cyan-400" />
                        Vincular seu dispositivo
                      </h4>
                      <ol className="list-decimal pl-4 space-y-2 text-xs font-bold text-slate-400">
                        <li>Abra o WhatsApp no seu smartphone.</li>
                        <li>Toque em <strong className="text-white">Mais opções (︙)</strong> ou <strong className="text-white">Configurações</strong>.</li>
                        <li>Selecione <strong className="text-white">Aparelhos conectados</strong> e toque em <strong className="text-white">Conectar aparelho</strong>.</li>
                        <li>Aponte a câmera do celular para este QR Code para realizar o login instantâneo.</li>
                      </ol>

                      <div className="pt-2 flex items-center gap-3">
                        <button
                          onClick={fetchConnectionStatus}
                          className="flex items-center gap-1.5 text-[10px] font-black text-cyan-400 uppercase tracking-widest hover:text-cyan-300 transition-colors"
                        >
                          <RefreshCw size={12} /> Atualizar status
                        </button>
                        <span className="text-[10px] text-slate-500 font-bold">O QR Code recarrega automaticamente a cada leitura.</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Card de Teste de Notificação */}
          {isWhatsAppConnected && (
            <form onSubmit={handleSendTest} className="orion-panel p-8 space-y-6 animate-fade-in">
              <div className="flex items-center gap-3 border-b border-white/5 pb-4 mb-4">
                <div className="p-2 rounded-xl bg-gradient-to-br from-indigo-500/20 to-blue-500/20 border border-indigo-500/30 text-indigo-400 shadow-inner">
                  <Send size={20} />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">Testar Notificação do Apolo</h3>
                  <p className="text-xs text-slate-400 font-semibold leading-relaxed">Envie uma notificação de atualização de tabelas de teste para validar o som e o push em tempo real no seu dispositivo.</p>
                </div>
              </div>

              {testSuccess && (
                <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl flex items-center gap-3 text-emerald-400 text-xs font-black animate-in fade-in">
                  <CheckCircle2 size={16} className="shrink-0" />
                  <p>Notificação de teste disparada com sucesso! Verifique o WhatsApp no aparelho de destino.</p>
                </div>
              )}

              {testError && (
                <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-2xl flex items-center gap-3 text-rose-400 text-xs font-bold">
                  <AlertTriangle size={16} className="shrink-0" />
                  <p>{testError}</p>
                </div>
              )}

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="ml-1 text-[10px] font-black uppercase tracking-widest text-slate-500">WhatsApp de Destino (Com DDD)</label>
                  <input
                    type="text"
                    required
                    value={testPhone}
                    onChange={(e) => setTestPhone(e.target.value)}
                    placeholder="Ex: 5561999999999"
                    className="orion-control w-full py-4 px-4 text-xs font-bold text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/40 focus:ring-1 focus:ring-blue-500/20 transition-all"
                  />
                </div>

                <div className="space-y-2">
                  <label className="ml-1 text-[10px] font-black uppercase tracking-widest text-slate-500">Conteúdo do Alerta</label>
                  <textarea
                    required
                    rows={8}
                    value={testMessage}
                    onChange={(e) => setTestMessage(e.target.value)}
                    className="orion-control w-full p-4 text-xs font-semibold leading-relaxed text-slate-300 placeholder-slate-600 focus:outline-none focus:border-blue-500/40 focus:ring-1 focus:ring-blue-500/20 transition-all resize-none"
                  />
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={sendingTest || !testPhone.trim() || !testMessage.trim()}
                  className="flex items-center gap-2 rounded-xl bg-blue-600 px-6 py-4 text-xs font-black text-white hover:bg-blue-700 disabled:opacity-50 cursor-pointer shadow-lg shadow-blue-600/15"
                >
                  {sendingTest ? (
                    <Loader2 className="animate-spin" size={14} />
                  ) : (
                    <>
                      <Send size={14} />
                      <span>Enviar Notificação de Teste</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Lado Direito: Limpeza Geral do Ambiente */}
        <div className="space-y-8">
          <div className="orion-panel p-8 space-y-6">
            <div className="flex items-center gap-3 border-b border-white/5 pb-4 mb-4">
              <div className="p-2 rounded-xl bg-gradient-to-br from-rose-500/20 to-red-500/20 border border-rose-500/30 text-rose-400 shadow-inner">
                <Sliders size={20} />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Painel Operacional</h3>
                <p className="text-[10px] text-slate-500 font-black uppercase tracking-wider mt-0.5">Reset de ambiente</p>
              </div>
            </div>

            {clearSuccess && (
              <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl flex items-center gap-3 text-emerald-400 text-xs font-black animate-in fade-in">
                <CheckCircle2 size={16} className="shrink-0" />
                <p>Ambiente operacional limpo e resetado com sucesso!</p>
              </div>
            )}

            {clearError && (
              <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-2xl flex items-center gap-3 text-rose-400 text-xs font-bold">
                <AlertTriangle size={16} className="shrink-0" />
                <p>{clearError}</p>
              </div>
            )}

            <p className="text-[11px] leading-relaxed font-semibold text-slate-400">
              Caso você queira recomeçar a validação das conexões do Inbox de corretores a partir do zero absoluto, você pode acionar a limpeza geral do sistema. 
            </p>

            <div className="p-4 rounded-xl border border-rose-500/10 bg-rose-500/5 text-[10px] leading-relaxed font-bold text-rose-400 flex items-start gap-2.5">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <span>
                **CUIDADO**: Esta ação excluirá todas as sessões ativas com prefixo **orion_** no servidor do WhatsApp e limpará todos os históricos de mensagens e conversas do Inbox no banco.
              </span>
            </div>

            <button
              onClick={handleClearEnvironment}
              disabled={clearingEnv}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-rose-600/10 hover:bg-rose-600/20 border border-rose-500/20 py-4 text-xs font-black text-rose-400 transition-all cursor-pointer disabled:opacity-50"
            >
              {clearingEnv ? (
                <Loader2 className="animate-spin" size={14} />
              ) : (
                <>
                  <Trash2 size={14} />
                  <span>Limpar Instâncias & Banco</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </InternalLayout>
  );
}
