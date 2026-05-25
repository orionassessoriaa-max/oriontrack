'use client';

import { useEffect, useMemo, useState } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import { useAuth } from '@/components/providers/AuthProvider';
import { supabase } from '@/lib/supabase/client';
import { Award, CalendarDays, CheckCircle2, Flame, Loader2, Plus, Save, Target, Trophy, Users } from 'lucide-react';

type TeamMember = {
  id: string;
  nome: string | null;
  email: string | null;
  email_real: string | null;
  tipo_usuario: string;
  foto_url: string | null;
  pontos: number;
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
    totalPontos: number;
    daysRemaining: number;
    progress: number;
    dailyMessages: { profile_id: string; text: string }[];
  };
  isAdmin: boolean;
};

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

function initials(name?: string | null) {
  return (name || 'Orion')
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export default function ApolloTeamPage() {
  const { profile } = useAuth();
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

  const progress = data?.summary.progress || 0;
  const remaining = Math.max(0, Number(data?.meta.meta_valor || 50000) - Number(data?.summary.realizadoObjetivos || 0));

  return (
    <InternalLayout>
      <div className="mb-8 grid gap-5 xl:grid-cols-[1fr_auto] xl:items-end">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.28em] text-blue-600">Time operacional</p>
          <h1 className="mt-2 text-4xl font-black tracking-tight text-slate-950 dark:text-white">Meu time Apollo</h1>
          <p className="mt-2 max-w-3xl text-sm font-bold leading-7 text-slate-500 dark:text-slate-300">
            Acompanhe os integrantes, pontue entregas importantes e mantenha todo mundo olhando para a meta do mes.
          </p>
        </div>
        <div className="border border-blue-100 bg-white p-4 shadow-sm dark:border-blue-400/20 dark:bg-slate-900">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Meta Apollo Maio</p>
          <p className="mt-1 text-3xl font-black text-slate-950 dark:text-white">{brl(data?.meta.meta_valor || 50000)}</p>
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
            <Metric icon={Target} label="Meta do mes" value={brl(data.meta.meta_valor)} tone="blue" />
            <Metric icon={CheckCircle2} label="Objetivos fechados" value={brl(data.summary.realizadoObjetivos)} tone="emerald" />
            <Metric icon={CalendarDays} label="Prazo" value={`${data.summary.daysRemaining} dias`} tone="amber" />
            <Metric icon={Trophy} label="Pontos do time" value={String(data.summary.totalPontos)} tone="violet" />
          </section>

          <section className="mt-6 overflow-hidden border border-blue-100 bg-white shadow-sm dark:border-blue-400/20 dark:bg-slate-900">
            <div className="grid gap-5 p-6 lg:grid-cols-[1fr_280px] lg:items-center">
              <div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.28em] text-blue-600">Corrida dos 50K</p>
                    <h2 className="mt-2 text-2xl font-black text-slate-950 dark:text-white">Apollo em ritmo de virada</h2>
                  </div>
                  <span className="bg-slate-950 px-4 py-2 text-sm font-black text-white dark:bg-blue-600">{progress}%</span>
                </div>
                <div className="mt-6 h-5 overflow-hidden bg-slate-100 dark:bg-slate-800">
                  <div
                    className="h-full bg-gradient-to-r from-blue-600 via-cyan-400 to-emerald-400 transition-all duration-700"
                    style={{ width: `${Math.min(100, progress)}%` }}
                  />
                </div>
                <p className="mt-4 text-sm font-bold text-slate-500 dark:text-slate-300">
                  Ja temos {brl(data.summary.realizadoObjetivos)} em objetivos concluidos. Faltam {brl(remaining)} para bater a meta.
                </p>
              </div>
              {data.isAdmin && (
                <div className="border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Editar meta</p>
                  <input
                    value={metaForm.meta_valor}
                    onChange={(event) => setMetaForm((current) => ({ ...current, meta_valor: event.target.value }))}
                    className="mt-3 w-full border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-950 outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                  />
                  <input
                    type="date"
                    value={metaForm.prazo}
                    onChange={(event) => setMetaForm((current) => ({ ...current, prazo: event.target.value }))}
                    className="mt-3 w-full border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-950 outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                  />
                  <button
                    onClick={() => submitAction({ action: 'update_meta', meta_valor: metaForm.meta_valor, prazo: metaForm.prazo }, 'Meta atualizada.')}
                    disabled={saving}
                    className="mt-3 flex w-full items-center justify-center gap-2 bg-blue-600 px-4 py-3 text-sm font-black text-white transition hover:bg-blue-700"
                  >
                    {saving ? <Loader2 className="animate-spin" size={17} /> : <Save size={17} />} Salvar meta
                  </button>
                </div>
              )}
            </div>
          </section>

          <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_420px]">
            <section className="border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
              <div className="border-b border-slate-100 p-5 dark:border-slate-800">
                <p className="text-[10px] font-black uppercase tracking-[0.28em] text-blue-600">Ranking</p>
                <h2 className="mt-1 text-2xl font-black text-slate-950 dark:text-white">Pontuacao dos integrantes</h2>
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.members.length === 0 ? (
                  <p className="p-8 text-center text-sm font-black text-slate-400">Nenhum integrante no Apollo ainda.</p>
                ) : data.members.map((member, index) => (
                  <div key={member.id} className="grid gap-4 p-5 sm:grid-cols-[auto_1fr_auto] sm:items-center">
                    <div className="flex items-center gap-4">
                      <span className="flex h-9 w-9 items-center justify-center bg-slate-950 text-sm font-black text-white dark:bg-blue-600">#{index + 1}</span>
                      <div className="h-14 w-14 overflow-hidden bg-gradient-to-br from-blue-600 to-indigo-600 text-white">
                        {member.foto_url ? <img src={member.foto_url} alt={member.nome || ''} className="h-full w-full object-cover" /> : <span className="flex h-full w-full items-center justify-center text-lg font-black">{initials(member.nome)}</span>}
                      </div>
                    </div>
                    <div className="min-w-0">
                      <h3 className="truncate text-lg font-black text-slate-950 dark:text-white">{member.nome || 'Integrante Apollo'}</h3>
                      <p className="text-xs font-black uppercase tracking-widest text-blue-600">{roleLabels[member.tipo_usuario] || member.tipo_usuario}</p>
                      <p className="mt-2 text-sm font-semibold leading-6 text-slate-500 dark:text-slate-300">{messages.get(member.id)}</p>
                    </div>
                    <div className="bg-blue-50 px-5 py-4 text-center dark:bg-blue-950/50">
                      <p className="text-3xl font-black text-blue-600">{member.pontos}</p>
                      <p className="text-[10px] font-black uppercase tracking-widest text-blue-500">pontos</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <aside className="space-y-6">
              {data.isAdmin && (
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
                    className="mt-3 flex w-full items-center justify-center gap-2 bg-blue-600 px-4 py-3 text-sm font-black text-white transition hover:bg-blue-700"
                  >
                    {saving ? <Loader2 className="animate-spin" size={17} /> : <Award size={17} />} Pontuar
                  </button>
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
                        <p className="text-sm font-black text-blue-600">{brl(objective.valor_estimado)}</p>
                      </div>
                      {data.isAdmin ? (
                        <select
                          value={objective.status}
                          onChange={(event) => submitAction({ action: 'update_objective', id: objective.id, status: event.target.value }, 'Objetivo atualizado.')}
                          className="h-11 border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                        >
                          <option value="aberto">Aberto</option>
                          <option value="em_andamento">Em andamento</option>
                          <option value="feito">Concluido</option>
                        </select>
                      ) : (
                        <span className="h-8 bg-slate-100 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-600 dark:bg-slate-800 dark:text-slate-200">{statusLabel(objective.status)}</span>
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
                      className="mt-3 flex w-full items-center justify-center gap-2 bg-slate-950 px-4 py-3 text-sm font-black text-white transition hover:bg-blue-700 dark:bg-blue-600"
                    >
                      <Plus size={17} /> Criar objetivo
                    </button>
                  </div>
                )}
              </section>
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
    <div className={`border p-5 shadow-sm transition hover:-translate-y-1 hover:shadow-lg ${colors[tone]}`}>
      <Icon size={22} />
      <p className="mt-5 text-[10px] font-black uppercase tracking-widest opacity-70">{label}</p>
      <p className="mt-2 text-2xl font-black">{value}</p>
    </div>
  );
}
