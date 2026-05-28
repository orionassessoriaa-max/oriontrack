'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { BarChart3, CheckCircle2, Copy, Crown, Loader2, Plus, Send, Save, Settings, ShieldCheck, Target, Trash2, TrendingUp, Users } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/components/providers/AuthProvider';
import { useDialog } from '@/components/providers/DialogProvider';

type CorretorTeamManagerProps = {
  corretorId?: string;
};

type Team = {
  id: string;
  nome: string;
  corretor_id: string;
  proximo_indice: number;
};

type Membro = {
  id: string;
  nome: string;
  email: string;
  profile_id: string | null;
  status: string;
  ordem: number;
  ultimo_lead_at: string | null;
};

type Credentials = {
  email: string;
  senha_provisoria: string;
  link_login: string;
};

type TeamSettings = {
  owner_in_distribution: boolean;
  owner_profile: {
    id: string;
    nome: string;
    email: string;
    email_real?: string | null;
  } | null;
};

type AssignableLead = {
  id: string;
  nome: string;
  telefone: string | null;
  status: string | null;
  cidade?: string | null;
  investimento?: string | null;
  valor_negociacao?: number | string | null;
  valor_venda?: number | string | null;
  valor_comissao?: number | string | null;
  responsavel_membro_id: string | null;
  data_entrada?: string | null;
  updated_at?: string | null;
};

type MemberStats = Membro & {
  totalLeads: number;
  semResposta: number;
  negociacao: number;
  vendas: number;
  cotacoes: number;
  receita: number;
  comissao: number;
  ultimoLead?: string | null;
};

function currency(value: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);
}

