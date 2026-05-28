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
  if (tone === 'good') return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400 font-semibold';
  if (tone === 'warning') return 'border-amber-500/20 bg-amber-500/10 text-amber-400 font-semibold';
  return 'border-white/[0.08] bg-[#161a20] text-[#8C95A3] font-semibold';
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
          <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-[#0863FF]">CRM Orion</p>
          <h1 className="text-3xl font-black tracking-tight text-white sm:text-4xl">Pipeline Comercial</h1>
          <p className="font-medium text-[#8C95A3]">Arraste leads entre etapas, clique no cliente e registre observações, ligações e WhatsApp.</p>
        </div>
        <div className="flex w-full flex-col gap-3 lg:w-auto lg:flex-row lg:flex-wrap lg:items-center lg:justify-end">
          <div className="relative w-full lg:w-[320px]">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar cliente..."
              className="w-full rounded-2xl border border-white/[0.08] bg-[#111418] py-3 pl-11 pr-4 text-sm font-bold text-white placeholder-slate-500 shadow-sm focus:border-[#0863FF] focus:outline-none transition-all"
            />
          </div>
          <select
            value={pageFilter}
            onChange={(event) => setPageFilter(event.target.value)}
            className="w-full rounded-2xl border border-white/[0.08] bg-[#111418] px-5 py-3 text-sm font-black text-white shadow-sm focus:border-[#0863FF] focus:outline-none lg:w-[240px] lg:min-w-[240px] transition-all"
          >
            <option value="todas">Todas as páginas</option>
            {pageOptions.map((page) => <option key={page} value={page}>{page}</option>)}
            <option value="__sem_pagina__">Sem página</option>
          </select>
          <button onClick={fetchCrm} className="flex w-full items-center justify-center gap-2 rounded-2xl border border-white/[0.08] bg-[#111418] px-5 py-3 text-sm font-black text-white shadow-sm transition-all hover:bg-[#161a20] hover:-translate-y-0.5 hover:shadow-md lg:w-[170px]">
            {loading ? <Loader2 className="animate-spin" size={16} /> : <RefreshCw size={16} />} Atualizar
          </button>
        </div>
      </div>

      <div className="mb-8 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-5 animate-in fade-in slide-in-from-top-4 duration-500">
        <Stat label="Leads" value={leads.length} icon={Target} active={metricFilter === 'todos'} onClick={() => setMetricFilter('todos')} className="" />
        <Stat label="Sem resposta" value={staleCount} icon={AlertTriangle} active={metricFilter === 'sem_resposta'} onClick={() => setMetricFilter('sem_resposta')} className="" />
        <Stat label="Tarefas" value={openTasks} icon={Clock} active={metricFilter === 'tarefas'} onClick={() => setMetricFilter('tarefas')} className="" />
        <Stat label="Hoje" value={todayTasks} icon={CheckCircle2} active={metricFilter === 'hoje'} onClick={() => setMetricFilter('hoje')} className="" />
        <Stat label="Fit ICP" value={`${fitStats.good}/${fitStats.warning}`} icon={OrionMark} active={metricFilter === 'fit_icp'} onClick={() => setMetricFilter('fit_icp')} className="" />
      </div>

      {metricFilter !== 'todos' && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#0863FF]/30 bg-[#0863FF]/10 px-5 py-4 text-sm font-bold text-white shadow-flux">
          <span>Filtro ativo: {metricLabels[metricFilter]} ({filteredLeads.length})</span>
          <button
            type="button"
            onClick={() => setMetricFilter('todos')}
            className="rounded-xl bg-[#0863FF] px-4 py-2 text-[11px] font-black uppercase tracking-widest text-white shadow-md hover:bg-opacity-90 transition-all"
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
                    <div className="sticky top-0 z-20 mb-3 rounded-flux-card-inner border border-white/[0.08] bg-[#111418] p-4 shadow-flux">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className={`h-2.5 w-2.5 rounded-full ${statusStyle.dot}`} />
                            <h3 className="text-sm font-black uppercase tracking-widest text-white">{column.label}</h3>
                          </div>
                          <p className="mt-1 text-xs font-medium text-[#8C95A3]">{column.desc}</p>
                        </div>
                        <span className="rounded-full border border-white/[0.08] bg-[#161a20] px-2.5 py-1 text-[10px] font-black text-[#8C95A3]">
                          {columnLeads.length}
                        </span>
                      </div>
                      {requiresCommercialData(column.id) && (
                        <div className="mt-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2">
                          <p className="text-[9px] font-black uppercase tracking-widest text-emerald-500/80">Total na etapa</p>
                          <p className="text-sm font-bold text-emerald-400">{formatCurrencyValue(commercialTotal)}</p>
                        </div>
                      )}
                    </div>

                    <div
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={() => handleDrop(column.id)}
                      className={`min-h-[220px] space-y-3 rounded-flux-card border p-3 transition-all duration-300 ${draggedLeadId ? 'border-[#0863FF]/45 bg-[#0863FF]/5 shadow-[0_0_20px_rgba(8,99,255,0.05)]' : 'border-white/[0.08] bg-[#111418]/30'}`}
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
                              className={`w-full rounded-flux-card-inner border p-4 text-left shadow-sm transition-all duration-300 hover:shadow-lg cursor-pointer ${
                                selected 
                                  ? 'border-[#0863FF] bg-[#161A20] ring-4 ring-[#0863FF]/15' 
                                  : 'border-white/[0.08] bg-[#161A20] hover:border-white/[0.15] hover:bg-[#1c222a]'
                              }`}
                            >
                              <div className="mb-3 flex items-start justify-between gap-3">
                                <div>
                                  <p className="font-semibold text-white leading-tight">{lead.nome}</p>
                                  <p className="mt-1.5 flex items-center gap-2 text-xs font-bold text-[#8C95A3]">
                                    <Phone size={13} className="text-[#0863FF]" /> {lead.telefone}
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
                                <div className="mb-3 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-amber-400">
                                  Dados incompletos: {importWarnings.join(', ')}
                                </div>
                              )}
                              <div className="mb-3 grid grid-cols-2 gap-2 text-[11px] font-bold text-[#8C95A3]">
                                <span>CNPJ: {lead.possui_cnpj || '-'}</span>
                                <span>Vidas: {lead.idades || '-'}</span>
                                <span className="col-span-2 rounded-xl bg-[#0863FF]/10 border border-[#0863FF]/15 px-2.5 py-1.5 text-[#0863FF] font-extrabold">Página: {lead.operadora || 'Sem página'}</span>
                                {lead.responsavel_membro?.nome && (
                                  <span className="col-span-2 rounded-xl bg-emerald-500/10 border border-emerald-500/15 px-2.5 py-1.5 text-emerald-400 font-extrabold">Responsável: {lead.responsavel_membro.nome}</span>
                                )}
                                {lead.cadencia_inicio && (
                                  <span className={`col-span-2 rounded-xl px-2.5 py-1.5 font-extrabold border ${lead.cadencia_ativa ? 'bg-violet-500/10 border-violet-500/15 text-violet-400' : 'bg-white/5 border-white/5 text-slate-400'}`}>
                                    Cadência: {lead.cadencia_ativa ? `dia ${getCadenceDays(lead)}` : `${getCadenceDays(lead)} dia(s) encerrada`}
                                  </span>
                                )}
                                <span className="truncate">{lead.cidade || 'Cidade não informada'}</span>
                                <span className="truncate">{lead.investimento || 'Sem investimento'}</span>
                                {requiresCommercialData(normalizeLeadStatus(lead.status)) && (
                                  <>
                                    <span className="col-span-2 border-t border-dashed border-white/[0.08] pt-2 mt-1">Negociação: {formatCurrencyValue(lead.valor_negociacao)}</span>
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
                        <div className="rounded-[1.5rem] border border-dashed border-white/[0.08] bg-[#161a20]/20 py-12 text-center">
                          <OrionMark size={18} className="mx-auto mb-2 opacity-25 animate-pulse" />
                          <p className="text-[10px] font-bold uppercase tracking-widest text-[#8C95A3]">Sem leads aqui</p>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {boardScrollWidth > boardClientWidth && (
              <div className="sticky bottom-0 z-40 -mt-5 border-t border-white/[0.08] bg-black/80 px-2 py-2 backdrop-blur">
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
          <aside className="fixed inset-y-0 right-0 z-[100] w-full max-w-[620px] overflow-y-auto border-l border-white/[0.08] bg-[#111418] p-5 shadow-2xl shadow-black/80 sm:p-6 text-white scrollbar-hidden">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-[#0863FF]">Cliente selecionado</p>
                <h2 className="text-2xl font-semibold tracking-tight text-white">{selectedLead.nome}</h2>
                <p className="mt-1 text-sm font-bold text-[#8C95A3]">{selectedLead.telefone}</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setEditing((current) => !current)} className="rounded-xl bg-[#0863FF] px-4 py-2 text-xs font-black uppercase tracking-widest text-white shadow-md hover:bg-opacity-90 transition-all">
                  {editing ? 'Ver ficha' : 'Editar'}
                </button>
                <button onClick={() => setSelectedLead(null)} className="rounded-xl bg-[#161a20] border border-white/[0.08] p-2 text-[#8C95A3] hover:text-white transition-all">
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="mb-5 rounded-[1.5rem] border border-[#0863FF]/30 bg-[#0863FF]/5 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-[#0863FF]">Status comercial</p>
                  <p className="text-sm font-bold text-white">{getLeadStatusStyle(selectedLead.status).label}</p>
                </div>
                {isStale(selectedLead) && <span className="rounded-full bg-amber-500/10 border border-amber-500/20 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-amber-400 animate-pulse">Atenção</span>}
              </div>
              <select
                value={normalizeLeadStatus(selectedLead.status)}
                onChange={(event) => updateLeadStatus(selectedLead.id, event.target.value as LeadStatus)}
                className="w-full rounded-2xl border border-white/[0.08] bg-[#161a20] px-4 py-3 text-sm font-bold text-white focus:border-[#0863FF] focus:outline-none transition-all"
              >
                {columns.map((column) => <option key={column.id} value={column.id}>{column.label}</option>)}
              </select>
            </div>

            <div className="mb-5 rounded-[1.5rem] border border-violet-500/20 bg-violet-500/5 p-4">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-violet-400">Cadencia de atendimento</p>
                  <p className="mt-1 text-sm font-bold text-white">
                    {selectedLead.cadencia_ativa
                      ? `Ativa no dia ${getCadenceDays(selectedLead)}`
                      : selectedLead.cadencia_inicio
                        ? `Encerrada apos ${getCadenceDays(selectedLead)} dia(s)`
                        : 'Ainda nao iniciada'}
                  </p>
                </div>
                <Clock className="text-violet-400" size={22} />
              </div>
              <p className="mb-3 text-xs font-semibold leading-relaxed text-[#8C95A3]">
                Use quando o lead nao responder. O Orion conta os dias em cadencia e registra o inicio e a parada na timeline do cliente.
              </p>
              <button
                type="button"
                disabled={saving}
                onClick={() => toggleCadence(selectedLead, selectedLead.cadencia_ativa ? 'stop' : 'start')}
                className={`flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-black text-white transition disabled:opacity-50 ${selectedLead.cadencia_ativa ? 'bg-black border border-white/5 hover:bg-[#161a20]' : 'bg-violet-600 hover:bg-violet-700'}`}
              >
                {saving ? <Loader2 className="animate-spin" size={16} /> : <Clock size={16} />}
                {selectedLead.cadencia_ativa ? 'Parar cadencia' : 'Iniciar cadencia'}
              </button>
            </div>

            {canAssignTeamLeads && teamMembers.length > 0 && (
              <div className="mb-5 rounded-[1.5rem] border border-white/[0.08] bg-[#161a20] p-4 shadow-flux">
                <div className="mb-3 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-black text-[#0863FF] border border-white/5">
                    <Users size={18} />
                  </div>
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-[#8C95A3]">Enviar lead</p>
                    <h3 className="text-sm font-bold text-white">Atribuir para integrante do time</h3>
                  </div>
                </div>
                <select
                  value={selectedLead.responsavel_membro_id || ''}
                  onChange={(event) => assignLeadToMember(selectedLead.id, event.target.value)}
                  className="w-full rounded-2xl border border-white/[0.08] bg-[#111418] px-4 py-3 text-sm font-bold text-white focus:border-[#0863FF] focus:outline-none transition-all"
                >
                  <option value="">Selecione quem vai receber</option>
                  {teamMembers.map((member) => <option key={member.id} value={member.id}>{member.nome}</option>)}
                </select>
                {assigningLeadId === selectedLead.id && (
                  <p className="mt-2 flex items-center gap-2 text-xs font-black text-[#0863FF]">
                    <Loader2 className="animate-spin" size={14} /> Enviando lead...
                  </p>
                )}
              </div>
            )}

            {editing ? (
              <form onSubmit={saveLeadDetails} className="mb-5 rounded-[1.5rem] border border-white/[0.08] bg-[#161a20] p-4 shadow-sm animate-in fade-in duration-300">
                <h3 className="mb-4 text-sm font-black uppercase tracking-widest text-white">Editar ficha</h3>
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
                  <span className="mb-2 block text-[10px] font-black uppercase tracking-widest text-[#8C95A3]">Observações internas</span>
                  <textarea value={editForm.observacoes} onChange={(event) => setEditForm((prev) => ({ ...prev, observacoes: event.target.value }))} rows={3} className="w-full resize-none rounded-2xl border border-white/[0.08] bg-[#111418] p-4 text-sm font-bold text-white placeholder-slate-500 focus:border-[#0863FF] focus:outline-none transition-all" />
                </label>
                <button disabled={saving} className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-[#0863FF] px-4 py-3 text-sm font-black text-white hover:bg-opacity-90 transition-all shadow-md disabled:opacity-50">
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
                className="flex items-center justify-center gap-2 rounded-2xl bg-[#161a20] border border-white/[0.08] px-4 py-3 text-sm font-black text-white hover:bg-[#1c222a] transition-all"
              >
                <Phone size={16} className="text-[#0863FF]" /> Ligar
              </a>
              <a
                href={`/inbox?lead=${selectedLead.id}&telefone=${cleanPhone(selectedLead.telefone)}`}
                className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 px-4 py-3 text-sm font-black text-emerald-400 hover:bg-emerald-500/15 transition-all"
              >
                <MessageSquare size={16} /> Chamar inbox
              </a>
            </div>

            <form onSubmit={addNote} className="mb-5 rounded-[1.5rem] border border-white/[0.08] bg-[#161a20] p-4 shadow-sm">
              <label className="mb-2 block text-[10px] font-black uppercase tracking-widest text-[#8C95A3]">Observações</label>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={3}
                placeholder="Ex: lead pediu retorno, enviou documentos, ficou de falar com socio..."
                className="w-full resize-none rounded-2xl border border-white/[0.08] bg-[#111418] p-4 text-sm font-bold text-white placeholder-slate-500 focus:border-[#0863FF] focus:outline-none transition-all"
              />
              <button disabled={saving} className="mt-3 flex items-center gap-2 rounded-2xl bg-[#0863FF] px-5 py-3 text-sm font-black text-white disabled:opacity-50 hover:bg-opacity-90 transition-all shadow-md">
                <Send size={16} /> Salvar observacao
              </button>
            </form>

            {selectedLead.observacoes && cleanLeadObservationText(selectedLead.observacoes) && (
              <div className="mb-5 rounded-[1.5rem] border border-white/[0.08] bg-[#161a20] p-4">
                <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-[#8C95A3]">UTMs / observações da planilha</p>
                <p className="text-sm font-bold leading-relaxed text-[#8C95A3]">{cleanLeadObservationText(selectedLead.observacoes)}</p>
              </div>
            )}

            <form onSubmit={uploadAttachment} className="mb-5 rounded-[1.5rem] border border-[#0863FF]/20 bg-[#0863FF]/5 p-4">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-black uppercase tracking-widest text-white">
                <Paperclip size={16} className="text-[#0863FF]" /> Fotos e arquivos
              </h3>
              <label className="block cursor-pointer rounded-2xl border border-dashed border-[#0863FF]/30 bg-[#111418] p-4 text-center transition-all hover:border-[#0863FF]">
                <Upload className="mx-auto mb-2 text-[#0863FF]" size={22} />
                <span className="block text-sm font-black text-white">
                  {selectedFile ? selectedFile.name : 'Selecionar foto ou arquivo'}
                </span>
                <span className="mt-1 block text-[11px] font-bold text-[#8C95A3]">PNG, JPG, PDF ou documento do cliente</span>
                <input
                  type="file"
                  className="hidden"
                  onChange={(event) => setSelectedFile(event.target.files?.[0] || null)}
                />
              </label>
              <button
                disabled={!selectedFile || uploadingFile}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-[#0863FF] px-4 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50 hover:bg-opacity-90 transition-all shadow-md"
              >
                {uploadingFile ? <Loader2 className="animate-spin" size={16} /> : <Upload size={16} />} Anexar ao lead
              </button>
            </form>

            <form onSubmit={addTask} className="mb-5 rounded-[1.5rem] border border-white/[0.08] bg-[#161a20] p-4 shadow-sm">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-black uppercase tracking-widest text-white">
                <Plus size={16} className="text-[#0863FF]" /> Follow-up
              </h3>
              <input
                value={taskTitle}
                onChange={(event) => setTaskTitle(event.target.value)}
                placeholder="Ex: retornar amanha"
                className="mb-3 w-full rounded-2xl border border-white/[0.08] bg-[#111418] px-4 py-3 text-sm font-bold text-white placeholder-slate-500 focus:border-[#0863FF] focus:outline-none transition-all"
              />
              <input
                type="datetime-local"
                value={taskDue}
                onChange={(event) => setTaskDue(event.target.value)}
                className="mb-3 w-full rounded-2xl border border-white/[0.08] bg-[#111418] px-4 py-3 text-sm font-bold text-white focus:border-[#0863FF] focus:outline-none transition-all"
              />
              <button disabled={saving} className="w-full rounded-2xl bg-[#0863FF] py-3 text-sm font-black text-white hover:bg-opacity-90 transition-all shadow-md disabled:opacity-50">Criar lembrete</button>
            </form>

            {selectedTasks.length > 0 && (
              <div className="mb-5 space-y-2">
                <h3 className="text-sm font-black uppercase tracking-widest text-white">Tarefas abertas</h3>
                {selectedTasks.map((task) => (
                  <div key={task.id} className="rounded-2xl border border-white/[0.08] bg-[#161a20] p-4 shadow-sm">
                    <p className="text-sm font-semibold text-white">{task.titulo}</p>
                    <p className="mt-1.5 text-[11px] font-bold text-[#8C95A3]">{task.vencimento ? format(new Date(task.vencimento), 'dd/MM HH:mm', { locale: ptBR }) : 'Sem prazo'}</p>
                    <button onClick={() => completeTask(task.id)} className="mt-2.5 inline-flex items-center gap-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-emerald-400 hover:bg-emerald-500/15 transition-all">
                      <CheckCircle2 size={13} /> concluir
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div>
              <h3 className="mb-3 text-sm font-black uppercase tracking-widest text-white">Timeline</h3>
              <div className="max-h-64 space-y-3 overflow-y-auto pr-1 scrollbar-hidden">
                {atividades.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-white/[0.08] bg-[#161a20]/40 p-6 text-center text-sm font-bold text-[#8C95A3]">Nenhuma atividade registrada.</div>
                ) : atividades.map((activity) => (
                  <div key={activity.id} className="rounded-2xl border border-white/[0.08] bg-[#161a20] p-4 shadow-sm">
                    <div className="mb-1.5 flex items-center justify-between gap-3">
                      <p className="font-semibold text-white leading-tight">{activity.titulo}</p>
                      <span className="text-[10px] font-bold text-[#8C95A3] shrink-0">{format(new Date(activity.created_at), 'dd/MM HH:mm', { locale: ptBR })}</span>
                    </div>
                    {activity.descricao && (
                      activity.descricao.startsWith('http') ? (
                        <a href={activity.descricao} target="_blank" className="text-sm font-black text-[#0863FF] hover:underline transition-all">
                          Abrir arquivo anexado
                        </a>
                      ) : (
                        <p className="text-sm font-medium text-[#8C95A3] leading-relaxed">{activity.descricao}</p>
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
        <div className="mt-8 rounded-[22px] border border-emerald-500/20 bg-emerald-500/5 p-6 shadow-sm">
          <h3 className="mb-4 flex items-center gap-2 text-sm font-black uppercase tracking-widest text-emerald-400">
            <MessageSquare size={16} /> Inbox WhatsApp
          </h3>
          <div className="flex gap-3 overflow-x-auto scrollbar-hidden">
            {conversas.slice(0, 8).map((conversation) => (
              <div key={conversation.id} className="min-w-52 rounded-2xl border border-white/[0.08] bg-[#161a20] p-4 text-sm font-bold text-white shadow-sm hover:border-[#0863FF]/30 transition-all">
                {conversation.nome_contato || conversation.telefone}
              </div>
            ))}
          </div>
        </div>
      )}

      {commercialModal && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
          <form
            onSubmit={submitCommercialModal}
            className="w-full max-w-xl rounded-[22px] border border-white/[0.08] bg-[#111418] p-6 sm:p-8 shadow-2xl shadow-black/90 text-white"
          >
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-[#0863FF]">Dados comerciais</p>
                <h2 className="mt-1.5 text-2xl font-semibold tracking-tight text-white">Avançar para {getLeadStatusStyle(commercialModal.status).label}</h2>
                <p className="mt-1 text-sm font-bold text-[#8C95A3]">{commercialModal.lead.nome}</p>
              </div>
              <button
                type="button"
                onClick={() => closeCommercialModal(null)}
                className="rounded-xl bg-[#161a20] border border-white/[0.08] p-2.5 text-[#8C95A3] hover:text-white transition-all"
                aria-label="Fechar"
              >
                <X size={18} />
              </button>
            </div>

            {commercialModalError && (
              <div className="mb-5 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-400">
                {commercialModalError}
              </div>
            )}

            {commercialModal.status === 'Sem interesse' ? (
              <div className="grid gap-4">
                <label className="block">
                  <span className="mb-2 block text-[10px] font-black uppercase tracking-widest text-[#8C95A3]">Motivo</span>
                  <select
                    autoFocus
                    value={commercialModal.sem_interesse_motivo}
                    onChange={(event) => setCommercialModal((current) => current ? { ...current, sem_interesse_motivo: event.target.value } : current)}
                    className="w-full rounded-2xl border border-white/[0.08] bg-[#161a20] px-4 py-3 text-base font-bold text-white focus:border-[#0863FF] focus:outline-none transition-all"
                  >
                    <option value="">Selecione o motivo</option>
                    <option value="Preco acima do esperado">Preço acima do esperado</option>
                    <option value="Ja fechou com outro corretor">Já fechou com outro corretor</option>
                    <option value="Nao quer contratar agora">Não quer contratar agora</option>
                    <option value="Fora do perfil de atendimento">Fora do perfil de atendimento</option>
                    <option value="Nao respondeu apos tentativas">Não respondeu após tentativas</option>
                    <option value="Outro motivo">Outro motivo</option>
                  </select>
                </label>
                <label className="flex items-center justify-between gap-3 rounded-2xl border border-white/[0.08] bg-[#161a20] px-4 py-3">
                  <span className="text-sm font-black text-white">Chegou a fazer cotação?</span>
                  <input
                    type="checkbox"
                    checked={commercialModal.sem_interesse_fez_cotacao}
                    onChange={(event) => setCommercialModal((current) => current ? { ...current, sem_interesse_fez_cotacao: event.target.checked } : current)}
                    className="h-5 w-5 rounded border-white/[0.08] bg-[#111418] text-[#0863FF] focus:ring-[#0863FF]"
                  />
                </label>
                {commercialModal.sem_interesse_fez_cotacao && (
                  <label className="block">
                    <span className="mb-2 block text-[10px] font-black uppercase tracking-widest text-[#8C95A3]">Valor da cotação</span>
                    <input
                      value={commercialModal.valor_negociacao}
                      onChange={(event) => setCommercialModal((current) => current ? { ...current, valor_negociacao: event.target.value } : current)}
                      placeholder="Ex: 1200"
                      className="w-full rounded-2xl border border-white/[0.08] bg-[#161a20] px-4 py-3 text-base font-bold text-white placeholder-slate-500 focus:border-[#0863FF] focus:outline-none transition-all"
                    />
                  </label>
                )}
              </div>
            ) : (
              <div className="grid gap-4">
                <label className="block">
                  <span className="mb-2 block text-[10px] font-black uppercase tracking-widest text-[#8C95A3]">Valor da negociação</span>
                  <input
                    autoFocus
                    value={commercialModal.valor_negociacao}
                    onChange={(event) => setCommercialModal((current) => current ? { ...current, valor_negociacao: event.target.value } : current)}
                    placeholder="Ex: 1200"
                    className="w-full rounded-2xl border border-white/[0.08] bg-[#161a20] px-4 py-3 text-base font-bold text-white placeholder-slate-500 focus:border-[#0863FF] focus:outline-none transition-all"
                  />
                </label>

                <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-emerald-400">
                  <span className="mb-1 block text-[10px] font-black uppercase tracking-widest text-emerald-500/80">Comissão calculada automaticamente</span>
                  <p className="text-lg font-bold text-emerald-400">{formatCurrencyValue(calculateCommissionFromSale(commercialModal.valor_negociacao))}</p>
                  <p className="mt-1 text-xs font-medium text-emerald-500/70">250% sobre o valor da negociação.</p>
                </div>
              </div>
            )}

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => closeCommercialModal(null)}
                className="rounded-2xl border border-white/[0.08] bg-[#161a20] px-5 py-3 text-sm font-black text-[#8C95A3] hover:text-white transition-all"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="rounded-2xl bg-[#0863FF] px-5 py-3 text-sm font-black text-white shadow-lg shadow-[#0863FF]/20 transition hover:-translate-y-0.5 hover:bg-opacity-90"
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
    <div className="rounded-2xl border border-white/[0.08] bg-[#161a20] p-4">
      <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-[#8C95A3]">{label}</p>
      <p className="break-words text-sm font-semibold text-white">{value}</p>
    </div>
  );
}

function EditField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="mb-2 block text-[10px] font-black uppercase tracking-widest text-[#8C95A3]">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-2xl border border-white/[0.08] bg-[#161a20] px-4 py-3 text-sm font-bold text-white placeholder-slate-500 focus:border-[#0863FF] focus:outline-none transition-all"
      />
    </label>
  );
}

function EditSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="mb-2 block text-[10px] font-black uppercase tracking-widest text-[#8C95A3]">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-2xl border border-white/[0.08] bg-[#161a20] px-4 py-3 text-sm font-bold text-white focus:border-[#0863FF] focus:outline-none transition-all"
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
  const isStale = label === 'Sem resposta';
  const isTasks = label === 'Tarefas';
  const isToday = label === 'Hoje';
  const isFit = label === 'Fit ICP';

  let customBadgeClass = '';
  if (active) {
    customBadgeClass = 'bg-[#0863FF] border-[#0863FF] text-white shadow-lg shadow-[#0863FF]/20';
  } else {
    customBadgeClass = 'bg-[#111418] border-white/[0.08] hover:bg-[#161a20] hover:-translate-y-0.5 text-slate-400';
  }

  let textValueColor = active ? 'text-white' : 'text-white';
  let iconColor = '';
  if (!active) {
    if (isStale) iconColor = 'text-amber-500';
    else if (isTasks) iconColor = 'text-[#0863FF]';
    else if (isToday) iconColor = 'text-emerald-400';
    else if (isFit) iconColor = 'text-violet-400';
    else iconColor = 'text-slate-400';
  } else {
    iconColor = 'text-white';
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-[22px] border p-5 text-left shadow-sm transition-all focus:outline-none cursor-pointer flex flex-col justify-between min-h-[110px] ${customBadgeClass}`}
    >
      <p className="mb-2.5 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest leading-none">
        <Icon size={14} className={`animate-pulse ${iconColor}`} /> {label}
      </p>
      <p className={`text-3xl font-semibold tracking-tight ${textValueColor}`}>{value}</p>
    </button>
  );
}
