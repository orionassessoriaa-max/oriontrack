'use client';

import { useState, useEffect } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import { useAuth } from '@/components/providers/AuthProvider';
import { supabase } from '@/lib/supabase/client';
import { Loader2, ExternalLink, RefreshCw, Calculator, Info, Settings, Save, AlertTriangle, Check } from 'lucide-react';

export default function SimuladorPage() {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [iframeKey, setIframeKey] = useState(0);
  const [corretor, setCorretor] = useState<any>(null);
  const [simuladorUrl, setSimuladorUrl] = useState('');
  const [inputUrl, setInputUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [tema, setTema] = useState<string>('noturno');

  // Carrega o tema do sistema
  useEffect(() => {
    const handleThemeChange = () => {
      setTema(window.localStorage.getItem('orion:tema_sistema') || 'noturno');
    };
    handleThemeChange();
    window.addEventListener('orion:theme_changed', handleThemeChange);
    return () => window.removeEventListener('orion:theme_changed', handleThemeChange);
  }, []);

  const isDark = tema === 'noturno';

  // Busca dados do corretor
  useEffect(() => {
    if (profile?.corretor_id) {
      fetchCorretor();
    } else {
      setLoading(false);
    }
  }, [profile]);

  const fetchCorretor = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('corretores')
        .select('*')
        .eq('id', profile?.corretor_id)
        .single();

      if (error) throw error;

      if (data) {
        setCorretor(data);
        const savedUrl = data.operadoras_info?.link_simulador || '';
        setSimuladorUrl(savedUrl);
        setInputUrl(savedUrl);
      }
    } catch (err) {
      console.error('Erro ao buscar dados do corretor:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = () => {
    setLoading(true);
    setIframeKey((prev) => prev + 1);
  };

  const handleSaveUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile?.corretor_id || !corretor) return;

    setSaving(true);
    try {
      const updatedOperadorasInfo = {
        ...(corretor.operadoras_info || {}),
        link_simulador: inputUrl.trim()
      };

      const { error } = await supabase
        .from('corretores')
        .update({ operadoras_info: updatedOperadorasInfo })
        .eq('id', profile.corretor_id);

      if (error) throw error;

      setSimuladorUrl(inputUrl.trim());
      setCorretor({
        ...corretor,
        operadoras_info: updatedOperadorasInfo
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      setShowSettings(false);
      handleRefresh();
    } catch (err) {
      console.error('Erro ao salvar URL do simulador:', err);
      alert('Erro ao salvar as configurações.');
    } finally {
      setSaving(false);
    }
  };

  const canEdit = profile && ['admin', 'gestor_trafego', 'corretor', 'corretor_admin'].includes(profile.tipo_usuario);
  const currentIframeUrl = simuladorUrl || "https://beta.paineldocorretor.com.br/cotacoes?somente-conteudo=true";

  return (
    <InternalLayout>
      <div className="flex flex-col h-[calc(100vh-110px)] space-y-4">
        
        {/* Header Superior Premium */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/5 pb-4 shrink-0">
          <div>
            <div className="flex items-center gap-2 text-cyan-400 font-extrabold text-xs uppercase tracking-widest">
              <Calculator size={14} className="animate-pulse" />
              <span>Simulador de Planos</span>
            </div>
            <h1 className="mt-1 text-2xl font-black tracking-tight text-white sm:text-3xl">
              Painel do Corretor
            </h1>
            <p className="mt-1 text-xs sm:text-sm font-bold text-slate-400">
              Faça suas simulações e cálculos de planos de saúde de forma integrada.
            </p>
          </div>

          {/* Botões de Ação */}
          <div className="flex items-center gap-2 self-start sm:self-auto">
            {canEdit && (
              <button
                onClick={() => setShowSettings(!showSettings)}
                className={`flex items-center gap-2 px-4 py-2 rounded-2xl border text-xs font-bold transition-all active:scale-95 ${
                  showSettings 
                    ? 'bg-cyan-500/20 border-cyan-500/30 text-cyan-400' 
                    : 'bg-white/5 border-white/5 hover:bg-white/10 text-slate-300'
                }`}
              >
                <Settings size={14} />
                Configurar Link
              </button>
            )}
            <button
              onClick={handleRefresh}
              className="flex items-center gap-2 px-4 py-2 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/5 text-xs font-bold text-slate-300 transition-all active:scale-95"
              title="Recarregar Simulador"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              Recarregar
            </button>
            <a
              href={simuladorUrl || "https://beta.paineldocorretor.com.br/cotacoes?"}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-4 py-2 rounded-2xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-xs font-bold text-white transition-all shadow-lg shadow-cyan-950/20 active:scale-95"
            >
              <ExternalLink size={14} />
              Abrir em Nova Aba
            </a>
          </div>
        </div>

        {/* Painel de Configurações da URL */}
        {showSettings && canEdit && (
          <form onSubmit={handleSaveUrl} className="bg-slate-900/80 rounded-2xl border border-white/10 p-5 space-y-4 animate-in fade-in-50 duration-200 shrink-0">
            <div className="space-y-1.5">
              <label className="text-xs font-extrabold text-cyan-400 uppercase tracking-wider block">Link de Integração do Painel do Corretor</label>
              <input
                type="url"
                value={inputUrl}
                onChange={(e) => setInputUrl(e.target.value)}
                placeholder="Ex: https://app.paineldocorretor.com.br/?hash=SEU_HASH_AQUI&somente-conteudo=true"
                className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500/50"
                required
              />
              <p className="text-[10px] text-slate-500 leading-normal font-medium">
                Insira o link com hash fornecido pelo suporte do Painel do Corretor para carregar sem restrições de iframe. Caso queira redefinir para o padrão da beta, deixe o campo em branco.
              </p>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => {
                  setShowSettings(false);
                  setInputUrl(simuladorUrl);
                }}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-400 hover:bg-white/5 transition-all"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-xs font-black text-white transition-all disabled:opacity-50"
              >
                {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                Salvar Configurações
              </button>
            </div>
          </form>
        )}

        {/* Alerta de erro de iframe (se for o link beta direto) */}
        {!simuladorUrl && (
          <div className="flex items-start gap-3.5 p-4 bg-amber-500/10 border border-amber-500/20 rounded-2xl text-xs text-amber-300 shrink-0">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-bold text-amber-200">
                O link direto da Beta do Painel do Corretor bloqueia o uso de iframes.
              </p>
              <p className="text-slate-400 font-medium leading-relaxed">
                Por isso, a tela abaixo pode aparecer cinza ou em branco. Para ver aqui dentro, você precisa do seu **Link de Integração Simplificado (com Hash)** fornecido pela Trindade Tecnologia/Painel do Corretor. Cole-o clicando em <strong className="text-cyan-400">Configurar Link</strong> acima. Enquanto isso, use o botão <strong className="text-white">Abrir em Nova Aba</strong> para simular normalmente em outra janela.
              </p>
            </div>
          </div>
        )}

        {saveSuccess && (
          <div className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-xs font-bold text-emerald-400 shrink-0 animate-in fade-in-50">
            <Check size={14} />
            Link atualizado com sucesso! Carregando novo simulador...
          </div>
        )}

        {/* Container do Iframe com Loading State */}
        <div className="relative flex-1 w-full bg-slate-950/40 rounded-3xl border border-white/5 overflow-hidden shadow-2xl">
          {loading && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-slate-950/90 backdrop-blur-sm transition-all duration-300">
              <Loader2 size={36} className="text-cyan-400 animate-spin mb-4" />
              <p className="text-sm font-black text-white tracking-wider uppercase">Carregando Simulador...</p>
              <p className="text-2xs text-slate-500 mt-1 font-bold">Painel do Corretor Integrado</p>
            </div>
          )}

          <iframe
            key={iframeKey}
            src={currentIframeUrl}
            className="w-full h-full border-none rounded-3xl"
            onLoad={() => setLoading(false)}
            allow="clipboard-read; clipboard-write; geolocation"
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals"
          />
        </div>

      </div>
    </InternalLayout>
  );
}
