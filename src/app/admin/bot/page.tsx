'use client';

import { useEffect, useMemo, useState } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import { useAuth } from '@/components/providers/AuthProvider';
import { supabase } from '@/lib/supabase/client';
import {
  AlertCircle,
  BellRing,
  Bot,
  Building2,
  Check,
  GitBranch,
  Loader2,
  MessageSquare,
  Plus,
  Save,
  Send,
  Trash2,
  Workflow,
} from 'lucide-react';

interface Corretora {
  id: string;
  nome: string;
  status: string;
}

type BotNodeType = 'trigger' | 'message' | 'condition' | 'action' | 'question';

interface BotFlowNode {
  id: string;
  type: BotNodeType;
  label: string;
  description: string;
  branch?: 'true' | 'false';
}

interface BotConfig {
  id: string;
  corretora_id: string;
  nome: string;
  trigger_key: string;
  primeira_mensagem: string;
  fluxo: BotFlowNode[];
  status: string;
  created_at?: string;
  updated_at?: string;
  corretoras?: {
    nome: string;
  };
}

const DEFAULT_MESSAGE = `Ola, {primeiro_nome}! Tudo bem?

Voce acabou de preencher nosso formulario para planos de saude.

Logo um de nossos especialistas entrara em contato para te ajudar.`;

const DEFAULT_FLOW: BotFlowNode[] = [
  { id: 'trigger_crm', type: 'trigger', label: 'Gatilho CRM', description: 'Quando o lead cair no CRM' },
  { id: 'message_first', type: 'message', label: 'Primeiro atendimento', description: 'Mensagem fixa enviada ao lead' },
  { id: 'condition_response', type: 'condition', label: 'Resposta do lead', description: 'Condição true/false para continuar' },
  { id: 'notify_broker', type: 'action', label: 'Acionar corretor', description: 'Encaminha para o responsavel' },
];

const nodeStyles: Record<BotNodeType, string> = {
  trigger: 'border-cyan-400/50 bg-cyan-500/10 text-cyan-200',
  message: 'border-blue-400/50 bg-blue-500/10 text-blue-100',
  condition: 'border-emerald-400/50 bg-emerald-500/10 text-emerald-100',
  action: 'border-amber-400/50 bg-amber-500/10 text-amber-100',
  question: 'border-purple-400/50 bg-purple-500/10 text-purple-100',
};

function normalizeFlow(value: unknown): BotFlowNode[] {
  return Array.isArray(value) && value.length ? value as BotFlowNode[] : DEFAULT_FLOW;
}

