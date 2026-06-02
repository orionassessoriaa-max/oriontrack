'use client';

import { useEffect, useMemo, useState } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import { useAuth } from '@/components/providers/AuthProvider';
import { supabase } from '@/lib/supabase/client';
import { Award, CheckCircle2, Crown, DollarSign, Loader2, Lock, Pencil, Plus, Save, Sparkles, Target, Trophy, X } from 'lucide-react';

type TeamMember = {
  id: string;
  nome: string | null;
  email: string | null;
  email_real: string | null;
  tipo_usuario: string;
  foto_url: string | null;
  pontos: number;
  pontos_detalhes?: Array<{ id: string; pontos: number; motivo: string; created_at: string }>;
  is_admin_master?: boolean | null;
};

type Objective = {
  id: string;
  titulo: string;
  valor_estimado: number;
  status: 'aberto' | 'em_andamento' | 'feito';
};

type Sale = {
  id: string;
  nome: string;
  vendido: string;
  valor: number;
  created_at?: string;
};

type TeamPayload = {
  month: string;
  monthLabel: string;
  meta: { meta_valor: number; prazo: string };
  objectives: Objective[];
  sales: Sale[];
  members: TeamMember[];
  summary: {
    totalObjetivos: number;
    realizadoObjetivos: number;
    totalVendas: number;
    realizadoTotal: number;
    emAndamentoObjetivos: number;
    previsaoObjetivos: number;
    previsaoAberta: number;
    faltanteMeta: number;
    totalPontos: number;
    daysRemaining: number;
    progress: number;
    forecastProgress: number;
    dailyMessages: { profile_id: string; text: string }[];
  };
  isAdmin: boolean;
  previousMonth?: {
    month: string;
    label: string;
    meta_valor: number;
    realizadoTotal: number;
    totalVendas: number;
    totalObjetivos: number;
    totalPontos: number;
    objectivesCount: number;
    salesCount: number;
    progress: number;
    hasData: boolean;
  } | null;
  needsMonthlySetup?: boolean;
  needsMigration?: boolean;
};

const MASTER_EMAIL = 'ewerttonherculano@gmail.com';

const roleLabels: Record<string, string> = {
  admin: 'Admin Orion',
  gestor_trafego: 'Gestor de Trafego',
  designer: 'Designer',
  account_manager: 'Account Manager',
};

function brl(value: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));
}

function statusLabel(status: Objective['status']) {
  if (status === 'feito') return 'Concluido';
  if (status === 'em_andamento') return 'Em andamento';
  return 'Aberto';
}

function statusClass(status: Objective['status']) {
  if (status === 'feito') return 'border-emerald-500/30 bg-emerald-950/40 text-emerald-300';
  if (status === 'em_andamento') return 'border-blue-500/30 bg-blue-950/40 text-blue-300';
  return 'border-amber-500/30 bg-amber-950/40 text-amber-300';
}

