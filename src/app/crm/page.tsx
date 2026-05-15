'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import { useAuth } from '@/components/providers/AuthProvider';
import { supabase } from '@/lib/supabase/client';
import { Lead, LeadAtividade, LeadTarefa } from '@/types';
import { getLeadStatusStyle, LEAD_STATUSES } from '@/lib/leadStatus';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Inbox,
  Loader2,
  MessageSquare,
  Phone,
  Plus,
  RefreshCw,
  Search,
  Send,
  Target
} from 'lucide-react';

type WhatsAppConversa = {
  id: string;
  lead_id: string | null;
  corretor_id: string | null;
  telefone: string;
  nome_contato: string | null;
  status: string;
  ultima_mensagem_at: string | null;
};

function isStale(lead: Lead) {
  if (lead.status !== 'Aguardando atendimento' || !lead.data_entrada) return false;
  return Date.now() - new Date(lead.data_entrada).getTime() > 20 * 60 * 1000;
}

export default function CrmPage() {
  const { profile } = useAuth();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [tarefas, setTarefas] = useState<LeadTarefa[]>([]);
  const [atividades, setAtividades] = useState<LeadAtividade[]>([]);
  const [conversas, setConversas] = useState<WhatsAppConversa[]>([]);
  const [selectedLeadId, setSelectedLeadId] = useState<string>('');
  const [search, setSearch] = useState('');
  const [note, setNote] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDue, setTaskDue] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedLead = leads.find((lead) => lead.id === selectedLeadId) || leads[0] || null;

  async function fetchCrm() {
    if (!profile?.id) return;

    setLoading(true);
    setError(null);
    try {
      const [leadsRes, tarefasRes, conversasRes] = await Promise.all([
        supabase.from('leads').select('*').order('data_entrada', { ascending: false }).limit(80),
        supabase.from('lead_tarefas').select('*').order('vencimento', { ascending: true }).limit(80),
        supabase.from('whatsapp_conversas').select('*').order('ultima_mensagem_at', { ascending: false }).limit(50)
      ]);

      if (leadsRes.error) throw leadsRes.error;
      if (tarefasRes.error) throw tarefasRes.error;
      if (conversasRes.error) throw conversasRes.error;

      setLeads((leadsRes.data || []) as Lead[]);
      setTarefas((tarefasRes.data || []) as LeadTarefa[]);
      setConversas((conversasRes.data || []) as WhatsAppConversa[]);
      setSelectedLeadId((current) => current || leadsRes.data?.[0]?.id || '');
    } catch (err: any) {
      setError(err.message || 'Erro ao carregar CRM.');
    } finally {
      setLoading(false);
    }
  }

  async function fetchTimeline(leadId: string) {
    if (!leadId) return;
    const { data } = await supabase
      .from('lead_atividades')
      .select('*')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false })
      .limit(40);
    setAtividades((data || []) as LeadAtividade[]);
  }

  useEffect(() => {
    void fetchCrm();
  }, [profile?.id]);

  useEffect(() => {
    if (selectedLead?.id) void fetchTimeline(selectedLead.id);
  }, [selectedLead?.id]);

  const filteredLeads = useMemo(() => {
    const term = search.toLowerCase();
    return leads.filter((lead) =>
      `${lead.nome} ${lead.telefone} ${lead.cidade} ${lead.status}`.toLowerCase().includes(term)
    );
  }, [leads, search]);

  const staleCount = leads.filter(isStale).length;
  const openTasks = tarefas.filter((task) => task.status === 'pendente').length;
  const todayTasks = tarefas.filter((task) => task.status === 'pendente' && task.vencimento && new Date(task.vencimento).toDateString() === new Date().toDateString()).length;

  async function addNote(event: FormEvent) {
    event.preventDefault();
    if (!selectedLead || !note.trim()) return;
    setSaving(true);
    const { error: insertError } = await supabase.from('lead_atividades').insert([{
      lead_id: selectedLead.id,
      profile_id: profile?.id,
      tipo: 'nota',
      titulo: 'Nota registrada',
      descricao: note.trim()
    }]);
    setSaving(false);
    if (insertError) {
      alert(insertError.message);
      return;
    }
    setNote('');
    await fetchTimeline(selectedLead.id);
  }

  async function addTask(event: FormEvent) {
    event.preventDefault();
    if (!selectedLead || !taskTitle.trim()) return;
    setSaving(true);
    const { error: insertError } = await supabase.from('lead_tarefas').insert([{
      lead_id: selectedLead.id,
      corretor_id: selectedLead.corretor_id,
      responsavel_profile_id: profile?.id,
      titulo: taskTitle.trim(),
      vencimento: taskDue ? new Date(taskDue).toISOString() : null,
      prioridade: isStale(selectedLead) ? 'alta' : 'normal'
    }]);
    setSaving(false);
    if (insertError) {
      alert(insertError.message);
      return;
    }
    setTaskTitle('');
    setTaskDue('');
    await fetchCrm();
  }

  async function completeTask(taskId: string) {
    await supabase.from('lead_tarefas').update({ status: 'concluida', updated_at: new Date().toISOString() }).eq('id', taskId);
    await fetchCrm();
  }

  return (
    <InternalLayout>
      <div className="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-blue-600">CRM Orion</p>
          <h1 className="text-3xl font-black tracking-tight text-gray-900">Central Comercial</h1>
          <p className="font-medium text-gray-500">Timeline, tarefas, follow-up e inbox preparados para WhatsApp em tempo real.</p>
        </div>
        <button onClick={fetchCrm} className="flex items-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-black text-slate-600 shadow-sm">
          <RefreshCw size={16} /> Atualizar
        </button>
      </div>

      <div className="mb-8 grid gap-4 md:grid-cols-4">
        <div className="rounded-[2rem] border border-gray-100 bg-white p-5 shadow-sm">
          <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-gray-400">Leads no CRM</p>
          <p className="text-3xl font-black text-gray-900">{leads.length}</p>
        </div>
        <div className="rounded-[2rem] border border-amber-100 bg-amber-50 p-5">
          <p className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-amber-700"><AlertTriangle size={14} /> Sem resposta</p>
          <p className="text-3xl font-black text-amber-950">{staleCount}</p>
        </div>
        <div className="rounded-[2rem] border border-blue-100 bg-blue-50 p-5">
          <p className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-blue-700"><Clock size={14} /> Tarefas abertas</p>
          <p className="text-3xl font-black text-blue-950">{openTasks}</p>
        </div>
        <div className="rounded-[2rem] border border-emerald-100 bg-emerald-50 p-5">
          <p className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-emerald-700"><Target size={14} /> Para hoje</p>
          <p className="text-3xl font-black text-emerald-950">{todayTasks}</p>
        </div>
      </div>

      {error && <div className="mb-6 rounded-2xl border border-red-100 bg-red-50 p-4 text-sm font-bold text-red-600">{error}</div>}

      <div className="grid gap-6 xl:grid-cols-[340px_1fr_360px]">
        <div className="rounded-[2rem] border border-gray-100 bg-white shadow-sm">
          <div className="border-b border-gray-50 p-4">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar lead..." className="w-full rounded-2xl border-none bg-slate-50 py-3 pl-11 pr-4 text-sm font-bold focus:ring-2 focus:ring-blue-500/20" />
            </div>
          </div>
          <div className="max-h-[720px] overflow-y-auto p-3">
            {loading ? (
              <div className="flex justify-center py-20"><Loader2 className="animate-spin text-blue-600" /></div>
            ) : filteredLeads.map((lead) => {
              const active = selectedLead?.id === lead.id;
              const statusStyle = getLeadStatusStyle(lead.status);
              return (
                <button key={lead.id} onClick={() => setSelectedLeadId(lead.id)} className={`mb-2 block w-full rounded-2xl border p-4 text-left transition-all ${active ? 'border-blue-200 bg-blue-50' : 'border-gray-100 hover:bg-slate-50'}`}>
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <p className="font-black text-gray-900">{lead.nome}</p>
                    {isStale(lead) && <AlertTriangle size={16} className="text-amber-500" />}
                  </div>
                  <p className="mb-3 flex items-center gap-2 text-xs font-bold text-slate-500"><Phone size={13} /> {lead.telefone}</p>
                  <span className={`rounded-full border px-2 py-1 text-[9px] font-black uppercase tracking-widest ${statusStyle.chip}`}>{statusStyle.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-[2rem] border border-gray-100 bg-white p-6 shadow-sm">
          {selectedLead ? (
            <>
              <div className="mb-6 flex items-start justify-between gap-4">
                <div>
                  <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-blue-600">Ficha do lead</p>
                  <h2 className="text-2xl font-black text-gray-900">{selectedLead.nome}</h2>
                  <p className="mt-1 text-sm font-bold text-slate-500">{selectedLead.telefone} • {selectedLead.cidade || 'Cidade nao informada'}</p>
                </div>
                <a href={`https://wa.me/55${selectedLead.telefone.replace(/\D/g, '')}`} target="_blank" className="rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-black text-white">
                  WhatsApp
                </a>
              </div>

              <div className="mb-6 grid gap-3 md:grid-cols-3">
                <InfoCard label="CNPJ" value={selectedLead.possui_cnpj || '-'} />
                <InfoCard label="Vidas" value={selectedLead.idades || '-'} />
                <InfoCard label="Investimento" value={selectedLead.investimento || '-'} />
              </div>

              <form onSubmit={addNote} className="mb-6 rounded-[1.5rem] border border-gray-100 bg-slate-50 p-4">
                <label className="mb-2 block text-[10px] font-black uppercase tracking-widest text-gray-400">Registrar nota</label>
                <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Ex: chamou no WhatsApp, pediu retorno, enviou documentacao..." className="w-full resize-none rounded-2xl border-none bg-white p-4 text-sm font-bold focus:ring-2 focus:ring-blue-500/20" />
                <button disabled={saving} className="mt-3 flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-black text-white"><Send size={16} /> Salvar nota</button>
              </form>

              <div>
                <h3 className="mb-4 text-sm font-black uppercase tracking-widest text-gray-900">Timeline</h3>
                <div className="space-y-3">
                  {atividades.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-gray-200 p-8 text-center text-sm font-bold text-slate-400">Nenhuma atividade registrada ainda.</div>
                  ) : atividades.map((activity) => (
                    <div key={activity.id} className="rounded-2xl border border-gray-100 p-4">
                      <div className="mb-1 flex items-center justify-between gap-3">
                        <p className="font-black text-gray-900">{activity.titulo}</p>
                        <span className="text-[10px] font-bold text-slate-400">{format(new Date(activity.created_at), 'dd/MM HH:mm', { locale: ptBR })}</span>
                      </div>
                      {activity.descricao && <p className="text-sm font-medium text-slate-500">{activity.descricao}</p>}
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="flex min-h-[400px] items-center justify-center text-sm font-bold text-slate-400">Selecione um lead para abrir a ficha.</div>
          )}
        </div>

        <div className="space-y-6">
          <div className="rounded-[2rem] border border-gray-100 bg-white p-5 shadow-sm">
            <h3 className="mb-4 flex items-center gap-2 text-sm font-black uppercase tracking-widest text-gray-900"><Plus size={16} /> Nova tarefa</h3>
            <form onSubmit={addTask} className="space-y-3">
              <input value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} placeholder="Ex: retornar lead" className="w-full rounded-2xl border-none bg-slate-50 px-4 py-3 text-sm font-bold focus:ring-2 focus:ring-blue-500/20" />
              <input type="datetime-local" value={taskDue} onChange={(e) => setTaskDue(e.target.value)} className="w-full rounded-2xl border-none bg-slate-50 px-4 py-3 text-sm font-bold focus:ring-2 focus:ring-blue-500/20" />
              <button disabled={!selectedLead || saving} className="w-full rounded-2xl bg-blue-600 py-3 text-sm font-black text-white disabled:opacity-50">Criar tarefa</button>
            </form>
          </div>

          <div className="rounded-[2rem] border border-gray-100 bg-white p-5 shadow-sm">
            <h3 className="mb-4 flex items-center gap-2 text-sm font-black uppercase tracking-widest text-gray-900"><Clock size={16} /> Follow-ups</h3>
            <div className="space-y-2">
              {tarefas.filter((task) => task.status === 'pendente').slice(0, 8).map((task) => (
                <div key={task.id} className="rounded-2xl border border-gray-100 p-3">
                  <p className="text-sm font-black text-gray-900">{task.titulo}</p>
                  <p className="mt-1 text-[11px] font-bold text-slate-400">{task.vencimento ? format(new Date(task.vencimento), 'dd/MM HH:mm', { locale: ptBR }) : 'Sem prazo'}</p>
                  <button onClick={() => completeTask(task.id)} className="mt-2 inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-emerald-600"><CheckCircle2 size={13} /> concluir</button>
                </div>
              ))}
              {openTasks === 0 && <p className="rounded-2xl border border-dashed border-gray-200 p-5 text-center text-sm font-bold text-slate-400">Sem tarefas abertas.</p>}
            </div>
          </div>

          <div className="rounded-[2rem] border border-emerald-100 bg-emerald-50 p-5">
            <h3 className="mb-4 flex items-center gap-2 text-sm font-black uppercase tracking-widest text-emerald-950"><MessageSquare size={16} /> Inbox WhatsApp</h3>
            <p className="mb-4 text-sm font-bold leading-relaxed text-emerald-800">Base pronta para mensagens em tempo real via provedor oficial/API. Hoje o botao abre WhatsApp externo.</p>
            <div className="space-y-2">
              {conversas.slice(0, 4).map((conversation) => (
                <div key={conversation.id} className="rounded-2xl bg-white p-3 text-sm font-bold text-emerald-950">
                  {conversation.nome_contato || conversation.telefone}
                </div>
              ))}
              {conversas.length === 0 && <p className="rounded-2xl bg-white/70 p-4 text-center text-sm font-bold text-emerald-700">Nenhuma conversa conectada ainda.</p>}
            </div>
          </div>
        </div>
      </div>
    </InternalLayout>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-slate-50 p-4">
      <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-gray-400">{label}</p>
      <p className="text-sm font-black text-gray-900">{value}</p>
    </div>
  );
}
