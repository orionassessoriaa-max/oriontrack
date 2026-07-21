'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, Check, Clipboard, Clock3, MessageSquareText, Power, RefreshCw, Save, Settings, Smartphone, Sparkles } from 'lucide-react';
import { useCommercial } from '@/components/commercial/CommercialShell';
import type { CommercialLead } from '@/lib/comercial';
import { DEFAULT_COMMERCIAL_SDR_PROMPT } from '@/lib/commercialSdrPrompt';

export default function CommercialAiPage() {
  const { api, role, members } = useCommercial();
  const [leads, setLeads] = useState<CommercialLead[]>([]);
  const [selected, setSelected] = useState<CommercialLead | null>(null);
  const [message, setMessage] = useState('');
  const [prompt, setPrompt] = useState(DEFAULT_COMMERCIAL_SDR_PROMPT);
  const [active, setActive] = useState(true);
  const [instanceProfileId, setInstanceProfileId] = useState('');
  const [loading, setLoading] = useState(true);
  const [configLoading, setConfigLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState('');

  const loadLeads = useCallback(async () => { setLoading(true); try { const payload = await api('/api/comercial/leads'); setLeads(payload.leads || []); } finally { setLoading(false); } }, [api]);
  const loadConfig = useCallback(async () => { setConfigLoading(true); try { const payload = await api('/api/comercial/ia-config'); setActive(payload.active !== false); setPrompt(payload.prompt || DEFAULT_COMMERCIAL_SDR_PROMPT); setInstanceProfileId(payload.instanceProfileId || ''); } finally { setConfigLoading(false); } }, [api]);
  useEffect(() => { void loadLeads(); void loadConfig(); }, [loadConfig, loadLeads]);
  const queue = useMemo(() => leads.filter((lead) => !['Negocio fechado', 'Perdido', 'Desqualificado', 'Fora do MQL'].includes(lead.status)).sort((a, b) => new Date(a.ultimo_contato_at || a.updated_at).getTime() - new Date(b.ultimo_contato_at || b.updated_at).getTime()), [leads]);
  async function generate(lead: CommercialLead) { setSelected(lead); setGenerating(true); setMessage(''); try { const payload = await api('/api/comercial/ai', { method: 'POST', body: JSON.stringify({ lead_id: lead.id }) }); setMessage(payload.message || ''); } finally { setGenerating(false); } }
  async function saveConfig() { setSaving(true); setNotice(''); try { await api('/api/comercial/ia-config', { method: 'PATCH', body: JSON.stringify({ active, prompt, instanceProfileId }) }); setNotice('Configuração da IA SDR salva.'); } catch (error) { setNotice(error instanceof Error ? error.message : 'Nao foi possivel salvar.'); } finally { setSaving(false); } }
  async function markContact() { if (!selected) return; await api('/api/comercial/leads', { method: 'PATCH', body: JSON.stringify({ id: selected.id, ultimo_contato_at: new Date().toISOString() }) }); await loadLeads(); }

  return <div>
    <header className="kh-page-head"><div><div className="kh-eyebrow">Automação comercial</div><h1>IA SDR</h1><p>Aline qualifica os leads e prepara o próximo contato para o time comercial.</p></div><button className="kh-icon-button" onClick={() => { void loadLeads(); void loadConfig(); }} aria-label="Atualizar"><RefreshCw size={17} className={loading || configLoading ? 'kh-spin' : ''} /></button></header>
    <section className="kh-panel kh-sdr-config">
      <div className="kh-panel-header"><div><span>Configuração da operação</span><h2>IA SDR ativa</h2></div><span className={`kh-badge ${active ? 'green' : 'red'}`}><Power size={12} /> {active ? 'Ativa' : 'Inativa'}</span></div>
      <div className="kh-sdr-config-body"><div className="kh-sdr-status"><div className="kh-ai-mark"><Bot size={23} /></div><div><strong>IA SDR da Orion</strong><p>Use o prompt abaixo para ajustar o comportamento da Aline. As alterações valem para esta operação.</p></div><button type="button" className={`kh-toggle ${active ? 'active' : ''}`} onClick={() => setActive((value) => !value)} aria-pressed={active}><span /></button></div><label className="kh-sdr-prompt"><span><Smartphone size={14} /> Instância WhatsApp da IA</span><select className="kh-select" value={instanceProfileId} onChange={(event) => setInstanceProfileId(event.target.value)} disabled={role !== 'coordenador'}><option value="">Selecione o perfil que enviará as mensagens</option>{members.filter((member) => member.ativo).map((member) => <option key={member.profile_id} value={member.profile_id}>{member.nome} ({member.papel})</option>)}</select><small>A IA usará a instância WhatsApp desse perfil. A conexão é feita no Inbox.</small></label><label className="kh-sdr-prompt"><span><Settings size={14} /> Prompt da IA SDR</span><textarea className="kh-textarea" value={prompt} onChange={(event) => setPrompt(event.target.value)} disabled={role !== 'coordenador'} /><small>{role === 'coordenador' ? 'Somente o coordenador pode alterar o prompt.' : 'Apenas o coordenador pode alterar o prompt.'}</small></label><footer className="kh-sdr-config-footer">{notice && <span>{notice}</span>}{role === 'coordenador' && <button className="kh-button primary" onClick={() => void saveConfig()} disabled={saving}><Save size={15} /> {saving ? 'Salvando...' : 'Salvar configuração'}</button>}</footer></div>
    </section>
    <section className="kh-ai-layout kh-sdr-followup"><article className="kh-panel kh-ai-queue"><div className="kh-panel-header"><div><span>Fila recomendada</span><h2>Próximos contatos</h2></div><span>{queue.length} leads</span></div><div>{queue.map((lead) => { const last = new Date(lead.ultimo_contato_at || lead.updated_at); const hours = Math.max(0, Math.floor((Date.now() - last.getTime()) / 3600000)); return <button key={lead.id} className={selected?.id === lead.id ? 'active' : ''} onClick={() => void generate(lead)}><div className="kh-avatar">{lead.nome.split(' ').slice(0, 2).map((part) => part[0]).join('')}</div><div><strong>{lead.nome}</strong><span>{lead.status}</span></div><div><Clock3 size={13} /><span>{hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`} sem contato</span></div></button>; })}{!queue.length && <div className="kh-ai-empty"><Check size={22} /><span>A fila está em dia.</span></div>}</div></article><article className="kh-panel kh-ai-composer"><div className="kh-ai-intro"><div className="kh-ai-mark"><Bot size={24} /></div><div><span>IA SDR</span><h2>{selected ? selected.nome : 'Selecione um lead'}</h2><p>{selected ? 'A mensagem foi gerada usando o prompt configurado acima.' : 'Escolha um lead para gerar uma abordagem personalizada.'}</p></div></div><div className={`kh-ai-message ${generating ? 'loading' : ''}`}>{generating ? <><Sparkles className="kh-spin" size={20} /><span>Preparando abordagem...</span></> : message ? <p>{message}</p> : <><MessageSquareText size={26} /><span>A mensagem aparecerá aqui.</span></>}</div><footer><button className="kh-button" disabled={!message} onClick={async () => { await navigator.clipboard.writeText(message); setCopied(true); setTimeout(() => setCopied(false), 1800); }}>{copied ? <Check size={16} /> : <Clipboard size={16} />}{copied ? 'Copiada' : 'Copiar mensagem'}</button><button className="kh-button primary" disabled={!selected || !message} onClick={() => void markContact()}><Check size={16} /> Marcar contato realizado</button></footer></article></section>
  </div>;
}
