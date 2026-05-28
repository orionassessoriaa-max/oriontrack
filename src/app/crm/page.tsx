'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import InternalLayout from '@/components/layout/InternalLayout';
import { useAuth } from '@/components/providers/AuthProvider';
import { supabase } from '@/lib/supabase/client';
import { Lead, LeadAtividade, LeadStatus, LeadTarefa, TipoCampanha } from '@/types';
import { getLeadStatusStyle, normalizeLeadStatus } from '@/lib/leadStatus';
import { getLeadQualification } from '@/lib/leadQualification';
import { cleanLeadObservationText, getLeadImportWarnings } from '@/lib/leadWarnings';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  MessageSquare,
  Paperclip,
  Phone,
  Plus,
  RefreshCw,
  Search,
  Send,
  Save,
  Target,
  Upload,
  Users,
  X
} from 'lucide-react';
import OrionMark from '@/components/ui/OrionMark';

type WhatsAppConversa = {
  id: string;
  lead_id: string | null;
  corretor_id: string | null;
  telefone: string;
  nome_contato: string | null;
  status: string;
  ultima_mensagem_at: string | null;
};

type MetricFilter = 'todos' | 'sem_resposta' | 'tarefas' | 'hoje' | 'fit_icp';

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

const COMMERCIAL_REQUIRED_STATUSES: LeadStatus[] = [
  'Em negociação',
  'Não tive retorno',
  'Venda realizada',
];

function parseCurrencyInput(value?: string | number | null) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const cleaned = String(value || '')
    .replace(/[^\d,.-]/g, '')
    .replace(/\.(?=\d{3}(,|$))/g, '')
    .replace(',', '.');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCurrencyValue(value?: string | number | null) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(parseCurrencyInput(value));
}

function calculateCommissionFromSale(value?: string | number | null) {
  return parseCurrencyInput(value) * 2.5;
}

function requiresCommercialData(status: LeadStatus) {
  return COMMERCIAL_REQUIRED_STATUSES.includes(status);
}

function requiresStatusMoveModal(status: LeadStatus) {
  return requiresCommercialData(status) || status === 'Sem interesse';
}

function getCadenceDays(lead: Pick<Lead, 'cadencia_inicio' | 'cadencia_fim' | 'cadencia_ativa'>) {
  if (!lead.cadencia_inicio) return 0;
  const start = new Date(lead.cadencia_inicio).getTime();
  const end = lead.cadencia_ativa ? Date.now() : new Date(lead.cadencia_fim || new Date()).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 1;
  return Math.max(1, Math.ceil((end - start) / 86_400_000));
}

type CommercialPayload = {
  valor_negociacao?: number | null;
  operadora_negociacao?: string | null;
  valor_comissao?: number | null;
  sem_interesse_motivo?: string | null;
  sem_interesse_fez_cotacao?: boolean;
};

type CommercialModalState = {
  lead: Lead;
  status: LeadStatus;
  valor_negociacao: string;
  operadora_negociacao: string;
  valor_comissao: string;
  sem_interesse_motivo: string;
  sem_interesse_fez_cotacao: boolean;
} | null;

type TeamMember = {
  id: string;
  nome: string;
  email: string;
};

const READY_LABELS = ['Amil bronze', 'Amil platinum', 'Porto p470', 'Outra etiqueta'];

