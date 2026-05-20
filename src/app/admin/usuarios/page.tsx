'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import { supabase } from '@/lib/supabase/client';
import { Corretor, Profile, TipoCampanha, UserRole } from '@/types';
import { generateOrionEmail, getRoleLabel } from '@/lib/users';
import { OPERADORAS_ONBOARDING } from '@/lib/onboarding';
import { buildOperationalTeamMembers, getTeamMemberAvatar, isTrafficManagerMember, OrionTeamMember } from '@/lib/orionTeam';
import { useAuth } from '@/components/providers/AuthProvider';
import { Camera, CheckCircle2, Copy, KeyRound, Loader2, Mail, Plus, RefreshCw, Search, Shield, Trash2, UserPlus, Users } from 'lucide-react';
import { useRouter } from 'next/navigation';

type Credentials = {
  email: string;
  email_real: string | null;
  senha_provisoria: string;
  link_login: string;
};

type AdminProfile = Profile & {
  is_admin_master?: boolean;
};

const initialForm = {
  nome: '',
  email_real: '',
  tipo_usuario: 'corretor' as UserRole,
  telefone: '',
  tipo_campanha: 'ambos' as TipoCampanha,
  operadoras: [] as string[],
  time_operacional: [] as OrionTeamMember[],
  foto_url: '',
};

const MASTER_ADMIN_EMAIL = 'ewerttonherculano@gmail.com';

