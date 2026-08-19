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
  Smartphone,
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
  sender_mode?: 'automatic' | 'profile' | 'dedicated' | null;
  sender_profile_id?: string | null;
  dedicated_instance_name?: string | null;
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
  senderKey: string;
}

interface BotSenderOption {
  key: string;
  mode: 'profile' | 'dedicated';
  profile_id: string | null;
  instance_name: string;
  source: 'inbox' | 'ai';
  owner_name: string;
  phone: string;
  connected: boolean;
  state: string;
}

interface BotHealth {
  healthy: boolean;
  state: string;
  instance_name?: string | null;
  phone?: string | null;
  owner_name?: string | null;
  sender_mode?: string | null;
}

type WorkspaceMode = 'empty' | 'summary' | 'editor';

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
    senderKey: config?.sender_mode === 'profile' && config.sender_profile_id
      ? `profile:${config.sender_profile_id}`
      : config?.sender_mode === 'dedicated' && config.dedicated_instance_name
        ? `dedicated:${config.dedicated_instance_name}`
        : '',
  };
}

function snapshot(form: BotFormState) {
  return JSON.stringify(form);
}

function cleanBrief(value: string) {
  return value
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 700);
}

function buildPromptFromBrief(brief: string) {
  const safeBrief = cleanBrief(brief);
  const context = safeBrief || 'planos de saude';

  return `Ola, {primeiro_nome}! Tudo bem?

Voce acabou de preencher o nosso formulario para ${context}.

Logo um dos nossos especialistas vai entrar em contato para te atender com mais detalhes.`;
}

function buildPromptRevision(prompt: string, revision: string) {
  const cleanRevision = cleanBrief(revision);
  if (!cleanRevision) return prompt;

  const lowerRevision = cleanRevision.toLowerCase();
  if (lowerRevision.includes('curt') || lowerRevision.includes('menor') || lowerRevision.includes('objetiv')) {
    return `Ola, {primeiro_nome}! Tudo bem?

Recebemos seu formulario.

Um especialista vai te chamar em breve para continuar o atendimento.`;
  }

  if (lowerRevision.includes('formal')) {
    return `Ola, {primeiro_nome}. Tudo bem?

Recebemos seu formulario para planos de saude.

Em breve, um especialista entrara em contato para dar continuidade ao seu atendimento.`;
  }

  if (lowerRevision.includes('human') || lowerRevision.includes('natural')) {
    return `Ola, {primeiro_nome}! Tudo bem?

Vi aqui que voce acabou de preencher nosso formulario.

Ja deixei tudo encaminhado e um especialista vai te chamar para seguir com seu atendimento.`;
  }

  return `${prompt.trim()}

Observacao para o atendimento: ${cleanRevision}`;
}

function previewPrompt(prompt: string, selectedItem?: BotWorkspaceItem) {
  return prompt
    .replaceAll('{primeiro_nome}', 'Teste')
    .replaceAll('{nome}', 'Teste do Bot')
    .replaceAll('{telefone}', '5561999999999')
    .replaceAll('{idades}', '32')
    .replaceAll('{cidade}', 'Brasilia')
    .replaceAll('{operadora}', 'Hapvida')
    .replaceAll('{concessionaria}', selectedItem?.nome || 'sua concessionaria');
}