function toNumber(value: unknown) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const text = String(value || '').replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeStatus(value?: string | null) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export default function CorretorTeamManager({ corretorId }: CorretorTeamManagerProps) {
  const { profile } = useAuth();
  const { confirmDialog } = useDialog();
  const [team, setTeam] = useState<Team | null>(null);
  const [membros, setMembros] = useState<Membro[]>([]);
  const [leads, setLeads] = useState<AssignableLead[]>([]);
  const [nomeTime, setNomeTime] = useState('Time comercial');
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [selectedLeadId, setSelectedLeadId] = useState('');
  const [selectedMemberId, setSelectedMemberId] = useState('');
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<TeamSettings>({
    owner_in_distribution: false,
    owner_profile: null,
  });
  const [error, setError] = useState<string | null>(null);
  const [assignMessage, setAssignMessage] = useState<string | null>(null);
  const canAssignLeads = profile?.tipo_usuario === 'corretor';

  const memberStats = useMemo<MemberStats[]>(() => {
    return membros.map((member) => {
      const memberLeads = leads.filter((lead) => lead.responsavel_membro_id === member.id);
      const stats = memberLeads.reduce((acc, lead) => {
        const status = normalizeStatus(lead.status);
        const isSale = status.includes('venda');
        const isNegotiation = status.includes('negoci');
        const isQuote = status.includes('cotacao') || status.includes('cota');
        const noReply = status.includes('retorno') || status.includes('resposta') || status.includes('aguardando') || status.includes('contato feito');

        acc.semResposta += noReply ? 1 : 0;
        acc.negociacao += isNegotiation ? 1 : 0;
        acc.cotacoes += isQuote ? 1 : 0;
        acc.vendas += isSale ? 1 : 0;
        acc.receita += toNumber(lead.valor_venda) || (isSale ? toNumber(lead.valor_negociacao) : 0);
        acc.comissao += toNumber(lead.valor_comissao);
        return acc;
      }, { semResposta: 0, negociacao: 0, cotacoes: 0, vendas: 0, receita: 0, comissao: 0 });

      return {
        ...member,
        totalLeads: memberLeads.length,
        ultimoLead: memberLeads[0]?.data_entrada || member.ultimo_lead_at,
        ...stats,
      };
    });
  }, [membros, leads]);

  const teamSummary = useMemo(() => {
    const assigned = leads.filter((lead) => lead.responsavel_membro_id).length;
    const sales = memberStats.reduce((sum, member) => sum + member.vendas, 0);
    const semResposta = memberStats.reduce((sum, member) => sum + member.semResposta, 0);
    const comissao = memberStats.reduce((sum, member) => sum + member.comissao, 0);
    const receita = memberStats.reduce((sum, member) => sum + member.receita, 0);
    return {
      total: leads.length,
      assigned,
      unassigned: Math.max(leads.length - assigned, 0),
      sales,
      semResposta,
      comissao,
      receita,
      conversion: leads.length ? Math.round((sales / leads.length) * 100) : 0,
    };
  }, [leads, memberStats]);

  const ranking = useMemo(() => {
    return [...memberStats].sort((a, b) => b.vendas - a.vendas || b.comissao - a.comissao || b.totalLeads - a.totalLeads);
  }, [memberStats]);

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token;
  }

  async function fetchTeam() {
    setLoading(true);
    setError(null);
    const token = await getToken();

    if (!token) {
      setError('Sessao expirada. Entre novamente.');
      setLoading(false);
      return;
    }

    const params = corretorId ? `?corretor_id=${corretorId}` : '';
    const response = await fetch(`/api/corretor/times${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const payload = await response.json();

    if (!response.ok) {
      setError(payload.error || 'Erro ao carregar time. Se voce esta logado como corretor, seu cadastro precisa estar vinculado ao registro de corretor.');
      setLoading(false);
      return;
    }

    setTeam(payload.team);
    setNomeTime(payload.team?.nome || 'Time comercial');
    setMembros(payload.membros || []);
    setLeads(payload.leads || []);
    setSettings(payload.settings || { owner_in_distribution: false, owner_profile: null });
    setLoading(false);
  }

  useEffect(() => {
    void fetchTeam();
  }, [corretorId]);

  async function postTeam(body: Record<string, unknown>) {
    const token = await getToken();
    if (!token) throw new Error('Sessao expirada. Entre novamente.');

    const response = await fetch('/api/corretor/times', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ ...body, corretor_id: corretorId }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Erro ao salvar time.');
    return payload;
  }

  async function saveTeamName() {
    setSaving(true);
    setError(null);
    try {
      await postTeam({ action: 'update_team_name', nome: nomeTime });
      await fetchTeam();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function createMember(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setCredentials(null);

    try {
      const payload = await postTeam({ action: 'create_member', nome, email });
      setCredentials(payload.credentials);
      setNome('');
      setEmail('');
      await fetchTeam();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function removeMember(member: Membro) {
    const confirmed = await confirmDialog(`Remover ${member.nome} do time?`, {
      title: 'Remover integrante',
      confirmLabel: 'Remover',
      variant: 'danger',
    });
    if (!confirmed) return;

    setSaving(true);
    setError(null);
    try {
      await postTeam({ action: 'delete_member', member_id: member.id });
      await fetchTeam();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function assignLead(event: FormEvent) {
    event.preventDefault();
    setAssigning(true);
    setError(null);
    setAssignMessage(null);

    try {
      await postTeam({ action: 'assign_lead', lead_id: selectedLeadId, member_id: selectedMemberId });
      setAssignMessage('Lead enviado para o integrante selecionado.');
      setSelectedLeadId('');
      setSelectedMemberId('');
      await fetchTeam();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setAssigning(false);
    }
  }

  async function toggleOwnerDistribution(includeOwner: boolean) {
    setSettingsSaving(true);
    setError(null);

    try {
      await postTeam({ action: 'toggle_owner_member', include_owner: includeOwner });
      await fetchTeam();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSettingsSaving(false);
    }
  }

  async function copyAccess() {
    if (!credentials) return;
    await navigator.clipboard.writeText(
      `ORION TRACK\nLogin: ${credentials.email}\nSenha provisoria: ${credentials.senha_provisoria}\nAcesse: ${credentials.link_login}`
    );
    alert('Acesso copiado.');
  }

  return (
    <div className="space-y-6">
      {error && <div className="rounded-2xl border border-red-100 bg-red-50 p-4 text-sm font-black text-red-600">{error}</div>}

      {credentials && (
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-5">
          <div className="mb-4 flex items-center gap-3 text-emerald-700">
            <CheckCircle2 size={22} />
            <div>
              <p className="font-black">Membro criado com senha provisoria</p>
              <p className="text-xs font-bold">Envie esses dados para o primeiro acesso.</p>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
            <div className="rounded-xl bg-white/80 p-3 text-sm font-bold">{credentials.email}</div>
            <div className="rounded-xl bg-white p-3 text-sm font-black">{credentials.senha_provisoria}</div>
            <button onClick={copyAccess} className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-black text-white">
              <Copy size={16} /> Copiar
            </button>
          </div>
        </div>
      )}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Leads do time', value: teamSummary.total, detail: `${teamSummary.assigned} atribuídos`, icon: Users, tone: 'blue' },
          { label: 'Sem resposta', value: teamSummary.semResposta, detail: 'precisam de atenção', icon: Target, tone: 'amber' },
          { label: 'Vendas', value: teamSummary.sales, detail: `${teamSummary.conversion}% conversão`, icon: TrendingUp, tone: 'emerald' },
          { label: 'Comissão', value: currency(teamSummary.comissao), detail: `${currency(teamSummary.receita)} em vendas`, icon: BarChart3, tone: 'slate' },
        ].map((card) => {
          const Icon = card.icon;
          const tone = {
            blue: 'border-blue-100 bg-blue-50 text-blue-700',
            amber: 'border-amber-100 bg-amber-50 text-amber-700',
            emerald: 'border-emerald-100 bg-emerald-50 text-emerald-700',
            slate: 'border-slate-200 bg-slate-50 text-slate-800',
          }[card.tone];
          return (
            <div key={card.label} className={`rounded-2xl border p-5 shadow-sm ${tone}`}>
              <div className="mb-4 flex items-center justify-between">
                <p className="text-[10px] font-black uppercase tracking-widest">{card.label}</p>
                <Icon size={20} />
              </div>
              <p className="text-3xl font-black text-slate-950">{card.value}</p>
              <p className="mt-2 text-xs font-black uppercase tracking-widest opacity-70">{card.detail}</p>
            </div>
          );
        })}
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-5 flex items-center justify-between gap-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-blue-600">Performance</p>
              <h2 className="mt-1 text-xl font-black text-slate-950">Distribuição por integrante</h2>
            </div>
            <span className="rounded-full bg-slate-100 px-4 py-2 text-xs font-black text-slate-600">
              {teamSummary.unassigned} sem responsável
            </span>
          </div>
          <div className="space-y-4">
            {memberStats.length === 0 ? (
              <p className="rounded-2xl bg-slate-50 p-6 text-center text-sm font-bold text-slate-400">Crie integrantes para ver a distribuição automática.</p>
            ) : memberStats.map((member) => {
              const width = teamSummary.total ? Math.max(8, Math.round((member.totalLeads / teamSummary.total) * 100)) : 0;
              return (
                <div key={member.id} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black text-slate-950">{member.nome}</p>
                      <p className="text-xs font-bold text-slate-500">{member.totalLeads} leads | {member.vendas} vendas | {currency(member.comissao)}</p>
                    </div>
                    <span className="text-lg font-black text-blue-600">{width}%</span>
                  </div>
                  <div className="h-3 overflow-hidden rounded-full bg-white">
                    <div className="h-full rounded-full bg-gradient-to-r from-blue-600 via-cyan-400 to-emerald-400 transition-all duration-700" style={{ width: `${width}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-slate-950 p-6 text-white shadow-sm">
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-400 text-slate-950">
              <Crown size={22} />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-amber-300">Ranking</p>
              <h2 className="text-xl font-black">Vendas do time</h2>
            </div>
          </div>
          <div className="space-y-3">
            {ranking.length === 0 ? (
              <p className="rounded-2xl bg-white/5 p-5 text-sm font-bold text-slate-300">O ranking aparece quando houver integrantes.</p>
            ) : ranking.map((member, index) => (
              <div key={member.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-2xl bg-white/6 p-4">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-sm font-black">#{index + 1}</span>
                <div className="min-w-0">
                  <p className="truncate font-black">{member.nome}</p>
                  <p className="text-xs font-bold text-slate-300">{member.totalLeads} leads | {member.semResposta} sem resposta</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-black text-emerald-300">{member.vendas}</p>
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">vendas</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[1fr_1.2fr]">
        <div className="rounded-[1.75rem] border border-slate-200 bg-white p-6 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-xl">
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
              <Users size={23} />
            </div>
            <div>
              <h2 className="text-xl font-black text-slate-950">Meu time comercial</h2>
              <p className="text-sm font-bold text-slate-500">Organize quem vai atender os leads novos das campanhas.</p>
            </div>
          </div>

          <label className="block">
            <span className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-400">Nome do time</span>
            <input
              value={nomeTime}
              onChange={(event) => setNomeTime(event.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4 text-sm font-black outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </label>
          <button
            type="button"
            onClick={saveTeamName}
            disabled={saving}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 py-4 text-sm font-black text-white transition-all hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
            Salvar nome do time
          </button>

          <button
            type="button"
            onClick={() => setSettingsOpen((current) => !current)}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-4 text-sm font-black text-slate-700 transition-all hover:-translate-y-0.5 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
          >
            <Settings size={18} />
            Configurações do time
          </button>

          {settingsOpen && (
            <div className="mt-4 rounded-2xl border border-blue-100 bg-blue-50 p-4 animate-in fade-in slide-in-from-top-2">
              <div className="flex items-start gap-3">
                <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-blue-600">
                  <ShieldCheck size={19} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-black text-slate-950">Participar da distribuição</p>
                  <p className="mt-1 text-xs font-bold leading-relaxed text-slate-600">
                    Quando ativado, o dono do time tambem pode receber leads novos das campanhas e aparece nos relatorios e ranking.
                  </p>
                  {settings.owner_profile && (
                    <p className="mt-2 text-[10px] font-black uppercase tracking-widest text-blue-700">
                      Dono do time: {settings.owner_profile.nome}
                    </p>
                  )}
                </div>
                <label className="relative inline-flex cursor-pointer items-center">
                  <input
                    type="checkbox"
                    className="peer sr-only"
                    checked={settings.owner_in_distribution}
                    disabled={settingsSaving}
                    onChange={(event) => toggleOwnerDistribution(event.target.checked)}
                  />
                  <span className="h-7 w-12 rounded-full bg-slate-300 transition peer-checked:bg-blue-600 peer-disabled:opacity-50" />
                  <span className="absolute left-1 h-5 w-5 rounded-full bg-white shadow transition peer-checked:translate-x-5" />
                </label>
              </div>
            </div>
          )}

          <form onSubmit={createMember} className="mt-8 space-y-4 border-t border-slate-100 pt-6">
            <label className="block">
              <span className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-400">Nome do integrante</span>
              <input
                required
                value={nome}
                onChange={(event) => setNome(event.target.value)}
                placeholder="Nome da pessoa"
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-400">Email real</span>
              <input
                required
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="pessoa@email.com"
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </label>
            <button
              disabled={saving}
              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-4 text-sm font-black text-white transition-all hover:bg-emerald-700 disabled:opacity-50"
            >
              {saving ? <Loader2 className="animate-spin" size={18} /> : <Plus size={18} />}
              Criar integrante
            </button>
          </form>

          {canAssignLeads && (
            <form onSubmit={assignLead} className="mt-8 space-y-4 border-t border-slate-100 pt-6">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-blue-600">Enviar lead</p>
                <h3 className="mt-1 text-lg font-black text-slate-950">Atribuir manualmente</h3>
                <p className="text-sm font-bold text-slate-500">Use quando quiser mandar um lead especifico para alguem do time.</p>
              </div>
              {assignMessage && (
                <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-3 text-sm font-black text-emerald-700">
                  {assignMessage}
                </div>
              )}
              <label className="block">
                <span className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-400">Lead</span>
                <select
                  required
                  value={selectedLeadId}
                  onChange={(event) => setSelectedLeadId(event.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20"
                >
                  <option value="">Selecione o lead</option>
                  {leads.map((lead) => {
                    const currentMember = membros.find((member) => member.id === lead.responsavel_membro_id);
                    return (
                      <option key={lead.id} value={lead.id}>
                        {lead.nome} {lead.telefone ? `- ${lead.telefone}` : ''} {currentMember ? `(atual: ${currentMember.nome})` : ''}
                      </option>
                    );
                  })}
                </select>
              </label>
              <label className="block">
                <span className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-400">Integrante</span>
                <select
                  required
                  value={selectedMemberId}
                  onChange={(event) => setSelectedMemberId(event.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20"
                >
                  <option value="">Selecione quem vai receber</option>
                  {membros.map((member) => <option key={member.id} value={member.id}>{member.nome}</option>)}
                </select>
              </label>
              <button
                disabled={assigning || membros.length === 0 || leads.length === 0}
                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-5 py-4 text-sm font-black text-white transition-all hover:bg-slate-800 disabled:opacity-50"
              >
                {assigning ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />}
                Enviar lead
              </button>
            </form>
          )}
        </div>

        <div className="overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-sm transition-all duration-300 hover:shadow-xl">
          <div className="border-b border-slate-100 p-6">
            <p className="text-[10px] font-black uppercase tracking-widest text-blue-600">{team?.nome || 'Time comercial'}</p>
            <h2 className="mt-1 text-xl font-black text-slate-950">Integrantes cadastrados</h2>
            <p className="mt-2 text-sm font-bold text-slate-500">
              Acompanhe quem atende cada oportunidade e veja a evolucao do time.
            </p>
          </div>

          {loading ? (
            <div className="flex justify-center p-16">
              <Loader2 className="animate-spin text-blue-600" size={36} />
            </div>
          ) : membros.length === 0 ? (
            <div className="p-16 text-center text-sm font-bold text-slate-400">
              Nenhum integrante criado ainda.
            </div>
          ) : (
            <div className="grid gap-4 p-5">
              {memberStats.map((member, index) => (
                <div key={member.id} className="rounded-[1.5rem] border border-slate-100 bg-slate-50 p-4 transition-all duration-300 hover:-translate-y-1 hover:border-blue-200 hover:bg-white hover:shadow-lg">
                  <div className="grid gap-4 xl:grid-cols-[1fr_1.4fr_auto] xl:items-center">
                  <div className="flex min-w-0 items-center gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 text-sm font-black text-white">
                      {member.nome.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="font-black text-slate-950">{member.nome}</p>
                      <p className="break-all text-xs font-bold text-slate-500">{member.email}</p>
                      <p className="mt-1 text-[10px] font-black uppercase tracking-widest text-blue-600">
                        Fila #{index + 1} {member.ultimo_lead_at ? `| ultimo lead ${new Date(member.ultimo_lead_at).toLocaleDateString('pt-BR')}` : ''}
                      </p>
                      {member.profile_id === settings.owner_profile?.id && (
                        <span className="mt-2 inline-flex rounded-full bg-blue-100 px-3 py-1 text-[9px] font-black uppercase tracking-widest text-blue-700">
                          Dono do time
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <div className="rounded-xl bg-blue-50 p-3">
                      <p className="text-[9px] font-black uppercase tracking-widest text-blue-500">Leads</p>
                      <p className="text-lg font-black text-slate-950">{member.totalLeads}</p>
                    </div>
                    <div className="rounded-xl bg-amber-50 p-3">
                      <p className="text-[9px] font-black uppercase tracking-widest text-amber-600">Sem resposta</p>
                      <p className="text-lg font-black text-slate-950">{member.semResposta}</p>
                    </div>
                    <div className="rounded-xl bg-emerald-50 p-3">
                      <p className="text-[9px] font-black uppercase tracking-widest text-emerald-600">Vendas</p>
                      <p className="text-lg font-black text-slate-950">{member.vendas}</p>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-3">
                      <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">Comissão</p>
                      <p className="text-sm font-black text-slate-950">{currency(member.comissao)}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeMember(member)}
                    disabled={member.profile_id === settings.owner_profile?.id}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-xs font-black text-red-600 transition-all hover:bg-red-100"
                    title={member.profile_id === settings.owner_profile?.id ? 'Desative em Configurações do time.' : 'Remover integrante'}
                  >
                    <Trash2 size={15} /> Remover
                  </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
