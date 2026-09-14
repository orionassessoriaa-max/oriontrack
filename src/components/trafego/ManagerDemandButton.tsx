'use client';

import { useState } from 'react';
import { Loader2, Send, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';

const categories = [
  ['funil_crm', 'Funil e CRM'], ['trafego', 'Tráfego'], ['integracao', 'Integração'],
  ['relatorio', 'Relatório'], ['acesso', 'Acesso'], ['outro', 'Outra demanda'],
];

export default function ManagerDemandButton() {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState('funil_crm');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('normal');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true); setMessage('');
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('Sessão expirada. Entre novamente.');
      const response = await fetch('/api/equipe/apollo/demandas', {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ categoria: category, titulo: title, descricao: description, prioridade }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Não foi possível enviar a demanda.');
      setTitle(''); setDescription(''); setPriority('normal'); setMessage('Demanda enviada para Ewertton.');
    } catch (error: unknown) { setMessage(error instanceof Error ? error.message : 'Não foi possível enviar a demanda.'); }
    finally { setSaving(false); }
  }

  return <>
    <button type="button" onClick={() => { setMessage(''); setOpen(true); }} className="inline-flex h-11 items-center gap-2 rounded-xl border border-cyan-500/50 bg-cyan-500/10 px-4 text-sm font-black text-cyan-200 transition hover:bg-cyan-500/20">
      <Send size={16} /> Enviar demanda
    </button>
    {open ? <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/75 p-4" role="dialog" aria-modal="true" aria-labelledby="manager-demand-title">
      <form onSubmit={submit} className="w-full max-w-xl rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-black uppercase tracking-[.2em] text-cyan-400">Time DevOps</p><h2 id="manager-demand-title" className="mt-1 text-xl font-black text-white">Nova demanda para Ewertton</h2><p className="mt-2 text-sm font-medium text-slate-400">Registre o pedido com contexto. Ele entrará no quadro de tarefas.</p></div><button type="button" onClick={() => setOpen(false)} aria-label="Fechar" className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white"><X size={18} /></button></div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2"><label className="block text-xs font-bold text-slate-300">Categoria<select value={category} onChange={(event) => setCategory(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm font-semibold text-white outline-none focus:border-cyan-500">{categories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="block text-xs font-bold text-slate-300">Prioridade<select value={priority} onChange={(event) => setPriority(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm font-semibold text-white outline-none focus:border-cyan-500"><option value="baixa">Baixa</option><option value="normal">Normal</option><option value="alta">Alta</option><option value="urgente">Urgente</option></select></label></div>
        <label className="mt-4 block text-xs font-bold text-slate-300">Título<input required minLength={2} maxLength={180} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ex.: Ajustar etapa do funil da corretora" className="mt-2 h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm font-semibold text-white outline-none focus:border-cyan-500" /></label>
        <label className="mt-4 block text-xs font-bold text-slate-300">Detalhes<textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={4000} placeholder="Explique o que está acontecendo, a corretora envolvida e o resultado esperado." className="mt-2 min-h-32 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-sm font-medium text-white outline-none focus:border-cyan-500" /></label>
        {message ? <p className={`mt-4 text-sm font-bold ${message.startsWith('Demanda enviada') ? 'text-emerald-400' : 'text-rose-300'}`}>{message}</p> : null}
        <button disabled={saving || title.trim().length < 2} className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-cyan-500 text-sm font-black text-slate-950 disabled:opacity-50">{saving ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}{saving ? 'Enviando...' : 'Enviar para Ewertton'}</button>
      </form>
    </div> : null}
  </>;
}
