'use client';

import { useState } from 'react';
import { Copy, Eye, Plus, RefreshCw, ShieldCheck, UserRound, UsersRound } from 'lucide-react';
import { useCommercial } from '@/components/commercial/CommercialShell';
import { type CommercialRole } from '@/lib/comercial';

type Credentials = { nome: string; email: string; senhaProvisoria: string; papel: string };

export default function CommercialUsersPage() {
  const { api, members, role, refreshAccess, canViewCommercialAsUser, startViewingCommercialMember } = useCommercial();
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [telefone, setTelefone] = useState('');
  const [newRole, setNewRole] = useState<CommercialRole>('sdr');
  const [saving, setSaving] = useState(false);
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  async function add() {
    if (!nome.trim()) return;
    setSaving(true);
    setFormError(null);
    try {
      const payload = await api('/api/comercial/members', {
        method: 'POST',
        body: JSON.stringify({ action: 'create', nome, email, telefone, papel: newRole }),
      });
      setCredentials(payload.credentials);
      setNome(''); setEmail(''); setTelefone(''); setNewRole('sdr');
      await refreshAccess();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Não foi possível criar o integrante.');
    } finally { setSaving(false); }
  }

  async function update(profile_id: string, papel: string, ativo: boolean) {
    await api('/api/comercial/members', { method: 'PATCH', body: JSON.stringify({ profile_id, papel, ativo }) });
    await refreshAccess();
  }

  if (role !== 'coordenador') return <div className="kh-inline-error">Apenas administradores e o DevOps podem gerenciar usuários.</div>;

  return (
    <div>
      <header className="kh-page-head">
        <div><div className="kh-eyebrow">Administração</div><h1>Usuários</h1><p>Crie os acessos de quem qualifica, acompanha e fecha as oportunidades.</p></div>
        <button className="kh-icon-button" onClick={() => void refreshAccess()} aria-label="Atualizar"><RefreshCw size={17} /></button>
      </header>

      <section className="kh-user-add kh-panel">
        <div><UsersRound size={20} /><div><strong>Criar usuário comercial</strong><span>O acesso será criado no Orion Track e no Kripto Hunters.</span></div></div>
        <input className="kh-input" value={nome} onChange={(event) => setNome(event.target.value)} placeholder="Nome completo" aria-label="Nome completo" />
        <input className="kh-input" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="E-mail (opcional)" type="email" aria-label="E-mail" />
        <input className="kh-input" value={telefone} onChange={(event) => setTelefone(event.target.value)} placeholder="Telefone (opcional)" type="tel" aria-label="Telefone" />
        <select className="kh-select" value={newRole} onChange={(event) => setNewRole(event.target.value as CommercialRole)} aria-label="Função comercial"><option value="sdr">SDR</option><option value="closer">Closer</option><option value="coordenador">Coordenador comercial</option></select>
        <button className="kh-button primary" disabled={!nome.trim() || saving} onClick={() => void add()}><Plus size={16} /> Criar usuário</button>
        {formError && <div className="kh-inline-error" role="alert">{formError}</div>}
      </section>

      {credentials && <section className="kh-credentials kh-panel"><div><strong>Acesso criado</strong><span>Envie estes dados ao integrante. A senha deverá ser trocada no primeiro acesso.</span></div><div><span>Login</span><strong>{credentials.email}</strong></div><div><span>Senha provisória</span><strong>{credentials.senhaProvisoria}</strong></div><button className="kh-button" type="button" onClick={() => void navigator.clipboard?.writeText(`Login: ${credentials.email}\nSenha: ${credentials.senhaProvisoria}`)}><Copy size={15} /> Copiar acesso</button></section>}

      <section className="kh-user-list">{members.map((member) => <article key={member.profile_id} className={!member.ativo ? 'inactive' : ''}><button type="button" className="kh-user-avatar" onClick={() => canViewCommercialAsUser && startViewingCommercialMember(member.profile_id)} disabled={!canViewCommercialAsUser} title={canViewCommercialAsUser ? 'Visualizar como este integrante' : undefined}>{member.foto_url ? <img src={member.foto_url} alt="" /> : <UserRound size={20} />}</button><button type="button" className="kh-user-identity" onClick={() => canViewCommercialAsUser && startViewingCommercialMember(member.profile_id)} disabled={!canViewCommercialAsUser} title={canViewCommercialAsUser ? 'Visualizar como este integrante' : undefined}><strong>{member.nome}</strong><span>{member.email}</span></button><div className="kh-user-role"><ShieldCheck size={14} /><select value={member.papel} onChange={(event) => void update(member.profile_id, event.target.value, member.ativo)}><option value="coordenador">Coordenador comercial</option><option value="closer">Closer</option><option value="sdr">SDR</option></select></div><span className={`kh-badge ${member.ativo ? 'green' : 'red'}`}>{member.ativo ? 'Ativo' : 'Inativo'}</span><div className="kh-user-actions">{canViewCommercialAsUser && <button className="kh-button" onClick={() => startViewingCommercialMember(member.profile_id)}><Eye size={15} /> Visualizar</button>}<button className="kh-button" onClick={() => void update(member.profile_id, member.papel, !member.ativo)}>{member.ativo ? 'Desativar' : 'Ativar'}</button></div></article>)}</section>
    </div>
  );
}
