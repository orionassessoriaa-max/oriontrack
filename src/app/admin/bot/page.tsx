'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import { useAuth } from '@/components/providers/AuthProvider';
import { supabase } from '@/lib/supabase/client';
import {
  AlertTriangle,
  Bot,
  Building2,
  Check,
  ChevronRight,
  Edit3,
  Loader2,
  MessageSquare,
  Plus,
  Save,
  Sparkles,
  Wand2,
} from 'lucide-react';

interface Corretora {
  id: string;
  nome: string;
  status?: string | null;
}

interface BotPromptMeta {
  tipo?: string;
  categoria?: string;
  descricao?: string;
  modelo_base?: string;
  prompt_version?: string;
}

interface BotConfig {
  id: string;
  corretora_id: string;
  nome: string;
  trigger_key: string;
  primeira_mensagem: string;
  fluxo?: BotPromptMeta | unknown;
  status: string;
  created_at?: string;
  updated_at?: string;
  corretoras?: { nome?: string | null } | { nome?: string | null }[] | null;
}

interface BotWorkspaceItem {
  id: string;
  nome: string;
  status?: string | null;
  config?: BotConfig;
}

interface BotTemplate {
  id: string;
  nome: string;
  categoria: string;
  descricao: string;
  prompt: string;
}

interface BotFormState {
  nome: string;
  categoria: string;
  prompt: string;
  status: 'ativo' | 'inativo';
}

const DEFAULT_PROMPT = `Ola, {primeiro_nome}! Tudo bem?

Voce acabou de preencher o nosso formulario para planos de saude.

Logo um dos nossos especialistas vai entrar em contato para te atender com mais detalhes.`;

const BOT_TEMPLATES: BotTemplate[] = [
  {
    id: 'primeiro-atendimento',
    nome: 'Primeiro atendimento',
    categoria: 'Atendimento',
    descricao: 'Mensagem curta para avisar que o cadastro chegou e que o especialista vai chamar.',
    prompt: DEFAULT_PROMPT,
  },
  {
    id: 'confirmacao-interesse',
    nome: 'Confirmacao de interesse',
    categoria: 'Atendimento',
    descricao: 'Confirma que o lead veio do formulario e abre caminho para contato humano.',
    prompt: `Ola, {primeiro_nome}! Tudo bem?

Recebemos seu cadastro para planos de saude pela pagina {operadora}.

Um especialista da {concessionaria} vai te chamar para entender melhor seu perfil e te orientar com a cotacao.`,
  },
  {
    id: 'fila-comercial',
    nome: 'Fila comercial',
    categoria: 'Aviso',
    descricao: 'Usado quando o corretor ainda vai assumir o contato manualmente.',
    prompt: `Ola, {primeiro_nome}! Tudo bem?

Seu formulario chegou aqui para o nosso time comercial.

Em breve um especialista vai continuar o atendimento por este WhatsApp.`,
  },
  {
    id: 'pos-cadastro',
    nome: 'Pos-cadastro premium',
    categoria: 'Atendimento',
    descricao: 'Mensagem um pouco mais consultiva, mantendo o bot apenas no primeiro contato.',
    prompt: `Ola, {primeiro_nome}! Tudo bem?

Vi que voce acabou de preencher nosso formulario para planos de saude.

Ja deixei seu atendimento encaminhado para um especialista. Ele vai te chamar para seguir com a cotacao de forma mais precisa.`,
  },
];

function getConfigCorretoraName(config: BotConfig) {
  const relation = config.corretoras;
  if (Array.isArray(relation)) return relation[0]?.nome || 'Concessionaria';
  return relation?.nome || 'Concessionaria';
}

function getFlowMeta(config?: BotConfig): BotPromptMeta {
  if (!config?.fluxo || Array.isArray(config.fluxo) || typeof config.fluxo !== 'object') return {};
  return config.fluxo as BotPromptMeta;
}

