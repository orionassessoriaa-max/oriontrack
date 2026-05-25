'use client';

import { useEffect, useMemo, useState } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import { useAuth } from '@/components/providers/AuthProvider';
import { supabase } from '@/lib/supabase/client';
import { Award, CheckCircle2, Crown, Loader2, Lock, Plus, Save, Sparkles, Target, Trophy } from 'lucide-react';

type TeamMember = {
  id: string;
  nome: string | null;
  email: string | null;
  email_real: string | null;
  tipo_usuario: string;
  foto_url: string | null;
  pontos: number;
  is_admin_master?: boolean | null;
};

type Objective = {
  id: string;
  titulo: string;
  valor_estimado: number;
  status: 'aberto' | 'em_andamento' | 'feito';
};

type TeamPayload = {
  month: string;
  meta: { meta_valor: number; prazo: string };
  objectives: Objective[];
  members: TeamMember[];
  summary: {
    totalObjetivos: number;
    realizadoObjetivos: number;
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
  if (status === 'feito') return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-950/30 dark:text-emerald-100';
  if (status === 'em_andamento') return 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-400/30 dark:bg-blue-950/30 dark:text-blue-100';
  return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/30 dark:bg-amber-950/30 dark:text-amber-100';
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
  const [metaForm, setMetaForm] = useState({ meta_valor: '50000', prazo: '2026-05-31' });

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
        meta_valor: String(payload.meta?.meta_valor || 50000),
        prazo: payload.meta?.prazo || '2026-05-31',
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
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Nao foi possivel salvar.');
    } finally {
      setSaving(false);
    }
  }

  const metaValue = Number(data?.meta.meta_valor || 50000);
  const progress = data?.summary.progress || 0;
  const forecastProgress = data?.summary.forecastProgress || 0;
  const topMember = data?.members[0];

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
                Placar do mes, ranking de entregas e objetivos de receita em uma tela. Integrantes acompanham; somente admins pontuam e mudam metas.
              </p>
            </div>
            <div className="border border-white/10 bg-white/10 p-5 backdrop-blur">
              <p className="text-[10px] font-black uppercase tracking-widest text-cyan-200">Boss final de maio</p>
              <p className="mt-1 text-4xl font-black">{brl(metaValue)}</p>
              <p className="mt-2 text-xs font-bold text-blue-100">Faltam {data?.summary.daysRemaining ?? 0} dias para virar o jogo.</p>
            </div>
          </div>
        </div>
      </div>

      {notice && (
        <div className="mb-5 border border-blue-200 bg-blue-50 p-4 text-sm font-black text-blue-700 dark:border-blue-400/30 dark:bg-blue-950/40 dark:text-blue-100">
          {notice}
        </div>
      )}

      {loading ? (
        <div className="flex h-80 items-center justify-center border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
          <Loader2 className="animate-spin text-blue-600" size={38} />
        </div>
      ) : !data ? (
        <div className="border border-red-100 bg-red-50 p-6 text-sm font-black text-red-700">Nao foi possivel abrir o painel Apollo.</div>
      ) : (
        <>
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Metric icon={Target} label="Meta do mes" value={brl(metaValue)} tone="blue" />
            <Metric icon={CheckCircle2} label="Concluido" value={brl(data.summary.realizadoObjetivos)} tone="emerald" />
            <Metric icon={Sparkles} label="Previsao aberta" value={brl(data.summary.previsaoAberta)} tone="amber" />
            <Metric icon={Trophy} label="XP do time" value={String(data.summary.totalPontos)} tone="violet" />
          </section>

          <section className="mt-6 overflow-hidden border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <div className="grid gap-6 p-6 xl:grid-cols-[1fr_320px] xl:items-start">
              <div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.28em] text-blue-600">Projecao da campanha</p>
                    <h2 className="mt-2 text-2xl font-black text-slate-950 dark:text-white">Previsao x realizado</h2>
                  </div>
                  <span className="bg-slate-950 px-4 py-2 text-sm font-black text-white dark:bg-blue-600">{progress}% realizado</span>
                </div>
                <div className="mt-6 space-y-4">
                  <Progress label="Realizado" value={progress} amount={brl(data.summary.realizadoObjetivos)} color="from-emerald-500 to-cyan-400" />
                  <Progress label="Previsao total dos objetivos" value={forecastProgress} amount={brl(data.summary.previsaoObjetivos)} color="from-blue-600 to-violet-500" />
                  <Progress label="Em andamento" value={Math.min(100, Math.round((data.summary.emAndamentoObjetivos / metaValue) * 100))} amount={brl(data.summary.emAndamentoObjetivos)} color="from-amber-400 to-orange-500" />
                </div>
                <p className="mt-5 text-sm font-bold text-slate-500 dark:text-slate-300">
                  Quando um objetivo sai de aberto para concluido, ele passa da previsao para o realizado e sobe a barra principal da meta.
                </p>
              </div>

              <div className="border border-slate-200 bg-slate-50 p-5 dark:border-slate-700 dark:bg-slate-950">
                <div className="flex items-center gap-3">
                  <Crown className="text-amber-500" />
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">MVP do momento</p>
                    <h3 className="text-xl font-black text-slate-950 dark:text-white">{topMember?.nome || 'Aguardando pontos'}</h3>
                  </div>
                </div>
                <p className="mt-5 text-4xl font-black text-blue-600">{topMember?.pontos || 0} XP</p>
                <p className="mt-2 text-sm font-bold text-slate-500 dark:text-slate-300">
                  {topMember ? messages.get(topMember.id) : 'Pontue uma entrega para iniciar o ranking do Apollo.'}
                </p>
              </div>
            </div>
          </section>

          <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_430px]">
            <section className="border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
              <div className="border-b border-slate-100 p-5 dark:border-slate-800">
                <p className="text-[10px] font-black uppercase tracking-[0.28em] text-blue-600">Ranking</p>
                <h2 className="mt-1 text-2xl font-black text-slate-950 dark:text-white">Liga Apollo</h2>
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.members.length === 0 ? (
                  <p className="p-8 text-center text-sm font-black text-slate-400">Nenhum integrante no Apollo ainda.</p>
                ) : data.members.map((member, index) => (
                  <div key={member.id} className="grid gap-4 p-5 transition hover:bg-blue-50/60 dark:hover:bg-blue-950/20 sm:grid-cols-[auto_1fr_auto] sm:items-center">
                    <div className="flex items-center gap-4">
                      <span className="flex h-10 w-10 items-center justify-center bg-slate-950 text-sm font-black text-white dark:bg-blue-600">#{index + 1}</span>
                      <div className="h-16 w-16 overflow-hidden bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-600/20">
                        {member.foto_url ? <img src={member.foto_url} alt={member.nome || ''} className="h-full w-full object-cover" /> : <span className="flex h-full w-full items-center justify-center text-lg font-black">{initials(member.nome)}</span>}
                      </div>
                    </div>
                    <div className="min-w-0">
                      <h3 className="truncate text-xl font-black text-slate-950 dark:text-white">{member.nome || 'Integrante Apollo'}</h3>
                      <p className="text-xs font-black uppercase tracking-widest text-blue-600">{displayRole(member)}</p>
                      <p className="mt-2 text-sm font-semibold leading-6 text-slate-500 dark:text-slate-300">{messages.get(member.id)}</p>
                    </div>
                    <div className="bg-blue-50 px-5 py-4 text-center dark:bg-blue-950/50">
                      <p className="text-4xl font-black text-blue-600">{member.pontos}</p>
                      <p className="text-[10px] font-black uppercase tracking-widest text-blue-500">XP</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <aside className="space-y-6">
              {data.isAdmin ? (
                <section className="border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
                  <p className="text-[10px] font-black uppercase tracking-[0.28em] text-blue-600">Admin</p>
                  <h2 className="mt-1 text-xl font-black text-slate-950 dark:text-white">Pontuar integrante</h2>
                  <select
                    value={pointsForm.profile_id}
                    onChange={(event) => setPointsForm((current) => ({ ...current, profile_id: event.target.value }))}
                    className="mt-4 w-full border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-950 outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  >
                    <option value="">Selecione alguem</option>
                    {data.members.map((member) => <option key={member.id} value={member.id}>{member.nome}</option>)}
                  </select>
                  <input
                    value={pointsForm.pontos}
                    onChange={(event) => setPointsForm((current) => ({ ...current, pontos: event.target.value }))}
                    placeholder="Pontos"
                    className="mt-3 w-full border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-950 outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />
                  <input
                    value={pointsForm.motivo}
                    onChange={(event) => setPointsForm((current) => ({ ...current, motivo: event.target.value }))}
                    placeholder="Motivo da pontuacao"
                    className="mt-3 w-full border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-950 outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />
                  <button
                    onClick={() => submitAction({ action: 'add_points', ...pointsForm }, 'Pontuacao adicionada.')}
                    disabled={saving}
                    className="mt-3 flex w-full cursor-pointer items-center justify-center gap-2 bg-blue-600 px-4 py-3 text-sm font-black text-white transition hover:bg-blue-700"
                  >
                    {saving ? <Loader2 className="animate-spin" size={17} /> : <Award size={17} />} Pontuar
                  </button>
                </section>
              ) : (
                <section className="border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
                  <Lock className="text-blue-600" />
                  <h2 className="mt-3 text-xl font-black text-slate-950 dark:text-white">Modo visualizacao</h2>
                  <p className="mt-2 text-sm font-bold leading-6 text-slate-500 dark:text-slate-300">
                    Voce acompanha ranking, metas e objetivos. Alteracoes de pontuacao e status ficam com o admin.
                  </p>
                </section>
              )}

              <section className="border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
                <div className="border-b border-slate-100 p-5 dark:border-slate-800">
                  <p className="text-[10px] font-black uppercase tracking-[0.28em] text-blue-600">Objetivos</p>
                  <h2 className="mt-1 text-xl font-black text-slate-950 dark:text-white">Renovacoes de Maio</h2>
                </div>
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {data.objectives.map((objective) => (
                    <div key={objective.id} className="grid grid-cols-[1fr_auto] gap-3 p-4">
                      <div>
                        <h3 className="font-black text-slate-950 dark:text-white">{objective.titulo}</h3>
                        <p className="text-sm font-black text-blue-600">Previsao: {brl(objective.valor_estimado)}</p>
                      </div>
                      {data.isAdmin ? (
                        <select
                          value={objective.status}
                          onChange={(event) => submitAction({ action: 'update_objective', id: objective.id, status: event.target.value }, 'Objetivo atualizado.')}
                          className={`h-11 cursor-pointer border px-3 text-xs font-black outline-none ${statusClass(objective.status)}`}
                        >
                          <option value="aberto">Aberto</option>
                          <option value="em_andamento">Em andamento</option>
                          <option value="feito">Concluido</option>
                        </select>
                      ) : (
                        <span className={`h-8 border px-3 py-2 text-[10px] font-black uppercase tracking-widest ${statusClass(objective.status)}`}>{statusLabel(objective.status)}</span>
                      )}
                    </div>
                  ))}
                </div>
                {data.isAdmin && (
                  <div className="border-t border-slate-100 p-5 dark:border-slate-800">
                    <h3 className="text-sm font-black text-slate-950 dark:text-white">Adicionar objetivo</h3>
                    <input
                      value={objectiveForm.titulo}
                      onChange={(event) => setObjectiveForm((current) => ({ ...current, titulo: event.target.value }))}
                      placeholder="Nome do objetivo"
                      className="mt-3 w-full border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-950 outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                    />
                    <input
                      value={objectiveForm.valor_estimado}
                      onChange={(event) => setObjectiveForm((current) => ({ ...current, valor_estimado: event.target.value }))}
                      placeholder="Valor estimado"
                      className="mt-3 w-full border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-950 outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                    />
                    <button
                      onClick={() => submitAction({ action: 'create_objective', ...objectiveForm }, 'Objetivo criado.')}
                      disabled={saving}
                      className="mt-3 flex w-full cursor-pointer items-center justify-center gap-2 bg-slate-950 px-4 py-3 text-sm font-black text-white transition hover:bg-blue-700 dark:bg-blue-600"
                    >
                      <Plus size={17} /> Criar objetivo
                    </button>
                  </div>
                )}
              </section>

              {data.isAdmin && (
                <section className="border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
                  <p className="text-[10px] font-black uppercase tracking-[0.28em] text-blue-600">Meta</p>
                  <h2 className="mt-1 text-xl font-black text-slate-950 dark:text-white">Ajustar alvo do mes</h2>
                  <input
                    value={metaForm.meta_valor}
                    onChange={(event) => setMetaForm((current) => ({ ...current, meta_valor: event.target.value }))}
                    className="mt-4 w-full border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-950 outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />
                  <input
                    type="date"
                    value={metaForm.prazo}
                    onChange={(event) => setMetaForm((current) => ({ ...current, prazo: event.target.value }))}
                    className="mt-3 w-full border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-950 outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />
                  <button
                    onClick={() => submitAction({ action: 'update_meta', meta_valor: metaForm.meta_valor, prazo: metaForm.prazo }, 'Meta atualizada.')}
                    disabled={saving}
                    className="mt-3 flex w-full cursor-pointer items-center justify-center gap-2 bg-blue-600 px-4 py-3 text-sm font-black text-white transition hover:bg-blue-700"
                  >
                    {saving ? <Loader2 className="animate-spin" size={17} /> : <Save size={17} />} Salvar meta
                  </button>
                </section>
              )}
            </aside>
          </div>
        </>
      )}
    </InternalLayout>
  );
}