export default function CrmPage() {
  const { profile } = useAuth();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [tarefas, setTarefas] = useState<LeadTarefa[]>([]);
  const [atividades, setAtividades] = useState<LeadAtividade[]>([]);
  const [conversas, setConversas] = useState<WhatsAppConversa[]>([]);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [tipoCampanha, setTipoCampanha] = useState<TipoCampanha | null>('ambos');
  const [search, setSearch] = useState('');
  const [pageFilter, setPageFilter] = useState('todas');
  const [metricFilter, setMetricFilter] = useState<MetricFilter>('todos');
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
    valor_negociacao: '',
    operadora_negociacao: '',
    valor_comissao: '',
    etiqueta: '',
    observacoes: '',
    status: 'Aguardando atendimento' as LeadStatus,
  });
  const [draggedLeadId, setDraggedLeadId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [commercialModal, setCommercialModal] = useState<CommercialModalState>(null);
  const [commercialModalError, setCommercialModalError] = useState<string | null>(null);
  const commercialResolverRef = useRef<((payload: CommercialPayload | null) => void) | null>(null);
  const boardScrollRef = useRef<HTMLDivElement | null>(null);
  const boardScrollbarRef = useRef<HTMLDivElement | null>(null);
  const boardScrollSyncRef = useRef(false);
  const [boardScrollWidth, setBoardScrollWidth] = useState(0);
  const [boardClientWidth, setBoardClientWidth] = useState(0);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [assigningLeadId, setAssigningLeadId] = useState<string | null>(null);
  const canAssignTeamLeads = profile?.tipo_usuario === 'corretor';

  async function fetchCrm() {
    if (!profile?.id) return;

    setLoading(true);
    setError(null);

    try {
      const corretorScopeId = ['corretor', 'corretor_membro'].includes(profile.tipo_usuario) ? profile.corretor_id : null;
      let leadsQuery = supabase
        .from('leads')
        .select('*, responsavel_membro:responsavel_membro_id(nome,email)')
        .order('data_entrada', { ascending: false })
        .limit(200);

      let tarefasQuery = supabase
        .from('lead_tarefas')
        .select('*')
        .order('vencimento', { ascending: true })
        .limit(100);

      let conversasQuery = supabase
        .from('whatsapp_conversas')
        .select('*')
        .order('ultima_mensagem_at', { ascending: false })
        .limit(50);

      if (corretorScopeId) {
        leadsQuery = leadsQuery.eq('corretor_id', corretorScopeId);
        tarefasQuery = tarefasQuery.eq('corretor_id', corretorScopeId);
        conversasQuery = conversasQuery.eq('corretor_id', corretorScopeId);
      }

      if (profile.tipo_usuario === 'corretor_membro') {
        leadsQuery = leadsQuery.eq('responsavel_profile_id', profile.id);
        tarefasQuery = tarefasQuery.eq('responsavel_profile_id', profile.id);
      }

      const [leadsRes, tarefasRes, conversasRes] = await Promise.all([
        leadsQuery,
        tarefasQuery,
        conversasQuery
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

      if (['corretor', 'corretor_membro'].includes(profile.tipo_usuario) && profile.corretor_id) {
        const { data: corretor } = await supabase
          .from('corretores')
          .select('tipo_campanha')
          .eq('id', profile.corretor_id)
          .maybeSingle();

        setTipoCampanha((corretor?.tipo_campanha as TipoCampanha | null) || 'ambos');
      }

      if (profile.tipo_usuario === 'corretor') {
        await fetchTeamMembers();
      }
    } catch (err: any) {
      setError(err.message || 'Erro ao carregar CRM.');
    } finally {
      setLoading(false);
    }
  }

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token;
  }

  async function fetchTeamMembers() {
    if (!profile?.corretor_id || !canAssignTeamLeads) return;
    const token = await getToken();
    if (!token) return;

    const response = await fetch('/api/corretor/times', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const payload = await response.json().catch(() => ({}));
    if (response.ok) {
      setTeamMembers(payload.membros || []);
    }
  }

  async function assignLeadToMember(leadId: string, memberId: string) {
    if (!memberId) return;
    const token = await getToken();
    if (!token) {
      alert('Sessao expirada. Entre novamente.');
      return;
    }

    setAssigningLeadId(leadId);
    const response = await fetch('/api/corretor/times', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ action: 'assign_lead', lead_id: leadId, member_id: memberId }),
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      alert(payload.error || 'Erro ao enviar lead.');
      setAssigningLeadId(null);
      return;
    }

    const member = teamMembers.find((item) => item.id === memberId);
    const assignedPayload = {
      responsavel_membro_id: memberId,
      responsavel_membro: member ? { nome: member.nome, email: member.email } : undefined,
    };
    setLeads((current) => current.map((lead) => lead.id === leadId ? { ...lead, ...assignedPayload } : lead));
    setSelectedLead((current) => current?.id === leadId ? { ...current, ...assignedPayload } : current);
    setAssigningLeadId(null);
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
  }, [profile?.id, profile?.tipo_usuario, profile?.corretor_id]);

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
        valor_negociacao: selectedLead.valor_negociacao ? String(selectedLead.valor_negociacao) : '',
        operadora_negociacao: selectedLead.operadora_negociacao || '',
        valor_comissao: selectedLead.valor_comissao ? String(selectedLead.valor_comissao) : '',
        etiqueta: selectedLead.etiqueta || '',
        observacoes: selectedLead.observacoes || '',
        status: normalizeLeadStatus(selectedLead.status),
      });
      setEditing(false);
      setSelectedFile(null);
    } else {
      setAtividades([]);
    }
  }, [selectedLead?.id]);

  function syncBoardScroll(source: 'board' | 'bar') {
    const board = boardScrollRef.current;
    const bar = boardScrollbarRef.current;
    if (!board || !bar || boardScrollSyncRef.current) return;

    boardScrollSyncRef.current = true;
    if (source === 'board') {
      bar.scrollLeft = board.scrollLeft;
    } else {
      board.scrollLeft = bar.scrollLeft;
    }
    requestAnimationFrame(() => {
      boardScrollSyncRef.current = false;
    });
  }

  const staleLeadIds = useMemo(() => new Set(leads.filter(isStale).map((lead) => lead.id)), [leads]);
  const openTaskLeadIds = useMemo(() => new Set(tarefas.filter((task) => task.status === 'pendente').map((task) => task.lead_id)), [tarefas]);
  const todayTaskLeadIds = useMemo(() => {
    const today = new Date().toDateString();
    return new Set(
      tarefas
        .filter((task) => task.status === 'pendente' && task.vencimento && new Date(task.vencimento).toDateString() === today)
        .map((task) => task.lead_id)
    );
  }, [tarefas]);
  const fitLeadIds = useMemo(() => new Set(
    leads
      .filter((lead) => getLeadQualification(lead, tipoCampanha).tone === 'good')
      .map((lead) => lead.id)
  ), [leads, tipoCampanha]);

  const filteredLeads = useMemo(() => {
    const term = search.toLowerCase();
    return leads.filter((lead) => {
      const leadPage = lead.operadora || '';
      const searchMatch = `${lead.nome} ${lead.telefone} ${lead.cidade} ${lead.status} ${lead.operadora || ''} ${lead.observacoes || ''}`.toLowerCase().includes(term);
      const pageMatch = pageFilter === 'todas' || (pageFilter === '__sem_pagina__' ? !leadPage : leadPage === pageFilter);
      const metricMatch =
        metricFilter === 'todos' ||
        (metricFilter === 'sem_resposta' && staleLeadIds.has(lead.id)) ||
        (metricFilter === 'tarefas' && openTaskLeadIds.has(lead.id)) ||
        (metricFilter === 'hoje' && todayTaskLeadIds.has(lead.id)) ||
        (metricFilter === 'fit_icp' && fitLeadIds.has(lead.id));

      return searchMatch && pageMatch && metricMatch;
    });
  }, [leads, search, pageFilter, metricFilter, staleLeadIds, openTaskLeadIds, todayTaskLeadIds, fitLeadIds]);

  useEffect(() => {
    const board = boardScrollRef.current;
    if (!board) return;

    const syncSize = () => {
      setBoardScrollWidth(board.scrollWidth);
      setBoardClientWidth(board.clientWidth);
    };

    syncSize();
    const observer = new ResizeObserver(syncSize);
    observer.observe(board);
    Array.from(board.children).forEach((child) => observer.observe(child));
    window.addEventListener('resize', syncSize);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', syncSize);
    };
  }, [filteredLeads.length, selectedLead?.id, loading]);

  const pageOptions = useMemo(() => {
    const pages = leads.map((lead) => lead.operadora || '').filter(Boolean);
    return Array.from(new Set(pages)).sort((a, b) => a.localeCompare(b));
  }, [leads]);

  const staleCount = staleLeadIds.size;
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

  function getCommercialTotal(status: LeadStatus) {
    return getLeadsByStatus(status).reduce((total, lead) => {
      return total + parseCurrencyInput(lead.valor_negociacao);
    }, 0);
  }

  function requestCommercialPayload(lead: Lead, status: LeadStatus): Promise<CommercialPayload | null> {
    if (!requiresStatusMoveModal(status)) return Promise.resolve(null);
    if (requiresCommercialData(status) && parseCurrencyInput(lead.valor_negociacao) > 0) return Promise.resolve(null);

    setCommercialModalError(null);
    setCommercialModal({
      lead,
      status,
      valor_negociacao: lead.valor_negociacao ? String(lead.valor_negociacao) : '',
      operadora_negociacao: lead.operadora_negociacao || '',
      valor_comissao: lead.valor_comissao ? String(lead.valor_comissao) : '',
      sem_interesse_motivo: lead.sem_interesse_motivo || '',
      sem_interesse_fez_cotacao: Boolean(lead.sem_interesse_fez_cotacao || parseCurrencyInput(lead.valor_negociacao) > 0),
    });

    return new Promise((resolve) => {
      commercialResolverRef.current = resolve;
    });
  }

  function closeCommercialModal(payload: CommercialPayload | null) {
    commercialResolverRef.current?.(payload);
    commercialResolverRef.current = null;
    setCommercialModal(null);
    setCommercialModalError(null);
  }

  function submitCommercialModal(event: FormEvent) {
    event.preventDefault();
    if (!commercialModal) return;

    if (commercialModal.status === 'Sem interesse') {
      const motivo = commercialModal.sem_interesse_motivo.trim();
      const valor = parseCurrencyInput(commercialModal.valor_negociacao);
      if (!motivo) {
        setCommercialModalError('Informe o motivo para marcar o lead como sem interesse.');
        return;
      }
      if (commercialModal.sem_interesse_fez_cotacao && !valor) {
        setCommercialModalError('Informe o valor da cotacao feita antes de encerrar.');
        return;
      }
      closeCommercialModal({
        sem_interesse_motivo: motivo,
        sem_interesse_fez_cotacao: commercialModal.sem_interesse_fez_cotacao,
        valor_negociacao: commercialModal.sem_interesse_fez_cotacao ? valor : null,
      });
      return;
    }

    const payload = {
      valor_negociacao: parseCurrencyInput(commercialModal.valor_negociacao),
      valor_comissao: calculateCommissionFromSale(commercialModal.valor_negociacao),
    };

    if (!payload.valor_negociacao) {
      setCommercialModalError('Preencha o valor da negociação para avançar.');
      return;
    }

    closeCommercialModal(payload);
  }

  async function updateLeadStatus(leadId: string, status: LeadStatus) {
    const currentLead = leads.find((lead) => lead.id === leadId);
    if (!currentLead) return;

    let commercialPayload: CommercialPayload | null = null;
    if (requiresStatusMoveModal(status)) {
      commercialPayload = await requestCommercialPayload(currentLead, status);
      if (commercialPayload === null && requiresStatusMoveModal(status) && !(requiresCommercialData(status) && parseCurrencyInput(currentLead.valor_negociacao) > 0)) return;
    }

    const previousLeads = leads;
    const optimisticPayload = { ...(commercialPayload || {}), status };
    setLeads((prev) => prev.map((lead) => lead.id === leadId ? { ...lead, ...optimisticPayload } : lead));
    setSelectedLead((current) => current?.id === leadId ? { ...current, ...optimisticPayload } : current);

    const token = await getToken();
    if (!token) {
      setLeads(previousLeads);
      alert('Sessao expirada. Entre novamente.');
      return;
    }

    const response = await fetch(`/api/crm/leads/${leadId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(optimisticPayload),
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      setLeads(previousLeads);
      alert('Erro ao mover lead: ' + (payload.error || 'tente novamente.'));
      return;
    }

    if (payload.lead) {
      setLeads((prev) => prev.map((lead) => lead.id === leadId ? { ...lead, ...payload.lead } : lead));
      setSelectedLead((current) => current?.id === leadId ? { ...current, ...payload.lead } : current);
    }

    if (selectedLead?.id === leadId) await fetchTimeline(leadId);
  }

  async function toggleCadence(lead: Lead, action: 'start' | 'stop') {
    const token = await getToken();
    if (!token) {
      alert('Sessao expirada. Entre novamente.');
      return;
    }

    setSaving(true);
    const response = await fetch(`/api/crm/leads/${lead.id}/cadencia`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ action }),
    });
    const payload = await response.json().catch(() => ({}));
    setSaving(false);

    if (!response.ok) {
      alert(payload.error || 'Nao foi possivel atualizar a cadencia.');
      return;
    }

    if (payload.lead) {
      setLeads((prev) => prev.map((item) => item.id === lead.id ? { ...item, ...payload.lead } : item));
      setSelectedLead((current) => current?.id === lead.id ? { ...current, ...payload.lead } : current);
    }
    await fetchTimeline(lead.id);
  }

  function handleDrop(status: LeadStatus) {
    if (!draggedLeadId) return;
    const lead = leads.find((item) => item.id === draggedLeadId);
    setDraggedLeadId(null);
    if (!lead || normalizeLeadStatus(lead.status) === status) return;
    void updateLeadStatus(lead.id, status);
  }

  const metricLabels: Record<MetricFilter, string> = {
    todos: 'Todos os leads',
    sem_resposta: 'Sem resposta',
    tarefas: 'Tarefas abertas',
    hoje: 'Tarefas de hoje',
    fit_icp: 'Dentro do perfil',
  };

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

  async function uploadAttachment(event: FormEvent) {
    event.preventDefault();
    if (!selectedLead || !selectedFile) return;

    setUploadingFile(true);
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;

    if (!token) {
      setUploadingFile(false);
      alert('Sessao expirada. Entre novamente.');
      return;
    }

    const formData = new FormData();
    formData.append('file', selectedFile);

    const response = await fetch(`/api/crm/leads/${selectedLead.id}/attachments`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: formData,
    });

    const payload = await response.json();
    setUploadingFile(false);

    if (!response.ok) {
      alert(payload.error || 'Erro ao anexar arquivo.');
      return;
    }

    setSelectedFile(null);
    await fetchTimeline(selectedLead.id);
  }

  async function saveLeadDetails(event: FormEvent) {
    event.preventDefault();
    if (!selectedLead) return;

    if (requiresCommercialData(editForm.status)) {
      const hasCommercialData = editForm.valor_negociacao;
      if (!hasCommercialData) {
        alert('Para salvar lead em negociação em diante, preencha o valor da negociação.');
        return;
      }
    }

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
        valor_negociacao: editForm.valor_negociacao ? parseCurrencyInput(editForm.valor_negociacao) : null,
        operadora_negociacao: editForm.operadora_negociacao || null,
        valor_comissao: editForm.valor_negociacao ? calculateCommissionFromSale(editForm.valor_negociacao) : null,
        etiqueta: editForm.etiqueta || null,
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
        <div className="min-w-0">
          <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-blue-600">CRM Orion</p>
          <h1 className="text-3xl font-black tracking-tight text-gray-900 sm:text-4xl">Pipeline Comercial</h1>
          <p className="font-medium text-gray-500">Arraste leads entre etapas, clique no cliente e registre observacoes, ligacoes e WhatsApp.</p>
        </div>
        <div className="flex w-full flex-col gap-3 lg:w-auto lg:flex-row lg:flex-wrap lg:items-center lg:justify-end">
          <div className="relative w-full lg:w-[320px]">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar cliente..."
              className="w-full rounded-2xl border-none bg-white py-3 pl-11 pr-4 text-sm font-bold shadow-sm focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
          <select
            value={pageFilter}
            onChange={(event) => setPageFilter(event.target.value)}
            className="w-full rounded-2xl border-none bg-white px-5 py-3 text-sm font-black text-slate-700 shadow-sm focus:ring-2 focus:ring-blue-500/20 lg:w-[240px] lg:min-w-[240px]"
          >
            <option value="todas">Todas as paginas</option>
            {pageOptions.map((page) => <option key={page} value={page}>{page}</option>)}
            <option value="__sem_pagina__">Sem pagina</option>
          </select>
          <button onClick={fetchCrm} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-black text-slate-700 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md lg:w-[170px]">
            {loading ? <Loader2 className="animate-spin" size={16} /> : <RefreshCw size={16} />} Atualizar
          </button>
        </div>
      </div>

      <div className="mb-8 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-5">
        <Stat label="Leads" value={leads.length} icon={Target} active={metricFilter === 'todos'} onClick={() => setMetricFilter('todos')} className="border-gray-100 bg-white text-slate-600" />
        <Stat label="Sem resposta" value={staleCount} icon={AlertTriangle} active={metricFilter === 'sem_resposta'} onClick={() => setMetricFilter('sem_resposta')} className="border-amber-100 bg-amber-50 text-amber-700" />
        <Stat label="Tarefas" value={openTasks} icon={Clock} active={metricFilter === 'tarefas'} onClick={() => setMetricFilter('tarefas')} className="border-blue-100 bg-blue-50 text-blue-700" />
        <Stat label="Hoje" value={todayTasks} icon={CheckCircle2} active={metricFilter === 'hoje'} onClick={() => setMetricFilter('hoje')} className="border-emerald-100 bg-emerald-50 text-emerald-700" />
        <Stat label="Fit ICP" value={`${fitStats.good}/${fitStats.warning}`} icon={OrionMark} active={metricFilter === 'fit_icp'} onClick={() => setMetricFilter('fit_icp')} className="border-violet-100 bg-violet-50 text-violet-700" />
      </div>

      {metricFilter !== 'todos' && (
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-blue-100 bg-blue-50 px-5 py-4 text-sm font-bold text-blue-700">
          <span>Filtro ativo: {metricLabels[metricFilter]} ({filteredLeads.length})</span>
          <button
            type="button"
            onClick={() => setMetricFilter('todos')}
            className="rounded-xl bg-white px-3 py-2 text-[11px] font-black uppercase tracking-widest text-blue-700 shadow-sm"
          >
            Limpar
          </button>
        </div>
      )}

      {error && <div className="mb-6 rounded-2xl border border-red-100 bg-red-50 p-4 text-sm font-bold text-red-600">{error}</div>}

      <div className={`grid gap-6 ${selectedLead ? 'xl:grid-cols-[1fr_560px]' : 'grid-cols-1'}`}>
        <div>
          {loading ? (
            <div className="flex h-72 items-center justify-center rounded-[2rem] bg-white shadow-sm">
              <Loader2 className="animate-spin text-blue-600" size={42} />
            </div>
          ) : (
            <>
            <div
              ref={boardScrollRef}
              onScroll={() => syncBoardScroll('board')}
              className="scrollbar-visible flex min-h-[calc(100dvh-330px)] snap-x gap-4 overflow-x-scroll pb-8 sm:gap-5"
            >
              {columns.map((column) => {
                const columnLeads = getLeadsByStatus(column.id);
                const statusStyle = getLeadStatusStyle(column.id);
                const commercialTotal = getCommercialTotal(column.id);

                return (
                  <div key={column.id} className="min-w-[285px] flex-1 snap-start sm:min-w-[310px]">
                    <div className="sticky top-0 z-20 mb-3 rounded-flux-card-inner border border-gray-100 bg-white p-4 shadow-sm">
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
                      {requiresCommercialData(column.id) && (
                        <div className="mt-3 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2">
                          <p className="text-[9px] font-black uppercase tracking-widest text-emerald-600">Total na etapa</p>
                          <p className="text-sm font-black text-emerald-800">{formatCurrencyValue(commercialTotal)}</p>
                        </div>
                      )}
                    </div>

                    <div
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={() => handleDrop(column.id)}
                      className={`min-h-[220px] space-y-3 rounded-flux-card border p-3 transition-colors ${draggedLeadId ? 'border-blue-200 bg-blue-50/70' : statusStyle.column}`}
                    >
                      <AnimatePresence mode="popLayout">
                        {columnLeads.map((lead) => {
                          const qualification = getLeadQualification(lead, tipoCampanha);
                          const selected = selectedLead?.id === lead.id;
                          const importWarnings = getLeadImportWarnings(lead);
                          return (
                            <motion.button
                              key={lead.id}
                              layout
                              initial={{ opacity: 0, y: 12 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -12 }}
                              whileHover={{ scale: 1.015, y: -2 }}
                              transition={{ duration: 0.25, ease: "easeOut" }}
                              draggable
                              onDragStart={() => setDraggedLeadId(lead.id)}
                              onDragEnd={() => setDraggedLeadId(null)}
                              onClick={() => setSelectedLead(lead)}
                              className={`w-full rounded-flux-card-inner border bg-white/80 dark:bg-slate-900/80 backdrop-blur-md p-4 text-left shadow-sm transition-all hover:shadow-md cursor-pointer ${
                                selected 
                                  ? 'border-blue-400 ring-4 ring-blue-100 dark:ring-blue-900/30' 
                                  : 'border-white/30 dark:border-white/5'
                              }`}
                            >
                              <div className="mb-3 flex items-start justify-between gap-3">
                                <div>
                                  <p className="font-black text-gray-900 dark:text-white leading-tight">{lead.nome}</p>
                                  <p className="mt-1.5 flex items-center gap-2 text-xs font-bold text-slate-500">
                                    <Phone size={13} className="text-blue-500" /> {lead.telefone}
                                  </p>
                                </div>
                                <div className="flex items-center gap-2">
                                  {importWarnings.length > 0 && (
                                    <AlertTriangle
                                      size={17}
                                      className="text-orange-500"
                                      aria-label="Lead com dados incompletos"
                                    />
                                  )}
                                  {isStale(lead) && <AlertTriangle size={17} className="text-amber-500" />}
                                </div>
                              </div>
                              {importWarnings.length > 0 && (
                                <div className="mb-3 rounded-xl border border-amber-100 bg-amber-50/70 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-amber-700">
                                  Dados incompletos: {importWarnings.join(', ')}
                                </div>
                              )}
                              <div className="mb-3 grid grid-cols-2 gap-2 text-[11px] font-bold text-slate-500">
                                <span>CNPJ: {lead.possui_cnpj || '-'}</span>
                                <span>Vidas: {lead.idades || '-'}</span>
                                <span className="col-span-2 rounded-xl bg-blue-50/80 dark:bg-blue-950/40 px-2.5 py-1.5 text-blue-700 dark:text-blue-300 font-extrabold">Pagina: {lead.operadora || 'Sem pagina'}</span>
                                {lead.responsavel_membro?.nome && (
                                  <span className="col-span-2 rounded-xl bg-emerald-50/80 dark:bg-emerald-950/40 px-2.5 py-1.5 text-emerald-700 dark:text-emerald-300 font-extrabold">Responsavel: {lead.responsavel_membro.nome}</span>
                                )}
                                {lead.cadencia_inicio && (
                                  <span className={`col-span-2 rounded-xl px-2.5 py-1.5 font-extrabold ${lead.cadencia_ativa ? 'bg-violet-50/80 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300' : 'bg-slate-50 text-slate-500'}`}>
                                    Cadencia: {lead.cadencia_ativa ? `dia ${getCadenceDays(lead)}` : `${getCadenceDays(lead)} dia(s) encerrada`}
                                  </span>
                                )}
                                <span className="truncate">{lead.cidade || 'Cidade nao informada'}</span>
                                <span className="truncate">{lead.investimento || 'Sem investimento'}</span>
                                {requiresCommercialData(normalizeLeadStatus(lead.status)) && (
                                  <>
                                    <span className="col-span-2 border-t border-dashed border-slate-100 pt-2 mt-1">Negociação: {formatCurrencyValue(lead.valor_negociacao)}</span>
                                    <span className="col-span-2">Comissão: {formatCurrencyValue(lead.valor_comissao)}</span>
                                  </>
                                )}
                              </div>
                              <span className={`inline-flex rounded-full border px-2.5 py-1 text-[9px] font-black uppercase tracking-widest ${qualificationClass(qualification.tone)}`}>
                                {qualification.label}
                              </span>
                            </motion.button>
                          );
                        })}
                      </AnimatePresence>
                      {columnLeads.length === 0 && (
                        <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-white/60 dark:bg-slate-900/40 py-12 text-center">
                          <OrionMark size={18} className="mx-auto mb-2 opacity-25 animate-pulse" />
                          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Sem leads aqui</p>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {boardScrollWidth > boardClientWidth && (
              <div className="sticky bottom-0 z-40 -mt-5 border-t border-slate-200 bg-white/95 px-2 py-2 backdrop-blur">
                <div
                  ref={boardScrollbarRef}
                  onScroll={() => syncBoardScroll('bar')}
                  className="scrollbar-visible overflow-x-scroll"
                >
                  <div style={{ width: boardScrollWidth, height: 1 }} />
                </div>
              </div>
            )}
            </>
          )}
        </div>

        {selectedLead && (
          <>
          <div
            className="fixed inset-0 z-[90] bg-slate-950/35 backdrop-blur-sm"
            onClick={() => setSelectedLead(null)}
          />
          <aside className="fixed inset-y-0 right-0 z-[100] w-full max-w-[620px] overflow-y-auto border-l border-gray-100 bg-white p-5 shadow-2xl shadow-slate-950/20 sm:p-6">
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

            <div className="mb-5 rounded-[1.5rem] border border-violet-100 bg-violet-50 p-4">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-violet-600">Cadencia de atendimento</p>
                  <p className="mt-1 text-sm font-bold text-violet-950">
                    {selectedLead.cadencia_ativa
                      ? `Ativa no dia ${getCadenceDays(selectedLead)}`
                      : selectedLead.cadencia_inicio
                        ? `Encerrada apos ${getCadenceDays(selectedLead)} dia(s)`
                        : 'Ainda nao iniciada'}
                  </p>
                </div>
                <Clock className="text-violet-500" size={22} />
              </div>
              <p className="mb-3 text-xs font-semibold leading-relaxed text-violet-900/70">
                Use quando o lead nao responder. O Orion conta os dias em cadencia e registra o inicio e a parada na timeline do cliente.
              </p>
              <button
                type="button"
                disabled={saving}
                onClick={() => toggleCadence(selectedLead, selectedLead.cadencia_ativa ? 'stop' : 'start')}
                className={`flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-black text-white transition disabled:opacity-50 ${selectedLead.cadencia_ativa ? 'bg-slate-950 hover:bg-slate-800' : 'bg-violet-600 hover:bg-violet-700'}`}
              >
                {saving ? <Loader2 className="animate-spin" size={16} /> : <Clock size={16} />}
                {selectedLead.cadencia_ativa ? 'Parar cadencia' : 'Iniciar cadencia'}
              </button>
            </div>

            {canAssignTeamLeads && teamMembers.length > 0 && (
              <div className="mb-5 rounded-[1.5rem] border border-slate-100 bg-white p-4 shadow-sm">
                <div className="mb-3 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-950 text-white">
                    <Users size={18} />
                  </div>
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Enviar lead</p>
                    <h3 className="text-sm font-black text-slate-950">Atribuir para integrante do time</h3>
                  </div>
                </div>
                <select
                  value={selectedLead.responsavel_membro_id || ''}
                  onChange={(event) => assignLeadToMember(selectedLead.id, event.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-black text-slate-700 focus:ring-2 focus:ring-blue-500/20"
                >
                  <option value="">Selecione quem vai receber</option>
                  {teamMembers.map((member) => <option key={member.id} value={member.id}>{member.nome}</option>)}
                </select>
                {assigningLeadId === selectedLead.id && (
                  <p className="mt-2 flex items-center gap-2 text-xs font-black text-blue-600">
                    <Loader2 className="animate-spin" size={14} /> Enviando lead...
                  </p>
                )}
              </div>
            )}

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
                  <EditField label="Investimento" value={editForm.investimento} onChange={(value) => setEditForm((prev) => ({ ...prev, investimento: value }))} />
                  <EditField label="Pagina" value={editForm.operadora} onChange={(value) => setEditForm((prev) => ({ ...prev, operadora: value }))} />
                  <EditSelect label="Etiqueta" value={editForm.etiqueta} options={['', ...READY_LABELS]} onChange={(value) => {
                    const etiqueta = value === 'Outra etiqueta' ? (window.prompt('Nome da nova etiqueta', editForm.etiqueta) || '') : value;
                    setEditForm((prev) => ({ ...prev, etiqueta }));
                  }} />
                  <EditField label="Valor negociação" value={editForm.valor_negociacao} onChange={(value) => setEditForm((prev) => ({ ...prev, valor_negociacao: value }))} />
                  <EditField label="Operadora venda" value={editForm.operadora_negociacao} onChange={(value) => setEditForm((prev) => ({ ...prev, operadora_negociacao: value }))} />
                  <InfoCard label="Comissão automática" value={formatCurrencyValue(calculateCommissionFromSale(editForm.valor_negociacao))} />
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
                <InfoCard label="Investimento" value={selectedLead.investimento || '-'} />
                <InfoCard label="Cidade" value={selectedLead.cidade || '-'} />
                <InfoCard label="Pagina" value={selectedLead.operadora || '-'} />
                <InfoCard label="Etiqueta" value={selectedLead.etiqueta || '-'} />
                <InfoCard label="Valor negociação" value={selectedLead.valor_negociacao ? formatCurrencyValue(selectedLead.valor_negociacao) : '-'} />
                <InfoCard label="Operadora venda" value={selectedLead.operadora_negociacao || '-'} />
                <InfoCard label="Comissão" value={selectedLead.valor_comissao ? formatCurrencyValue(selectedLead.valor_comissao) : '-'} />
                {selectedLead.sem_interesse_motivo && (
                  <InfoCard label="Motivo sem interesse" value={selectedLead.sem_interesse_motivo} />
                )}
                {selectedLead.sem_interesse_motivo && (
                  <InfoCard label="Teve cotacao?" value={selectedLead.sem_interesse_fez_cotacao ? 'Sim' : 'Nao'} />
                )}
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
                href={`/inbox?lead=${selectedLead.id}&telefone=${cleanPhone(selectedLead.telefone)}`}
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

            {selectedLead.observacoes && cleanLeadObservationText(selectedLead.observacoes) && (
              <div className="mb-5 rounded-[1.5rem] border border-slate-100 bg-slate-50 p-4">
                <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-400">UTMs / observacoes da planilha</p>
                <p className="text-sm font-bold leading-relaxed text-slate-600">{cleanLeadObservationText(selectedLead.observacoes)}</p>
              </div>
            )}

            <form onSubmit={uploadAttachment} className="mb-5 rounded-[1.5rem] border border-blue-100 bg-blue-50 p-4">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-black uppercase tracking-widest text-blue-950">
                <Paperclip size={16} /> Fotos e arquivos
              </h3>
              <label className="block cursor-pointer rounded-2xl border border-dashed border-blue-200 bg-white p-4 text-center transition-all hover:border-blue-400">
                <Upload className="mx-auto mb-2 text-blue-500" size={22} />
                <span className="block text-sm font-black text-slate-700">
                  {selectedFile ? selectedFile.name : 'Selecionar foto ou arquivo'}
                </span>
                <span className="mt-1 block text-[11px] font-bold text-slate-400">PNG, JPG, PDF ou documento do cliente</span>
                <input
                  type="file"
                  className="hidden"
                  onChange={(event) => setSelectedFile(event.target.files?.[0] || null)}
                />
              </label>
              <button
                disabled={!selectedFile || uploadingFile}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {uploadingFile ? <Loader2 className="animate-spin" size={16} /> : <Upload size={16} />} Anexar ao lead
              </button>
            </form>

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
                    {activity.descricao && (
                      activity.descricao.startsWith('http') ? (
                        <a href={activity.descricao} target="_blank" className="text-sm font-black text-blue-600 hover:underline">
                          Abrir arquivo anexado
                        </a>
                      ) : (
                        <p className="text-sm font-medium text-slate-500">{activity.descricao}</p>
                      )
                    )}
                  </div>
                ))}
              </div>
            </div>
          </aside>
          </>
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

      {commercialModal && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-950/55 px-4 backdrop-blur-sm">
          <form
            onSubmit={submitCommercialModal}
            className="w-full max-w-xl rounded-[2rem] border border-slate-200 bg-white p-6 shadow-2xl shadow-slate-950/25"
          >
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-blue-600">Dados comerciais</p>
                <h2 className="mt-1 text-2xl font-black text-slate-950">Avancar para {getLeadStatusStyle(commercialModal.status).label}</h2>
                <p className="mt-1 text-sm font-bold text-slate-500">{commercialModal.lead.nome}</p>
              </div>
              <button
                type="button"
                onClick={() => closeCommercialModal(null)}
                className="rounded-2xl bg-slate-100 p-2 text-slate-500 transition hover:bg-slate-200 hover:text-slate-900"
                aria-label="Fechar"
              >
                <X size={18} />
              </button>
            </div>

            {commercialModalError && (
              <div className="mb-4 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-black text-red-600">
                {commercialModalError}
              </div>
            )}

            {commercialModal.status === 'Sem interesse' ? (
              <div className="grid gap-4">
                <label className="block">
                  <span className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-400">Motivo</span>
                  <select
                    autoFocus
                    value={commercialModal.sem_interesse_motivo}
                    onChange={(event) => setCommercialModal((current) => current ? { ...current, sem_interesse_motivo: event.target.value } : current)}
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-base font-black text-slate-950 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10"
                  >
                    <option value="">Selecione o motivo</option>
                    <option value="Preco acima do esperado">Preco acima do esperado</option>
                    <option value="Ja fechou com outro corretor">Ja fechou com outro corretor</option>
                    <option value="Nao quer contratar agora">Nao quer contratar agora</option>
                    <option value="Fora do perfil de atendimento">Fora do perfil de atendimento</option>
                    <option value="Nao respondeu apos tentativas">Nao respondeu apos tentativas</option>
                    <option value="Outro motivo">Outro motivo</option>
                  </select>
                </label>
                <label className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <span className="text-sm font-black text-slate-800">Chegou a fazer cotacao?</span>
                  <input
                    type="checkbox"
                    checked={commercialModal.sem_interesse_fez_cotacao}
                    onChange={(event) => setCommercialModal((current) => current ? { ...current, sem_interesse_fez_cotacao: event.target.checked } : current)}
                    className="h-5 w-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                </label>
                {commercialModal.sem_interesse_fez_cotacao && (
                  <label className="block">
                    <span className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-400">Valor da cotacao</span>
                    <input
                      value={commercialModal.valor_negociacao}
                      onChange={(event) => setCommercialModal((current) => current ? { ...current, valor_negociacao: event.target.value } : current)}
                      placeholder="Ex: 1200"
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-base font-black text-slate-950 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10"
                    />
                  </label>
                )}
              </div>
            ) : (
              <div className="grid gap-4">
                <label className="block">
                  <span className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-400">Valor da negociacao</span>
                  <input
                    autoFocus
                    value={commercialModal.valor_negociacao}
                    onChange={(event) => setCommercialModal((current) => current ? { ...current, valor_negociacao: event.target.value } : current)}
                    placeholder="Ex: 1200"
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-base font-black text-slate-950 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10"
                  />
                </label>

                <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3">
                  <span className="mb-1 block text-[10px] font-black uppercase tracking-widest text-emerald-700">Comissão calculada automaticamente</span>
                  <p className="text-lg font-black text-emerald-800">{formatCurrencyValue(calculateCommissionFromSale(commercialModal.valor_negociacao))}</p>
                  <p className="mt-1 text-xs font-bold text-emerald-700">250% sobre o valor da negociação.</p>
                </div>
              </div>
            )}

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => closeCommercialModal(null)}
                className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-black text-slate-600 transition hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="rounded-2xl bg-blue-600 px-5 py-3 text-sm font-black text-white shadow-lg shadow-blue-600/20 transition hover:-translate-y-0.5 hover:bg-blue-700"
              >
                Salvar e mover lead
              </button>
            </div>
          </form>
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

function Stat({
  label,
  value,
  icon: Icon,
  className,
  active,
  onClick,
}: {
  label: string;
  value: number | string;
  icon: typeof Target | typeof OrionMark;
  className: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`glass-panel glass-card-glow rounded-[1.75rem] border p-5 text-left shadow-sm transition-all focus:outline-none focus:ring-4 focus:ring-blue-500/10 cursor-pointer ${
        active 
          ? 'ring-2 ring-blue-500/70 border-blue-500/60 bg-blue-500/10 shadow-[0_12px_24px_-8px_rgba(59,130,246,0.35)]' 
          : 'border-white/20'
      } ${className}`}
    >
      <p className="mb-2.5 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest opacity-85">
        <Icon size={14} className="animate-pulse" /> {label}
      </p>
      <p className="text-3xl font-black text-gray-900 dark:text-white tracking-tight">{value}</p>
    </button>
  );
}
