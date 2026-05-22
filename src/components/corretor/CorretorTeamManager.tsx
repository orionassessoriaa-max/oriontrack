'use client';

import { FormEvent, useEffect, useState } from 'react';
import { CheckCircle2, Copy, Loader2, Plus, Send, Save, Trash2, Users } from 'lucide-react';
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

type AssignableLead = {
  id: string;
  nome: string;
  telefone: string | null;
  status: string | null;
  responsavel_membro_id: string | null;
};

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
  const [error, setError] = useState<string | null>(null);
  const [assignMessage, setAssignMessage] = useState<string | null>(null);
  const canAssignLeads = profile?.tipo_usuario === 'corretor' && !corretorId;

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

      <div className="grid gap-6 xl:grid-cols-[1fr_1.2fr]">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
              <Users size={23} />
            </div>
            <div>
              <h2 className="text-xl font-black text-slate-950">Criar time</h2>
              <p className="text-sm font-bold text-slate-500">Distribuicao automatica de leads, um por vez.</p>
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
            Salvar time
          </button>

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

        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 p-6">
            <p className="text-[10px] font-black uppercase tracking-widest text-blue-600">{team?.nome || 'Time comercial'}</p>
            <h2 className="mt-1 text-xl font-black text-slate-950">Integrantes cadastrados</h2>
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
            <div className="divide-y divide-slate-100">
              {membros.map((member, index) => (
                <div key={member.id} className="grid gap-4 p-5 md:grid-cols-[1fr_auto] md:items-center">
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
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeMember(member)}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-xs font-black text-red-600 transition-all hover:bg-red-100"
                  >
                    <Trash2 size={15} /> Remover
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