export default function AdminBotPage() {
  const { actualProfile } = useAuth();
  const [activeConfigs, setActiveConfigs] = useState<BotConfig[]>([]);
  const [inactiveCorretoras, setInactiveCorretoras] = useState<Corretora[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedConfig, setSelectedConfig] = useState<Partial<BotConfig> | null>(null);
  const [selectedCorretoraId, setSelectedCorretoraId] = useState('');
  const [nome, setNome] = useState('Primeiro atendimento');
  const [status, setStatus] = useState('ativo');
  const [message, setMessage] = useState(DEFAULT_MESSAGE);
  const [flow, setFlow] = useState<BotFlowNode[]>(DEFAULT_FLOW);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const isAdmin = actualProfile?.tipo_usuario === 'admin';

  async function loadData() {
    if (!isAdmin) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) {
        setError('Sessao expirada. Faca login novamente.');
        return;
      }

      const response = await fetch('/api/admin/bot', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Erro ao carregar bots.');
        return;
      }

      setActiveConfigs(data.activeConfigs || []);
      setInactiveCorretoras(data.inactiveCorretoras || []);
    } catch (err: any) {
      setError(err?.message || 'Erro de rede ao carregar bots.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [isAdmin]);

  const filteredConfigs = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return activeConfigs;
    return activeConfigs.filter((config) =>
      config.nome.toLowerCase().includes(term) ||
      (config.corretoras?.nome || '').toLowerCase().includes(term)
    );
  }, [activeConfigs, search]);

  function startNew() {
    if (!inactiveCorretoras.length) {
      setError('Todas as concessionarias ativas ja possuem bot configurado.');
      return;
    }

    setSelectedConfig(null);
    setSelectedCorretoraId(inactiveCorretoras[0].id);
    setNome('Primeiro atendimento');
    setStatus('ativo');
    setMessage(DEFAULT_MESSAGE);
    setFlow(DEFAULT_FLOW);
    setSuccess(null);
    setError(null);
  }

  function editConfig(config: BotConfig) {
    setSelectedConfig(config);
    setSelectedCorretoraId(config.corretora_id);
    setNome(config.nome || 'Primeiro atendimento');
    setStatus(config.status || 'ativo');
    setMessage(config.primeira_mensagem || DEFAULT_MESSAGE);
    setFlow(normalizeFlow(config.fluxo));
    setSuccess(null);
    setError(null);
  }

  function addNode(type: BotNodeType, label: string, description: string, branch?: 'true' | 'false') {
    setFlow((current) => [
      ...current,
      {
        id: `${type}_${Date.now()}`,
        type,
        label,
        description,
        branch,
      },
    ]);
  }

  async function saveConfig(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedCorretoraId || !nome.trim() || !message.trim()) {
      setError('Preencha concessionaria, nome do modelo e primeira mensagem.');
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) {
        setError('Sessao expirada. Faca login novamente.');
        return;
      }

      const response = await fetch('/api/admin/bot', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          corretora_id: selectedCorretoraId,
          nome,
          trigger_key: 'crm',
          primeira_mensagem: message,
          fluxo: flow,
          status,
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Erro ao salvar bot.');
        return;
      }

      setSuccess('Bot salvo. O primeiro atendimento sera enviado quando o lead cair no CRM.');
      await loadData();
      if (data.config) editConfig({ ...data.config, fluxo: normalizeFlow(data.config.fluxo) });
    } catch (err: any) {
      setError(err?.message || 'Erro ao salvar bot.');
    } finally {
      setSaving(false);
    }
  }

  async function deleteConfig(id?: string) {
    if (!id) return;
    if (!window.confirm('Desativar este bot da concessionaria?')) return;

    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      const response = await fetch(`/api/admin/bot?id=${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Erro ao remover bot.');
        return;
      }

      setSuccess('Bot removido.');
      setSelectedConfig(null);
      await loadData();
    } catch (err: any) {
      setError(err?.message || 'Erro ao remover bot.');
    } finally {
      setSaving(false);
    }
  }

  if (!isAdmin) {
    return (
      <InternalLayout>
        <main className="min-h-screen px-6 py-10 text-white">
          <div className="rounded-[28px] border border-red-500/30 bg-red-500/10 p-8">
            <h1 className="text-2xl font-black">Acesso restrito</h1>
            <p className="mt-2 text-sm text-slate-300">A pagina de Bot esta disponivel apenas para Dev e Admin Orion.</p>
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
              Configure bots simples por concessionaria. O gatilho padrao e CRM: quando o lead entra, o bot envia o primeiro atendimento.
            </p>
          </div>
          <button
            type="button"
            onClick={startNew}
            className="inline-flex items-center justify-center gap-2 rounded-[18px] bg-cyan-500 px-6 py-4 text-sm font-black text-white shadow-lg shadow-cyan-500/20 transition hover:bg-cyan-400"
          >
            <Plus className="h-4 w-4" />
            Ativar Nova Concessionaria
          </button>
        </section>

        {error && (
          <div className="mb-5 flex items-center gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 px-5 py-4 text-sm font-bold text-red-200">
            <AlertCircle className="h-5 w-5" />
            {error}
          </div>
        )}
        {success && (
          <div className="mb-5 flex items-center gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-5 py-4 text-sm font-bold text-emerald-200">
            <Check className="h-5 w-5" />
            {success}
          </div>
        )}

        {loading ? (
          <div className="flex min-h-[420px] items-center justify-center rounded-[28px] border border-cyan-500/20 bg-slate-950/70">
            <Loader2 className="h-8 w-8 animate-spin text-cyan-300" />
          </div>
        ) : (
          <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
            <aside className="rounded-[28px] border border-cyan-500/20 bg-slate-950/80 p-5">
              <div className="mb-4 flex items-center gap-3">
                <Building2 className="h-5 w-5 text-cyan-300" />
                <h2 className="text-lg font-black">Concessionarias</h2>
              </div>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar bot..."
                className="mb-5 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm font-bold text-white outline-none transition focus:border-cyan-400"
              />

              <div className="space-y-3">
                {filteredConfigs.map((config) => (
                  <button
                    key={config.id}
                    type="button"
                    onClick={() => editConfig(config)}
                    className={`w-full rounded-2xl border p-4 text-left transition ${
                      selectedConfig?.id === config.id
                        ? 'border-cyan-400 bg-cyan-500/10'
                        : 'border-slate-800 bg-slate-900/70 hover:border-cyan-500/50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-black text-white">{config.corretoras?.nome || 'Concessionaria'}</p>
                        <p className="mt-1 text-xs font-bold uppercase tracking-[0.18em] text-cyan-300">{config.nome}</p>
                      </div>
                      <span className={`rounded-full px-3 py-1 text-[10px] font-black uppercase ${config.status === 'ativo' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-700 text-slate-300'}`}>
                        {config.status}
                      </span>
                    </div>
                  </button>
                ))}
              </div>

              {inactiveCorretoras.length > 0 && (
                <div className="mt-6 border-t border-slate-800 pt-5">
                  <p className="mb-3 text-xs font-black uppercase tracking-[0.24em] text-slate-500">Disponiveis</p>
                  <div className="space-y-2">
                    {inactiveCorretoras.slice(0, 8).map((corretora) => (
                      <button
                        key={corretora.id}
                        type="button"
                        onClick={() => {
                          setSelectedConfig(null);
                          setSelectedCorretoraId(corretora.id);
                          setNome('Primeiro atendimento');
                          setStatus('ativo');
                          setMessage(DEFAULT_MESSAGE);
                          setFlow(DEFAULT_FLOW);
                        }}
                        className="w-full rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-3 text-left text-xs font-bold text-slate-300 hover:border-cyan-500/40 hover:text-white"
                      >
                        {corretora.nome}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </aside>

            <form onSubmit={saveConfig} className="rounded-[28px] border border-cyan-500/20 bg-slate-950/80 p-5 lg:p-7">
              <div className="mb-6 grid gap-4 lg:grid-cols-4">
                <label className="lg:col-span-2">
                  <span className="mb-2 block text-xs font-black uppercase tracking-[0.24em] text-slate-400">Concessionaria</span>
                  <select
                    value={selectedCorretoraId}
                    onChange={(event) => setSelectedCorretoraId(event.target.value)}
                    disabled={Boolean(selectedConfig?.id)}
                    className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-4 text-sm font-black text-white outline-none focus:border-cyan-400 disabled:opacity-60"
                  >
                    <option value="">Selecione</option>
                    {selectedConfig?.corretora_id && (
                      <option value={selectedConfig.corretora_id}>{selectedConfig.corretoras?.nome || 'Concessionaria selecionada'}</option>
                    )}
                    {inactiveCorretoras.map((corretora) => (
                      <option key={corretora.id} value={corretora.id}>{corretora.nome}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="mb-2 block text-xs font-black uppercase tracking-[0.24em] text-slate-400">Modelo</span>
                  <input
                    value={nome}
                    onChange={(event) => setNome(event.target.value)}
                    className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-4 text-sm font-black text-white outline-none focus:border-cyan-400"
                  />
                </label>
                <label>
                  <span className="mb-2 block text-xs font-black uppercase tracking-[0.24em] text-slate-400">Status</span>
                  <select
                    value={status}
                    onChange={(event) => setStatus(event.target.value)}
                    className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-4 text-sm font-black text-white outline-none focus:border-cyan-400"
                  >
                    <option value="ativo">Ativo</option>
                    <option value="inativo">Inativo</option>
                  </select>
                </label>
              </div>

              <div className="mb-6 rounded-[24px] border border-slate-800 bg-slate-900/60 p-5">
                <div className="mb-4 flex items-center justify-between gap-4">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.28em] text-cyan-300">Gatilho padrao</p>
                    <h3 className="mt-1 text-xl font-black">CRM</h3>
                  </div>
                  <span className="rounded-full border border-cyan-400/30 bg-cyan-500/10 px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-cyan-200">
                    lead caiu no CRM
                  </span>
                </div>
                <label>
                  <span className="mb-2 block text-xs font-black uppercase tracking-[0.24em] text-slate-400">Primeira mensagem</span>
                  <textarea
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    rows={7}
                    className="w-full resize-y rounded-2xl border border-slate-700 bg-slate-950 px-4 py-4 text-sm font-bold leading-6 text-white outline-none focus:border-cyan-400"
                  />
                </label>
                <p className="mt-3 text-xs font-bold text-slate-500">
                  Variaveis: {'{primeiro_nome}'}, {'{nome}'}, {'{telefone}'}, {'{idades}'}, {'{cidade}'}, {'{operadora}'}, {'{concessionaria}'}
                </p>
              </div>

              <div className="rounded-[24px] border border-slate-800 bg-[#050b16] p-5">
                <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <div className="flex items-center gap-2 text-cyan-300">
                      <Workflow className="h-5 w-5" />
                      <p className="text-xs font-black uppercase tracking-[0.28em]">Fluxo visual</p>
                    </div>
                    <h3 className="mt-1 text-xl font-black">Nos do bot</h3>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => addNode('question', 'Nova pergunta', 'Pergunta fixa para continuar o fluxo')} className="rounded-xl border border-purple-400/30 px-3 py-2 text-xs font-black text-purple-200 hover:bg-purple-500/10">Adicionar pergunta</button>
                    <button type="button" onClick={() => addNode('condition', 'Resposta True', 'Se o lead responder sim/positivo', 'true')} className="rounded-xl border border-emerald-400/30 px-3 py-2 text-xs font-black text-emerald-200 hover:bg-emerald-500/10">Resposta true</button>
                    <button type="button" onClick={() => addNode('condition', 'Resposta False', 'Se o lead responder nao/negativo', 'false')} className="rounded-xl border border-red-400/30 px-3 py-2 text-xs font-black text-red-200 hover:bg-red-500/10">Resposta false</button>
                    <button type="button" onClick={() => addNode('action', 'Acionar corretor', 'Encaminha para atendimento humano')} className="rounded-xl border border-amber-400/30 px-3 py-2 text-xs font-black text-amber-200 hover:bg-amber-500/10">Acionar corretor</button>
                  </div>
                </div>

                <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-[radial-gradient(circle_at_1px_1px,rgba(34,211,238,.22)_1px,transparent_0)] p-5 [background-size:22px_22px]">
                  <div className="flex min-w-max items-center gap-4">
                    {flow.map((node, index) => (
                      <div key={node.id} className="flex items-center gap-4">
                        <div className={`w-56 rounded-2xl border p-4 shadow-xl shadow-black/20 ${nodeStyles[node.type] || nodeStyles.message}`}>
                          <div className="mb-3 flex items-center justify-between gap-2">
                            <span className="rounded-full bg-black/20 px-2 py-1 text-[10px] font-black uppercase tracking-[0.18em]">{node.type}</span>
                            {node.branch && <span className="rounded-full bg-white/10 px-2 py-1 text-[10px] font-black uppercase">{node.branch}</span>}
                          </div>
                          <p className="text-sm font-black text-white">{node.label}</p>
                          <p className="mt-2 text-xs font-bold leading-5 text-slate-300">{node.description}</p>
                        </div>
                        {index < flow.length - 1 && (
                          <div className="flex items-center text-cyan-400/70">
                            <div className="h-px w-10 bg-cyan-400/50" />
                            <GitBranch className="h-4 w-4" />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-between">
                <button
                  type="button"
                  onClick={() => deleteConfig(selectedConfig?.id)}
                  disabled={!selectedConfig?.id || saving}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-red-500/30 px-5 py-4 text-sm font-black text-red-300 transition hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Trash2 className="h-4 w-4" />
                  Remover bot
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-8 py-4 text-sm font-black text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-500 disabled:cursor-wait disabled:opacity-70"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Salvar bot
                </button>
              </div>
            </form>
          </div>
        )}

        <section className="mt-6 grid gap-4 lg:grid-cols-3">
          <div className="rounded-[24px] border border-cyan-500/20 bg-cyan-500/10 p-5">
            <Send className="mb-3 h-5 w-5 text-cyan-300" />
            <p className="text-sm font-black">Primeiro atendimento</p>
            <p className="mt-2 text-xs font-bold leading-5 text-slate-400">Envia uma mensagem curta ao lead assim que ele entra no CRM.</p>
          </div>
          <div className="rounded-[24px] border border-emerald-500/20 bg-emerald-500/10 p-5">
            <MessageSquare className="mb-3 h-5 w-5 text-emerald-300" />
            <p className="text-sm font-black">Modelos prontos</p>
            <p className="mt-2 text-xs font-bold leading-5 text-slate-400">Cada concessionaria pode ter seu modelo fixo de abordagem inicial.</p>
          </div>
          <div className="rounded-[24px] border border-amber-500/20 bg-amber-500/10 p-5">
            <BellRing className="mb-3 h-5 w-5 text-amber-300" />
            <p className="text-sm font-black">Acionar corretor</p>
            <p className="mt-2 text-xs font-bold leading-5 text-slate-400">O no de acao ja fica desenhado para evoluir depois sem refazer a estrutura.</p>
          </div>
        </section>
      </main>
    </InternalLayout>
  );
}