export default function AdminUsuariosPage() {
  const { user, startViewingAsCorretor, startViewingAsGestor, startViewingAsDesigner, startViewingAsAccount } = useAuth();
  const router = useRouter();
  const [profiles, setProfiles] = useState<AdminProfile[]>([]);
  const [corretores, setCorretores] = useState<Corretor[]>([]);
  const [form, setForm] = useState(initialForm);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [isMasterAdmin, setIsMasterAdmin] = useState(false);

  const accessEmail = useMemo(() => generateOrionEmail(form.nome), [form.nome]);
  const teamMembers = useMemo(() => buildOperationalTeamMembers(profiles), [profiles]);

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token;
  }

  async function fetchUsers() {
    setLoading(true);
    setError(null);

    const token = await getToken();
    if (!token) {
      setError('Sessão expirada. Entre novamente.');
      setLoading(false);
      return;
    }

    const response = await fetch('/api/admin/usuarios', {
      headers: { Authorization: `Bearer ${token}` }
    });
    const payload = await response.json();

    if (!response.ok) {
      setError(payload.error || 'Erro ao buscar usuários.');
      setLoading(false);
      return;
    }

    setProfiles(payload.profiles || []);
    setCorretores(payload.corretores || []);
    setIsMasterAdmin(Boolean(payload.isMasterAdmin));
    setLoading(false);
  }

  useEffect(() => {
    const requestedRole = new URLSearchParams(window.location.search).get('tipo') as UserRole | null;
    if (requestedRole && ['admin', 'corretor', 'gestor_trafego', 'designer', 'account_manager'].includes(requestedRole)) {
      setForm((current) => ({
        ...current,
        tipo_usuario: requestedRole,
        time_operacional: requestedRole === 'corretor' ? current.time_operacional : [],
        operadoras: requestedRole === 'corretor' ? current.operadoras : []
      }));
    }
    void fetchUsers();
  }, []);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setCredentials(null);

    const token = await getToken();
    if (!token) {
      setError('Sessão expirada. Entre novamente.');
      setSaving(false);
      return;
    }

    const gestorTrafegoId = form.time_operacional.find(isTrafficManagerMember)?.profile_id || null;

    const response = await fetch('/api/admin/usuarios', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ ...form, email: accessEmail, gestor_trafego_id: gestorTrafegoId })
    });
    const payload = await response.json();

    if (!response.ok) {
      setError(payload.error || 'Erro ao criar usuário.');
      setSaving(false);
      return;
    }

    setCredentials(payload.credentials);
    setForm({ ...initialForm, tipo_usuario: form.tipo_usuario });
    await fetchUsers();
    setSaving(false);
  }

  function handlePhotoChange(file?: File | null) {
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError('Envie uma imagem valida para a foto.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setForm((current) => ({ ...current, foto_url: String(reader.result || '') }));
    };
    reader.readAsDataURL(file);
  }

  async function handleDelete(profile: Profile) {
    if (!window.confirm(`Remover ${profile.nome}? Se for corretor, os leads dele também serão removidos.`)) return;

    setRemovingId(profile.id);
    setError(null);

    const token = await getToken();
    if (!token) {
      setError('Sessão expirada. Entre novamente.');
      setRemovingId(null);
      return;
    }

    const response = await fetch(`/api/admin/usuarios?id=${profile.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
    const payload = await response.json();

    if (!response.ok) {
      setError(payload.error || 'Erro ao remover usuário.');
      setRemovingId(null);
      return;
    }

    await fetchUsers();
    setRemovingId(null);
  }

  async function handleResetPassword(profile: Profile) {
    if (!window.confirm(`Gerar uma nova senha provisÃ³ria para ${profile.nome}?`)) return;

    setRemovingId(profile.id);
    setError(null);
    setCredentials(null);

    const token = await getToken();
    if (!token) {
      setError('SessÃ£o expirada. Entre novamente.');
      setRemovingId(null);
      return;
    }

    const response = await fetch('/api/admin/usuarios', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ id: profile.id, action: 'reset_password' })
    });
    const payload = await response.json();

    if (!response.ok) {
      setError(payload.error || 'Erro ao redefinir senha.');
      setRemovingId(null);
      return;
    }

    setCredentials(payload.credentials);
    await fetchUsers();
    setRemovingId(null);
  }

  const filteredProfiles = profiles.filter((profile) => {
    const target = `${profile.nome} ${profile.email} ${profile.email_real || ''} ${profile.tipo_usuario}`.toLowerCase();
    return target.includes(search.toLowerCase());
  });

  function copyCredentials() {
    if (!credentials) return;
    navigator.clipboard.writeText(
      `ORION TRACK\nLogin: ${credentials.email}\nSenha provisória: ${credentials.senha_provisoria}\nAcesse: ${credentials.link_login}`
    );
  }

  async function copyUserId(value: string) {
    await navigator.clipboard.writeText(value);
    alert('ID copiado para usar no n8n.');
  }

  function getUserIntegrationId(profile: Profile, corretor?: Corretor) {
    return profile.tipo_usuario === 'corretor'
      ? profile.corretor_id || corretor?.id || profile.id
      : profile.id;
  }

  async function openUserPanel(profile: Profile) {
    if (profile.tipo_usuario === 'corretor') {
      if (profile.corretor_id) await startViewingAsCorretor(profile.corretor_id);
      return;
    }

    if (profile.tipo_usuario === 'gestor_trafego') {
      await startViewingAsGestor(profile.id);
      return;
    }

    if (profile.tipo_usuario === 'designer') {
      await startViewingAsDesigner(profile.id);
      return;
    }

    if (profile.tipo_usuario === 'account_manager') {
      await startViewingAsAccount(profile.id);
      return;
    }

    router.push('/admin');
  }

  return (
    <InternalLayout>
      <div className="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-blue-600">Admin mestre</p>
          <h1 className="text-3xl font-black tracking-tight text-gray-900">Acessos</h1>
          <p className="font-medium text-gray-500">Cadastre admins, gestores e corretores em um só lugar.</p>
        </div>
        <button
          onClick={fetchUsers}
          className="flex items-center justify-center gap-2 rounded-2xl border border-gray-100 bg-white px-5 py-3 text-sm font-black text-slate-600 shadow-sm transition-all hover:bg-slate-50"
        >
          <RefreshCw size={16} /> Atualizar
        </button>
      </div>

      {error && <div className="mb-6 rounded-2xl border border-red-100 bg-red-50 p-4 text-sm font-bold text-red-600">{error}</div>}

      {credentials && (
        <div className="mb-8 rounded-[2rem] border-2 border-emerald-200 bg-emerald-50 p-6 shadow-lg shadow-emerald-100/60">
          <div className="mb-4 flex items-center gap-3 text-emerald-700">
            <CheckCircle2 size={24} />
            <div>
              <h2 className="text-lg font-black">Acesso criado com senha provisória</h2>
              <p className="text-xs font-bold text-emerald-700/80">Envie esses dados para o primeiro login. Depois a pessoa troca a senha.</p>
            </div>
          </div>
          <div className="grid gap-3 text-sm font-bold text-emerald-950 md:grid-cols-3">
            <div className="rounded-2xl bg-white/70 p-4">
              <p className="text-[10px] uppercase tracking-widest text-emerald-600">Login provisório</p>
              <p className="mt-1 break-all">{credentials.email}</p>
            </div>
            <div className="rounded-2xl border border-emerald-200 bg-white p-4 shadow-sm">
              <p className="text-[10px] uppercase tracking-widest text-emerald-600">Senha provisória</p>
              <p className="mt-1 flex items-center gap-2 text-xl font-black text-emerald-950">
                <KeyRound size={18} /> {credentials.senha_provisoria}
              </p>
            </div>
            <button
              onClick={copyCredentials}
              className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-4 font-black text-white transition-all hover:bg-emerald-700"
            >
              <Copy size={18} /> Copiar acesso
            </button>
          </div>
        </div>
      )}

      <div className="grid gap-8 xl:grid-cols-[420px_1fr]">
        <form onSubmit={handleCreate} className="rounded-[2.5rem] border border-gray-100 bg-white p-6 shadow-sm">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
              <UserPlus size={24} />
            </div>
            <div>
              <h2 className="text-xl font-black text-gray-900">Adicionar pessoa</h2>
              <p className="text-xs font-bold text-slate-400">O email Orion é gerado pelo nome.</p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="ml-1 text-[10px] font-black uppercase tracking-widest text-gray-400">Nome completo</label>
              <input
                required
                value={form.nome}
                onChange={(event) => setForm((current) => ({ ...current, nome: event.target.value }))}
                placeholder="Luiz Andrade"
                className="mt-2 w-full rounded-2xl border-none bg-slate-50 px-5 py-4 text-sm font-bold focus:ring-2 focus:ring-blue-500/20"
              />
            </div>

            <div>
              <label className="ml-1 text-[10px] font-black uppercase tracking-widest text-gray-400">Tipo de usuário</label>
              <select
                value={form.tipo_usuario}
                onChange={(event) => {
                  const tipo_usuario = event.target.value as UserRole;
                  setForm((current) => ({
                    ...current,
                    tipo_usuario,
                    time_operacional: tipo_usuario === 'corretor' ? current.time_operacional : [],
                    operadoras: tipo_usuario === 'corretor' ? current.operadoras : []
                  }));
                }}
                className="mt-2 w-full rounded-2xl border-none bg-slate-50 px-5 py-4 text-sm font-black focus:ring-2 focus:ring-blue-500/20"
              >
                <option value="corretor">Corretor</option>
                <option value="gestor_trafego">Gestor de tráfego</option>
                <option value="designer">Designer</option>
                <option value="account_manager">Account manager</option>
                {isMasterAdmin && <option value="admin">Admin / Diretor</option>}
              </select>
            </div>

            <div>
              <label className="ml-1 text-[10px] font-black uppercase tracking-widest text-gray-400">Email de acesso</label>
              <div className="mt-2 flex items-center gap-3 rounded-2xl bg-blue-50 px-5 py-4 text-sm font-black text-blue-700">
                <Mail size={16} /> {accessEmail}
              </div>
            </div>

            <div>
              <label className="ml-1 text-[10px] font-black uppercase tracking-widest text-gray-400">Email real opcional</label>
              <input
                type="email"
                value={form.email_real}
                onChange={(event) => setForm((current) => ({ ...current, email_real: event.target.value }))}
                placeholder="email pessoal/profissional real"
                className="mt-2 w-full rounded-2xl border-none bg-slate-50 px-5 py-4 text-sm font-bold focus:ring-2 focus:ring-blue-500/20"
              />
            </div>

            <div>
              <label className="ml-1 text-[10px] font-black uppercase tracking-widest text-gray-400">Foto</label>
              <label className="mt-2 flex cursor-pointer items-center gap-4 rounded-2xl bg-slate-50 px-5 py-4 text-sm font-bold text-slate-500 transition-all hover:bg-slate-100">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white text-blue-600 shadow-sm">
                  {form.foto_url ? (
                    <img src={form.foto_url} alt="Foto" className="h-full w-full object-cover" />
                  ) : (
                    <Camera size={18} />
                  )}
                </div>
                <div>
                  <p className="font-black text-slate-700">Inserir foto</p>
                  <p className="text-[10px] font-bold text-slate-400">Aparece no seletor do time e no perfil.</p>
                </div>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => handlePhotoChange(event.target.files?.[0])}
                />
              </label>
            </div>

            {form.tipo_usuario === 'corretor' && (
              <>
                <div>
                  <label className="ml-1 text-[10px] font-black uppercase tracking-widest text-gray-400">Time Orion</label>
                  <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {teamMembers.map((member) => {
                      const selected = form.time_operacional.some((item) => item.nome === member.nome);
                      const avatar = getTeamMemberAvatar(member);
                      return (
                        <button
                          key={member.profile_id || member.nome}
                          type="button"
                          onClick={() => setForm((current) => ({
                            ...current,
                            time_operacional: selected
                              ? current.time_operacional.filter((item) => item.nome !== member.nome)
                              : [
                                  ...current.time_operacional.filter((item) =>
                                    isTrafficManagerMember(member) ? !isTrafficManagerMember(item) : true
                                  ),
                                  member
                                ]
                          }))}
                          className={`rounded-2xl border px-4 py-3 text-left transition-all ${
                            selected ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-100 bg-slate-50 text-slate-600 hover:bg-slate-100'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <div className={`flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl ${selected ? 'bg-white/20 text-white' : 'bg-white text-blue-600'}`}>
                              {avatar ? <img src={avatar} alt={member.nome} className="h-full w-full object-cover" /> : member.nome[0]}
                            </div>
                            <div className="min-w-0">
                              <p className="truncate text-xs font-black">{member.nome}</p>
                              <p className={`mt-1 text-[10px] font-bold ${selected ? 'text-blue-100' : 'text-slate-400'}`}>{member.cargo}</p>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="ml-1 text-[10px] font-black uppercase tracking-widest text-gray-400">Operadoras da campanha</label>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {OPERADORAS_ONBOARDING.map((operadora) => {
                      const selected = form.operadoras.includes(operadora);
                      return (
                        <button
                          key={operadora}
                          type="button"
                          onClick={() => setForm((current) => ({
                            ...current,
                            operadoras: selected
                              ? current.operadoras.filter((item) => item !== operadora)
                              : [...current.operadoras, operadora]
                          }))}
                          className={`rounded-2xl border px-4 py-3 text-left text-xs font-black transition-all ${
                            selected ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-100 bg-slate-50 text-slate-500 hover:bg-slate-100'
                          }`}
                        >
                          {operadora}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="ml-1 text-[10px] font-black uppercase tracking-widest text-gray-400">Telefone</label>
                  <input
                    required
                    value={form.telefone}
                    onChange={(event) => setForm((current) => ({ ...current, telefone: event.target.value }))}
                    placeholder="(00) 00000-0000"
                    className="mt-2 w-full rounded-2xl border-none bg-slate-50 px-5 py-4 text-sm font-bold focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>

                <div>
                  <label className="ml-1 text-[10px] font-black uppercase tracking-widest text-gray-400">Tipo de campanha</label>
                  <select
                    value={form.tipo_campanha}
                    onChange={(event) => setForm((current) => ({ ...current, tipo_campanha: event.target.value as TipoCampanha }))}
                    className="mt-2 w-full rounded-2xl border-none bg-slate-50 px-5 py-4 text-sm font-black focus:ring-2 focus:ring-blue-500/20"
                  >
                    <option value="pme">PME</option>
                    <option value="adesao">Individual</option>
                    <option value="ambos">Ambos</option>
                  </select>
                </div>
              </>
            )}
          </div>

          <button
            type="submit"
            disabled={saving}
            className="mt-6 flex w-full items-center justify-center gap-3 rounded-2xl bg-blue-600 py-5 font-black text-white shadow-xl shadow-blue-600/20 transition-all hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? <Loader2 className="animate-spin" size={20} /> : <><Plus size={20} /> Criar acesso</>}
          </button>
        </form>

        <div className="rounded-[2.5rem] border border-gray-100 bg-white shadow-sm">
          <div className="border-b border-gray-50 p-6">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-50 text-slate-500">
                <Users size={24} />
              </div>
              <div>
                <h2 className="text-xl font-black text-gray-900">Pessoas cadastradas</h2>
                <p className="text-xs font-bold text-slate-400">{profiles.length} acessos ativos no sistema.</p>
              </div>
            </div>
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar por nome, email ou perfil..."
                className="w-full rounded-2xl border-none bg-slate-50 py-4 pl-12 pr-4 text-sm font-bold focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
          </div>

          {loading ? (
            <div className="flex justify-center py-24">
              <Loader2 className="animate-spin text-blue-600" size={40} />
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {filteredProfiles.map((profile) => {
                const corretor = corretores.find((item) => item.id === profile.corretor_id);
                const operadoras = corretor?.operadoras_info?.selecionadas;
                const isOwnAccess = profile.id === user?.id;
                const isMasterAccess = Boolean(profile.is_admin_master) || [profile.email, profile.email_real]
                  .filter(Boolean)
                  .map((email) => String(email).toLowerCase())
                  .includes(MASTER_ADMIN_EMAIL);

                return (
                  <div key={profile.id} className="flex flex-col gap-4 p-5 transition-colors hover:bg-blue-50/30 md:flex-row md:items-center md:justify-between">
                    <button
                      type="button"
                      onClick={() => void openUserPanel(profile)}
                      className="flex flex-1 items-center gap-4 text-left"
                      title={`Abrir painel de ${profile.nome}`}
                    >
                      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-sm font-black text-white">
                        {profile.tipo_usuario === 'admin' ? <Shield size={20} /> : profile.nome.slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-black text-gray-900">{profile.nome}</p>
                          <span className={`rounded-full px-3 py-1 text-[9px] font-black uppercase tracking-widest ${
                            isMasterAccess ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-500'
                          }`}>
                            {isMasterAccess ? 'Admin master' : getRoleLabel(profile.tipo_usuario)}
                          </span>
                          {profile.precisa_trocar_senha && (
                            <span className="rounded-full bg-amber-50 px-3 py-1 text-[9px] font-black uppercase tracking-widest text-amber-700">
                              primeiro acesso
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-xs font-bold text-slate-400">{profile.email}</p>
                        {profile.email_real && <p className="text-xs font-medium text-slate-400">Real: {profile.email_real}</p>}
                        {Array.isArray(operadoras) && operadoras.length > 0 && (
                          <p className="mt-1 text-[10px] font-black uppercase tracking-widest text-blue-500">
                            {operadoras.join(', ')}
                          </p>
                        )}
                        <p className="mt-2 max-w-[520px] truncate rounded-xl bg-slate-50 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                          ID para n8n: <span className="normal-case tracking-normal text-slate-700">{getUserIntegrationId(profile, corretor)}</span>
                        </p>
                      </div>
                    </button>

                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => copyUserId(getUserIntegrationId(profile, corretor))}
                        className="flex items-center justify-center gap-2 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs font-black text-blue-700 transition-all hover:bg-blue-100"
                      >
                        <Copy size={16} />
                        Copiar ID
                      </button>
                      {isOwnAccess || isMasterAccess ? (
                        <span className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs font-black uppercase tracking-widest text-blue-700">
                          Admin master
                        </span>
                      ) : (
                        <>
                        <button
                          onClick={() => handleResetPassword(profile)}
                          disabled={removingId === profile.id}
                          className="flex items-center justify-center gap-2 rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-xs font-black text-amber-700 transition-all hover:bg-amber-100 disabled:opacity-50"
                        >
                          {removingId === profile.id ? <Loader2 className="animate-spin" size={16} /> : <KeyRound size={16} />}
                          Nova senha
                        </button>
                        <button
                          onClick={() => handleDelete(profile)}
                          disabled={removingId === profile.id}
                          className="flex items-center justify-center gap-2 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-xs font-black text-red-600 transition-all hover:bg-red-100 disabled:opacity-50"
                        >
                          {removingId === profile.id ? <Loader2 className="animate-spin" size={16} /> : <Trash2 size={16} />}
                          Remover
                        </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </InternalLayout>
  );
}