function Metric({ icon: Icon, label, value, tone }: { icon: any; label: string; value: string; tone: 'blue' | 'emerald' | 'amber' | 'violet' }) {
  const colors = {
    blue: 'bg-blue-50 text-blue-700 border-blue-100 dark:bg-blue-950/40 dark:border-blue-400/20 dark:text-blue-100',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100 dark:bg-emerald-950/30 dark:border-emerald-400/20 dark:text-emerald-100',
    amber: 'bg-amber-50 text-amber-700 border-amber-100 dark:bg-amber-950/30 dark:border-amber-400/20 dark:text-amber-100',
    violet: 'bg-violet-50 text-violet-700 border-violet-100 dark:bg-violet-950/30 dark:border-violet-400/20 dark:text-violet-100',
  };

  return (
    <div className={`border p-5 shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-xl ${colors[tone]}`}>
      <Icon size={22} />
      <p className="mt-5 text-[10px] font-black uppercase tracking-widest opacity-70">{label}</p>
      <p className="mt-2 text-2xl font-black">{value}</p>
    </div>
  );
}

function Progress({ label, value, amount, color }: { label: string; value: number; amount: string; color: string }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-4 text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-300">
        <span>{label}</span>
        <span>{amount}</span>
      </div>
      <div className="h-4 overflow-hidden bg-slate-100 dark:bg-slate-800">
        <div className={`h-full bg-gradient-to-r ${color} transition-all duration-700`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
      </div>
    </div>
  );
}
