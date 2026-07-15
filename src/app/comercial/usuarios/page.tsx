'use client';

import { useEffect, useState } from 'react';
import { Plus, RefreshCw, ShieldCheck, UserRound, UsersRound } from 'lucide-react';
import { useCommercial } from '@/components/commercial/CommercialShell';
import { commercialRoleLabel, type CommercialRole } from '@/lib/comercial';

type Candidate = { id: string; nome: string; email: string | null };

export default function CommercialUsersPage() {
  const { api, members, role, refreshAccess } = useCommercial();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [profileId, setProfileId] = useState('');
  const [newRole, setNewRole] = useState<CommercialRole>('sdr');
  const [saving, setSaving] = useState(false);
  async function loadCandidates() { const payload = await api('/api/comercial/members'); setCandidates(payload.candidates || []); }
  useEffect(() => { if (role === 'coordenador') void loadCandidates(); }, [role]);
  async function add() { if (!profileId) return; setSaving(true); try { await api('/api/comercial/members', { method: 'POST', body: JSON.stringify({ profile_id: profileId, papel: newRole }) }); setProfileId(''); await refreshAccess(); await loadCandidates(); } finally { setSaving(false); } }
  async function update(profile_id: string, papel: string, ativo: boolean) { await api('/api/comercial/members', { method: 'PATCH', body: JSON.stringify({ profile_id, papel, ativo }) }); await refreshAccess(); }
  if (role !== 'coordenador') return <div className="kh-inline-error">Apenas o coordenador comercial pode gerenciar usuários.</div>;
  return (
    <div>
      <header className="kh-page-head"><div><div className="kh-eyebrow">Administração</div><h1>Usuários</h1><p>Defina quem coordena, qualifica e fecha as oportunidades comerciais.</p></div><button className="kh-icon-button" onClick={() => void refreshAccess()} aria-label="Atualizar"><RefreshCw size={17} /></button></header>
      <section className="kh-user-add kh-panel"><div><UsersRound size={20} /><div><strong>Adicionar à operação</strong><span>O perfil precisa existir no Orion Track.</span></div></div><select className="kh-select" value={profileId} onChange={(event) => setProfileId(event.target.value)}><option value="">Selecione um usuário...</option>{candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.nome} — {candidate.email}</option>)}</select><select className="kh-select" value={newRole} onChange={(event) => setNewRole(event.target.value as CommercialRole)}><option value="sdr">SDR</option><option value="closer">Closer</option><option value="coordenador">Coordenador comercial</option></select><button className="kh-button primary" disabled={!profileId || saving} onClick={() => void add()}><Plus size={16} /> Vincular</button></section>
      <section className="kh-user-list">{members.map((member) => <article key={member.profile_id} className={!member.ativo ? 'inactive' : ''}><div className="kh-user-avatar">{member.foto_url ? <img src={member.foto_url} alt="" /> : <UserRound size={20} />}</div><div><strong>{member.nome}</strong><span>{member.email}</span></div><div className="kh-user-role"><ShieldCheck size={14} /><select value={member.papel} onChange={(event) => void update(member.profile_id, event.target.value, member.ativo)}><option value="coordenador">Coordenador comercial</option><option value="closer">Closer</option><option value="sdr">SDR</option></select></div><span className={`kh-badge ${member.ativo ? 'green' : 'red'}`}>{member.ativo ? 'Ativo' : 'Inativo'}</span><button className="kh-button" onClick={() => void update(member.profile_id, member.papel, !member.ativo)}>{member.ativo ? 'Desativar' : 'Ativar'}</button></article>)}</section>
    </div>
  );
}