function initials(name?: string | null) {
  return (name || 'Orion')
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function isDevOps(member?: Pick<TeamMember, 'email' | 'email_real' | 'is_admin_master'> | null) {
  const emails = [member?.email, member?.email_real].filter(Boolean).map((email) => String(email).toLowerCase());
  return Boolean(member?.is_admin_master) || emails.includes(MASTER_EMAIL);
}

function displayRole(member: TeamMember) {
  if (isDevOps(member)) return 'DevOps Manager';
  return roleLabels[member.tipo_usuario] || member.tipo_usuario;
}

export default function ApolloTeamPage() {
  useAuth();
  const [data, setData] = useState<TeamPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [pointsForm, setPointsForm] = useState({ profile_id: '', pontos: '5', motivo: '' });
  const [objectiveForm, setObjectiveForm] = useState({ titulo: '', valor_estimado: '' });
  const [saleForm, setSaleForm] = useState({ nome: '', vendido: '', valor: '' });
  const [metaForm, setMetaForm] = useState({ meta_valor: '', prazo: '' });
  const [editingObjective, setEditingObjective] = useState<{ id: string; titulo: string; valor_estimado: string } | null>(null);
  const [editingSale, setEditingSale] = useState<{ id: string; nome: string; vendido: string; valor: string } | null>(null);

  async function requestTeam(body?: Record<string, unknown>) {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    const response = await fetch('/api/equipe/apollo', {
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Nao foi possivel carregar o time Apollo.');
    return payload;
  }

  async function load() {
    setLoading(true);
    setNotice(null);
    try {
      const payload = await requestTeam();
      setData(payload);
      setMetaForm({
        meta_valor: payload.meta?.meta_valor ? String(payload.meta.meta_valor) : '',
        prazo: payload.meta?.prazo || '',
      });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Nao foi possivel carregar o time Apollo.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const messages = useMemo(() => {
    const map = new Map<string, string>();
    data?.summary.dailyMessages.forEach((item) => map.set(item.profile_id, item.text));
    return map;
  }, [data]);

  async function submitAction(body: Record<string, unknown>, successMessage: string) {
    setSaving(true);
    setNotice(null);
    try {
      await requestTeam(body);
      setNotice(successMessage);
      if (body.action === 'create_sale') setSaleForm({ nome: '', vendido: '', valor: '' });
      if (body.action === 'create_objective') setObjectiveForm({ titulo: '', valor_estimado: '' });
      if (body.action === 'add_points') setPointsForm((current) => ({ ...current, pontos: '5', motivo: '' }));
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Nao foi possivel salvar.');
    } finally {
      setSaving(false);
    }
  }

  async function removeAction(body: Record<string, unknown>, successMessage: string) {
    let label = 'esta pontuacao';
    if (body.action === 'delete_sale') label = 'esta venda';
    else if (body.action === 'delete_objective') label = 'este objetivo';
    if (!window.confirm(`Remover ${label}?`)) return;
    await submitAction(body, successMessage);
  }

  const metaValue = Number(data?.meta.meta_valor || 0);
  const progress = data?.summary.progress || 0;
  const forecastProgress = data?.summary.forecastProgress || 0;
  const topMember = data?.members.find((member) => Number(member.pontos || 0) > 0);
  const monthTitle = data?.monthLabel ? data.monthLabel.charAt(0).toUpperCase() + data.monthLabel.slice(1) : 'Mes atual';

  return (
    <InternalLayout>
      <div className="mb-8 overflow-hidden border border-blue-200 bg-slate-950 text-white shadow-xl dark:border-blue-400/30">
        <div className="relative p-6 sm:p-8">
          <div className="absolute right-0 top-0 h-48 w-48 bg-blue-500/20 blur-3xl" />
          <div className="absolute bottom-0 left-1/3 h-40 w-40 bg-cyan-400/20 blur-3xl" />
          <div className="relative grid gap-6 xl:grid-cols-[1fr_320px] xl:items-end">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.32em] text-cyan-300">Time operacional</p>
              <h1 className="mt-2 text-4xl font-black tracking-tight sm:text-5xl">Meu time Apollo</h1>
              <p className="mt-3 max-w-3xl text-sm font-bold leading-7 text-blue-100">
                Placar de {monthTitle}, ranking de entregas e objetivos de receita em uma tela. A virada mensal zera o placar novo e preserva o fechamento anterior.
              </p>
            </div>
            <div className="border border-white/10 bg-white/10 p-5 backdrop-blur">
              <p className="text-[10px] font-black uppercase tracking-widest text-cyan-200">Realizado ate agora</p>
              <p className="mt-1 text-4xl font-black">{brl(data?.summary.realizadoTotal || 0)}</p>
              <p className="mt-2 text-xs font-bold text-blue-100">
                Meta: {metaValue > 0 ? brl(metaValue) : 'pendente'}. Faltam {data?.summary.daysRemaining ?? 0} dias para virar o jogo.
              </p>
            </div>
          </div>
        </div>
      </div>

      {notice && (
        <div className="mb-5 border border-blue-200 bg-blue-50 p-4 text-sm font-black text-blue-700 dark:border-blue-400/30 dark:bg-blue-950/40 dark:text-blue-100">
          {notice}
        </div>
      )}

      {data?.needsMonthlySetup && (
        <div className="mb-5 border border-amber-300/40 bg-amber-950/40 p-5 text-sm font-black text-amber-100">
          {data.isAdmin
            ? `Configure a meta de ${monthTitle} para iniciar o novo ciclo. O mês anterior continua salvo no fechamento abaixo.`
            : `A meta de ${monthTitle} ainda precisa ser configurada pelo admin. O placar novo começa zerado.`}
        </div>
      )}

      {loading ? (
        <div className="flex h-80 items-center justify-center border border-white/5 bg-slate-950/60 backdrop-blur-md">
          <Loader2 className="animate-spin text-blue-500" size={38} />
        </div>
      ) : !data ? (
        <div className="border border-red-100 bg-red-50 p-6 text-sm font-black text-red-700">Nao foi possivel abrir o painel Apollo.</div>
      ) : (
        <>
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Metric icon={Target} label="Meta do mes" value={brl(metaValue)} tone="blue" />
            <Metric icon={CheckCircle2} label="Restante para meta" value={brl(data.summary.faltanteMeta)} tone="emerald" />
            <Metric icon={Sparkles} label="Previsao aberta" value={brl(data.summary.previsaoAberta)} tone="amber" />
            <Metric icon={DollarSign} label="Vendas" value={brl(data.summary.totalVendas)} tone="violet" />
          </section>

          {data.previousMonth?.hasData && (
            <section className="mt-6 border border-white/5 bg-slate-900/60 p-5 backdrop-blur-md shadow-2xl shadow-blue-950/20">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.28em] text-slate-400">Fechamento armazenado</p>
                  <h2 className="mt-1 text-2xl font-black text-white">{data.previousMonth.label}</h2>
                  <p className="mt-2 text-sm font-bold text-slate-400">
                    Os dados do mês anterior ficam separados por ciclo e não entram no placar novo.
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-4 lg:min-w-[620px]">
                  <MiniHistory label="Realizado" value={brl(data.previousMonth.realizadoTotal)} />
                  <MiniHistory label="Meta" value={brl(data.previousMonth.meta_valor)} />
                  <MiniHistory label="Vendas" value={brl(data.previousMonth.totalVendas)} />
                  <MiniHistory label="XP" value={`${data.previousMonth.totalPontos}`} />
                </div>
              </div>
            </section>
          )}

          <section className="mt-6 overflow-hidden border border-white/5 bg-slate-900/60 backdrop-blur-md shadow-2xl shadow-blue-950/25">
            <div className="grid gap-6 p-6 xl:grid-cols-[1fr_320px] xl:items-start">
              <div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.28em] text-blue-400">Projecao da campanha</p>
                    <h2 className="mt-2 text-2xl font-black text-white">Previsao x realizado</h2>
                  </div>
                  <span className="bg-blue-600/20 border border-blue-500/30 px-4 py-2 text-sm font-black text-blue-400">{progress}% realizado</span>
                </div>
                <div className="mt-6 space-y-4">
                  <Progress label="Realizado na meta" value={progress} amount={brl(data.summary.realizadoTotal)} color="from-emerald-500 to-cyan-400" />
                  <Progress label="Vendas registradas" value={metaValue > 0 ? Math.min(100, Math.round((data.summary.totalVendas / metaValue) * 100)) : 0} amount={brl(data.summary.totalVendas)} color="from-cyan-400 to-blue-600" />
                  <Progress label="Previsao total dos objetivos" value={forecastProgress} amount={brl(data.summary.previsaoObjetivos)} color="from-blue-600 to-violet-500" />
                  <Progress label="Em andamento" value={metaValue > 0 ? Math.min(100, Math.round((data.summary.emAndamentoObjetivos / metaValue) * 100)) : 0} amount={brl(data.summary.emAndamentoObjetivos)} color="from-amber-400 to-orange-500" />
                </div>
                <p className="mt-5 text-sm font-bold text-slate-400">
                  Vendas registradas entram direto no realizado. Objetivos concluidos tambem somam no placar principal da meta.
                </p>
              </div>

              <div className="border border-white/5 bg-slate-950/60 p-5 backdrop-blur-md">
                <div className="flex items-center gap-3">
                  {topMember ? <Crown className="text-amber-500" /> : <Trophy className="text-slate-500" />}
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{topMember ? 'MVP do momento' : 'MVP aguardando'}</p>
                    <h3 className="text-xl font-black text-white">{topMember?.nome || 'Aguardando pontos'}</h3>
                  </div>
                </div>
                <p className="mt-5 text-4xl font-black text-blue-400">{topMember?.pontos || 0} XP</p>
                <p className="mt-2 text-sm font-bold text-slate-400">
                  {topMember ? messages.get(topMember.id) : 'Pontue uma entrega para iniciar o ranking do Apollo.'}
                </p>
              </div>
            </div>
          </section>

          <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_430px]">
            <section className="border border-white/5 bg-slate-900/60 backdrop-blur-md shadow-2xl shadow-blue-950/25">
              <div className="border-b border-white/5 p-5">
                <p className="text-[10px] font-black uppercase tracking-[0.28em] text-blue-400">Ranking</p>
                <h2 className="mt-1 text-2xl font-black text-white">Liga Apollo</h2>
              </div>
              <div className="divide-y divide-white/5">
                {data.members.length === 0 ? (
                  <p className="p-8 text-center text-sm font-black text-slate-500">Nenhum integrante no Apollo ainda.</p>
                ) : data.members.map((member, index) => (
                  <div key={member.id} className="grid gap-4 p-5 transition hover:bg-white/5 sm:grid-cols-[auto_1fr_auto] sm:items-center">
                    <div className="flex items-center gap-4">
                      <span className="flex h-10 w-10 items-center justify-center bg-blue-600/20 border border-blue-500/30 text-sm font-black text-blue-400">#{index + 1}</span>
                      <div className="h-16 w-16 overflow-hidden bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-600/20">
                        {member.foto_url ? <img src={member.foto_url} alt={member.nome || ''} className="h-full w-full object-cover" /> : <span className="flex h-full w-full items-center justify-center text-lg font-black">{initials(member.nome)}</span>}
                      </div>
                    </div>
                    <div className="min-w-0">
                      <h3 className="truncate text-xl font-black text-white">{member.nome || 'Integrante Apollo'}</h3>
                      <p className="text-xs font-black uppercase tracking-widest text-blue-400">{displayRole(member)}</p>
                      <p className="mt-2 text-sm font-semibold leading-6 text-slate-400">{messages.get(member.id)}</p>
                      {Array.isArray(member.pontos_detalhes) && member.pontos_detalhes.length > 0 && (
                        <div className="mt-3 grid gap-2">
                          {member.pontos_detalhes.map((detail, detailIndex) => (
                            <div key={`${member.id}-${detail.created_at}-${detailIndex}`} className="flex items-start justify-between gap-3 border border-blue-500/10 bg-blue-950/20 px-3 py-2 text-xs font-bold text-blue-200">
                              <div>
                                <span className="mr-2 inline-flex bg-blue-600 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-white">
                                  +{detail.pontos} XP
                                </span>
                                {detail.motivo}
                              </div>
                              {data.isAdmin && detail.id && (
                                <button
                                  type="button"
                                  onClick={() => removeAction({ action: 'delete_point', id: detail.id }, 'Pontuacao removida.')}
                                  className="grid h-7 w-7 shrink-0 cursor-pointer place-items-center border border-white/10 bg-slate-950 text-slate-400 transition hover:border-red-500/50 hover:bg-red-950/40 hover:text-red-400"
                                  title="Remover pontuacao"
                                >
                                  <X size={14} />
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="bg-blue-950/20 border border-blue-500/15 px-5 py-4 text-center">
                      <p className="text-4xl font-black text-blue-400">{member.pontos}</p>
                      <p className="text-[10px] font-black uppercase tracking-widest text-blue-500">XP</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <aside className="space-y-6">
              {data.isAdmin ? (
                <section className="border border-white/5 bg-slate-900/60 p-5 backdrop-blur-md shadow-2xl shadow-blue-950/20">
                  <p className="text-[10px] font-black uppercase tracking-[0.28em] text-blue-400">Admin</p>
                  <h2 className="mt-1 text-xl font-black text-white">Pontuar integrante</h2>
                  <select
                    value={pointsForm.profile_id}
                    onChange={(event) => setPointsForm((current) => ({ ...current, profile_id: event.target.value }))}
                    className="mt-4 w-full border border-white/10 bg-slate-950 px-4 py-3 text-sm font-black text-white outline-none focus:border-blue-500/50 transition"
                  >
                    <option value="">Selecione alguem</option>
                    {data.members.map((member) => <option key={member.id} value={member.id}>{member.nome}</option>)}
                  </select>
                  <input
                    value={pointsForm.pontos}
                    onChange={(event) => setPointsForm((current) => ({ ...current, pontos: event.target.value }))}
                    placeholder="Pontos"
                    className="mt-3 w-full border border-white/10 bg-slate-950 px-4 py-3 text-sm font-black text-white outline-none focus:border-blue-500/50 transition"
                  />
                  <input
                    value={pointsForm.motivo}
                    onChange={(event) => setPointsForm((current) => ({ ...current, motivo: event.target.value }))}
                    placeholder="Motivo da pontuacao"
                    className="mt-3 w-full border border-white/10 bg-slate-950 px-4 py-3 text-sm font-black text-white outline-none focus:border-blue-500/50 transition"
                  />
                  <button
                    onClick={() => submitAction({ action: 'add_points', ...pointsForm }, 'Pontuacao adicionada.')}
                    disabled={saving}
                    className="mt-3 flex w-full cursor-pointer items-center justify-center gap-2 bg-blue-600 border border-blue-500/30 px-4 py-3 text-sm font-black text-white transition hover:bg-blue-550 hover:shadow-lg hover:shadow-blue-500/20"
                  >
                    {saving ? <Loader2 className="animate-spin" size={17} /> : <Award size={17} />} Pontuar
                  </button>
                </section>
              ) : (
                <section className="border border-white/5 bg-slate-900/60 p-5 backdrop-blur-md shadow-2xl shadow-blue-950/20">
                  <Lock className="text-blue-400" />
                  <h2 className="mt-3 text-xl font-black text-white">Modo visualizacao</h2>
                  <p className="mt-2 text-sm font-bold leading-6 text-slate-400">
                    Voce acompanha ranking, metas e objetivos. Alteracoes de pontuacao e status ficam com o admin.
                  </p>
                </section>
              )}

              <section className="border border-white/5 bg-slate-900/60 backdrop-blur-md shadow-2xl shadow-blue-950/20">
                <div className="border-b border-white/5 p-5">
                  <p className="text-[10px] font-black uppercase tracking-[0.28em] text-blue-400">Objetivos</p>
                  <h2 className="mt-1 text-xl font-black text-white">Objetivos de {monthTitle}</h2>
                </div>
                <div className="divide-y divide-white/5">
                  {data.objectives.map((objective) => (
                    <div key={objective.id} className="grid grid-cols-[1fr_auto] gap-3 p-4">
                      <div>
                        <h3 className="font-black text-white">{objective.titulo}</h3>
                        <p className="text-sm font-black text-blue-400">Previsao: {brl(objective.valor_estimado)}</p>
                      </div>
                      {data.isAdmin ? (
                        <div className="flex items-center gap-2">
                          <select
                            value={objective.status}
                            onChange={(event) => submitAction({ action: 'update_objective', id: objective.id, status: event.target.value }, 'Objetivo atualizado.')}
                            className={`h-11 cursor-pointer border px-3 text-xs font-black outline-none ${statusClass(objective.status)}`}
                          >
                            <option value="aberto">Aberto</option>
                            <option value="em_andamento">Em andamento</option>
                            <option value="feito">Concluido</option>
                          </select>
                          <button
                            type="button"
                            onClick={() => setEditingObjective({ id: objective.id, titulo: objective.titulo, valor_estimado: String(objective.valor_estimado) })}
                            className="grid h-11 w-11 cursor-pointer place-items-center border border-white/10 bg-slate-950 text-slate-400 transition hover:bg-white/5 hover:text-white"
                            title="Editar objetivo"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => removeAction({ action: 'delete_objective', id: objective.id }, 'Objetivo removido.')}
                            className="grid h-11 w-11 cursor-pointer place-items-center border border-white/10 bg-slate-950 text-slate-400 transition hover:border-red-500/50 hover:bg-red-950/40 hover:text-red-400"
                            title="Remover objetivo"
                          >
                            <X size={16} />
                          </button>
                        </div>
                      ) : (
                        <span className={`h-8 border px-3 py-2 text-[10px] font-black uppercase tracking-widest ${statusClass(objective.status)}`}>{statusLabel(objective.status)}</span>
                      )}
                    </div>
                  ))}
                </div>
                {data.isAdmin && (
                  <div className="border-t border-white/5 p-5">
                    <h3 className="text-sm font-black text-white">Adicionar objetivo</h3>
                    <input
                      value={objectiveForm.titulo}
                      onChange={(event) => setObjectiveForm((current) => ({ ...current, titulo: event.target.value }))}
                      placeholder="Nome do objetivo"
                      className="mt-3 w-full border border-white/10 bg-slate-950 px-4 py-3 text-sm font-black text-white outline-none focus:border-blue-500/50 transition"
                    />
                    <input
                      value={objectiveForm.valor_estimado}
                      onChange={(event) => setObjectiveForm((current) => ({ ...current, valor_estimado: event.target.value }))}
                      placeholder="Valor estimado"
                      className="mt-3 w-full border border-white/10 bg-slate-950 px-4 py-3 text-sm font-black text-white outline-none focus:border-blue-500/50 transition"
                    />
                    <button
                      onClick={() => submitAction({ action: 'create_objective', ...objectiveForm }, 'Objetivo criado.')}
                      disabled={saving}
                      className="mt-3 flex w-full cursor-pointer items-center justify-center gap-2 bg-blue-600 border border-blue-500/30 px-4 py-3 text-sm font-black text-white transition hover:bg-blue-500 hover:shadow-lg hover:shadow-blue-500/20"
                    >
                      <Plus size={17} /> Criar objetivo
                    </button>
                  </div>
                )}
              </section>

              <section className="border border-white/5 bg-slate-900/60 backdrop-blur-md shadow-2xl shadow-blue-950/20">
                <div className="border-b border-white/5 p-5">
                  <p className="text-[10px] font-black uppercase tracking-[0.28em] text-emerald-400">Vendas</p>
                  <h2 className="mt-1 text-xl font-black text-white">Vendas registradas na meta</h2>
                  <p className="mt-1 text-sm font-bold text-slate-400">
                    Registre cliente, produto e valor para alimentar o placar comercial do Apollo.
                  </p>
                </div>
                <div className="divide-y divide-white/5">
                  {data.sales.length === 0 ? (
                    <p className="p-5 text-sm font-black text-slate-500">Nenhuma venda registrada ainda.</p>
                  ) : data.sales.map((sale) => (
                    <div key={sale.id} className="grid gap-2 p-4 sm:grid-cols-[1fr_auto_auto] sm:items-center">
                      <div>
                        <h3 className="font-black text-white">{sale.nome}</h3>
                        <p className="text-sm font-bold text-slate-400">{sale.vendido}</p>
                      </div>
                      <p className="text-lg font-black text-emerald-400">{brl(sale.valor)}</p>
                      {data.isAdmin && (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setEditingSale({ id: sale.id, nome: sale.nome, vendido: sale.vendido, valor: String(sale.valor) })}
                            className="grid h-9 w-9 cursor-pointer place-items-center border border-white/10 bg-slate-950 text-slate-400 transition hover:bg-white/5 hover:text-white"
                            title="Editar venda"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => removeAction({ action: 'delete_sale', id: sale.id }, 'Venda removida.')}
                            className="grid h-9 w-9 cursor-pointer place-items-center border border-white/10 bg-slate-950 text-slate-400 transition hover:border-red-500/50 hover:bg-red-950/40 hover:text-red-400"
                            title="Remover venda"
                          >
                            <X size={16} />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                {data.isAdmin && (
                  <div className="border-t border-white/5 p-5">
                    <h3 className="text-sm font-black text-white">Nova venda</h3>
                    <input
                      value={saleForm.nome}
                      onChange={(event) => setSaleForm((current) => ({ ...current, nome: event.target.value }))}
                      placeholder="Cliente ou conta. Ex: Beth"
                      className="mt-3 w-full border border-white/10 bg-slate-950 px-4 py-3 text-sm font-black text-white outline-none focus:border-emerald-500/50 transition"
                    />
                    <input
                      value={saleForm.vendido}
                      onChange={(event) => setSaleForm((current) => ({ ...current, vendido: event.target.value }))}
                      placeholder="Produto. Ex: Social Media"
                      className="mt-3 w-full border border-white/10 bg-slate-950 px-4 py-3 text-sm font-black text-white outline-none focus:border-emerald-500/50 transition"
                    />
                    <input
                      value={saleForm.valor}
                      onChange={(event) => setSaleForm((current) => ({ ...current, valor: event.target.value }))}
                      placeholder="Valor. Ex: 6000"
                      className="mt-3 w-full border border-white/10 bg-slate-950 px-4 py-3 text-sm font-black text-white outline-none focus:border-emerald-500/50 transition"
                    />
                    <button
                      onClick={() => submitAction({ action: 'create_sale', ...saleForm }, 'Venda adicionada.')}
                      disabled={saving}
                      className="mt-3 flex w-full cursor-pointer items-center justify-center gap-2 bg-emerald-600 border border-emerald-500/30 px-4 py-3 text-sm font-black text-white transition hover:bg-emerald-500 hover:shadow-lg hover:shadow-emerald-500/20"
                    >
                      <DollarSign size={17} /> Registrar venda
                    </button>
                  </div>
                )}
              </section>

              {data.isAdmin && (
                <section className="border border-white/5 bg-slate-900/60 p-5 backdrop-blur-md shadow-2xl shadow-blue-950/20">
                  <p className="text-[10px] font-black uppercase tracking-[0.28em] text-blue-400">Meta</p>
                  <h2 className="mt-1 text-xl font-black text-white">{data.needsMonthlySetup ? 'Configurar novo mes' : 'Ajustar alvo do mes'}</h2>
                  <input
                    value={metaForm.meta_valor}
                    onChange={(event) => setMetaForm((current) => ({ ...current, meta_valor: event.target.value }))}
                    placeholder="Meta do mes. Ex: 50000"
                    className="mt-4 w-full border border-white/10 bg-slate-950 px-4 py-3 text-sm font-black text-white outline-none focus:border-blue-500/50 transition"
                  />
                  <input
                    type="date"
                    value={metaForm.prazo}
                    onChange={(event) => setMetaForm((current) => ({ ...current, prazo: event.target.value }))}
                    className="mt-3 w-full border border-white/10 bg-slate-950 px-4 py-3 text-sm font-black text-white outline-none focus:border-blue-500/50 transition"
                  />
                  <button
                    onClick={() => submitAction({ action: 'update_meta', meta_valor: metaForm.meta_valor, prazo: metaForm.prazo }, 'Meta atualizada.')}
                    disabled={saving}
                    className="mt-3 flex w-full cursor-pointer items-center justify-center gap-2 bg-blue-600 border border-blue-500/30 px-4 py-3 text-sm font-black text-white transition hover:bg-blue-500 hover:shadow-lg hover:shadow-blue-500/20"
                  >
                    {saving ? <Loader2 className="animate-spin" size={17} /> : <Save size={17} />} Salvar meta
                  </button>
                </section>
              )}
            </aside>
          </div>
        </>
      )}

      {editingObjective && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md border border-white/10 bg-slate-900 p-6 shadow-2xl text-white backdrop-blur-md">
            <div className="flex items-center justify-between border-b border-white/5 pb-4">
              <h3 className="text-xl font-black">Editar Objetivo</h3>
              <button
                onClick={() => setEditingObjective(null)}
                className="text-slate-400 hover:text-white transition"
              >
                <X size={20} />
              </button>
            </div>
            <div className="mt-4 space-y-4">
              <div>
                <label className="text-xs font-black uppercase tracking-widest text-slate-400">Nome do Objetivo</label>
                <input
                  value={editingObjective.titulo}
                  onChange={(e) => setEditingObjective({ ...editingObjective, titulo: e.target.value })}
                  placeholder="Nome do objetivo"
                  className="mt-1.5 w-full border border-white/10 bg-slate-950 px-4 py-3 text-sm font-black text-white outline-none focus:border-blue-500/50 transition"
                />
              </div>
              <div>
                <label className="text-xs font-black uppercase tracking-widest text-slate-400">Valor Estimado (R$)</label>
                <input
                  value={editingObjective.valor_estimado}
                  onChange={(e) => setEditingObjective({ ...editingObjective, valor_estimado: e.target.value })}
                  placeholder="Valor estimado"
                  className="mt-1.5 w-full border border-white/10 bg-slate-950 px-4 py-3 text-sm font-black text-white outline-none focus:border-blue-500/50 transition"
                />
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-3 border-t border-white/5 pt-4">
              <button
                onClick={() => setEditingObjective(null)}
                className="cursor-pointer bg-white/5 border border-white/10 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-slate-300 hover:bg-white/10 transition"
              >
                Cancelar
              </button>
              <button
                onClick={async () => {
                  if (!editingObjective.titulo || !editingObjective.valor_estimado) {
                    alert('Preencha todos os campos.');
                    return;
                  }
                  await submitAction({
                    action: 'update_objective',
                    id: editingObjective.id,
                    titulo: editingObjective.titulo,
                    valor_estimado: editingObjective.valor_estimado
                  }, 'Objetivo atualizado.');
                  setEditingObjective(null);
                }}
                disabled={saving}
                className="flex cursor-pointer items-center justify-center gap-2 bg-blue-600 border border-blue-500/30 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-white hover:bg-blue-500 hover:shadow-lg hover:shadow-blue-500/20"
              >
                {saving ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />} Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {editingSale && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md border border-white/10 bg-slate-900 p-6 shadow-2xl text-white backdrop-blur-md">
            <div className="flex items-center justify-between border-b border-white/5 pb-4">
              <h3 className="text-xl font-black">Editar Venda</h3>
              <button
                onClick={() => setEditingSale(null)}
                className="text-slate-400 hover:text-white transition"
              >
                <X size={20} />
              </button>
            </div>
            <div className="mt-4 space-y-4">
              <div>
                <label className="text-xs font-black uppercase tracking-widest text-slate-400">Cliente / Conta</label>
                <input
                  value={editingSale.nome}
                  onChange={(e) => setEditingSale({ ...editingSale, nome: e.target.value })}
                  placeholder="Cliente ou conta"
                  className="mt-1.5 w-full border border-white/10 bg-slate-950 px-4 py-3 text-sm font-black text-white outline-none focus:border-emerald-500/50 transition"
                />
              </div>
              <div>
                <label className="text-xs font-black uppercase tracking-widest text-slate-400">Produto Vendido</label>
                <input
                  value={editingSale.vendido}
                  onChange={(e) => setEditingSale({ ...editingSale, vendido: e.target.value })}
                  placeholder="Produto vendido"
                  className="mt-1.5 w-full border border-white/10 bg-slate-950 px-4 py-3 text-sm font-black text-white outline-none focus:border-emerald-500/50 transition"
                />
              </div>
              <div>
                <label className="text-xs font-black uppercase tracking-widest text-slate-400">Valor (R$)</label>
                <input
                  value={editingSale.valor}
                  onChange={(e) => setEditingSale({ ...editingSale, valor: e.target.value })}
                  placeholder="Valor da venda"
                  className="mt-1.5 w-full border border-white/10 bg-slate-950 px-4 py-3 text-sm font-black text-white outline-none focus:border-emerald-500/50 transition"
                />
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-3 border-t border-white/5 pt-4">
              <button
                onClick={() => setEditingSale(null)}
                className="cursor-pointer bg-white/5 border border-white/10 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-slate-300 hover:bg-white/10 transition"
              >
                Cancelar
              </button>
              <button
                onClick={async () => {
                  if (!editingSale.nome || !editingSale.vendido || !editingSale.valor) {
                    alert('Preencha todos os campos.');
                    return;
                  }
                  await submitAction({
                    action: 'edit_sale',
                    id: editingSale.id,
                    nome: editingSale.nome,
                    vendido: editingSale.vendido,
                    valor: editingSale.valor
                  }, 'Venda atualizada.');
                  setEditingSale(null);
                }}
                disabled={saving}
                className="flex cursor-pointer items-center justify-center gap-2 bg-emerald-600 border border-emerald-500/30 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-white hover:bg-emerald-550 hover:shadow-lg hover:shadow-emerald-500/20"
              >
                {saving ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />} Salvar
              </button>
            </div>
          </div>
        </div>
      )}
    </InternalLayout>
  );
}

function Metric({ icon: Icon, label, value, tone }: { icon: any; label: string; value: string; tone: 'blue' | 'emerald' | 'amber' | 'violet' }) {
  const colors = {
    blue: 'bg-slate-950/60 text-blue-400 border-blue-500/20 shadow-lg shadow-blue-500/5',
    emerald: 'bg-slate-950/60 text-emerald-400 border-emerald-500/20 shadow-lg shadow-emerald-500/5',
    amber: 'bg-slate-950/60 text-amber-400 border-amber-500/20 shadow-lg shadow-amber-500/5',
    violet: 'bg-slate-950/60 text-violet-400 border-violet-500/20 shadow-lg shadow-violet-500/5',
  };

  return (
    <div className={`border p-5 backdrop-blur-md transition duration-300 hover:-translate-y-1 hover:shadow-xl ${colors[tone]}`}>
      <Icon size={22} className="text-current" />
      <p className="mt-5 text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</p>
      <p className="mt-2 text-2xl font-black text-white">{value}</p>
    </div>
  );
}

function MiniHistory({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-white/5 bg-slate-950/60 p-4">
      <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">{label}</p>
      <p className="mt-1 truncate text-lg font-black text-white" title={value}>{value}</p>
    </div>
  );
}

function Progress({ label, value, amount, color }: { label: string; value: number; amount: string; color: string }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-4 text-xs font-black uppercase tracking-widest text-slate-400">
        <span>{label}</span>
        <span>{amount}</span>
      </div>
      <div className="h-4 overflow-hidden bg-slate-950 border border-white/5">
        <div className={`h-full bg-gradient-to-r ${color} transition-all duration-700`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
      </div>
    </div>
  );
}