function buildForm(config?: BotConfig): BotFormState {
  const meta = getFlowMeta(config);
  return {
    nome: config?.nome || 'Primeiro atendimento',
    categoria: meta.categoria || 'Atendimento',
    prompt: config?.primeira_mensagem || DEFAULT_PROMPT,
    status: config?.status === 'ativo' ? 'ativo' : 'inativo',
  };
}

function snapshot(form: BotFormState) {
  return JSON.stringify(form);
}

export default function AdminBotPage() {
  const { actualProfile } = useAuth();
  const [items, setItems] = useState<BotWorkspaceItem[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [form, setForm] = useState<BotFormState>(() => buildForm());
  const [savedSnapshot, setSavedSnapshot] = useState(() => snapshot(buildForm()));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const isAdmin = actualProfile?.tipo_usuario === 'admin';
  const selectedItem = items.find((item) => item.id === selectedId);
  const hasUnsavedChanges = snapshot(form) !== savedSnapshot;

  const setFormField = <K extends keyof BotFormState>(key: K, value: BotFormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const loadData = useCallback(async () => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setFeedback(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        setFeedback({ type: 'error', message: 'Sessao expirada. Faca login novamente.' });
        return;
      }

      const response = await fetch('/api/admin/bot', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      const data = await response.json();

      if (!response.ok) {
        setFeedback({ type: 'error', message: data.error || 'Erro ao carregar bots.' });
        return;
      }

      const activeConfigs: BotConfig[] = data.activeConfigs || [];
      const activeItems: BotWorkspaceItem[] = activeConfigs.map((config) => ({
        id: config.corretora_id,
        nome: getConfigCorretoraName(config),
        status: config.status,
        config,
      }));

      const activeIds = new Set(activeItems.map((item) => item.id));
      const inactiveItems: BotWorkspaceItem[] = (data.inactiveCorretoras || [])
        .filter((corretora: Corretora) => !activeIds.has(corretora.id))
        .map((corretora: Corretora) => ({
          id: corretora.id,
          nome: corretora.nome,
          status: corretora.status,
        }));

      const merged = [...activeItems, ...inactiveItems].sort((a, b) => a.nome.localeCompare(b.nome));
      setItems(merged);

      const nextSelected = selectedId && merged.some((item) => item.id === selectedId)
        ? selectedId
        : merged[0]?.id || '';
      setSelectedId(nextSelected);

      const nextItem = merged.find((item) => item.id === nextSelected);
      const nextForm = buildForm(nextItem?.config);
      setForm(nextForm);
      setSavedSnapshot(snapshot(nextForm));
    } catch (error: any) {
      setFeedback({ type: 'error', message: error?.message || 'Erro de rede ao carregar bots.' });
    } finally {
      setLoading(false);
    }
  }, [isAdmin, selectedId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges) return;
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  const filteredItems = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return items;
    return items.filter((item) => item.nome.toLowerCase().includes(term));
  }, [items, search]);

  function selectConcessionaria(id: string) {
    if (id === selectedId) return;
    if (hasUnsavedChanges && !window.confirm('Voce tem alteracoes nao salvas. Se sair ou recarregar a pagina, vai perder as mudancas. Deseja continuar?')) {
      return;
    }

    const nextItem = items.find((item) => item.id === id);
    const nextForm = buildForm(nextItem?.config);
    setSelectedId(id);
    setForm(nextForm);
    setSavedSnapshot(snapshot(nextForm));
    setFeedback(null);
  }

  function useTemplate(template: BotTemplate) {
    setForm((current) => ({
      ...current,
      nome: template.nome,
      categoria: template.categoria,
      prompt: template.prompt,
    }));
    setFeedback(null);
  }

  function createModel() {
    setForm({
      nome: 'Novo modelo',
      categoria: 'Atendimento',
      prompt: DEFAULT_PROMPT,
      status: 'inativo',
    });
    setFeedback(null);
  }

  async function saveModel(event: React.FormEvent) {
    event.preventDefault();

    if (!selectedItem?.id) {
      setFeedback({ type: 'error', message: 'Selecione uma concessionaria para salvar o modelo.' });
      return;
    }

    if (!form.nome.trim() || !form.prompt.trim()) {
      setFeedback({ type: 'error', message: 'Preencha o nome do modelo e o prompt.' });
      return;
    }

    setSaving(true);
    setFeedback(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        setFeedback({ type: 'error', message: 'Sessao expirada. Faca login novamente.' });
        return;
      }

      const response = await fetch('/api/admin/bot', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          corretora_id: selectedItem.id,
          nome: form.nome.trim(),
          trigger_key: 'crm',
          primeira_mensagem: form.prompt.trim(),
          fluxo: {
            tipo: 'prompt',
            categoria: form.categoria.trim() || 'Atendimento',
            descricao: 'Bot configurado por prompt',
            modelo_base: form.nome.trim(),
            prompt_version: 'prompt-v1',
          },
          status: form.status,
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        setFeedback({ type: 'error', message: data.error || 'Erro ao salvar modelo.' });
        return;
      }

      setFeedback({ type: 'success', message: 'Modelo salvo. O bot vai usar este prompt quando o lead cair no CRM.' });
      const nextForm = { ...form, nome: form.nome.trim(), prompt: form.prompt.trim() };
      setForm(nextForm);
      setSavedSnapshot(snapshot(nextForm));
      await loadData();
    } catch (error: any) {
      setFeedback({ type: 'error', message: error?.message || 'Erro ao salvar modelo.' });
    } finally {
      setSaving(false);
    }
  }

  if (!isAdmin) {
    return (
      <InternalLayout>
        <main className="min-h-screen bg-[#020814] px-6 py-10 text-white">
          <div className="rounded-[28px] border border-red-500/30 bg-red-500/10 p-8">
            <h1 className="text-2xl font-black">Acesso restrito</h1>
            <p className="mt-2 text-sm font-bold text-slate-300">
              A pagina de Bot esta disponivel apenas para Dev e Admin Orion.
            </p>
          </div>
        </main>
      </InternalLayout>
    );
  }

  return (
    <InternalLayout>
      <main className="min-h-screen bg-[#020814] px-4 py-8 text-white sm:px-6 lg:px-8">
        <section className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-500/10 text-cyan-300">
              <Bot className="h-6 w-6" />
            </div>
            <p className="text-xs font-black uppercase tracking-[0.35em] text-cyan-300">Automacao comercial</p>
            <h1 className="mt-2 text-4xl font-black tracking-tight">Bot</h1>
            <p className="mt-2 max-w-3xl text-sm font-bold text-slate-400">
              Configure bots por prompt para o primeiro atendimento. O gatilho padrao e CRM: o lead caiu, a primeira mensagem e enviada.
            </p>
          </div>

          <button
            type="button"
            onClick={createModel}
            className="inline-flex items-center justify-center gap-2 rounded-[18px] bg-cyan-500 px-6 py-4 text-sm font-black text-white shadow-lg shadow-cyan-500/20 transition hover:bg-cyan-400"
          >
            <Plus className="h-4 w-4" />
            Criar modelo
          </button>
        </section>

        {feedback && (
          <div className={`mb-5 flex items-center gap-3 rounded-2xl border px-5 py-4 text-sm font-bold ${
            feedback.type === 'success'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
              : 'border-red-500/30 bg-red-500/10 text-red-200'
          }`}
          >
            {feedback.type === 'success' ? <Check className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
            {feedback.message}
          </div>
        )}

        {hasUnsavedChanges && (
          <div className="mb-5 flex items-center justify-between gap-4 rounded-2xl border border-amber-400/40 bg-amber-500/10 px-5 py-4 text-sm font-bold text-amber-100">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-5 w-5" />
              Voce tem alteracoes nao salvas. Se sair ou recarregar a pagina, perdera as mudancas.
            </div>
            <button
              type="button"
              onClick={() => {
                const resetForm = buildForm(selectedItem?.config);
                setForm(resetForm);
                setSavedSnapshot(snapshot(resetForm));
              }}
              className="rounded-xl border border-amber-300/40 px-4 py-2 text-xs font-black uppercase tracking-[0.16em] hover:bg-amber-300/10"
            >
              Descartar
            </button>
          </div>
        )}

        {loading ? (
          <div className="flex min-h-[420px] items-center justify-center rounded-[28px] border border-cyan-500/20 bg-slate-950/70">
            <Loader2 className="h-8 w-8 animate-spin text-cyan-300" />
          </div>
        ) : (
          <div className="grid min-h-[680px] overflow-hidden rounded-[28px] border border-cyan-500/20 bg-slate-950/80 xl:grid-cols-[320px_minmax(0,1fr)]">
            <aside className="border-b border-slate-800 p-5 xl:border-b-0 xl:border-r">
              <div className="mb-5 flex items-center gap-3">
                <Building2 className="h-5 w-5 text-cyan-300" />
                <div>
                  <h2 className="text-lg font-black">Concessionarias</h2>
                  <p className="text-xs font-bold text-slate-500">Clique para configurar o bot</p>
                </div>
              </div>

              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar concessionaria..."
                className="mb-5 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm font-bold text-white outline-none transition focus:border-cyan-400"
              />

              <div className="max-h-[560px] space-y-2 overflow-y-auto pr-1">
                {filteredItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => selectConcessionaria(item.id)}
                    className={`group flex w-full items-center justify-between gap-3 rounded-2xl border p-4 text-left transition ${
                      selectedId === item.id
                        ? 'border-cyan-400 bg-cyan-500/10'
                        : 'border-slate-800 bg-slate-900/50 hover:border-cyan-500/40'
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black text-white">{item.nome}</p>
                      <p className={`mt-1 text-[10px] font-black uppercase tracking-[0.18em] ${
                        item.config?.status === 'ativo' ? 'text-emerald-300' : 'text-slate-500'
                      }`}
                      >
                        {item.config ? `Bot ${item.config.status}` : 'Sem modelo'}
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-slate-500 transition group-hover:text-cyan-300" />
                  </button>
                ))}
              </div>
            </aside>

            <section className="p-5 lg:p-7">
              {selectedItem ? (
                <form onSubmit={saveModel} className="grid gap-6 2xl:grid-cols-[minmax(0,520px)_minmax(0,1fr)]">
                  <div>
                    <div className="mb-5 rounded-[24px] border border-slate-800 bg-[#050b16] p-5">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-xs font-black uppercase tracking-[0.28em] text-cyan-300">Concessionaria selecionada</p>
                          <h2 className="mt-2 text-2xl font-black">{selectedItem.nome}</h2>
                          <p className="mt-2 text-sm font-bold text-slate-400">
                            O bot desta concessionaria sera disparado quando o lead cair no CRM.
                          </p>
                        </div>
                        <span className={`rounded-full px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] ${
                          form.status === 'ativo' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-700 text-slate-300'
                        }`}
                        >
                          {form.status}
                        </span>
                      </div>
                    </div>

                    <div className="rounded-[24px] border border-slate-800 bg-slate-900/40 p-5">
                      <div className="mb-5 flex items-center gap-2 text-cyan-300">
                        <Sparkles className="h-5 w-5" />
                        <h3 className="text-lg font-black text-white">Modelos prontos</h3>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-1">
                        {BOT_TEMPLATES.map((template) => (
                          <button
                            key={template.id}
                            type="button"
                            onClick={() => useTemplate(template)}
                            className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-left transition hover:border-cyan-500/50 hover:bg-cyan-500/10"
                          >
                            <div className="mb-3 flex items-center justify-between gap-3">
                              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10 text-blue-300">
                                <MessageSquare className="h-5 w-5" />
                              </div>
                              <span className="rounded-full bg-slate-800 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-slate-300">
                                {template.categoria}
                              </span>
                            </div>
                            <p className="text-sm font-black text-white">{template.nome}</p>
                            <p className="mt-2 text-xs font-bold leading-5 text-slate-400">{template.descricao}</p>
                            <div className="mt-4 inline-flex items-center gap-2 text-xs font-black text-cyan-300">
                              Usar modelo
                              <Edit3 className="h-3.5 w-3.5" />
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-[24px] border border-slate-800 bg-[#050b16] p-5">
                    <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <div className="flex items-center gap-2 text-cyan-300">
                          <Wand2 className="h-5 w-5" />
                          <p className="text-xs font-black uppercase tracking-[0.28em]">Modelo por prompt</p>
                        </div>
                        <h3 className="mt-1 text-2xl font-black">Criar ou editar modelo</h3>
                      </div>
                      <button
                        type="button"
                        onClick={createModel}
                        className="inline-flex items-center justify-center gap-2 rounded-2xl border border-cyan-400/40 px-4 py-3 text-xs font-black uppercase tracking-[0.16em] text-cyan-200 transition hover:bg-cyan-500/10"
                      >
                        <Plus className="h-4 w-4" />
                        Novo modelo
                      </button>
                    </div>

                    <div className="grid gap-4 lg:grid-cols-[1fr_180px]">
                      <label>
                        <span className="mb-2 block text-xs font-black uppercase tracking-[0.24em] text-slate-400">Nome do modelo</span>
                        <input
                          value={form.nome}
                          onChange={(event) => setFormField('nome', event.target.value)}
                          className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-4 text-sm font-black text-white outline-none focus:border-cyan-400"
                        />
                      </label>

                      <label>
                        <span className="mb-2 block text-xs font-black uppercase tracking-[0.24em] text-slate-400">Status</span>
                        <select
                          value={form.status}
                          onChange={(event) => setFormField('status', event.target.value as BotFormState['status'])}
                          className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-4 text-sm font-black text-white outline-none focus:border-cyan-400"
                        >
                          <option value="ativo">Ativo</option>
                          <option value="inativo">Inativo</option>
                        </select>
                      </label>
                    </div>

                    <label className="mt-4 block">
                      <span className="mb-2 block text-xs font-black uppercase tracking-[0.24em] text-slate-400">Categoria</span>
                      <input
                        value={form.categoria}
                        onChange={(event) => setFormField('categoria', event.target.value)}
                        className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-4 text-sm font-black text-white outline-none focus:border-cyan-400"
                      />
                    </label>

                    <label className="mt-4 block">
                      <span className="mb-2 block text-xs font-black uppercase tracking-[0.24em] text-slate-400">Prompt do modelo</span>
                      <textarea
                        value={form.prompt}
                        onChange={(event) => setFormField('prompt', event.target.value)}
                        rows={16}
                        className="w-full resize-y rounded-2xl border border-slate-700 bg-slate-950 px-4 py-4 text-sm font-bold leading-6 text-white outline-none focus:border-cyan-400"
                      />
                    </label>

                    <div className="mt-3 rounded-2xl border border-slate-800 bg-slate-900/50 p-4 text-xs font-bold leading-5 text-slate-400">
                      Variaveis disponiveis: {'{primeiro_nome}'}, {'{nome}'}, {'{telefone}'}, {'{idades}'}, {'{cidade}'}, {'{operadora}'}, {'{concessionaria}'}.
                    </div>

                    <div className="mt-6 flex justify-end">
                      <button
                        type="submit"
                        disabled={saving}
                        className="inline-flex min-w-[190px] items-center justify-center gap-2 rounded-2xl bg-blue-600 px-8 py-4 text-sm font-black text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-500 disabled:cursor-wait disabled:opacity-70"
                      >
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                        Salvar modelo
                      </button>
                    </div>
                  </div>
                </form>
              ) : (
                <div className="flex min-h-[520px] flex-col items-center justify-center rounded-[24px] border border-slate-800 bg-slate-900/30 text-center">
                  <Building2 className="mb-4 h-10 w-10 text-slate-600" />
                  <h2 className="text-2xl font-black">Nenhuma concessionaria encontrada</h2>
                  <p className="mt-2 max-w-md text-sm font-bold text-slate-500">
                    Crie uma concessionaria primeiro para configurar o bot de primeiro atendimento.
                  </p>
                </div>
              )}
            </section>
          </div>
        )}
      </main>
    </InternalLayout>
  );
}
