'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import { useAuth } from '@/components/providers/AuthProvider';
import { supabase } from '@/lib/supabase/client';
import { Lead, LeadAtividade, LeadStatus, LeadTarefa, TipoCampanha } from '@/types';
import { getLeadStatusStyle, normalizeLeadStatus } from '@/lib/leadStatus';
import { getLeadQualification } from '@/lib/leadQualification';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  MessageSquare,
  Phone,
  Plus,
  RefreshCw,
  Search,
  Send,
  Save,
  Sparkles,
  Target,
  X
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

const columns: { id: LeadStatus; label: string; desc: string }[] = [
  { id: 'Aguardando atendimento', label: 'Oportunidade', desc: 'Entrou e precisa de primeiro contato' },
  { id: 'Contato feito', label: 'Contato feito', desc: 'Primeira abordagem realizada' },
  { id: 'Cotação enviada', label: 'Cotacao enviada', desc: 'Proposta enviada ao lead' },
  { id: 'Em negociação', label: 'Negociacao', desc: 'Acompanhamento comercial ativo' },
  { id: 'Não tive retorno', label: 'Sem retorno', desc: 'Precisa de nova tentativa' },
  { id: 'Venda realizada', label: 'Venda', desc: 'Conversao concluida' },
  { id: 'Sem interesse', label: 'Sem interesse', desc: 'Descartado comercialmente' },
];

function isStale(lead: Lead) {
  if (normalizeLeadStatus(lead.status) !== 'Aguardando atendimento' || !lead.data_entrada) return false;
  return Date.now() - new Date(lead.data_entrada).getTime() > 20 * 60 * 1000;
}

function cleanPhone(phone?: string | null) {
  return String(phone || '').replace(/\D/g, '');
}

function qualificationClass(tone: 'good' | 'warning' | 'neutral') {
  if (tone === 'good') return 'border-emerald-100 bg-emerald-50 text-emerald-700';
  if (tone === 'warning') return 'border-amber-100 bg-amber-50 text-amber-700';
  return 'border-slate-200 bg-slate-50 text-slate-600';
}