export default function AdminBotPage() {
  const { actualProfile } = useAuth();
  const [items, setItems] = useState<BotWorkspaceItem[]>([]);
  const [senderOptionsByCorretora, setSenderOptionsByCorretora] = useState<Record<string, BotSenderOption[]>>({});
  const [botHealthByCorretora, setBotHealthByCorretora] = useState<Record<string, BotHealth>>({});
  const [selectedId, setSelectedId] = useState('');
  const [form, setForm] = useState<BotFormState>(() => buildForm());
  const [savedSnapshot, setSavedSnapshot] = useState(() => snapshot(buildForm()));
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('empty');
  const [botBrief, setBotBrief] = useState('');
  const [revisionBrief, setRevisionBrief] = useState('');
  const [showRevision, setShowRevision] = useState(false);
  const [showTest, setShowTest] = useState(false);
  const [testPhone, setTestPhone] = useState('');
  const [testing, setTesting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const isAdmin = actualProfile?.tipo_usuario === 'admin';
  const selectedItem = items.find((item) => item.id === selectedId);
  const selectedSenderOptions = senderOptionsByCorretora[selectedId] || [];
  const selectedSender = selectedSenderOptions.find((option) => option.key === form.senderKey);
  const selectedHealth = selectedId ? botHealthByCorretora[selectedId] : undefined;
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
      setSenderOptionsByCorretora(data.senderOptionsByCorretora || {});
      setBotHealthByCorretora(data.botHealthByCorretora || {});
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
        : '';
      setSelectedId(nextSelected);
      if (!nextSelected) setWorkspaceMode('empty');

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
    setWorkspaceMode('summary');
    setBotBrief('');
    setRevisionBrief('');
    setShowRevision(false);
    setShowTest(false);
    setFeedback(null);
  }

  function useTemplate(template: BotTemplate) {
    setForm((current) => ({
      ...current,
      nome: template.nome,
      categoria: template.categoria,
      prompt: template.prompt,
    }));
    setWorkspaceMode('editor');
    setShowRevision(false);
    setShowTest(false);
    setFeedback(null);
  }

  function createModel() {
    if (!selectedItem?.id) {
      setFeedback({ type: 'error', message: 'Selecione uma concessionaria antes de criar um modelo.' });
      return;
    }

    setForm({
      nome: 'Novo modelo',
      categoria: 'Atendimento',
      prompt: '',
      status: 'inativo',
      senderKey: '',
    });
    setWorkspaceMode('editor');
    setBotBrief('');
    setRevisionBrief('');
    setShowRevision(false);
    setShowTest(false);
    setFeedback(null);
  }

  function generatePrompt() {
    if (!botBrief.trim()) {
      setFeedback({ type: 'error', message: 'Descreva o fluxo que voce quer criar antes de gerar o prompt.' });
      return;
    }

    setForm((current) => ({
      ...current,
      nome: current.nome === 'Novo modelo' ? 'Primeiro atendimento' : current.nome,
      categoria: current.categoria || 'Atendimento',
      prompt: buildPromptFromBrief(botBrief),
    }));
    setShowRevision(false);
    setShowTest(false);
    setFeedback({ type: 'success', message: 'Prompt gerado localmente. Revise antes de salvar ou testar.' });
  }

  function revisePrompt() {
    if (!form.prompt.trim()) {
      setFeedback({ type: 'error', message: 'Gere um prompt antes de revisar.' });
      return;
    }
    if (!revisionBrief.trim()) {
      setFeedback({ type: 'error', message: 'Escreva o que voce quer revisar no prompt.' });
      return;
    }

    setForm((current) => ({
      ...current,
      prompt: buildPromptRevision(current.prompt, revisionBrief),
    }));
    setRevisionBrief('');
    setFeedback({ type: 'success', message: 'Prompt revisado. Confira o texto antes de salvar.' });
  }

  async function testModel() {
    if (!form.prompt.trim()) {
      setFeedback({ type: 'error', message: 'Gere ou escreva um prompt antes de testar.' });
      return;
    }
    if (!testPhone.trim()) {
      setFeedback({ type: 'error', message: 'Informe o WhatsApp de destino para o teste.' });
      return;
    }
    if (!selectedSender || !selectedItem?.id) {
      setFeedback({ type: 'error', message: 'Escolha primeiro o WhatsApp conectado que o bot vai usar.' });
      return;
    }

    setTesting(true);
    setFeedback(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        setFeedback({ type: 'error', message: 'Sessao expirada. Faca login novamente.' });
        return;
      }

      const response = await fetch('/api/admin/bot', {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          corretora_id: selectedItem.id,
          telefone: testPhone,
          mensagem: previewPrompt(form.prompt, selectedItem),
          sender_mode: selectedSender.mode,
          sender_profile_id: selectedSender.profile_id,
          dedicated_instance_name: selectedSender.mode === 'dedicated' ? selectedSender.instance_name : null,
        }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setFeedback({ type: 'error', message: data.error || 'Erro ao enviar o teste pelo WhatsApp escolhido.' });
        return;
      }

      const senderLabel = data.sender?.owner_name || selectedSender.owner_name;
      setFeedback({ type: 'success', message: `Teste enviado pelo WhatsApp de ${senderLabel}.` });
    } catch (error: any) {
      setFeedback({ type: 'error', message: error?.message || 'Erro ao testar bot.' });
    } finally {
      setTesting(false);
    }
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

    if (form.status === 'ativo' && !selectedSender) {
      setFeedback({ type: 'error', message: 'Escolha um WhatsApp conectado antes de ativar o bot.' });
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
          sender_mode: selectedSender?.mode || null,
          sender_profile_id: selectedSender?.profile_id || null,
          dedicated_instance_name: selectedSender?.mode === 'dedicated' ? selectedSender.instance_name : null,
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
      setWorkspaceMode('summary');
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
              {!selectedItem || workspaceMode === 'empty' ? (
                <div className="flex min-h-[520px] flex-col items-center justify-center rounded-[24px] border border-slate-800 bg-slate-900/30 text-center">
                  <Building2 className="mb-4 h-10 w-10 text-slate-600" />
                  <h2 className="text-2xl font-black">
                    {items.length ? 'Selecione uma concessionaria' : 'Nenhuma concessionaria encontrada'}
                  </h2>
                  <p className="mt-2 max-w-md text-sm font-bold text-slate-500">
                    {items.length
                      ? 'Clique em uma concessionaria na coluna ao lado para ver ou criar o bot dela.'
                      : 'Crie uma concessionaria primeiro para configurar o bot de primeiro atendimento.'}
                  </p>
                </div>
              ) : workspaceMode === 'editor' ? (
                <form onSubmit={saveModel} className="grid gap-6 2xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
                  <div className="space-y-5">
                    <div className="rounded-[24px] border border-cyan-500/20 bg-[#050b16] p-5">
                      <p className="text-xs font-black uppercase tracking-[0.28em] text-cyan-300">Concessionaria selecionada</p>
                      <h2 className="mt-2 text-2xl font-black">{selectedItem.nome}</h2>
                      <p className="mt-2 text-sm font-bold leading-6 text-slate-400">
                        Descreva o fluxo em linguagem simples. A geracao e local e nao envia dados sensiveis para IA externa.
                      </p>
                    </div>

                    <div className="rounded-[24px] border border-slate-800 bg-slate-900/40 p-5">
                      <div className="mb-5 flex items-center gap-2 text-cyan-300">
                        <Sparkles className="h-5 w-5" />
                        <h3 className="text-lg font-black text-white">Criar bot</h3>
                      </div>

                      <label className="block">
                        <span className="mb-2 block text-xs font-black uppercase tracking-[0.24em] text-slate-400">
                          O que voce quer criar?
                        </span>
                        <textarea
                          value={botBrief}
                          onChange={(event) => setBotBrief(event.target.value)}
                          rows={8}
                          placeholder="Ex: Quero um bot de primeiro contato que avise que o lead preencheu o formulario e diga que um especialista vai chamar em breve."
                          className="w-full resize-y rounded-2xl border border-slate-700 bg-slate-950 px-4 py-4 text-sm font-bold leading-6 text-white outline-none transition focus:border-cyan-400"
                        />
                      </label>

                      <button
                        type="button"
                        onClick={generatePrompt}
                        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-cyan-500 px-5 py-4 text-sm font-black text-white shadow-lg shadow-cyan-500/20 transition hover:bg-cyan-400"
                      >
                        <Wand2 className="h-4 w-4" />
                        Gerar prompt
                      </button>

                      <p className="mt-3 text-xs font-bold leading-5 text-slate-500">
                        O prompt gerado usa apenas texto local e variaveis seguras do CRM.
                      </p>
                    </div>

                    <div className="rounded-[24px] border border-slate-800 bg-slate-900/30 p-5">
                      <div className="mb-4 flex items-center gap-2 text-cyan-300">
                        <MessageSquare className="h-5 w-5" />
                        <h3 className="text-sm font-black uppercase tracking-[0.18em] text-white">Modelos prontos</h3>
                      </div>
                      <div className="grid gap-2">
                        {BOT_TEMPLATES.slice(0, 3).map((template) => (
                          <button
                            key={template.id}
                            type="button"
                            onClick={() => useTemplate(template)}
                            className="rounded-2xl border border-slate-800 bg-slate-950/70 px-4 py-3 text-left text-xs font-black text-slate-200 transition hover:border-cyan-500/50 hover:bg-cyan-500/10"
                          >
                            {template.nome}
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
                      <span className={`rounded-full px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] ${
                        form.status === 'ativo' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-700 text-slate-300'
                      }`}
                      >
                        {form.status}
                      </span>
                    </div>

                    <div className="mb-5 rounded-[22px] border border-cyan-400/40 bg-cyan-500/10 p-5 shadow-lg shadow-cyan-950/20">
                      <div className="mb-3 flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-400/15 text-cyan-200">
                          <Smartphone className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="text-xs font-black uppercase tracking-[0.22em] text-cyan-200">Numero de envio</p>
                          <p className="mt-1 text-sm font-bold text-slate-300">Escolha o WhatsApp que vai enviar a mensagem do bot e os testes.</p>
                        </div>
                      </div>
                      <select
                        value={form.senderKey}
                        onChange={(event) => setFormField('senderKey', event.target.value)}
                        className="w-full rounded-2xl border border-cyan-400/40 bg-slate-950 px-4 py-4 text-sm font-black text-white outline-none focus:border-cyan-300"
                      >
                        <option value="">Selecione um numero conectado</option>
                        {selectedSenderOptions.map((option) => (
                          <option key={option.key} value={option.key}>
                            {option.owner_name} - {option.phone || 'numero conectado'} - {option.source === 'ai' ? 'Pagina IA' : 'Inbox'}
                          </option>
                        ))}
                      </select>
                      {!selectedSenderOptions.length ? (
                        <p className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-bold text-amber-200">
                          Nenhum WhatsApp conectado foi encontrado para esta concessionaria.
                        </p>
                      ) : selectedSender ? (
                        <p className="mt-3 text-xs font-bold text-emerald-300">
                          Conectado: {selectedSender.owner_name} - {selectedSender.phone || 'numero identificado'}.
                        </p>
                      ) : null}
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
                          <option value="inativo">Inativo</option>
                          <option value="ativo">Ativo</option>
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
                        rows={14}
                        placeholder="Gere um prompt a partir da descricao ou escreva aqui manualmente."
                        className="w-full resize-y rounded-2xl border border-slate-700 bg-slate-950 px-4 py-4 text-sm font-bold leading-6 text-white outline-none focus:border-cyan-400"
                      />
                    </label>

                    <div className="mt-3 rounded-2xl border border-slate-800 bg-slate-900/50 p-4 text-xs font-bold leading-5 text-slate-400">
                      Variaveis disponiveis: {'{primeiro_nome}'}, {'{nome}'}, {'{telefone}'}, {'{idades}'}, {'{cidade}'}, {'{operadora}'}, {'{concessionaria}'}.
                    </div>

                    {form.prompt.trim() && (
                      <div className="mt-6 grid gap-3 lg:grid-cols-3">
                        <button
                          type="submit"
                          disabled={saving}
                          className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 py-4 text-sm font-black text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-500 disabled:cursor-wait disabled:opacity-70"
                        >
                          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                          Criar bot
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowRevision((current) => !current)}
                          className="inline-flex items-center justify-center gap-2 rounded-2xl border border-cyan-400/40 px-5 py-4 text-sm font-black text-cyan-200 transition hover:bg-cyan-500/10"
                        >
                          <Edit3 className="h-4 w-4" />
                          Revisar prompt
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (!selectedSender) {
                              setFeedback({ type: 'error', message: 'Escolha primeiro o WhatsApp conectado que o bot vai usar.' });
                              return;
                            }
                            setShowTest((current) => !current);
                          }}
                          className="inline-flex items-center justify-center gap-2 rounded-2xl border border-emerald-400/40 px-5 py-4 text-sm font-black text-emerald-200 transition hover:bg-emerald-500/10"
                        >
                          <MessageSquare className="h-4 w-4" />
                          Testar bot
                        </button>
                      </div>
                    )}

                    {showRevision && (
                      <div className="mt-5 rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4">
                        <label className="block">
                          <span className="mb-2 block text-xs font-black uppercase tracking-[0.24em] text-cyan-200">
                            O que voce quer revisar?
                          </span>
                          <textarea
                            value={revisionBrief}
                            onChange={(event) => setRevisionBrief(event.target.value)}
                            rows={4}
                            placeholder="Ex: deixa mais curto, mais humano, mais formal..."
                            className="w-full resize-y rounded-2xl border border-slate-700 bg-slate-950 px-4 py-4 text-sm font-bold leading-6 text-white outline-none focus:border-cyan-400"
                          />
                        </label>
                        <button
                          type="button"
                          onClick={revisePrompt}
                          className="mt-3 rounded-2xl bg-cyan-500 px-5 py-3 text-xs font-black uppercase tracking-[0.16em] text-white transition hover:bg-cyan-400"
                        >
                          Aplicar revisao
                        </button>
                      </div>
                    )}

                    {showTest && (
                      <div className="mt-5 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4">
                        <label className="block">
                          <span className="mb-2 block text-xs font-black uppercase tracking-[0.24em] text-emerald-200">
                            WhatsApp para testar
                          </span>
                          <input
                            value={testPhone}
                            onChange={(event) => setTestPhone(event.target.value)}
                            placeholder="5561999999999"
                            className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-4 text-sm font-black text-white outline-none focus:border-emerald-400"
                          />
                        </label>
                        <button
                          type="button"
                          onClick={testModel}
                          disabled={testing}
                          className="mt-3 inline-flex items-center gap-2 rounded-2xl bg-emerald-500 px-5 py-3 text-xs font-black uppercase tracking-[0.16em] text-white transition hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-70"
                        >
                          {testing && <Loader2 className="h-4 w-4 animate-spin" />}
                          Enviar pelo numero selecionado
                        </button>
                        {selectedSender && (
                          <p className="mt-3 text-xs font-bold text-emerald-300">
                            O teste sera enviado por {selectedSender.owner_name} - {selectedSender.phone || 'numero conectado'}.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </form>
              ) : (
                <div className="space-y-5">
                  <div className="rounded-[24px] border border-cyan-500/20 bg-[#050b16] p-6">
                    <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <p className="text-xs font-black uppercase tracking-[0.28em] text-cyan-300">Concessionaria selecionada</p>
                        <h2 className="mt-2 text-3xl font-black">{selectedItem.nome}</h2>
                        <p className="mt-2 text-sm font-bold text-slate-400">
                          {selectedItem.config
                            ? 'Esta concessionaria ja tem um bot configurado.'
                            : 'Esta concessionaria ainda nao tem bot de primeiro atendimento.'}
                        </p>
                      </div>
                      <span className={`w-fit rounded-full px-4 py-2 text-[10px] font-black uppercase tracking-[0.16em] ${
                        selectedItem.config?.status === 'ativo' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-700 text-slate-300'
                      }`}
                      >
                        {selectedItem.config?.status || 'sem bot'}
                      </span>
                    </div>

                    {selectedItem.config ? (
                      <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-950/70 p-5">
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                          <div>
                            <h3 className="text-xl font-black">{selectedItem.config.nome}</h3>
                            <p className="mt-1 text-xs font-black uppercase tracking-[0.18em] text-slate-500">
                              Gatilho: CRM
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-3">
                            <button
                              type="button"
                              onClick={() => setWorkspaceMode('editor')}
                              className="inline-flex items-center gap-2 rounded-2xl border border-cyan-400/40 px-5 py-3 text-xs font-black uppercase tracking-[0.16em] text-cyan-200 transition hover:bg-cyan-500/10"
                            >
                              <Edit3 className="h-4 w-4" />
                              Editar modelo
                            </button>
                            <button
                              type="button"
                              onClick={createModel}
                              className="inline-flex items-center gap-2 rounded-2xl bg-cyan-500 px-5 py-3 text-xs font-black uppercase tracking-[0.16em] text-white transition hover:bg-cyan-400"
                            >
                              <Plus className="h-4 w-4" />
                              Criar novo
                            </button>
                          </div>
                        </div>
                        <div className={`mt-4 flex items-start gap-3 rounded-2xl border p-4 ${
                          selectedHealth?.healthy
                            ? 'border-emerald-500/30 bg-emerald-500/10'
                            : 'border-amber-500/30 bg-amber-500/10'
                        }`}>
                          <Smartphone className={`mt-0.5 h-5 w-5 shrink-0 ${selectedHealth?.healthy ? 'text-emerald-300' : 'text-amber-300'}`} />
                          <div>
                            <p className={`text-xs font-black uppercase tracking-[0.18em] ${selectedHealth?.healthy ? 'text-emerald-200' : 'text-amber-200'}`}>
                              {selectedHealth?.healthy ? 'WhatsApp conectado' : 'WhatsApp precisa de verificacao'}
                            </p>
                            <p className="mt-1 text-sm font-bold text-slate-300">
                              {selectedHealth?.owner_name || 'Remetente automatico atual'}
                              {selectedHealth?.phone ? ` - ${selectedHealth.phone}` : ''}
                            </p>
                            {selectedHealth?.sender_mode === 'automatic' && (
                              <p className="mt-1 text-xs font-bold text-slate-500">
                                Bot legado preservado. Ao editar, escolha explicitamente o numero que ele deve usar.
                              </p>
                            )}
                          </div>
                        </div>
                        <pre className="mt-5 whitespace-pre-wrap rounded-2xl border border-slate-800 bg-slate-900/60 p-4 text-sm font-bold leading-6 text-slate-200">
                          {selectedItem.config.primeira_mensagem}
                        </pre>
                      </div>
                    ) : (
                      <div className="mt-6 rounded-2xl border border-dashed border-cyan-500/30 bg-cyan-500/5 p-6">
                        <h3 className="text-xl font-black">Criar bot</h3>
                        <p className="mt-2 text-sm font-bold leading-6 text-slate-400">
                          Crie um modelo por prompt para enviar a primeira mensagem quando o lead cair no CRM.
                        </p>
                        <button
                          type="button"
                          onClick={createModel}
                          className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-cyan-500 px-6 py-4 text-sm font-black text-white transition hover:bg-cyan-400"
                        >
                          <Plus className="h-4 w-4" />
                          Criar bot
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="rounded-[24px] border border-slate-800 bg-slate-900/30 p-5">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-cyan-300">
                        <Sparkles className="h-5 w-5" />
                        <h3 className="text-sm font-black uppercase tracking-[0.18em] text-white">Modelos prontos</h3>
                      </div>
                      <span className="text-xs font-bold text-slate-500">Opcional</span>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                      {BOT_TEMPLATES.map((template) => (
                        <button
                          key={template.id}
                          type="button"
                          onClick={() => useTemplate(template)}
                          className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-left transition hover:border-cyan-500/50 hover:bg-cyan-500/10"
                        >
                          <p className="text-sm font-black text-white">{template.nome}</p>
                          <p className="mt-2 line-clamp-2 text-xs font-bold leading-5 text-slate-500">{template.descricao}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </section>
          </div>
        )}
      </main>
    </InternalLayout>
  );
}
