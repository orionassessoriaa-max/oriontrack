'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { BarChart3, CheckCircle2, Copy, Crown, Loader2, Plus, Send, Settings, ShieldCheck, Target, Trash2, TrendingUp, Users, Trophy, BookOpen, Sparkles, ArrowRight, HelpCircle, RefreshCw } from 'lucide-react';
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
  ativo: boolean;
};

type Membro = {
  id: string;
  nome: string;
  email: string;
  profile_id: string | null;
  status: string;
  ordem: number;
  ultimo_lead_at: string | null;
  tipo_usuario?: string;
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
  const [brokerageName, setBrokerageName] = useState('');
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
  const [memberRole, setMemberRole] = useState<'corretor_membro' | 'corretor_admin'>('corretor_membro');
  const [skipOnboarding, setSkipOnboarding] = useState(false);
  const [showAddMemberForm, setShowAddMemberForm] = useState(false);
  const canAssignLeads = profile?.tipo_usuario === 'corretor' || profile?.tipo_usuario === 'corretor_admin';
  const displayTeamName = brokerageName || team?.nome || 'Time comercial';

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
      setError('Sessão expirada. Entre novamente.');
      setLoading(false);
      return;
    }

    const params = corretorId ? `?corretor_id=${corretorId}` : '';
    const response = await fetch(`/api/corretor/times${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const payload = await response.json();

    if (!response.ok) {
      setError(payload.error || 'Erro ao carregar time. Se você está logado como corretor, seu cadastro precisa estar vinculado ao registro de corretor.');
      setLoading(false);
      return;
    }

    setTeam(payload.team);
    setBrokerageName(payload.brokerage_name || payload.team?.nome || '');
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
    if (!token) throw new Error('Sessão expirada. Entre novamente.');

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

  async function createTeam() {
    setSaving(true);
    setError(null);
    try {
      const payload = await postTeam({ action: 'create_team', nome: displayTeamName });
      setTeam(payload.team);
      setBrokerageName(payload.brokerage_name || payload.team.nome || '');
      await fetchTeam();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteTeam() {
    const confirmed = await confirmDialog(
      'Tem certeza de que deseja EXCLUIR COMPLETAMENTE este time comercial? Todos os integrantes cadastrados perderão o acesso ao OrionTrack e as oportunidades voltarão para a carteira geral sem responsável. Esta ação é irreversível!',
      {
        title: 'Excluir Time Comercial',
        confirmLabel: 'Excluir Definitivamente',
        variant: 'danger',
      }
    );
    if (!confirmed) return;

    setSaving(true);
    setError(null);
    try {
      await postTeam({ action: 'delete_team' });
      setTeam(null);
      setMembros([]);
      setBrokerageName('');
      alert('Time excluído com sucesso.');
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

    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(email)) {
      setError('Por favor, informe um e-mail válido com a extensão (ex: .com, .com.br).');
      setSaving(false);
      return;
    }

    try {
      const payload = await postTeam({ action: 'create_member', nome, email, tipo_usuario: memberRole });
      setCredentials(payload.credentials);
      setNome('');
      setEmail('');
      setMemberRole('corretor_membro');
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

  async function toggleTeamDistribution(active: boolean) {
    setSettingsSaving(true);
    setError(null);

    try {
      await postTeam({ action: 'toggle_distribution', active });
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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="animate-spin text-cyan-400" size={40} />
      </div>
    );
  }

  if (!team) {
    return (
      <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
        {error && (
          <div className="rounded-2xl border border-red-500/10 bg-red-500/5 p-4 text-sm font-black text-red-400">
            {error}
          </div>
        )}

        <div className="rounded-[2.5rem] border border-white/5 bg-[#090e1a]/85 backdrop-blur-md p-8 md:p-12 shadow-2xl text-center space-y-8 relative overflow-hidden">
          {/* Decorative Glowing Orbs */}
          <div className="absolute -top-12 -left-12 w-48 h-48 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-12 -right-12 w-48 h-48 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />

          {/* Trophy Header Icon */}
          <div className="flex justify-center">
            <div className="relative">
              <div className="absolute inset-0 bg-amber-500/20 rounded-full blur-xl animate-pulse" />
              <div className="flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 via-orange-500 to-yellow-400 text-white shadow-2xl relative border-2 border-white/10 animate-bounce">
                <Trophy size={44} />
              </div>
            </div>
          </div>

          <div className="max-w-2xl mx-auto space-y-4">
            <p className="text-[11px] font-black uppercase tracking-widest text-cyan-400">Time de Vendas Orion</p>
            <h2 className="text-3xl md:text-4xl font-black text-white leading-tight">Aqui seu time comercial entra em campo! 🚀</h2>
            <p className="text-sm font-medium text-slate-400 leading-relaxed">
              Com o <strong>Meu Time</strong>, você organiza sua força de vendas de forma simples e de alta performance. 
              Cadastre integrantes, dê acessos exclusivos para cada vendedor e deixe o OrionTrack distribuir os leads 
              automaticamente em rodízio ou gerencie de forma compartilhada!
            </p>
          </div>

          {/* Feature Showcase Grid */}
          <div className="grid gap-4 sm:grid-cols-3 max-w-3xl mx-auto pt-4 text-left">
            {[
              { icon: Sparkles, title: "Automação de Vendas", text: "Distribua clientes instantaneamente de forma justa para sua equipe ativa." },
              { icon: Users, title: "Acessos Exclusivos", text: "Seus corretores têm login exclusivo para gerenciar o funil do CRM." },
              { icon: Crown, title: "Ranking Gamificado", text: "Estimule vendas e comissões com um ranking atualizado em tempo real." },
            ].map((f, i) => {
              const Icon = f.icon;
              return (
                <div key={i} className="bg-white/5 border border-white/5 p-5 rounded-2xl hover:border-cyan-500/20 transition-all duration-300">
                  <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 flex items-center justify-center mb-3">
                    <Icon size={20} />
                  </div>
                  <h4 className="font-black text-white text-sm">{f.title}</h4>
                  <p className="text-xs text-slate-400 font-medium mt-1 leading-relaxed">{f.text}</p>
                </div>
              );
            })}
          </div>

          {/* Form Step */}
          <div className="max-w-md mx-auto pt-6 border-t border-white/5">
            <div className="bg-white/5 p-6 rounded-3xl border border-white/10 space-y-5">
              <div>
                <h3 className="font-black text-white text-lg">Você não possui um time. Deseja criar?</h3>
                <p className="text-xs text-slate-400 font-bold mt-1">Dê um nome forte e marcante para a sua equipe!</p>
              </div>

              <div className="space-y-3">
                <input
                  type="text"
                  value={displayTeamName}
                  readOnly
                  placeholder="Ex: Elite Orion, Dream Team..."
                  className="w-full rounded-2xl border border-white/5 bg-[#070b13] px-5 py-4 text-sm font-black text-white outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500/50 focus:bg-[#090f1d] transition-all text-center"
                />
                
                <button
                  type="button"
                  onClick={createTeam}
                  disabled={saving}
                  className="w-full flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-blue-600 to-cyan-500 py-4 text-sm font-black text-white transition-all hover:scale-[1.02] shadow-lg shadow-blue-500/20 disabled:opacity-40 cursor-pointer"
                >
                  {saving ? <Loader2 className="animate-spin" size={18} /> : <ArrowRight size={18} />}
                  Criar Time da Corretora
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (membros.length === 0 && !skipOnboarding) {
    return (
      <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
        {error && (
          <div className="rounded-2xl border border-red-500/10 bg-red-500/5 p-4 text-sm font-black text-red-400">
            {error}
          </div>
        )}

        {credentials && (
          <div className="rounded-3xl border border-emerald-500/15 bg-emerald-500/5 p-5 shadow-lg shadow-emerald-500/5 animate-in fade-in duration-300">
            <div className="mb-4 flex items-center gap-3 text-emerald-400">
              <CheckCircle2 size={22} className="animate-pulse" />
              <div>
                <p className="font-black text-white">Membro criado com senha provisória</p>
                <p className="text-xs font-bold text-slate-400">Envie esses dados para o primeiro acesso.</p>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
              <div className="rounded-2xl bg-white/5 border border-white/5 p-3.5 text-sm font-bold text-slate-300">{credentials.email}</div>
              <div className="rounded-2xl bg-white/5 border border-white/5 p-3.5 text-sm font-black text-cyan-400">{credentials.senha_provisoria}</div>
              <button onClick={copyAccess} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-black text-white transition-all hover:bg-emerald-700 shadow-md">
                <Copy size={16} /> Copiar Acesso
              </button>
            </div>
          </div>
        )}

        <div className="rounded-[2.5rem] border border-white/5 bg-[#090e1a]/85 backdrop-blur-md p-8 md:p-12 shadow-2xl space-y-8 relative overflow-hidden">
          {/* Decorative Glowing Orbs */}
          <div className="absolute -top-12 -right-12 w-48 h-48 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-12 -left-12 w-48 h-48 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />

          {/* Stepper Header */}
          <div className="flex justify-between items-center pb-6 border-b border-white/5">
            <div>
              <span className="text-[10px] font-black uppercase tracking-widest text-emerald-400">Onboarding: Etapa 2 de 2</span>
              <h2 className="text-2xl font-black text-white mt-1">Seu time "{displayTeamName}" esta pronto!</h2>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-black">✓</div>
              <div className="h-px w-6 bg-emerald-500/20" />
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-500/20 border border-blue-500/30 text-cyan-400 text-xs font-black animate-pulse">2</div>
            </div>
          </div>

          <div className="grid gap-8 md:grid-cols-2">
            {/* Left Column: Context copy */}
            <div className="space-y-6 justify-center flex flex-col">
              <div className="space-y-4">
                <h3 className="text-xl font-black text-white">Adicione o seu primeiro vendedor ao time</h3>
                <p className="text-sm font-medium text-slate-400 leading-relaxed">
                  Adicione integrantes se quiser delegar acessos de vendedor. Eles receberão login exclusivo para gerenciar o CRM.
                </p>
                <p className="text-sm font-medium text-slate-400 leading-relaxed">
                  Você também pode pular esta etapa e gerenciar/adicionar integrantes a qualquer momento diretamente pelo painel.
                </p>
              </div>

              {/* Progress Box */}
              <div className="bg-white/5 border border-white/5 p-5 rounded-2xl space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-black">✓</div>
                    <span className="text-sm font-bold text-slate-300">Corretora: <strong className="text-emerald-400">{displayTeamName}</strong></span>
                  </div>
                  
                  <div className="pl-9">
                    <p className="rounded-xl border border-white/5 bg-white/[0.02] p-3 text-[10px] font-bold text-slate-400">
                      O nome do time acompanha a corretora vinculada no cadastro do admin.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3 border-t border-white/5 pt-3.5">
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-white/5 border border-dashed border-white/10 text-slate-500 text-xs font-black">2</div>
                  <span className="text-sm font-bold text-slate-400">Adicionar integrante (opcional)</span>
                </div>
              </div>

              {/* Reset Team Button */}
              <button
                type="button"
                onClick={deleteTeam}
                disabled={saving}
                className="w-full flex items-center justify-center gap-2 rounded-2xl border border-red-500/10 bg-red-500/5 hover:bg-red-500/10 py-3.5 text-xs font-black text-red-400 transition-all cursor-pointer shadow-md disabled:opacity-40"
              >
                <Trash2 size={14} />
                Excluir Time e Começar de Novo
              </button>
            </div>

            {/* Right Column: Creation Form or Question */}
            <div className="bg-white/5 p-6 rounded-3xl border border-white/10 flex flex-col justify-center min-h-[300px]">
              {!showAddMemberForm ? (
                <div className="space-y-6 text-center">
                  <div className="space-y-2">
                    <h4 className="font-black text-white text-lg">Deseja adicionar uma pessoa ao time agora?</h4>
                    <p className="text-xs text-slate-400 font-bold">
                      Você pode cadastrar um corretor para trabalhar em equipe ou ir direto para o painel.
                    </p>
                  </div>
                  <div className="space-y-3">
                    <button
                      type="button"
                      onClick={() => setShowAddMemberForm(true)}
                      className="w-full flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-600 to-cyan-500 py-4 text-sm font-black text-white transition-all hover:scale-[1.02] shadow-lg shadow-emerald-500/20 cursor-pointer"
                    >
                      <Plus size={18} />
                      Sim, adicionar integrante
                    </button>
                    <button
                      type="button"
                      onClick={() => setSkipOnboarding(true)}
                      className="w-full flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 py-4 text-xs font-black text-slate-300 transition-all hover:bg-white/10 cursor-pointer"
                    >
                      Não, ir para o painel
                    </button>
                  </div>
                </div>
              ) : (
                <form onSubmit={createMember} className="space-y-4">
                  <div className="mb-4 flex items-center justify-between">
                    <div>
                      <h4 className="font-black text-white text-base">Novo Integrante</h4>
                      <p className="text-xs text-slate-400 font-bold mt-1">Preencha os dados do seu primeiro vendedor.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowAddMemberForm(false)}
                      className="text-[10px] font-black text-slate-400 uppercase tracking-widest hover:underline"
                    >
                      Voltar
                    </button>
                  </div>
                  
                  <label className="block">
                    <span className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-500">Nome do Integrante</span>
                    <input
                      required
                      value={nome}
                      onChange={(event) => setNome(event.target.value)}
                      placeholder="Nome completo do vendedor"
                      className="w-full rounded-2xl border border-white/5 bg-[#070b13] px-5 py-4 text-sm font-bold text-white outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500/50 focus:bg-[#090f1d] transition-all"
                    />
                  </label>
                  
                  <label className="block">
                    <span className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-500">Email Comercial/Real</span>
                    <input
                      required
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="exemplo@vendedor.com"
                      className="w-full rounded-2xl border border-white/5 bg-[#070b13] px-5 py-4 text-sm font-bold text-white outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500/50 focus:bg-[#090f1d] transition-all"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-500">Nível de Permissão</span>
                    <select
                      value={memberRole}
                      onChange={(e) => setMemberRole(e.target.value as any)}
                      className="w-full rounded-2xl border border-white/5 bg-[#070b13] px-5 py-4 text-sm font-bold text-white outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500/50 focus:bg-[#090f1d] transition-all cursor-pointer"
                    >
                      <option value="corretor_membro" className="bg-[#070b13]">Corretor (Acesso Padrão)</option>
                      <option value="corretor_admin" className="bg-[#070b13]">Corretor Admin (Acesso Completo)</option>
                    </select>
                  </label>

                  <button
                    disabled={saving || !nome.trim() || !email.trim()}
                    className="w-full flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-600 to-cyan-500 py-4 text-sm font-black text-white transition-all hover:scale-[1.02] shadow-lg shadow-emerald-500/20 disabled:opacity-40 cursor-pointer"
                  >
                    {saving ? <Loader2 className="animate-spin" size={18} /> : <Plus size={18} />}
                    Criar Acesso e Ativar Painel
                  </button>

                  <button
                    type="button"
                    onClick={() => setSkipOnboarding(true)}
                    className="w-full mt-2 flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 py-4 text-xs font-black text-slate-300 transition-all hover:bg-white/10 cursor-pointer"
                  >
                    Pular e ir para o painel
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {error && (
        <div className="rounded-2xl border border-red-500/10 bg-red-500/5 p-4 text-sm font-black text-red-400">
          {error}
        </div>
      )}

      {credentials && (
        <div className="rounded-3xl border border-emerald-500/15 bg-emerald-500/5 p-5 shadow-lg shadow-emerald-500/5 animate-in fade-in duration-300">
          <div className="mb-4 flex items-center gap-3 text-emerald-400">
            <CheckCircle2 size={22} className="animate-pulse" />
            <div>
              <p className="font-black text-white">Membro criado com senha provisória</p>
              <p className="text-xs font-bold text-slate-400">Envie esses dados para o primeiro acesso.</p>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
            <div className="rounded-2xl bg-white/5 border border-white/5 p-3.5 text-sm font-bold text-slate-300">{credentials.email}</div>
            <div className="rounded-2xl bg-white/5 border border-white/5 p-3.5 text-sm font-black text-cyan-400">{credentials.senha_provisoria}</div>
            <button onClick={copyAccess} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-black text-white transition-all hover:bg-emerald-700 shadow-md">
              <Copy size={16} /> Copiar Acesso
            </button>
          </div>
        </div>
      )}

      {/* Premium Team Header Row */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 p-6 rounded-[2.5rem] border border-white/5 bg-gradient-to-r from-[#090e1a] via-[#0b1426] to-[#090e1a] shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-32 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="flex items-center gap-4 relative">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 via-cyan-400 to-indigo-600 text-white shadow-xl shadow-blue-500/25 border border-white/10 relative group">
            <Crown size={28} className="animate-pulse" />
          </div>
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-cyan-400">Painel do Time Comercial</p>
            <h1 className="text-2xl md:text-3xl font-black text-white tracking-tight">{displayTeamName}</h1>
            <p className="text-xs font-bold text-slate-400 mt-1">Lidere sua força de vendas, gerencie a automação de atendimento e analise a performance comercial.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={fetchTeam}
            className="flex items-center justify-center gap-2 rounded-2xl border border-white/5 bg-white/5 px-5 py-3.5 text-xs font-black text-slate-300 hover:text-white transition-all hover:bg-white/10 cursor-pointer animate-in fade-in"
          >
            <RefreshCw size={15} /> Recarregar dados
          </button>
        </div>
      </div>

      {/* Explicativo das Regras & Funcionamento do Painel */}
      <div className="rounded-[2rem] border border-white/5 bg-[#090e1a]/90 backdrop-blur-md p-6 shadow-2xl relative overflow-hidden">
        <div className="absolute -top-12 -right-12 w-32 h-32 bg-cyan-500/5 rounded-full blur-2xl" />
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
            <BookOpen size={22} />
          </div>
          <div className="space-y-4">
            <div>
              <h3 className="text-base font-black text-white">Manual Comercial da Distribuição de Clientes</h3>
              <p className="text-xs font-bold text-slate-400 mt-1">Veja como as novas oportunidades de vendas são distribuídas na sua equipe:</p>
            </div>
            
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4 pt-2">
              <div className="bg-white/[0.02] border border-white/5 p-4 rounded-2xl">
                <div className="flex items-center gap-2 mb-2 text-cyan-400">
                  <Send size={15} />
                  <h4 className="text-xs font-black">Rodízio Ativo (Escala)</h4>
                </div>
                <p className="text-[11px] text-slate-400 font-medium leading-relaxed">
                  Os novos clientes que entrarem pelos anúncios ou site são distribuídos automaticamente de forma justa e sequencial entre todos os corretores ativos do time.
                </p>
              </div>

              <div className="bg-white/[0.02] border border-white/5 p-4 rounded-2xl">
                <div className="flex items-center gap-2 mb-2 text-amber-400">
                  <Users size={15} />
                  <h4 className="text-xs font-black">Rodízio Inativo (Geral)</h4>
                </div>
                <p className="text-[11px] text-slate-400 font-medium leading-relaxed">
                  Se desativado, as novas oportunidades chegam sem um responsável definido. **Elas ficam visíveis no CRM para toda a equipe ao mesmo tempo**, e quem fizer o primeiro contato assume o atendimento!
                </p>
              </div>

              <div className="bg-white/[0.02] border border-white/5 p-4 rounded-2xl">
                <div className="flex items-center gap-2 mb-2 text-emerald-400">
                  <Crown size={15} />
                  <h4 className="text-xs font-black">Pódio & Rankings</h4>
                </div>
                <p className="text-[11px] text-slate-400 font-medium leading-relaxed">
                  O pódio de vendas é atualizado em tempo real! Ele celebra a performance de cada corretor baseado nos fechamentos de contrato marcados no CRM.
                </p>
              </div>

              <div className="bg-white/[0.02] border border-white/5 p-4 rounded-2xl">
                <div className="flex items-center gap-2 mb-2 text-indigo-400">
                  <HelpCircle size={15} />
                  <h4 className="text-xs font-black">Direcionamento Manual</h4>
                </div>
                <p className="text-[11px] text-slate-400 font-medium leading-relaxed">
                  Como líder, você tem total controle! Pode direcionar ou transferir qualquer cliente da sua própria carteira diretamente para um corretor específico a qualquer momento.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Stats Section */}
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Leads do time', value: teamSummary.total, detail: `${teamSummary.assigned} atribuídos`, icon: Users, tone: 'blue' },
          { label: 'Sem resposta', value: teamSummary.semResposta, detail: 'precisam de atenção', icon: Target, tone: 'amber' },
          { label: 'Vendas', value: teamSummary.sales, detail: `${teamSummary.conversion}% conversão`, icon: TrendingUp, tone: 'emerald' },
          { label: 'Comissão', value: currency(teamSummary.comissao), detail: `${currency(teamSummary.receita)} em vendas`, icon: BarChart3, tone: 'slate' },
        ].map((card) => {
          const Icon = card.icon;
          const tone = {
            blue: 'border-blue-500/10 bg-blue-500/5 text-blue-400 hover:border-blue-500/20 shadow-[0_0_20px_rgba(59,130,246,0.05)]',
            amber: 'border-amber-500/10 bg-amber-500/5 text-amber-400 hover:border-amber-500/20 shadow-[0_0_20px_rgba(245,158,11,0.05)]',
            emerald: 'border-emerald-500/10 bg-emerald-500/5 text-emerald-400 hover:border-emerald-500/20 shadow-[0_0_20px_rgba(16,185,129,0.05)]',
            slate: 'border-white/5 bg-[#090e1a]/85 text-slate-300 hover:border-white/10 shadow-2xl',
          }[card.tone];
          return (
            <div key={card.label} className={`rounded-3xl border p-6 transition-all duration-300 ${tone}`}>
              <div className="mb-4 flex items-center justify-between">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{card.label}</p>
                <Icon size={20} />
              </div>
              <p className="text-3xl font-black text-white">{card.value}</p>
              <p className="mt-2 text-xs font-black uppercase tracking-widest opacity-70 text-slate-400">{card.detail}</p>
            </div>
          );
        })}
      </section>

      {/* Row with Distribution Performance and Ranking */}
      <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        {/* Left Column: Distribution por integrante */}
        <div className="rounded-3xl border border-white/5 bg-[#090e1a]/85 backdrop-blur-md p-6 sm:p-7 shadow-2xl">
          <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-cyan-400">Desempenho Comercial</p>
              <h2 className="mt-1 text-xl font-black text-white">Distribuição por Integrante</h2>
            </div>
            <span className="rounded-full bg-white/5 border border-white/5 px-4 py-2 text-xs font-black text-slate-300">
              {teamSummary.unassigned} sem responsável
            </span>
          </div>
          <div className="space-y-4">
            {memberStats.length === 0 ? (
              <p className="rounded-2xl bg-white/5 border border-dashed border-white/5 p-8 text-center text-sm font-bold text-slate-400">
                Crie integrantes para ver a distribuição automática.
              </p>
            ) : memberStats.map((member) => {
              const width = teamSummary.total ? Math.max(8, Math.round((member.totalLeads / teamSummary.total) * 100)) : 0;
              return (
                <div key={member.id} className="rounded-2xl border border-white/5 bg-[#070b13] p-5 hover:border-cyan-500/20 transition-colors group">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black text-white group-hover:text-cyan-400 transition-colors">{member.nome}</p>
                      <p className="text-xs font-bold text-slate-400 mt-1">
                        {member.totalLeads} leads | {member.vendas} vendas | {currency(member.comissao)} comissão
                      </p>
                    </div>
                    <span className="text-lg font-black text-cyan-400">{width}%</span>
                  </div>
                  <div className="h-3 overflow-hidden rounded-full bg-[#090f1d] border border-white/5">
                    <div className="h-full rounded-full bg-gradient-to-r from-blue-600 via-cyan-400 to-emerald-400 transition-all duration-700" style={{ width: `${width}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column: Vendas do Time Ranking */}
        <div className="rounded-3xl border border-white/5 bg-[#090e1a]/85 backdrop-blur-md p-6 sm:p-7 shadow-2xl text-white">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-400/10 text-amber-400 border border-amber-400/20 shadow-md">
              <Crown size={20} className="animate-pulse" />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-amber-400">Classificação</p>
              <h2 className="text-xl font-black">Vendas do Time</h2>
            </div>
          </div>
          <div className="space-y-3">
            {ranking.length === 0 ? (
              <p className="rounded-2xl bg-white/5 border border-dashed border-white/5 p-8 text-center text-sm font-bold text-slate-400">
                O ranking aparecerá quando houver integrantes.
              </p>
            ) : ranking.map((member, index) => (
              <div key={member.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-2xl bg-[#070b13] border border-white/5 p-4 hover:border-amber-400/20 transition-colors">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/5 border border-white/5 text-xs font-black text-slate-400">#{index + 1}</span>
                <div className="min-w-0">
                  <p className="truncate font-black text-white">{member.nome}</p>
                  <p className="text-[10px] font-semibold text-slate-400 mt-1">{member.totalLeads} leads recebidos</p>
                </div>
                <div className="text-right">
                  <p className="text-xl font-black text-emerald-400">{member.vendas}</p>
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 leading-none mt-1">vendas</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Row with Configurations, Create and Assign Leads Form */}
      <div className="grid gap-6 xl:grid-cols-[1fr_1.2fr]">
        {/* Left Form: Configs, Create and Assign */}
        <div className="rounded-3xl border border-white/5 bg-[#090e1a]/85 backdrop-blur-md p-6 sm:p-7 shadow-2xl hover:border-blue-500/20 hover:shadow-blue-500/5 transition-all duration-300 flex flex-col justify-between">
          <div>
            <div className="mb-6 flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-500/10 text-cyan-400 border border-cyan-500/20 shadow-md">
                <Users size={22} />
              </div>
              <div>
                <h2 className="text-xl font-black text-white">Configurações e Equipe</h2>
                <p className="text-xs font-bold text-slate-400">Configure a escala de atendimento da corretora.</p>
              </div>
            </div>

            {/* Nome da corretora */}
            <div className="mb-4">
              <div className="rounded-2xl border border-white/5 bg-[#070b13] px-5 py-4">
                <span className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-500">Corretora do time</span>
                <p className="text-sm font-black text-white">{displayTeamName}</p>
                <p className="mt-1 text-[10px] font-bold text-slate-500">Alteracoes de nome devem ser feitas no cadastro do corretor pelo admin.</p>
              </div>
            </div>

            {/* Configurações do Time Expandable Section */}
            <div className="mb-6">
              <button
                type="button"
                onClick={() => setSettingsOpen((current) => !current)}
                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-white/5 bg-white/5 px-5 py-3.5 text-xs font-black text-slate-300 transition-all hover:bg-white/10 hover:text-white cursor-pointer"
              >
                <Settings size={16} className={settingsOpen ? 'rotate-90 transition-transform' : 'transition-transform'} />
                {settingsOpen ? 'Fechar Configurações do Time' : 'Configurações de Distribuição'}
              </button>

              {settingsOpen && (
                <div className="mt-4 rounded-2xl border border-blue-500/15 bg-blue-500/5 p-5 animate-in fade-in slide-in-from-top-2 duration-300 space-y-5">
                  
                  {/* Distribution Toggle Option 1: Owner Participation */}
                  <div className="flex items-start gap-4">
                    <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#070b13] text-cyan-400 border border-white/5">
                      <ShieldCheck size={19} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-black text-white text-sm">Participar da Distribuição</p>
                      <p className="mt-1 text-[11px] font-bold leading-relaxed text-slate-400">
                        Ative se você também quiser entrar na escala de rodízio de clientes e disputar vendas com o seu time.
                      </p>
                      {settings.owner_profile && (
                        <p className="mt-2 text-[9px] font-black uppercase tracking-widest text-cyan-400">
                          Perfil: {settings.owner_profile.nome}
                        </p>
                      )}
                    </div>
                    <label className="relative inline-flex cursor-pointer items-center shrink-0">
                      <input
                        type="checkbox"
                        className="peer sr-only"
                        checked={settings.owner_in_distribution}
                        disabled={settingsSaving}
                        onChange={(event) => toggleOwnerDistribution(event.target.checked)}
                      />
                      <span className="h-6 w-11 rounded-full bg-white/10 transition peer-checked:bg-cyan-500 peer-disabled:opacity-50" />
                      <span className="absolute left-0.5 h-5 w-5 rounded-full bg-white shadow transition peer-checked:translate-x-5" />
                    </label>
                  </div>

                  <div className="h-px bg-white/5" />

                  {/* Distribution Toggle Option 2: RANDOMIZAÇÃO ATIVA (NEW USER REQUEST) */}
                  <div className="flex items-start gap-4">
                    <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#070b13] text-cyan-400 border border-white/5">
                      <Send size={18} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-black text-white text-sm">Distribuição Automática (Rodízio)</p>
                      <p className="mt-1 text-[11px] font-bold leading-relaxed text-slate-400">
                        Ativado: novos clientes são divididos automaticamente de forma igualitária (um para cada um). Desativado: novos clientes chegam liberados para todos, e quem fizer o primeiro contato no CRM assume o atendimento.
                      </p>
                    </div>
                    <label className="relative inline-flex cursor-pointer items-center shrink-0">
                      <input
                        type="checkbox"
                        className="peer sr-only"
                        checked={team?.ativo ?? true}
                        disabled={settingsSaving || !team}
                        onChange={(event) => toggleTeamDistribution(event.target.checked)}
                      />
                      <span className="h-6 w-11 rounded-full bg-white/10 transition peer-checked:bg-cyan-500 peer-disabled:opacity-50" />
                      <span className="absolute left-0.5 h-5 w-5 rounded-full bg-white shadow transition peer-checked:translate-x-5" />
                    </label>
                  </div>

                  <div className="h-px bg-white/5" />

                  {/* Danger Zone: Delete Team */}
                  <div className="flex flex-col gap-3 p-4.5 rounded-2xl border border-red-500/10 bg-red-500/5">
                    <div>
                      <p className="font-black text-red-400 text-sm">Zona de Perigo</p>
                      <p className="mt-1 text-[11px] font-bold leading-relaxed text-slate-400">
                        Excluir este time comercial apagará permanentemente todos os acessos dos integrantes e removerá a fila de rodízio. Todos os leads ativos retornarão para a carteira geral sem responsável.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={deleteTeam}
                      disabled={saving}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 hover:bg-red-700 px-4 py-2.5 text-xs font-black text-white transition-all cursor-pointer shadow-md self-start"
                    >
                      <Trash2 size={14} /> Excluir Time Comercial
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Adicionar Membro Form */}
          <form onSubmit={createMember} className="mt-6 border-t border-white/5 pt-6 space-y-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-cyan-400">Novos Acessos</p>
            <h3 className="text-base font-black text-white">Criar Integrante da Equipe</h3>
            
            <label className="block">
              <span className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-500">Nome do Integrante</span>
              <input
                required
                value={nome}
                onChange={(event) => setNome(event.target.value)}
                placeholder="Nome da pessoa"
                className="w-full rounded-2xl border border-white/5 bg-[#070b13] px-5 py-4 text-sm font-bold text-white outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500/50 focus:bg-[#090f1d] transition-all"
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-500">Email Real</span>
              <input
                required
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="pessoa@email.com"
                className="w-full rounded-2xl border border-white/5 bg-[#070b13] px-5 py-4 text-sm font-bold text-white outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500/50 focus:bg-[#090f1d] transition-all"
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-500">Nível de Permissão</span>
              <select
                value={memberRole}
                onChange={(e) => setMemberRole(e.target.value as any)}
                className="w-full rounded-2xl border border-white/5 bg-[#070b13] px-5 py-4 text-sm font-bold text-white outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500/50 focus:bg-[#090f1d] transition-all cursor-pointer"
              >
                <option value="corretor_membro" className="bg-[#090e1a]">Corretor (Acesso Padrão)</option>
                <option value="corretor_admin" className="bg-[#090e1a]">Corretor Admin (Acesso Completo)</option>
              </select>
            </label>
            <button
              disabled={saving}
              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-4 text-sm font-black text-white transition-all hover:bg-emerald-700 disabled:opacity-50 cursor-pointer shadow-lg shadow-emerald-600/15"
            >
              {saving ? <Loader2 className="animate-spin" size={16} /> : <Plus size={16} />}
              Criar Acesso e Fila
            </button>
          </form>

          {/* Atribuir Manualmente Form */}
          {canAssignLeads && (
            <form onSubmit={assignLead} className="mt-8 border-t border-white/5 pt-6 space-y-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-cyan-400">Atribuição Manual</p>
                <h3 className="text-base font-black text-white">Transferir Lead</h3>
                <p className="text-xs font-bold text-slate-400 mt-1">Mande um lead específico da sua carteira para algum integrante.</p>
              </div>
              {assignMessage && (
                <div className="rounded-2xl border border-emerald-500/15 bg-emerald-500/5 p-3 text-xs font-black text-emerald-400">
                  {assignMessage}
                </div>
              )}
              <label className="block">
                <span className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-500">Lead</span>
                <select
                  required
                  value={selectedLeadId}
                  onChange={(event) => setSelectedLeadId(event.target.value)}
                  className="w-full rounded-2xl border border-white/5 bg-[#070b13] px-5 py-4 text-sm font-bold text-white outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500/50 focus:bg-[#090f1d] transition-all"
                >
                  <option value="" className="bg-[#090e1a]">Selecione o lead</option>
                  {leads.map((lead) => {
                    const currentMember = membros.find((member) => member.id === lead.responsavel_membro_id);
                    return (
                      <option key={lead.id} value={lead.id} className="bg-[#090e1a]">
                        {lead.nome} {lead.telefone ? `- ${lead.telefone}` : ''} {currentMember ? `(atendente: ${currentMember.nome})` : ''}
                      </option>
                    );
                  })}
                </select>
              </label>
              <label className="block">
                <span className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-500">Integrante</span>
                <select
                  required
                  value={selectedMemberId}
                  onChange={(event) => setSelectedMemberId(event.target.value)}
                  className="w-full rounded-2xl border border-white/5 bg-[#070b13] px-5 py-4 text-sm font-bold text-white outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500/50 focus:bg-[#090f1d] transition-all"
                >
                  <option value="" className="bg-[#090e1a]">Selecione o responsável</option>
                  {membros.map((member) => <option key={member.id} value={member.id} className="bg-[#090e1a]">{member.nome}</option>)}
                </select>
              </label>
              <button
                disabled={assigning || membros.length === 0 || leads.length === 0}
                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#070b13] border border-white/5 px-5 py-4 text-sm font-black text-slate-300 hover:text-white transition-all hover:bg-white/5 disabled:opacity-50 cursor-pointer"
              >
                {assigning ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}
                Confirmar Transferência
              </button>
            </form>
          )}
        </div>

        {/* Right List: Integrantes cadastrados */}
        <div className="overflow-hidden rounded-3xl border border-white/5 bg-[#090e1a]/85 backdrop-blur-md shadow-2xl hover:border-blue-500/20 transition-all duration-300">
          <div className="border-b border-white/5 p-6">
            <p className="text-[10px] font-black uppercase tracking-widest text-cyan-400">{team?.nome || 'Time comercial'}</p>
            <h2 className="mt-1 text-xl font-black text-white">Corretores Cadastrados</h2>
            <p className="mt-2 text-xs font-bold text-slate-400">
              Acompanhe de perto as vendas da sua equipe, celebre o progresso dos corretores e gerencie a força comercial do seu time.
            </p>
          </div>

          {membros.length === 0 ? (
            <div className="p-24 text-center text-sm font-bold text-slate-500 border border-dashed border-white/5 m-6 rounded-2xl">
              Nenhum integrante criado ainda na carteira.
            </div>
          ) : (
            <div className="grid gap-4 p-6">
              {memberStats.map((member, index) => (
                <div key={member.id} className="rounded-2xl border border-white/5 bg-[#070b13] p-5 transition-all duration-300 hover:-translate-y-1 hover:border-cyan-500/20 hover:bg-white/[0.01]">
                  <div className="flex flex-col gap-4">
                    {/* Top Row: User details (left) & Action button (right) */}
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-center gap-4 min-w-0">
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 text-sm font-black text-white shadow-md shadow-blue-500/10">
                          {member.nome.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="font-black text-white leading-tight">{member.nome}</p>
                          <p className="break-all text-xs font-semibold text-slate-400 mt-1">{member.email}</p>
                          <p className="mt-2 text-[9px] font-black uppercase tracking-widest text-cyan-400">
                            Posição: #{index + 1} {member.ultimo_lead_at ? `| último atendimento em ${new Date(member.ultimo_lead_at).toLocaleDateString('pt-BR')}` : ''}
                          </p>
                          <div className="flex flex-wrap gap-2 mt-2">
                            {member.profile_id === settings.owner_profile?.id && (
                              <span className="inline-flex rounded-full bg-blue-500/15 border border-blue-500/20 px-2.5 py-1 text-[8px] font-black uppercase tracking-widest text-cyan-400 leading-none">
                                Dono do time
                              </span>
                            )}
                            {member.tipo_usuario === 'corretor_admin' && (
                              <span className="inline-flex rounded-full bg-emerald-500/15 border border-emerald-500/20 px-2.5 py-1 text-[8px] font-black uppercase tracking-widest text-emerald-400 leading-none">
                                Admin do Time
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => removeMember(member)}
                        disabled={member.profile_id === settings.owner_profile?.id}
                        className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-red-500/10 bg-red-500/5 px-3 py-2.5 text-xs font-black text-red-400 transition-all hover:bg-red-500/10 hover:text-red-300 disabled:opacity-30 cursor-pointer shrink-0 self-start"
                        title={member.profile_id === settings.owner_profile?.id ? 'Desative em Configurações do time.' : 'Remover integrante'}
                      >
                        <Trash2 size={13} /> <span className="hidden sm:inline">Remover</span>
                      </button>
                    </div>

                    {/* Bottom Row: 4 metrics side-by-side, fully responsive */}
                    <div className="grid grid-cols-4 gap-2 sm:gap-3 mt-1 border-t border-white/5 pt-4">
                      <div className="bg-[#090f1d] border border-white/5 px-2 py-2 rounded-xl text-center">
                        <p className="text-[9px] font-bold text-blue-400 uppercase tracking-wider">Leads</p>
                        <p className="text-sm font-black text-white mt-0.5">{member.totalLeads}</p>
                      </div>
                      <div className="bg-[#090f1d] border border-white/5 px-2 py-2 rounded-xl text-center">
                        <p className="text-[9px] font-bold text-amber-400 uppercase tracking-wider">S/ Resp.</p>
                        <p className="text-sm font-black text-white mt-0.5">{member.semResposta}</p>
                      </div>
                      <div className="bg-[#090f1d] border border-white/5 px-2 py-2 rounded-xl text-center">
                        <p className="text-[9px] font-bold text-emerald-400 uppercase tracking-wider">Vendas</p>
                        <p className="text-sm font-black text-white mt-0.5">{member.vendas}</p>
                      </div>
                      <div className="bg-[#090f1d] border border-white/5 px-2 py-2 rounded-xl text-center">
                        <p className="text-[9px] font-bold text-purple-400 uppercase tracking-wider">Comissão</p>
                        <p className="text-xs font-black text-white mt-0.5 whitespace-nowrap overflow-hidden text-ellipsis">{currency(member.comissao)}</p>
                      </div>
                    </div>
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