export default function CrmPage() {
  const { profile } = useAuth();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [tarefas, setTarefas] = useState<LeadTarefa[]>([]);
  const [atividades, setAtividades] = useState<LeadAtividade[]>([]);
  const [conversas, setConversas] = useState<WhatsAppConversa[]>([]);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [tipoCampanha, setTipoCampanha] = useState<TipoCampanha | null>('ambos');
  const [search, setSearch] = useState('');
  const [note, setNote] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDue, setTaskDue] = useState('');
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    nome: '',
    telefone: '',
    idades: '',
    possui_cnpj: 'Não informado',
    tem_plano_ativo: 'Não informado',
    plano_atual: '',
    custo_plano_atual: '',
    investimento: '',
    cidade: '',
    operadora: '',
    observacoes: '',
    status: 'Aguardando atendimento' as LeadStatus,
  });
  const [draggedLeadId, setDraggedLeadId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchCrm() {
    if (!profile?.id) return;

    setLoading(true);
    setError(null);

    try {
      const [leadsRes, tarefasRes, conversasRes] = await Promise.all([
        supabase.from('leads').select('*').order('data_entrada', { ascending: false }).limit(200),
        supabase.from('lead_tarefas').select('*').order('vencimento', { ascending: true }).limit(100),
        supabase.from('whatsapp_conversas').select('*').order('ultima_mensagem_at', { ascending: false }).limit(50)
      ]);

      if (leadsRes.error) throw leadsRes.error;
      if (tarefasRes.error) throw tarefasRes.error;
      if (conversasRes.error) throw conversasRes.error;

      const normalizedLeads = (leadsRes.data || []).map((lead) => ({
        ...lead,
        status: normalizeLeadStatus(lead.status)
      })) as Lead[];

      setLeads(normalizedLeads);
      setTarefas((tarefasRes.data || []) as LeadTarefa[]);
      setConversas((conversasRes.data || []) as WhatsAppConversa[]);
      setSelectedLead((current) => {
        if (!current) return null;
        return normalizedLeads.find((lead) => lead.id === current.id) || null;
      });

      if (profile.tipo_usuario === 'corretor' && profile.corretor_id) {
        const { data: corretor } = await supabase
          .from('corretores')
          .select('tipo_campanha')
          .eq('id', profile.corretor_id)
          .maybeSingle();

        setTipoCampanha((corretor?.tipo_campanha as TipoCampanha | null) || 'ambos');
      }
    } catch (err: any) {
      setError(err.message || 'Erro ao carregar CRM.');
    } finally {
      setLoading(false);
    }
  }

  async function fetchTimeline(leadId: string) {
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
    if (selectedLead?.id) {
      void fetchTimeline(selectedLead.id);
      setEditForm({
        nome: selectedLead.nome || '',
        telefone: selectedLead.telefone || '',
        idades: selectedLead.idades || '',
        possui_cnpj: selectedLead.possui_cnpj || 'Não informado',
        tem_plano_ativo: selectedLead.tem_plano_ativo || 'Não informado',
        plano_atual: selectedLead.plano_atual || '',
        custo_plano_atual: selectedLead.custo_plano_atual || '',
        investimento: selectedLead.investimento || '',
        cidade: selectedLead.cidade || '',
        operadora: selectedLead.operadora || '',
        observacoes: selectedLead.observacoes || '',
        status: normalizeLeadStatus(selectedLead.status),
      });
      setEditing(false);
    } else {
      setAtividades([]);
    }
  }, [selectedLead?.id]);

  const filteredLeads = useMemo(() => {
    const term = search.toLowerCase();
    return leads.filter((lead) =>
      `${lead.nome} ${lead.telefone} ${lead.cidade} ${lead.status} ${lead.operadora || ''}`.toLowerCase().includes(term)
    );
  }, [leads, search]);

  const staleCount = leads.filter(isStale).length;
  const openTasks = tarefas.filter((task) => task.status === 'pendente').length;
  const todayTasks = tarefas.filter((task) => task.status === 'pendente' && task.vencimento && new Date(task.vencimento).toDateString() === new Date().toDateString()).length;
  const fitStats = leads.reduce(
    (acc, lead) => {
      const qualification = getLeadQualification(lead, tipoCampanha);
      if (qualification.tone === 'good') acc.good += 1;
      if (qualification.tone === 'warning') acc.warning += 1;
      return acc;
    },
    { good: 0, warning: 0 }
  );

  function getLeadsByStatus(status: LeadStatus) {
    return filteredLeads.filter((lead) => normalizeLeadStatus(lead.status) === status);
  }

  async function updateLeadStatus(leadId: string, status: LeadStatus) {
    const previousLeads = leads;
    setLeads((prev) => prev.map((lead) => lead.id === leadId ? { ...lead, status } : lead));
    setSelectedLead((current) => current?.id === leadId ? { ...current, status } : current);

    const { error: updateError } = await supabase
      .from('leads')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', leadId);

    if (updateError) {
      setLeads(previousLeads);
      alert('Erro ao mover lead: ' + updateError.message);
      return;
    }

    await supabase.from('lead_atividades').insert([{
      lead_id: leadId,
      profile_id: profile?.id,
      tipo: 'status',
      titulo: 'Status atualizado',
      descricao: `Lead movido para ${getLeadStatusStyle(status).label}`
    }]);

    if (selectedLead?.id === leadId) await fetchTimeline(leadId);
  }

  function handleDrop(status: LeadStatus) {
    if (!draggedLeadId) return;
    const lead = leads.find((item) => item.id === draggedLeadId);
    setDraggedLeadId(null);
    if (!lead || normalizeLeadStatus(lead.status) === status) return;
    void updateLeadStatus(lead.id, status);
  }

  async function addNote(event: FormEvent) {
    event.preventDefault();
    if (!selectedLead || !note.trim()) return;

    setSaving(true);
    const { error: insertError } = await supabase.from('lead_atividades').insert([{
      lead_id: selectedLead.id,
      profile_id: profile?.id,
      tipo: 'nota',
      titulo: 'Observacao registrada',
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

  async function saveLeadDetails(event: FormEvent) {
    event.preventDefault();
    if (!selectedLead) return;

    setSaving(true);
    const { error: updateError } = await supabase
      .from('leads')
      .update({
        nome: editForm.nome,
        telefone: editForm.telefone,
        idades: editForm.idades,
        possui_cnpj: editForm.possui_cnpj,
        tem_plano_ativo: editForm.tem_plano_ativo,
        plano_atual: editForm.plano_atual || null,
        custo_plano_atual: editForm.custo_plano_atual || null,
        investimento: editForm.investimento,
        cidade: editForm.cidade,
        operadora: editForm.operadora || null,
        observacoes: editForm.observacoes || null,
        status: editForm.status,
        updated_at: new Date().toISOString(),
      })
      .eq('id', selectedLead.id);

    if (updateError) {
      setSaving(false);
      alert('Erro ao atualizar lead: ' + updateError.message);
      return;
    }

    await supabase.from('lead_atividades').insert([{
      lead_id: selectedLead.id,
      profile_id: profile?.id,
      tipo: 'sistema',
      titulo: 'Ficha atualizada',
      descricao: 'Dados comerciais do lead foram editados no CRM.'
    }]);

    setSaving(false);
    setEditing(false);
    await fetchCrm();
    await fetchTimeline(selectedLead.id);
  }

  const selectedTasks = selectedLead
    ? tarefas.filter((task) => task.lead_id === selectedLead.id && task.status === 'pendente')
    : [];

  return (
    <InternalLayout>
      <div className="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-blue-600">CRM Orion</p>
          <h1 className="text-3xl font-black tracking-tight text-gray-900">Pipeline Comercial</h1>
          <p className="font-medium text-gray-500">Arraste leads entre etapas, clique no cliente e registre observacoes, ligacoes e WhatsApp.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="relative min-w-72">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar cliente..."
              className="w-full rounded-2xl border-none bg-white py-3 pl-11 pr-4 text-sm font-bold shadow-sm focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
          <button onClick={fetchCrm} className="flex items-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-black text-slate-600 shadow-sm">
            {loading ? <Loader2 className="animate-spin" size={16} /> : <RefreshCw size={16} />} Atualizar
          </button>
        </div>
      </div>

      <div className="mb-8 grid gap-4 md:grid-cols-5">
        <Stat label="Leads" value={leads.length} icon={Target} className="border-gray-100 bg-white text-slate-600" />
        <Stat label="Sem resposta" value={staleCount} icon={AlertTriangle} className="border-amber-100 bg-amber-50 text-amber-700" />
        <Stat label="Tarefas" value={openTasks} icon={Clock} className="border-blue-100 bg-blue-50 text-blue-700" />
        <Stat label="Hoje" value={todayTasks} icon={CheckCircle2} className="border-emerald-100 bg-emerald-50 text-emerald-700" />
        <Stat label="Fit ICP" value={`${fitStats.good}/${fitStats.warning}`} icon={Sparkles} className="border-violet-100 bg-violet-50 text-violet-700" />
      </div>

      {error && <div className="mb-6 rounded-2xl border border-red-100 bg-red-50 p-4 text-sm font-bold text-red-600">{error}</div>}

      <div className={`grid gap-6 ${selectedLead ? 'xl:grid-cols-[1fr_560px]' : 'grid-cols-1'}`}>
        <div>
          {loading ? (
            <div className="flex h-72 items-center justify-center rounded-[2rem] bg-white shadow-sm">
              <Loader2 className="animate-spin text-blue-600" size={42} />
            </div>
          ) : (
            <div className="flex min-h-[calc(100vh-330px)] snap-x gap-5 overflow-x-auto pb-8">
              {columns.map((column) => {
                const columnLeads = getLeadsByStatus(column.id);
                const statusStyle = getLeadStatusStyle(column.id);

                return (
                  <div key={column.id} className="min-w-[310px] flex-1 snap-start">
                    <div className="sticky top-0 z-20 mb-3 rounded-[1.5rem] border border-gray-100 bg-white p-4 shadow-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className={`h-2.5 w-2.5 rounded-full ${statusStyle.dot}`} />
                            <h3 className="text-sm font-black uppercase tracking-widest text-gray-900">{column.label}</h3>
                          </div>
                          <p className="mt-1 text-xs font-medium text-gray-400">{column.desc}</p>
                        </div>
                        <span className="rounded-full border border-slate-100 bg-slate-50 px-2.5 py-1 text-[10px] font-black text-slate-600">
                          {columnLeads.length}
                        </span>
                      </div>
                    </div>

                    <div
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={() => handleDrop(column.id)}
                      className={`min-h-[220px] space-y-3 rounded-[2rem] border p-3 transition-colors ${draggedLeadId ? 'border-blue-200 bg-blue-50/70' : statusStyle.column}`}
                    >
                      {columnLeads.map((lead) => {
                        const qualification = getLeadQualification(lead, tipoCampanha);
                        const selected = selectedLead?.id === lead.id;
                        return (
                          <button
                            key={lead.id}
                            draggable
                            onDragStart={() => setDraggedLeadId(lead.id)}
                            onDragEnd={() => setDraggedLeadId(null)}
                            onClick={() => setSelectedLead(lead)}
                            className={`w-full rounded-[1.5rem] border bg-white p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md ${selected ? 'border-blue-300 ring-4 ring-blue-100' : 'border-white'}`}
                          >
                            <div className="mb-3 flex items-start justify-between gap-3">
                              <div>
                                <p className="font-black text-gray-900">{lead.nome}</p>
                                <p className="mt-1 flex items-center gap-2 text-xs font-bold text-slate-500">
                                  <Phone size={13} /> {lead.telefone}
                                </p>
                              </div>
                              {isStale(lead) && <AlertTriangle size={17} className="text-amber-500" />}
                            </div>
                            <div className="mb-3 grid grid-cols-2 gap-2 text-[11px] font-bold text-slate-500">
                              <span>CNPJ: {lead.possui_cnpj || '-'}</span>
                              <span>Vidas: {lead.idades || '-'}</span>
                              <span>{lead.cidade || 'Cidade nao informada'}</span>
                              <span>{lead.investimento || 'Sem investimento'}</span>
                            </div>
                            <span className={`inline-flex rounded-full border px-2 py-1 text-[9px] font-black uppercase tracking-widest ${qualificationClass(qualification.tone)}`}>
                              {qualification.label}
                            </span>
                          </button>
                        );
                      })}
                      {columnLeads.length === 0 && (
                        <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-white/60 py-12 text-center">
                          <Sparkles size={20} className="mx-auto mb-2 text-slate-300" />
                          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Sem leads aqui</p>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {selectedLead && (
          <aside className="sticky top-6 max-h-[calc(100vh-3rem)] overflow-y-auto rounded-[2rem] border border-gray-100 bg-white p-6 shadow-xl shadow-slate-200/70">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-blue-600">Cliente selecionado</p>
                <h2 className="text-2xl font-black text-gray-900">{selectedLead.nome}</h2>
                <p className="mt-1 text-sm font-bold text-slate-500">{selectedLead.telefone}</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setEditing((current) => !current)} className="rounded-xl bg-blue-50 px-3 py-2 text-xs font-black uppercase tracking-widest text-blue-600 hover:bg-blue-100">
                  {editing ? 'Ver ficha' : 'Editar'}
                </button>
                <button onClick={() => setSelectedLead(null)} className="rounded-xl bg-slate-50 p-2 text-slate-400 hover:text-slate-700">
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="mb-5 rounded-[1.5rem] border border-blue-100 bg-blue-50 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-blue-600">Status comercial</p>
                  <p className="text-sm font-black text-blue-950">{getLeadStatusStyle(selectedLead.status).label}</p>
                </div>
                {isStale(selectedLead) && <span className="rounded-full bg-amber-100 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-amber-700">Atenção</span>}
              </div>
              <select
                value={normalizeLeadStatus(selectedLead.status)}
                onChange={(event) => updateLeadStatus(selectedLead.id, event.target.value as LeadStatus)}
                className="w-full rounded-2xl border-none bg-white px-4 py-3 text-sm font-black text-slate-700 focus:ring-2 focus:ring-blue-500/20"
              >
                {columns.map((column) => <option key={column.id} value={column.id}>{column.label}</option>)}
              </select>
            </div>

            {editing ? (
              <form onSubmit={saveLeadDetails} className="mb-5 rounded-[1.5rem] border border-gray-100 p-4">
                <h3 className="mb-4 text-sm font-black uppercase tracking-widest text-gray-900">Editar ficha</h3>
                <div className="grid gap-3 md:grid-cols-2">
                  <EditField label="Nome" value={editForm.nome} onChange={(value) => setEditForm((prev) => ({ ...prev, nome: value }))} />
                  <EditField label="Telefone" value={editForm.telefone} onChange={(value) => setEditForm((prev) => ({ ...prev, telefone: value }))} />
                  <EditField label="Idades" value={editForm.idades} onChange={(value) => setEditForm((prev) => ({ ...prev, idades: value }))} />
                  <EditField label="Cidade" value={editForm.cidade} onChange={(value) => setEditForm((prev) => ({ ...prev, cidade: value }))} />
                  <EditSelect label="CNPJ" value={editForm.possui_cnpj} options={['Sim', 'Não', 'Não informado']} onChange={(value) => setEditForm((prev) => ({ ...prev, possui_cnpj: value }))} />
                  <EditSelect label="Plano ativo" value={editForm.tem_plano_ativo} options={['Sim', 'Não', 'Não informado']} onChange={(value) => setEditForm((prev) => ({ ...prev, tem_plano_ativo: value }))} />
                  <EditField label="Plano atual" value={editForm.plano_atual} onChange={(value) => setEditForm((prev) => ({ ...prev, plano_atual: value }))} />
                  <EditField label="Custo atual" value={editForm.custo_plano_atual} onChange={(value) => setEditForm((prev) => ({ ...prev, custo_plano_atual: value }))} />
                  <EditField label="Investimento" value={editForm.investimento} onChange={(value) => setEditForm((prev) => ({ ...prev, investimento: value }))} />
                  <EditField label="Operadora" value={editForm.operadora} onChange={(value) => setEditForm((prev) => ({ ...prev, operadora: value }))} />
                </div>
                <label className="mt-3 block">
                  <span className="mb-2 block text-[10px] font-black uppercase tracking-widest text-gray-400">Observações internas</span>
                  <textarea value={editForm.observacoes} onChange={(event) => setEditForm((prev) => ({ ...prev, observacoes: event.target.value }))} rows={3} className="w-full resize-none rounded-2xl border-none bg-slate-50 p-4 text-sm font-bold focus:ring-2 focus:ring-blue-500/20" />
                </label>
                <button disabled={saving} className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-3 text-sm font-black text-white disabled:opacity-50">
                  {saving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />} Salvar alterações
                </button>
              </form>
            ) : (
              <div className="mb-5 grid grid-cols-2 gap-3">
                <InfoCard label="CNPJ" value={selectedLead.possui_cnpj || '-'} />
                <InfoCard label="Vidas" value={selectedLead.idades || '-'} />
                <InfoCard label="Plano ativo" value={selectedLead.tem_plano_ativo || '-'} />
                <InfoCard label="Plano atual" value={selectedLead.plano_atual || '-'} />
                <InfoCard label="Custo atual" value={selectedLead.custo_plano_atual || '-'} />
                <InfoCard label="Investimento" value={selectedLead.investimento || '-'} />
                <InfoCard label="Cidade" value={selectedLead.cidade || '-'} />
                <InfoCard label="Operadora" value={selectedLead.operadora || '-'} />
              </div>
            )}

            <div className="mb-5 grid grid-cols-2 gap-3">
              <a
                href={`tel:${cleanPhone(selectedLead.telefone)}`}
                className="flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-black text-white"
              >
                <Phone size={16} /> Ligar
              </a>
              <a
                href={`https://wa.me/55${cleanPhone(selectedLead.telefone)}`}
                target="_blank"
                className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-black text-white"
              >
                <MessageSquare size={16} /> Chamar inbox
              </a>
            </div>

            <form onSubmit={addNote} className="mb-5 rounded-[1.5rem] border border-gray-100 bg-slate-50 p-4">
              <label className="mb-2 block text-[10px] font-black uppercase tracking-widest text-gray-400">Observacoes</label>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={3}
                placeholder="Ex: lead pediu retorno, enviou documentos, ficou de falar com socio..."
                className="w-full resize-none rounded-2xl border-none bg-white p-4 text-sm font-bold focus:ring-2 focus:ring-blue-500/20"
              />
              <button disabled={saving} className="mt-3 flex items-center gap-2 rounded-2xl bg-blue-600 px-4 py-3 text-sm font-black text-white disabled:opacity-50">
                <Send size={16} /> Salvar observacao
              </button>
            </form>

            {selectedLead.observacoes && (
              <div className="mb-5 rounded-[1.5rem] border border-slate-100 bg-slate-50 p-4">
                <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-400">Observações salvas</p>
                <p className="text-sm font-bold leading-relaxed text-slate-600">{selectedLead.observacoes}</p>
              </div>
            )}

            <form onSubmit={addTask} className="mb-5 rounded-[1.5rem] border border-gray-100 p-4">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-black uppercase tracking-widest text-gray-900">
                <Plus size={16} /> Follow-up
              </h3>
              <input
                value={taskTitle}
                onChange={(event) => setTaskTitle(event.target.value)}
                placeholder="Ex: retornar amanha"
                className="mb-3 w-full rounded-2xl border-none bg-slate-50 px-4 py-3 text-sm font-bold focus:ring-2 focus:ring-blue-500/20"
              />
              <input
                type="datetime-local"
                value={taskDue}
                onChange={(event) => setTaskDue(event.target.value)}
                className="mb-3 w-full rounded-2xl border-none bg-slate-50 px-4 py-3 text-sm font-bold focus:ring-2 focus:ring-blue-500/20"
              />
              <button disabled={saving} className="w-full rounded-2xl bg-slate-900 py-3 text-sm font-black text-white disabled:opacity-50">Criar lembrete</button>
            </form>

            {selectedTasks.length > 0 && (
              <div className="mb-5 space-y-2">
                <h3 className="text-sm font-black uppercase tracking-widest text-gray-900">Tarefas abertas</h3>
                {selectedTasks.map((task) => (
                  <div key={task.id} className="rounded-2xl border border-gray-100 p-3">
                    <p className="text-sm font-black text-gray-900">{task.titulo}</p>
                    <p className="mt-1 text-[11px] font-bold text-slate-400">{task.vencimento ? format(new Date(task.vencimento), 'dd/MM HH:mm', { locale: ptBR }) : 'Sem prazo'}</p>
                    <button onClick={() => completeTask(task.id)} className="mt-2 inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-emerald-600">
                      <CheckCircle2 size={13} /> concluir
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div>
              <h3 className="mb-3 text-sm font-black uppercase tracking-widest text-gray-900">Timeline</h3>
              <div className="max-h-64 space-y-3 overflow-y-auto pr-1">
                {atividades.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-gray-200 p-6 text-center text-sm font-bold text-slate-400">Nenhuma atividade registrada.</div>
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
          </aside>
        )}
      </div>

      {conversas.length > 0 && (
        <div className="mt-4 rounded-[2rem] border border-emerald-100 bg-emerald-50 p-5">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-black uppercase tracking-widest text-emerald-950">
            <MessageSquare size={16} /> Inbox WhatsApp
          </h3>
          <div className="flex gap-3 overflow-x-auto">
            {conversas.slice(0, 8).map((conversation) => (
              <div key={conversation.id} className="min-w-52 rounded-2xl bg-white p-3 text-sm font-bold text-emerald-950">
                {conversation.nome_contato || conversation.telefone}
              </div>
            ))}
          </div>
        </div>
      )}
    </InternalLayout>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-slate-50 p-4">
      <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-gray-400">{label}</p>
      <p className="break-words text-sm font-black text-gray-900">{value}</p>
    </div>
  );
}

function EditField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="mb-2 block text-[10px] font-black uppercase tracking-widest text-gray-400">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-2xl border-none bg-slate-50 px-4 py-3 text-sm font-bold focus:ring-2 focus:ring-blue-500/20"
      />
    </label>
  );
}

function EditSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="mb-2 block text-[10px] font-black uppercase tracking-widest text-gray-400">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-2xl border-none bg-slate-50 px-4 py-3 text-sm font-bold focus:ring-2 focus:ring-blue-500/20"
      >
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}

function Stat({ label, value, icon: Icon, className }: { label: string; value: number | string; icon: typeof Target; className: string }) {
  return (
    <div className={`rounded-[2rem] border p-5 shadow-sm ${className}`}>
      <p className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest">
        <Icon size={14} /> {label}
      </p>
      <p className="text-3xl font-black text-gray-950">{value}</p>
    </div>
  );
}
