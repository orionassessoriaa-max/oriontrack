'use client';

import { useState, useEffect, Suspense, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { createPortal } from 'react-dom';
import InternalLayout from '@/components/layout/InternalLayout';
import { 
  Building2,
  Users,
  Search, 
  Filter,
  Loader2,
  Copy,
  Eye,
  Link2,
  ShieldAlert,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  UserPlus,
  Edit2,
  Plus,
  Trash2,
  X,
  CheckCircle2,
  KeyRound
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { Corretor, Profile } from '@/types';
import Link from 'next/link';
import { useAuth } from '@/components/providers/AuthProvider';
import { useDialog } from '@/components/providers/DialogProvider';
import { getGestorConcessionariaNames, isGestorLinkedToConcessionariaCorretor, isGestorLinkedToCorretor, normalizeAccessText } from '@/lib/gestorAccess';
import { buildOperationalTeamMembers, getTeamMemberAvatar, isTrafficManagerMember, OrionTeamMember } from '@/lib/orionTeam';
import { generateOrionEmail } from '@/lib/users';
import {
  audienceIncludesRole,
  leadDistributionAudienceLabels,
  leadDistributionModelLabels,
  normalizeLeadDistributionAudience,
  normalizeLeadDistributionModel,
  type LeadDistributionAudience,
  type LeadDistributionModel,
} from '@/lib/leadDistribution';

interface CorretoraGroup {
  id: string; // ID of the first corretor/profile in the group
  nome: string; // Company name (nome_empresa) or corretor's individual name
  is_empresa: boolean;
  corretoresRows: Corretor[];
  profiles: Profile[];
  meta_ad_account_name?: string | null;
  meta_ad_account_id?: string | null;
  status: string;
  empty?: boolean;
  corretora_id?: string | null;
  modo_operacao?: OperationMode;
  distribuicao_modelo?: LeadDistributionModel;
  distribuicao_publico?: LeadDistributionAudience;
  gestor_trafego_id?: string | null;
}

interface CorretoraRecord {
  id: string;
  nome: string;
  descricao?: string | null;
  status?: string | null;
  meta_ad_account_id?: string | null;
  meta_ad_account_name?: string | null;
  modo_operacao?: OperationMode | null;
  time_operacional?: OrionTeamMember[] | null;
  gestor_trafego_id?: string | null;
  distribuicao_modelo?: LeadDistributionModel | null;
  distribuicao_publico?: LeadDistributionAudience | null;
}

type BatchPersonRole = 'corretor_admin' | 'corretor_membro';

type BatchPerson = {
  id: string;
  nome: string;
  telefone: string;
  tipo_usuario: BatchPersonRole;
  recebe_leads: boolean;
  distribuicao_rotas: Array<{ id: string; peso: number }>;
};

type BrokerageRouteDraft = { id: string; nome: string; termos: string; fallback: boolean };

type CreatedCredential = {
  nome: string;
  tipo_usuario: string;
  email: string;
  senha_provisoria: string;
  link_login: string;
};

const createBatchPerson = (tipo_usuario: BatchPersonRole = 'corretor_admin'): BatchPerson => ({
  id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
  nome: '',
  telefone: '',
  tipo_usuario,
  recebe_leads: true,
  distribuicao_rotas: [],
});

const createRouteDraft = (nome = '', termos = ''): BrokerageRouteDraft => ({
  id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `rota-${Date.now()}-${Math.random()}`,
  nome,
  termos,
  fallback: false,
});

const emptyBrokerageForm = () => ({
  nome: '',
  descricao: '',
  time_operacional: [] as OrionTeamMember[],
  pessoas: [createBatchPerson()] as BatchPerson[],
  distribuicao_modelo: 'rodizio' as LeadDistributionModel,
  distribuicao_publico: 'todos' as LeadDistributionAudience,
  distribuicao_rotas: [createRouteDraft('PME', 'pme'), createRouteDraft('Individual', 'individual'), createRouteDraft('Adesao', 'adesao, adesão')] as BrokerageRouteDraft[],
});

const formatPhone = (value: string) => {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 2) return digits ? `(${digits}` : '';
  if (digits.length <= 7) return `(${digits.slice(0, 2)})${digits.slice(2)}`;
  return `(${digits.slice(0, 2)})${digits.slice(2, 7)}-${digits.slice(7)}`;
};

type OperationMode = 'individual' | 'grupo_rodizio' | 'grupo_rodizio_admin';

const operationModeLabels: Record<OperationMode, string> = {
  individual: 'Individual',
  grupo_rodizio: 'Grupo com rodizio',
  grupo_rodizio_admin: 'Grupo com rodizio + visao geral admin',
};

function normalizeOperationMode(value: unknown): OperationMode {
  return value === 'grupo_rodizio' || value === 'grupo_rodizio_admin' ? value : 'individual';
}

type CorretoraMember = {
  key: string;
  nome: string;
  email: string;
  email_real?: string | null;
  telefone?: string | null;
  status?: string | null;
  tipo_usuario?: string | null;
  foto_url?: string | null;
  profile_id?: string | null;
  corretor_id?: string | null;
  has_profile: boolean;
};

function getCorretoraMembers(group: CorretoraGroup): CorretoraMember[] {
  const members: CorretoraMember[] = [];
  const usedCorretorIds = new Set<string>();
  const usedEmails = new Set<string>();

  group.profiles.forEach((profile) => {
    const corretorRow = group.corretoresRows.find((row) => row.id === profile.corretor_id);
    const email = profile.email_real || profile.email || corretorRow?.email || '';
    members.push({
      key: `profile:${profile.id}`,
      nome: profile.nome,
      email,
      email_real: profile.email_real,
      // O perfil guarda o telefone individual. `corretorRow` representa a
      // concessionaria compartilhada e nao pode emprestar o mesmo numero para
      // todos os integrantes do grupo.
      telefone: profile.telefone || null,
      status: profile.status,
      tipo_usuario: profile.tipo_usuario,
      foto_url: profile.foto_url,
      profile_id: profile.id,
      corretor_id: profile.corretor_id,
      has_profile: true,
    });

    if (profile.corretor_id) usedCorretorIds.add(profile.corretor_id);
    if (email) usedEmails.add(email.trim().toLowerCase());
  });

  group.corretoresRows.forEach((corretor) => {
    const email = corretor.email || '';
    const normalizedEmail = email.trim().toLowerCase();
    if (usedCorretorIds.has(corretor.id) || (normalizedEmail && usedEmails.has(normalizedEmail))) {
      return;
    }

    members.push({
      key: `corretor:${corretor.id}`,
      nome: corretor.nome,
      email,
      telefone: corretor.telefone,
      status: corretor.status,
      tipo_usuario: null,
      foto_url: null,
      profile_id: null,
      corretor_id: corretor.id,
      has_profile: false,
    });
  });

  return members.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

function groupData(corretoresList: Corretor[], profilesList: Profile[], corretorasList: CorretoraRecord[] = []): CorretoraGroup[] {
  const groups: { [key: string]: CorretoraGroup } = {};

  corretorasList.forEach((corretora) => {
    const name = String(corretora.nome || '').trim();
    if (!name) return;
    const key = `empresa:${name.toLowerCase()}`;
    groups[key] = {
      id: corretora.id,
      nome: name,
      is_empresa: true,
      corretoresRows: [],
      profiles: [],
      meta_ad_account_id: corretora.meta_ad_account_id || null,
      meta_ad_account_name: corretora.meta_ad_account_name || null,
      status: corretora.status || 'ativo',
      empty: true,
      corretora_id: corretora.id,
      modo_operacao: normalizeOperationMode(corretora.modo_operacao),
      distribuicao_modelo: normalizeLeadDistributionModel(corretora.distribuicao_modelo),
      distribuicao_publico: normalizeLeadDistributionAudience(corretora.distribuicao_publico),
      gestor_trafego_id: corretora.gestor_trafego_id || null,
    };
  });

  // Initialize from corretores table
  corretoresList.forEach((c) => {
    const key = c.nome_empresa ? `empresa:${c.nome_empresa.trim().toLowerCase()}` : `individual:${c.id}`;
    const name = c.nome_empresa ? c.nome_empresa.trim() : c.nome;

    if (!groups[key]) {
      groups[key] = {
        id: c.id,
        nome: name,
        is_empresa: !!c.nome_empresa,
        corretoresRows: [],
        profiles: [],
        meta_ad_account_name: c.meta_ad_account_name,
        meta_ad_account_id: c.meta_ad_account_id,
        status: c.status || 'ativo',
        empty: false,
        corretora_id: null,
        modo_operacao: 'individual',
        distribuicao_modelo: 'rodizio',
        distribuicao_publico: 'todos',
        gestor_trafego_id: c.gestor_trafego_id || null,
      };
    }

    groups[key].empty = false;
    groups[key].corretoresRows.push(c);
    if (!groups[key].gestor_trafego_id && c.gestor_trafego_id) {
      groups[key].gestor_trafego_id = c.gestor_trafego_id;
    }
    if (c.meta_ad_account_name && !groups[key].meta_ad_account_name) {
      groups[key].meta_ad_account_name = c.meta_ad_account_name;
      groups[key].meta_ad_account_id = c.meta_ad_account_id;
    }
  });

  // Assign profiles to groups
  profilesList.forEach((p) => {
    let key = '';
    
    if (p.corretor_id) {
      const corretor = corretoresList.find((c) => c.id === p.corretor_id);
      if (corretor) {
        key = corretor.nome_empresa ? `empresa:${corretor.nome_empresa.trim().toLowerCase()}` : `individual:${corretor.id}`;
      } else {
        key = p.nome_empresa ? `empresa:${p.nome_empresa.trim().toLowerCase()}` : `profile:${p.id}`;
      }
    } else {
      key = p.nome_empresa ? `empresa:${p.nome_empresa.trim().toLowerCase()}` : `profile:${p.id}`;
    }

    const name = p.nome_empresa ? p.nome_empresa.trim() : p.nome;

    if (!groups[key]) {
      groups[key] = {
        id: p.corretor_id || p.id,
        nome: name,
        is_empresa: !!p.nome_empresa,
        corretoresRows: [],
        profiles: [],
        meta_ad_account_name: null,
        meta_ad_account_id: null,
        status: p.status || 'active',
        empty: false,
        corretora_id: null,
        modo_operacao: 'individual',
        distribuicao_modelo: 'rodizio',
        distribuicao_publico: 'todos',
        gestor_trafego_id: null,
      };
    }

    groups[key].empty = false;
    // Avoid duplicate profiles in the same brokerage group
    if (!groups[key].profiles.some((existing) => existing.id === p.id)) {
      groups[key].profiles.push(p);
    }
  });

  return Object.values(groups).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

function CorretorasContent() {
  const { profile, startViewingAsCorretor } = useAuth();
  const { confirmDialog } = useDialog();
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialGestorId = searchParams.get('gestor');

  const [corretores, setCorretores] = useState<Corretor[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [gestores, setGestores] = useState<Profile[]>([]);
  const [orionTeamProfiles, setOrionTeamProfiles] = useState<Profile[]>([]);
  const [corretorasCadastradas, setCorretorasCadastradas] = useState<CorretoraRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all'); // all, empresa, individual
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [creatingBrokerage, setCreatingBrokerage] = useState(false);
  const [newBrokerage, setNewBrokerage] = useState(emptyBrokerageForm);
  const [createBrokerageError, setCreateBrokerageError] = useState<string | null>(null);
  const [createdCredentials, setCreatedCredentials] = useState<CreatedCredential[]>([]);
  const [migrationPending, setMigrationPending] = useState(false);
  const [savingDistribution, setSavingDistribution] = useState<string | null>(null);
  const [savingGestor, setSavingGestor] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [deletingBrokerageId, setDeletingBrokerageId] = useState<string | null>(null);
  const isAdmin = profile?.tipo_usuario === 'admin';

  useEffect(() => {
    setMounted(true);
  }, []);

  async function fetchData() {
    setLoading(true);
    setError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      const [corretoresRes, profilesRes, gestoresRes, orionTeamRes, corretorasRes] = await Promise.all([
        supabase
          .from('corretores')
          .select('*')
          .order('nome'),
        supabase
          .from('profiles')
          .select('*')
          .in('tipo_usuario', ['corretor', 'corretor_admin', 'corretor_membro'])
          .order('nome'),
        supabase
          .from('profiles')
          .select('*')
          .eq('tipo_usuario', 'gestor_trafego')
          .in('status', ['active', 'ativo', 'Ativo'])
          .order('nome'),
        supabase
          .from('profiles')
          .select('*')
          .in('tipo_usuario', ['gestor_trafego', 'account_manager', 'designer', 'admin'])
          .in('status', ['active', 'ativo', 'Ativo'])
          .order('nome'),
        token ? fetch('/api/admin/corretoras', {
          headers: { Authorization: `Bearer ${token}` }
        }) : Promise.resolve(null)
      ]);

      if (corretoresRes.error) throw corretoresRes.error;
      if (profilesRes.error) throw profilesRes.error;
      if (gestoresRes.error) throw gestoresRes.error;
      if (orionTeamRes.error) throw orionTeamRes.error;

      let loadedCorretoras: CorretoraRecord[] = [];
      if (corretorasRes) {
        const payload = await corretorasRes.json().catch(() => ({}));
        if (corretorasRes.ok) {
          loadedCorretoras = payload.corretoras || [];
          setMigrationPending(Boolean(payload.migration_pending));
        } else if (payload.migration_pending) {
          setMigrationPending(true);
        }
      }

      if (loadedCorretoras.length === 0) {
        const { data: directCorretoras, error: directCorretorasError } = await supabase
          .from('corretoras')
          .select('*')
          .order('nome');

        if (!directCorretorasError) {
          loadedCorretoras = directCorretoras || [];
          setMigrationPending(false);
        }
      }

      let loadedCorretores = corretoresRes.data || [];
      let loadedProfiles = profilesRes.data || [];
      const loadedGestores = gestoresRes.data || [];

      if (profile?.tipo_usuario === 'gestor_trafego') {
        loadedCorretores = loadedCorretores.filter((corretor) => isGestorLinkedToConcessionariaCorretor(corretor, profile));
        const concessionariaNames = getGestorConcessionariaNames(loadedCorretores, profile);
        const linkedCorretorIds = new Set(loadedCorretores.map((corretor) => corretor.id));

        loadedProfiles = loadedProfiles.filter((item) => {
          const profileCompany = normalizeAccessText(item.nome_empresa);
          return (item.corretor_id && linkedCorretorIds.has(item.corretor_id))
            || (Boolean(profileCompany) && concessionariaNames.has(profileCompany));
        });

        loadedCorretoras = loadedCorretoras.filter((item) => concessionariaNames.has(normalizeAccessText(item.nome)));
      } else if (profile?.tipo_usuario === 'admin' && initialGestorId) {
        let concessionariaNames = new Set<string>();
        if (initialGestorId === 'sem-gestor') {
          const activeManagerIds = new Set(loadedGestores.map((gestor) => gestor.id));
          const managedConcessionariaNames = new Set<string>();

          loadedCorretoras.forEach((corretora) => {
            const directManagerIsActive = Boolean(
              corretora.gestor_trafego_id && activeManagerIds.has(corretora.gestor_trafego_id)
            );
            const teamHasActiveManager = Array.isArray(corretora.time_operacional) && corretora.time_operacional.some((member) =>
              isTrafficManagerMember(member) && Boolean(member.profile_id && activeManagerIds.has(member.profile_id))
            );
            if (directManagerIsActive || teamHasActiveManager) {
              const name = normalizeAccessText(corretora.nome);
              if (name) managedConcessionariaNames.add(name);
            }
          });

          loadedCorretores.forEach((corretor) => {
            const name = normalizeAccessText(corretor.nome_empresa);
            if (name && loadedGestores.some((gestor) => isGestorLinkedToCorretor(corretor, gestor))) {
              managedConcessionariaNames.add(name);
            }
          });

          const allConcessionariaNames = new Set([
            ...loadedCorretoras.map((corretora) => normalizeAccessText(corretora.nome)),
            ...loadedCorretores.map((corretor) => normalizeAccessText(corretor.nome_empresa)),
          ].filter(Boolean));
          concessionariaNames = new Set(
            [...allConcessionariaNames].filter((name) => !managedConcessionariaNames.has(name))
          );
          loadedCorretores = loadedCorretores.filter((corretor) =>
            concessionariaNames.has(normalizeAccessText(corretor.nome_empresa))
          );
        } else {
          const selectedGestor = loadedGestores.find((gestor) => gestor.id === initialGestorId);
          if (selectedGestor) {
            loadedCorretores.forEach((corretor) => {
              if (isGestorLinkedToConcessionariaCorretor(corretor, selectedGestor)) {
                const name = normalizeAccessText(corretor.nome_empresa);
                if (name) concessionariaNames.add(name);
              }
            });
            loadedCorretoras.forEach((corretora) => {
              const linkedDirectly = corretora.gestor_trafego_id === selectedGestor.id;
              const linkedInTeam = Array.isArray(corretora.time_operacional) && corretora.time_operacional.some((member) =>
                member.profile_id === selectedGestor.id && isTrafficManagerMember(member)
              );
              if (linkedDirectly || linkedInTeam) {
                const name = normalizeAccessText(corretora.nome);
                if (name) concessionariaNames.add(name);
              }
            });
            loadedCorretores = loadedCorretores.filter((corretor) =>
              concessionariaNames.has(normalizeAccessText(corretor.nome_empresa))
            );
          } else {
            loadedCorretores = [];
          }
        }

        const linkedCorretorIds = new Set(loadedCorretores.map((corretor) => corretor.id));
        loadedProfiles = loadedProfiles.filter((item) => {
          const profileCompany = normalizeAccessText(item.nome_empresa);
          return (item.corretor_id && linkedCorretorIds.has(item.corretor_id))
            || (Boolean(profileCompany) && concessionariaNames.has(profileCompany));
        });

        loadedCorretoras = loadedCorretoras.filter((item) => concessionariaNames.has(normalizeAccessText(item.nome)));
      }

      setCorretorasCadastradas(loadedCorretoras);
      setCorretores(loadedCorretores);
      setProfiles(loadedProfiles);
      setGestores(loadedGestores);
      setOrionTeamProfiles(orionTeamRes.data || []);
    } catch (err: unknown) {
      console.error('Error fetching data:', err);
      setError("Erro ao carregar dados do banco de dados.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (profile && profile.tipo_usuario !== 'admin' && profile.tipo_usuario !== 'gestor_trafego') {
      router.push('/dashboard');
      return;
    }
    
    void Promise.resolve().then(fetchData);
  }, [profile, initialGestorId]);

  const corretoras = useMemo(() => {
    return groupData(corretores, profiles, corretorasCadastradas);
  }, [corretores, profiles, corretorasCadastradas]);

  const orionTeamMembers = useMemo(
    () => buildOperationalTeamMembers(orionTeamProfiles),
    [orionTeamProfiles]
  );

  const filteredCorretoras = useMemo(() => {
    return corretoras.filter((c) => {
      const term = search.toLowerCase();
      const members = getCorretoraMembers(c);
      const matchesSearch = 
        c.nome.toLowerCase().includes(term) ||
        (c.meta_ad_account_name || '').toLowerCase().includes(term) ||
        members.some((member) => member.nome.toLowerCase().includes(term) || member.email.toLowerCase().includes(term));

      const matchesType = 
        typeFilter === 'all' || 
        (typeFilter === 'empresa' && c.is_empresa) ||
        (typeFilter === 'individual' && !c.is_empresa);

      return matchesSearch && matchesType;
    });
  }, [corretoras, search, typeFilter]);

  const activeGestorName = initialGestorId === 'sem-gestor'
    ? 'Sem gestor definido'
    : gestores.find((gestor) => gestor.id === initialGestorId)?.nome;

  const clearGestorFilter = () => {
    router.push('/admin/corretoras');
  };

  const changeGestorFilter = (gestorId: string) => {
    router.push(gestorId === 'all'
      ? '/admin/corretoras'
      : `/admin/corretoras?gestor=${encodeURIComponent(gestorId)}`
    );
  };

  const toggleExpand = (id: string) => {
    setExpandedGroups(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  const updateDistributionModel = async (group: CorretoraGroup, model: LeadDistributionModel) => {
    const corretoraId = group.corretora_id || (group.empty ? group.id : null);
    if (!corretoraId) return alert('Cadastre a concessionária antes de alterar a distribuição.');
    setSavingDistribution(group.id);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('Sessão expirada.');
      const response = await fetch('/api/admin/corretoras', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          id: corretoraId,
          distribuicao_modelo: model,
          distribuicao_publico: normalizeLeadDistributionAudience(group.distribuicao_publico),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Não foi possível atualizar a distribuição.');
      setCorretorasCadastradas((current) => current.map((item) => item.id === corretoraId ? { ...item, distribuicao_modelo: model } : item));
    } catch (err: any) {
      alert(err.message || 'Não foi possível atualizar a distribuição.');
    } finally {
      setSavingDistribution(null);
    }
  };

  const updateTrafficManager = async (group: CorretoraGroup, gestorId: string) => {
    const corretoraId = group.corretora_id || (group.empty ? group.id : null);
    if (!corretoraId) return alert('Cadastre a concessionaria antes de alterar o gestor.');
    setSavingGestor(group.id);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('Sessao expirada.');
      const response = await fetch('/api/admin/corretoras', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id: corretoraId, gestor_trafego_id: gestorId || null }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Nao foi possivel atualizar o gestor.');
      await fetchData();
    } catch (err: any) {
      alert(err.message || 'Nao foi possivel atualizar o gestor.');
    } finally {
      setSavingGestor(null);
    }
  };

  const copyId = (id: string) => {
    navigator.clipboard.writeText(id);
    alert('ID copiado para usar no n8n.');
  };

  const createBrokerage = async (event: React.FormEvent) => {
    event.preventDefault();
    setCreatingBrokerage(true);
    setError(null);
    setCreateBrokerageError(null);
    try {
      const nome = newBrokerage.nome.trim().replace(/\s+/g, ' ');
      const descricao = newBrokerage.descricao.trim() || null;
      if (!nome) throw new Error('Informe o nome da concessionaria.');
      if (newBrokerage.pessoas.length === 0) throw new Error('Adicione pelo menos uma pessoa.');
      const invalidPerson = newBrokerage.pessoas.find((person) =>
        !person.nome.trim() || person.telefone.replace(/\D/g, '').length !== 11
      );
      if (invalidPerson) throw new Error('Preencha nome e telefone completo de todas as pessoas.');
      const administrators = newBrokerage.pessoas.filter((person) => person.tipo_usuario === 'corretor_admin');
      if (administrators.length === 0) {
        throw new Error('Defina pelo menos uma pessoa como Administrador da concessionaria.');
      }

      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('Sessao expirada.');

      const response = await fetch('/api/admin/corretoras', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          nome,
          descricao,
          modo_operacao: 'individual',
          distribuicao_modelo: newBrokerage.distribuicao_modelo,
          distribuicao_publico: newBrokerage.distribuicao_publico,
          distribuicao_regras: newBrokerage.distribuicao_rotas.filter((route) => route.nome.trim()).map((route, index) => ({
            id: route.id,
            nome: route.nome.trim(),
            termos: route.termos.split(',').map((term) => term.trim().toLowerCase()).filter(Boolean),
            fallback: route.fallback,
            ativo: true,
            prioridade: index + 1,
            membros: [],
          })),
          time_operacional: newBrokerage.time_operacional,
          gestor_trafego_id: newBrokerage.time_operacional.find(isTrafficManagerMember)?.profile_id || null,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (payload.migration_pending) setMigrationPending(true);
        throw new Error(payload.error || 'Erro ao criar concessionaria.');
      }
      if (payload.already_exists) {
        throw new Error('Esta concessionaria ja existe. Abra o cadastro existente para adicionar novos corretores.');
      }

      const createdCorretora: CorretoraRecord | null = payload.corretora || null;
      if (createdCorretora) {
        setCorretorasCadastradas((current) => {
          const withoutDuplicate = current.filter((item) => item.nome.trim().toLowerCase() !== createdCorretora!.nome.trim().toLowerCase());
          return [...withoutDuplicate, createdCorretora!].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
        });
      }

      const orderedPeople = [
        administrators[0],
        ...newBrokerage.pessoas.filter((person) => person.id !== administrators[0].id),
      ];
      const credentials: CreatedCredential[] = [];
      const participantProfileIds: string[] = [];
      for (let index = 0; index < orderedPeople.length; index += 1) {
        const person = orderedPeople[index];
        const isPrimaryAdministrator = index === 0;
        const userResponse = await fetch('/api/admin/usuarios', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            nome: person.nome.trim(),
            telefone: person.telefone,
            tipo_usuario: isPrimaryAdministrator ? 'corretor' : person.tipo_usuario,
            nome_empresa: nome,
            email: generateOrionEmail(person.nome),
            tipo_campanha: 'ambos',
            participa_rodizio: person.recebe_leads,
            distribuicao_rotas: person.distribuicao_rotas,
            time_operacional: isPrimaryAdministrator ? newBrokerage.time_operacional : undefined,
            gestor_trafego_id: isPrimaryAdministrator
              ? newBrokerage.time_operacional.find(isTrafficManagerMember)?.profile_id || null
              : undefined,
          }),
        });
        const userPayload = await userResponse.json().catch(() => ({}));
        if (!userResponse.ok) {
          throw new Error(
            `A concessionaria foi criada, mas o acesso de ${person.nome} falhou: ${userPayload.error || 'erro desconhecido'}`
          );
        }
        credentials.push({
          nome: person.nome.trim(),
          tipo_usuario: isPrimaryAdministrator ? 'corretor' : person.tipo_usuario,
          ...userPayload.credentials,
        });
        if (person.recebe_leads && userPayload.user?.id) participantProfileIds.push(userPayload.user.id);
        setCreatedCredentials([...credentials]);
      }

      if (createdCorretora?.id) {
        const distributionResponse = await fetch('/api/admin/corretoras', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            id: createdCorretora.id,
            distribuicao_modelo: newBrokerage.distribuicao_modelo,
            distribuicao_publico: newBrokerage.distribuicao_publico,
            participantes_profile_ids: participantProfileIds,
          }),
        });
        const distributionPayload = await distributionResponse.json().catch(() => ({}));
        if (!distributionResponse.ok) throw new Error(distributionPayload.error || 'Os acessos foram criados, mas a distribuição não foi sincronizada.');
      }

      setCreatedCredentials(credentials);
      setNewBrokerage(emptyBrokerageForm());
      setCreateModalOpen(false);
      await fetchData();
    } catch (err: any) {
      setCreateBrokerageError(err.message || 'Erro ao criar concessionaria.');
    } finally {
      setCreatingBrokerage(false);
    }
  };

  const updateBatchPerson = (id: string, updates: Partial<BatchPerson>) => {
    setNewBrokerage((current) => ({
      ...current,
      pessoas: current.pessoas.map((person) => person.id === id ? { ...person, ...updates } : person),
    }));
  };

  const selectDistributionAudience = (audience: LeadDistributionAudience) => {
    setNewBrokerage((current) => ({
      ...current,
      distribuicao_publico: audience,
      pessoas: current.pessoas.map((person) => ({
        ...person,
        recebe_leads: audience === 'personalizado' ? person.recebe_leads : audienceIncludesRole(audience, person.tipo_usuario),
      })),
    }));
  };

  const removeBatchPerson = (id: string) => {
    setNewBrokerage((current) => ({
      ...current,
      pessoas: current.pessoas.filter((person) => person.id !== id),
    }));
  };

  const copyCreatedCredentials = async () => {
    if (createdCredentials.length === 0) return;
    const text = createdCredentials.map((credential) => [
      credential.nome,
      `Perfil: ${credential.tipo_usuario === 'corretor_membro' ? 'Corretor integrante' : 'Administrador'}`,
      `Login: ${credential.email}`,
      `Senha provisoria: ${credential.senha_provisoria}`,
      `Acesse: ${credential.link_login}`,
    ].join('\n')).join('\n\n');
    await navigator.clipboard.writeText(text);
  };

  const deleteBrokerage = async (group: CorretoraGroup) => {
    const corretoraId = group.corretora_id || (group.empty ? group.id : null);
    if (!corretoraId) {
      alert('Esta concessionaria ainda nao possui cadastro proprio para excluir.');
      return;
    }

    const members = getCorretoraMembers(group);
    const confirmed = await confirmDialog(
      members.length > 0
        ? `A concessionaria ${group.nome} tem ${members.length} corretor(es). Para proteger os dados, mova ou remova os corretores antes de excluir.`
        : `Excluir a concessionaria ${group.nome}?`,
      {
        title: members.length > 0 ? 'Concessionaria com vinculos' : 'Excluir concessionaria',
        confirmLabel: members.length > 0 ? 'Entendi' : 'Excluir',
        cancelLabel: members.length > 0 ? undefined : 'Cancelar',
        variant: members.length > 0 ? 'info' : 'danger',
      }
    );

    if (!confirmed || members.length > 0) return;

    setDeletingBrokerageId(corretoraId);
    setError(null);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('Sessao expirada.');

      const response = await fetch(`/api/admin/corretoras?id=${encodeURIComponent(corretoraId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Erro ao excluir concessionaria.');

      setCorretorasCadastradas((current) => current.filter((item) => item.id !== corretoraId));
      await fetchData();
    } catch (err: any) {
      setError(err.message || 'Erro ao excluir concessionaria.');
    } finally {
      setDeletingBrokerageId(null);
    }
  };

  const newCorretorHref = (nomeEmpresa?: string) => {
    const params = new URLSearchParams({ tipo: 'corretor' });
    if (nomeEmpresa) params.set('corretora', nomeEmpresa);
    return `/admin/usuarios?${params.toString()}`;
  };

  return (
    <InternalLayout>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-10">
        <div>
          <h1 className="text-3xl font-black text-gray-900 tracking-tight flex items-center gap-3">
            <Building2 className="text-blue-600" size={32} /> Concessionarias
          </h1>
          <p className="text-gray-500 font-medium">Visualizacao agrupada de concessionarias e corretores associados.</p>
        </div>
        {isAdmin && (
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              onClick={() => setCreateModalOpen(true)}
              className="bg-cyan-500 text-slate-950 px-8 py-4 rounded-2xl font-black flex items-center justify-center gap-2 hover:bg-cyan-400 transition-all shadow-xl shadow-cyan-500/20"
            >
              <Plus size={20} /> Nova Concessionaria
            </button>
            <Link
              href="/admin/usuarios?tipo=corretor"
              className="bg-blue-600 text-white px-8 py-4 rounded-2xl font-black flex items-center justify-center gap-2 hover:bg-blue-700 transition-all shadow-xl shadow-blue-600/20"
            >
              <UserPlus size={20} /> Novo Corretor
            </Link>
          </div>
        )}
      </div>

      {migrationPending && (
        <div className="mb-6 rounded-2xl border border-amber-400/20 bg-amber-400/10 p-4 text-sm font-bold text-amber-300">
          O cadastro de concessionarias ainda precisa da migration no Supabase. A listagem antiga continua funcionando, mas concessionarias vazias so aparecem apos aplicar a migration.
        </div>
      )}

      {createdCredentials.length > 0 && (
        <section aria-live="polite" className="mb-6 rounded-[2rem] border border-emerald-400/30 bg-emerald-500/10 p-5 shadow-lg shadow-emerald-950/10">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-400/15 text-emerald-300">
                <CheckCircle2 size={22} />
              </div>
              <div>
                <p className="text-sm font-black text-emerald-200">{createdCredentials.length} acesso(s) criado(s)</p>
                <p className="mt-1 text-xs font-bold text-emerald-100/70">Copie todos os logins e senhas provisórias em um único bloco.</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={copyCreatedCredentials} className="inline-flex min-h-11 items-center gap-2 rounded-2xl bg-emerald-400 px-5 py-3 text-xs font-black text-emerald-950 transition hover:bg-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-300">
                <Copy size={16} /> Copiar todos os acessos
              </button>
              <button type="button" onClick={() => setCreatedCredentials([])} className="min-h-11 rounded-2xl border border-emerald-300/20 px-4 py-3 text-xs font-black text-emerald-100 transition hover:bg-white/5">
                Fechar
              </button>
            </div>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {createdCredentials.map((credential) => (
              <div key={credential.email} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <p className="truncate text-sm font-black text-white">{credential.nome}</p>
                <p className="mt-1 text-[10px] font-black uppercase tracking-widest text-emerald-300">
                  {credential.tipo_usuario === 'corretor_membro' ? 'Corretor integrante' : 'Administrador'}
                </p>
                <p className="mt-3 break-all text-xs font-bold text-slate-300">{credential.email}</p>
                <p className="mt-2 flex items-center gap-2 text-sm font-black text-white"><KeyRound size={14} /> {credential.senha_provisoria}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {isAdmin && initialGestorId && (
        <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-cyan-400/20 bg-cyan-500/10 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-cyan-300">Filtro por gestor ativo</p>
            <p className="mt-1 text-sm font-black text-white">{activeGestorName || 'Gestor nao encontrado'}</p>
          </div>
          <button
            type="button"
            onClick={clearGestorFilter}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-slate-200 hover:bg-white/5"
          >
            <X size={14} /> Ver todas
          </button>
        </div>
      )}

      {isAdmin && mounted && createModalOpen && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-start justify-center overflow-y-auto bg-[#020617]/95 px-4 pb-8 pt-24 backdrop-blur-md sm:items-center sm:py-8">
          <form onSubmit={createBrokerage} className="w-full max-w-5xl max-h-[calc(100vh-7rem)] overflow-y-auto rounded-[2rem] border border-cyan-400/20 bg-[#090e1a] p-6 shadow-2xl shadow-cyan-950/50">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-cyan-400">Cadastro de concessionaria</p>
                <h2 className="mt-1 text-2xl font-black text-white">Nova concessionaria</h2>
                <p className="mt-1 text-xs font-bold text-slate-400">Defina o time responsável e crie todos os acessos da concessionária de uma vez.</p>
              </div>
              <button type="button" onClick={() => setCreateModalOpen(false)} className="rounded-xl bg-white/5 p-2 text-slate-400 hover:text-white">
                <X size={18} />
              </button>
            </div>
            <div className="space-y-4">
              {createBrokerageError && (
                <div className="rounded-2xl border border-rose-400/20 bg-rose-500/10 p-3 text-xs font-bold text-rose-300">
                  {createBrokerageError}
                </div>
              )}
              <div>
                <label className="ml-1 text-[10px] font-black uppercase tracking-widest text-slate-500">Nome da concessionaria</label>
                <input
                  value={newBrokerage.nome}
                  onChange={(event) => setNewBrokerage((current) => ({ ...current, nome: event.target.value }))}
                  required
                  placeholder="Ex: B2L Concessionaria"
                  className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-5 py-4 text-sm font-bold text-white outline-none focus:border-cyan-400"
                />
              </div>
              <div>
                <label className="ml-1 text-[10px] font-black uppercase tracking-widest text-slate-500">Observacao interna</label>
                <textarea
                  value={newBrokerage.descricao}
                  onChange={(event) => setNewBrokerage((current) => ({ ...current, descricao: event.target.value }))}
                  rows={3}
                  placeholder="Opcional"
                  className="mt-2 w-full resize-none rounded-2xl border border-white/10 bg-black/30 px-5 py-4 text-sm font-bold text-white outline-none focus:border-cyan-400"
                />
              </div>
              <fieldset className="rounded-[1.5rem] border border-white/10 bg-black/20 p-4">
                <legend className="px-2 text-[10px] font-black uppercase tracking-widest text-cyan-400">Time Orion responsável</legend>
                <p className="mb-4 text-xs font-bold text-slate-400">Este time será aplicado à concessionária e usado por todos os acessos vinculados.</p>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {orionTeamMembers.map((member) => {
                    const selected = newBrokerage.time_operacional.some((item) => item.profile_id === member.profile_id || item.nome === member.nome);
                    const avatar = getTeamMemberAvatar(member);
                    return (
                      <button
                        key={member.profile_id || member.nome}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => setNewBrokerage((current) => ({
                          ...current,
                          time_operacional: selected
                            ? current.time_operacional.filter((item) => (item.profile_id || item.nome) !== (member.profile_id || member.nome))
                            : [
                                ...current.time_operacional.filter((item) => isTrafficManagerMember(member) ? !isTrafficManagerMember(item) : true),
                                member,
                              ],
                        }))}
                        className={`min-h-14 rounded-2xl border px-3 py-3 text-left transition focus:outline-none focus:ring-2 focus:ring-cyan-300 ${selected ? 'border-cyan-300 bg-cyan-400 text-slate-950' : 'border-white/10 bg-white/5 text-slate-200 hover:bg-white/10'}`}
                      >
                        <span className="flex items-center gap-3">
                          <span className={`flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl ${selected ? 'bg-slate-950/15' : 'bg-black/30'}`}>
                            {avatar ? <img src={avatar} alt="" className="h-full w-full object-cover object-top" /> : member.nome.slice(0, 1)}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-xs font-black">{member.nome}</span>
                            <span className={`mt-1 block truncate text-[10px] font-bold ${selected ? 'text-slate-800' : 'text-slate-400'}`}>{member.cargo}</span>
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <fieldset className="rounded-[1.5rem] border border-cyan-400/20 bg-cyan-500/[0.04] p-4">
                <legend className="px-2 text-[10px] font-black uppercase tracking-widest text-cyan-400">Distribuição de novos leads</legend>
                <p className="mb-4 text-xs font-bold text-slate-400">Esta é a configuração principal. Notificações e Meu Time serão preenchidos automaticamente.</p>
                <div className="grid gap-3 md:grid-cols-2">
                  {(Object.entries(leadDistributionModelLabels) as [LeadDistributionModel, string][]).map(([value, label]) => {
                    const selected = newBrokerage.distribuicao_modelo === value;
                    return (
                      <button key={value} type="button" aria-pressed={selected} onClick={() => setNewBrokerage((current) => ({ ...current, distribuicao_modelo: value }))} className={`min-h-20 rounded-2xl border p-4 text-left transition focus:outline-none focus:ring-2 focus:ring-cyan-300 ${selected ? 'border-cyan-300 bg-cyan-400 text-slate-950' : 'border-white/10 bg-white/5 text-white hover:bg-white/10'}`}>
                        <span className="block text-sm font-black">{label}</span>
                        <span className={`mt-1 block text-[11px] font-bold ${selected ? 'text-slate-800' : 'text-slate-400'}`}>{value === 'rodizio' ? 'O sistema entrega cada lead ao próximo participante.' : 'Todos veem o lead; a primeira resposta humana assume o atendimento.'}</span>
                      </button>
                    );
                  })}
                </div>
                <p className="mb-2 mt-5 text-[10px] font-black uppercase tracking-widest text-slate-500">Quem recebe novos leads</p>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {(Object.entries(leadDistributionAudienceLabels) as [LeadDistributionAudience, string][]).map(([value, label]) => (
                    <button key={value} type="button" aria-pressed={newBrokerage.distribuicao_publico === value} onClick={() => selectDistributionAudience(value)} className={`min-h-11 rounded-xl border px-3 py-3 text-xs font-black transition focus:outline-none focus:ring-2 focus:ring-cyan-300 ${newBrokerage.distribuicao_publico === value ? 'border-cyan-300 bg-cyan-400/20 text-cyan-200' : 'border-white/10 bg-black/20 text-slate-300 hover:bg-white/10'}`}>
                      {label}
                    </button>
                  ))}
                </div>
              </fieldset>

              <fieldset className="rounded-[1.5rem] border border-violet-400/20 bg-violet-500/[0.04] p-4">
                <legend className="px-2 text-[10px] font-black uppercase tracking-widest text-violet-300">Separação por tipo de lead</legend>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="max-w-2xl">
                    <p className="text-sm font-black text-white">Como o sistema escolhe para qual grupo enviar o lead?</p>
                    <p className="mt-1 text-xs font-bold leading-5 text-slate-400">Ele procura palavras no nome da campanha ou do conjunto de anúncios. Quando encontra uma palavra cadastrada, usa a rota correspondente.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setNewBrokerage((current) => ({ ...current, distribuicao_rotas: [...current.distribuicao_rotas, createRouteDraft()] }))}
                    className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-2xl border border-violet-300/20 bg-violet-400/10 px-4 py-3 text-xs font-black text-violet-200 transition hover:bg-violet-400/20 focus:outline-none focus:ring-2 focus:ring-violet-300"
                  >
                    <Plus size={15} /> Adicionar rota
                  </button>
                </div>

                <div className="mt-4 grid gap-2 rounded-2xl border border-violet-300/15 bg-violet-400/[0.06] p-3 sm:grid-cols-3">
                  {[
                    ['1', 'O lead chega', 'O sistema lê campanha e conjunto.'],
                    ['2', 'Procura as palavras', 'Ex.: “pme”, “individual” ou “adesão”.'],
                    ['3', 'Escolhe a rota', 'Sem combinação, usa a rota reserva.'],
                  ].map(([step, title, description]) => (
                    <div key={step} className="flex gap-3 rounded-xl bg-black/20 p-3">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-400/20 text-xs font-black text-violet-200">{step}</span>
                      <span>
                        <span className="block text-xs font-black text-white">{title}</span>
                        <span className="mt-1 block text-[11px] font-bold leading-4 text-slate-400">{description}</span>
                      </span>
                    </div>
                  ))}
                </div>

                <div className="mt-4 space-y-3">
                  {newBrokerage.distribuicao_rotas.map((route, routeIndex) => {
                    const firstTerm = route.termos.split(',').map((term) => term.trim()).find(Boolean);
                    const routeName = route.nome.trim() || `Rota ${routeIndex + 1}`;

                    return (
                      <div key={route.id} className={`rounded-2xl border p-4 ${route.fallback ? 'border-violet-300/35 bg-violet-400/[0.08]' : 'border-white/10 bg-black/20'}`}>
                        <div className="mb-4 flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <span className="rounded-full bg-white/5 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-slate-400">Rota {routeIndex + 1}</span>
                            {route.fallback && <span className="rounded-full bg-violet-400/20 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-violet-200">Rota reserva</span>}
                          </div>
                          <button type="button" aria-label={`Remover rota ${route.nome || routeIndex + 1}`} onClick={() => setNewBrokerage((current) => ({
                            ...current,
                            distribuicao_rotas: current.distribuicao_rotas.filter((item) => item.id !== route.id),
                            pessoas: current.pessoas.map((person) => ({ ...person, distribuicao_rotas: person.distribuicao_rotas.filter((item) => item.id !== route.id) })),
                          }))} className="flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-rose-400/20 text-rose-300 transition hover:bg-rose-500/10 focus:outline-none focus:ring-2 focus:ring-rose-300">
                            <Trash2 size={16} />
                          </button>
                        </div>

                        <div className="grid gap-4 lg:grid-cols-[minmax(180px,0.7fr)_minmax(280px,1.3fr)_minmax(230px,0.8fr)] lg:items-start">
                          <div>
                            <label htmlFor={`route-name-${route.id}`} className="ml-1 text-[10px] font-black uppercase tracking-widest text-slate-400">Nome do grupo</label>
                            <input id={`route-name-${route.id}`} value={route.nome} onChange={(event) => setNewBrokerage((current) => ({ ...current, distribuicao_rotas: current.distribuicao_rotas.map((item) => item.id === route.id ? { ...item, nome: event.target.value } : item) }))} placeholder="Ex.: PME" className="mt-2 min-h-11 w-full rounded-xl border border-white/10 bg-[#111827] px-4 py-3 text-sm font-black text-white outline-none focus:border-violet-300 focus:ring-2 focus:ring-violet-300/20" />
                            <p className="mt-2 text-[11px] font-bold leading-4 text-slate-500">Este nome aparecerá na distribuição para a equipe.</p>
                          </div>
                          <div>
                            <label htmlFor={`route-terms-${route.id}`} className="ml-1 text-[10px] font-black uppercase tracking-widest text-slate-400">Quais palavras identificam este grupo?</label>
                            <input id={`route-terms-${route.id}`} aria-describedby={`route-terms-help-${route.id}`} value={route.termos} onChange={(event) => setNewBrokerage((current) => ({ ...current, distribuicao_rotas: current.distribuicao_rotas.map((item) => item.id === route.id ? { ...item, termos: event.target.value } : item) }))} placeholder="Ex.: pme, empresarial, cnpj" className="mt-2 min-h-11 w-full rounded-xl border border-white/10 bg-[#111827] px-4 py-3 text-sm font-bold text-white outline-none focus:border-violet-300 focus:ring-2 focus:ring-violet-300/20" />
                            <p id={`route-terms-help-${route.id}`} className="mt-2 text-[11px] font-bold leading-4 text-slate-500">Separe as palavras por vírgulas. O sistema procura qualquer uma delas na campanha ou conjunto.</p>
                          </div>
                          <label className={`flex min-h-[76px] cursor-pointer items-start justify-between gap-3 rounded-xl border px-4 py-3 transition focus-within:ring-2 focus-within:ring-violet-300 ${route.fallback ? 'border-violet-300/40 bg-violet-400/10' : 'border-white/10 bg-black/30 hover:bg-white/5'}`}>
                            <span>
                              <span className="block text-xs font-black text-white">Usar como rota reserva</span>
                              <span className="mt-1 block text-[11px] font-bold leading-4 text-slate-400">Recebe o lead quando nenhuma palavra combinar.</span>
                            </span>
                            <input type="checkbox" checked={route.fallback} onChange={(event) => setNewBrokerage((current) => ({ ...current, distribuicao_rotas: current.distribuicao_rotas.map((item) => ({ ...item, fallback: item.id === route.id ? event.target.checked : false })) }))} className="mt-1 h-5 w-5 shrink-0 rounded border-slate-500 text-violet-500 focus:ring-violet-400" />
                          </label>
                        </div>

                        {(firstTerm || route.fallback) && (
                          <p className="mt-4 rounded-xl border border-white/5 bg-black/20 px-3 py-2 text-[11px] font-bold leading-5 text-slate-300">
                            {firstTerm ? <>Exemplo: se a campanha contiver <strong className="text-violet-200">“{firstTerm}”</strong>, o lead vai para <strong className="text-white">{routeName}</strong>.</> : null}
                            {firstTerm && route.fallback ? ' ' : null}
                            {route.fallback ? <>Se nenhuma rota combinar, o lead também vai para <strong className="text-white">{routeName}</strong>.</> : null}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
                <p className="mt-3 text-[11px] font-bold leading-5 text-slate-500">Dica: marque somente uma rota como reserva. Ela evita que leads sem uma palavra conhecida fiquem sem destino.</p>
              </fieldset>

              <fieldset className="rounded-[1.5rem] border border-white/10 bg-black/20 p-4">
                <legend className="px-2 text-[10px] font-black uppercase tracking-widest text-cyan-400">Acessos da concessionária</legend>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xs font-bold text-slate-400">Informe nome, telefone e o nível de acesso de cada pessoa.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setNewBrokerage((current) => ({ ...current, pessoas: [...current.pessoas, createBatchPerson('corretor_membro')] }))}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-3 text-xs font-black text-cyan-300 transition hover:bg-cyan-400/20 focus:outline-none focus:ring-2 focus:ring-cyan-300"
                  >
                    <UserPlus size={16} /> Adicionar pessoa
                  </button>
                </div>
                <div className="mt-4 space-y-3">
                  {newBrokerage.pessoas.map((person, index) => (
                    <div key={person.id} className="grid gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3 md:grid-cols-[1fr_180px_190px_155px_48px] md:items-end">
                      <div>
                        <label htmlFor={`batch-name-${person.id}`} className="ml-1 text-[10px] font-black uppercase tracking-widest text-slate-500">Nome completo</label>
                        <input id={`batch-name-${person.id}`} required value={person.nome} onChange={(event) => updateBatchPerson(person.id, { nome: event.target.value })} placeholder={`Pessoa ${index + 1}`} className="mt-2 min-h-11 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm font-bold text-white outline-none focus:border-cyan-400" />
                      </div>
                      <div>
                        <label htmlFor={`batch-phone-${person.id}`} className="ml-1 text-[10px] font-black uppercase tracking-widest text-slate-500">Telefone</label>
                        <input id={`batch-phone-${person.id}`} required inputMode="tel" value={person.telefone} onChange={(event) => updateBatchPerson(person.id, { telefone: formatPhone(event.target.value) })} placeholder="(61)99999-9999" maxLength={14} className="mt-2 min-h-11 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm font-bold text-white outline-none focus:border-cyan-400" />
                      </div>
                      <div>
                        <label htmlFor={`batch-role-${person.id}`} className="ml-1 text-[10px] font-black uppercase tracking-widest text-slate-500">Tipo de usuário</label>
                        <select id={`batch-role-${person.id}`} value={person.tipo_usuario} onChange={(event) => {
                          const role = event.target.value as BatchPersonRole;
                          updateBatchPerson(person.id, {
                            tipo_usuario: role,
                            recebe_leads: newBrokerage.distribuicao_publico === 'personalizado' ? person.recebe_leads : audienceIncludesRole(newBrokerage.distribuicao_publico, role),
                          });
                        }} className="mt-2 min-h-11 w-full rounded-xl border border-white/10 bg-[#111827] px-4 py-3 text-sm font-black text-white outline-none focus:border-cyan-400">
                          <option value="corretor_admin">Administrador</option>
                          <option value="corretor_membro">Corretor integrante</option>
                        </select>
                      </div>
                      <label className="flex min-h-11 cursor-pointer items-center justify-between gap-2 rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-[11px] font-black text-slate-200">
                        Recebe leads
                        <input type="checkbox" checked={person.recebe_leads} onChange={(event) => {
                          setNewBrokerage((current) => ({
                            ...current,
                            distribuicao_publico: 'personalizado',
                            pessoas: current.pessoas.map((item) => item.id === person.id ? { ...item, recebe_leads: event.target.checked } : item),
                          }));
                        }} className="h-5 w-5 rounded border-slate-500 text-cyan-500 focus:ring-cyan-400" />
                      </label>
                      <button type="button" aria-label={`Remover ${person.nome || `pessoa ${index + 1}`}`} disabled={newBrokerage.pessoas.length === 1} onClick={() => removeBatchPerson(person.id)} className="flex min-h-11 items-center justify-center rounded-xl border border-rose-400/20 text-rose-300 transition hover:bg-rose-500/10 focus:outline-none focus:ring-2 focus:ring-rose-300 disabled:cursor-not-allowed disabled:opacity-30">
                        <Trash2 size={16} />
                      </button>
                      {newBrokerage.distribuicao_rotas.some((route) => route.nome.trim()) && (
                        <div className="md:col-span-5 rounded-2xl border border-violet-300/15 bg-violet-500/[0.05] p-3">
                          <p className="text-[10px] font-black uppercase tracking-widest text-violet-300">Rotas que esta pessoa recebe</p>
                          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                            {newBrokerage.distribuicao_rotas.filter((route) => route.nome.trim()).map((route) => {
                              const membership = person.distribuicao_rotas.find((item) => item.id === route.id);
                              return (
                                <div key={route.id} className={`flex min-h-12 items-center gap-3 rounded-xl border px-3 py-2 ${membership ? 'border-violet-300/40 bg-violet-400/10' : 'border-white/10 bg-black/20'}`}>
                                  <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-xs font-black text-white">
                                    <input type="checkbox" checked={Boolean(membership)} onChange={(event) => updateBatchPerson(person.id, {
                                      distribuicao_rotas: event.target.checked
                                        ? [...person.distribuicao_rotas, { id: route.id, peso: 1 }]
                                        : person.distribuicao_rotas.filter((item) => item.id !== route.id),
                                    })} className="h-5 w-5 rounded border-slate-500 text-violet-500 focus:ring-violet-400" />
                                    <span className="truncate">{route.nome}</span>
                                  </label>
                                  {membership && (
                                    <label className="flex items-center gap-2 text-[10px] font-black uppercase text-slate-400">
                                      Peso
                                      <input type="number" min={1} max={10} value={membership.peso} onChange={(event) => updateBatchPerson(person.id, {
                                        distribuicao_rotas: person.distribuicao_rotas.map((item) => item.id === route.id ? { ...item, peso: Math.max(1, Math.min(10, Number(event.target.value) || 1)) } : item),
                                      })} className="h-9 w-14 rounded-lg border border-white/10 bg-[#111827] px-2 text-center text-xs font-black text-white outline-none focus:border-violet-300" />
                                    </label>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </fieldset>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setCreateModalOpen(false)} className="rounded-2xl border border-white/10 px-6 py-3 text-xs font-black text-slate-300">
                Cancelar
              </button>
              <button type="submit" disabled={creatingBrokerage} className="flex items-center gap-2 rounded-2xl bg-cyan-500 px-6 py-3 text-xs font-black text-slate-950 disabled:opacity-60">
                {creatingBrokerage ? <Loader2 className="animate-spin" size={16} /> : <Plus size={16} />} Criar concessionaria e acessos
              </button>
            </div>
          </form>
        </div>,
        document.body
      )}

      {/* Estatísticas */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="orion-panel p-6 bg-gradient-to-br from-blue-50 to-white dark:from-slate-900/50 dark:to-slate-900/10 border-blue-100/50">
          <p className="text-[10px] font-black uppercase tracking-widest text-blue-600 mb-1">Total de Concessionarias</p>
          <p className="text-3xl font-black text-gray-900">{corretoras.length}</p>
        </div>
        <div className="orion-panel p-6 bg-gradient-to-br from-emerald-50 to-white dark:from-slate-900/50 dark:to-slate-900/10 border-emerald-100/50">
          <p className="text-[10px] font-black uppercase tracking-widest text-emerald-600 mb-1">Empresas / Grupos</p>
          <p className="text-3xl font-black text-gray-900">{corretoras.filter(c => c.is_empresa).length}</p>
        </div>
        <div className="orion-panel p-6 bg-gradient-to-br from-purple-50 to-white dark:from-slate-900/50 dark:to-slate-900/10 border-purple-100/50">
          <p className="text-[10px] font-black uppercase tracking-widest text-purple-600 mb-1">Corretores Individuais</p>
          <p className="text-3xl font-black text-gray-900">{corretoras.filter(c => !c.is_empresa).length}</p>
        </div>
      </div>

      {/* Painel de Filtros */}
      <div className="orion-panel mb-8 p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
          <div className={`${isAdmin ? 'md:col-span-6' : 'md:col-span-8'} relative group`}>
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-blue-500 transition-colors" size={18} />
            <input 
              type="text"
              placeholder="Buscar por concessionaria, conta Meta ou corretor..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="orion-control w-full py-4 pl-12 pr-4 font-medium"
            />
          </div>
          {isAdmin && (
            <div className="relative md:col-span-3">
              <Users className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <select
                value={initialGestorId || 'all'}
                onChange={(event) => changeGestorFilter(event.target.value)}
                className="orion-control min-h-12 w-full cursor-pointer appearance-none py-4 pl-12 pr-10 font-bold"
                aria-label="Filtrar concessionarias por gestor"
              >
                <option value="all">Todos os gestores</option>
                <option value="sem-gestor">Sem gestor definido</option>
                {gestores.map((gestor) => (
                  <option key={gestor.id} value={gestor.id}>{gestor.nome}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            </div>
          )}
          <div className={`${isAdmin ? 'md:col-span-3' : 'md:col-span-4'} relative`}>
            <Filter className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <select 
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="orion-control min-h-12 w-full cursor-pointer appearance-none py-4 pl-12 pr-10 font-bold"
              aria-label="Filtrar concessionarias por tipo"
            >
              <option value="all">Todas</option>
              <option value="empresa">Apenas Empresas/Grupos</option>
              <option value="individual">Apenas Corretores Individuais</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
          </div>
        </div>
      </div>

      {/* Conteúdo Principal */}
      <div className="space-y-4">
        {loading ? (
          <div className="orion-panel p-24 flex justify-center items-center">
            <Loader2 className="animate-spin text-blue-600" size={40} />
          </div>
        ) : error ? (
          <div className="orion-panel p-24 text-center">
            <div className="w-16 h-16 bg-red-50 text-red-600 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <ShieldAlert size={32} />
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">Erro</h3>
            <p className="text-red-500 font-medium max-w-md mx-auto mb-6">{error}</p>
            <button 
              onClick={fetchData}
              className="inline-flex items-center gap-2 text-blue-600 font-black uppercase tracking-widest text-xs hover:underline"
            >
              <RefreshCw size={14} /> Recarregar
            </button>
          </div>
        ) : filteredCorretoras.length === 0 ? (
          <div className="orion-panel p-24 text-center">
            <div className="w-20 h-20 bg-slate-50 rounded-[2rem] flex items-center justify-center mx-auto mb-6 text-slate-300">
              <Building2 size={40} />
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-1">Nenhuma concessionaria encontrada</h3>
            <p className="text-gray-500 font-medium">
              {isAdmin ? 'Ajuste os filtros ou crie uma nova concessionaria.' : 'Nenhuma concessionaria foi vinculada a sua gestao.'}
            </p>
          </div>
        ) : (
          filteredCorretoras.map((c) => {
            const isExpanded = !!expandedGroups[c.id];
            const members = getCorretoraMembers(c);
            return (
              <div 
                key={c.id} 
                className="orion-panel overflow-hidden border border-gray-100/80 bg-white transition-all shadow-sm duration-200"
              >
                {/* Cabecalho da concessionaria */}
                <div 
                  onClick={() => toggleExpand(c.id)}
                  className="p-6 flex flex-col md:flex-row md:items-center justify-between gap-4 cursor-pointer hover:bg-slate-50/50 transition-colors select-none"
                >
                  <div className="flex items-center gap-4 min-w-0">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center font-black text-white shrink-0 ${
                      c.is_empresa 
                        ? 'bg-gradient-to-br from-blue-500 to-indigo-600' 
                        : 'bg-gradient-to-br from-slate-400 to-slate-600'
                    }`}>
                      {c.is_empresa ? <Building2 size={22} /> : <Users size={22} />}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="text-lg font-bold text-gray-950 truncate max-w-[280px]">{c.nome}</h2>
                        <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest ${
                          c.is_empresa 
                            ? 'bg-blue-50 text-blue-700 border border-blue-100' 
                            : 'bg-slate-100 text-slate-600 border border-slate-200'
                        }`}>
                          {c.is_empresa ? 'Empresa' : 'Individual'}
                        </span>
                      </div>
                      <p className="text-xs font-medium text-slate-400 mt-1 flex items-center gap-1.5">
                        <Users size={13} className="text-slate-300" />
                        {members.length} {members.length === 1 ? 'corretor' : 'corretores'}
                      </p>
                      {members.length > 0 && (
                        <p className="text-[10px] font-black uppercase tracking-widest text-emerald-500 mt-2 truncate max-w-[420px]">
                          Corretores: {members.map((member) => member.nome).join(', ')}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-4 flex-wrap md:flex-nowrap justify-between md:justify-end">
                    {isAdmin && (
                      <div
                        onClick={(event) => event.stopPropagation()}
                        className="flex min-w-[210px] flex-col gap-1"
                      >
                        <label htmlFor={`gestor-${c.id}`} className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                          Gestor de trafego
                        </label>
                        <select
                          id={`gestor-${c.id}`}
                          value={c.gestor_trafego_id || ''}
                          disabled={savingGestor === c.id}
                          onChange={(event) => void updateTrafficManager(c, event.target.value)}
                          className="min-h-10 rounded-xl border border-violet-500/20 bg-violet-500/10 px-3 text-[11px] font-black uppercase tracking-widest text-violet-700 outline-none focus:ring-2 focus:ring-violet-400 disabled:cursor-wait disabled:opacity-60 dark:bg-[#111827] dark:text-violet-300"
                        >
                          <option value="">Sem gestor definido</option>
                          {gestores.map((gestor) => (
                            <option key={gestor.id} value={gestor.id}>{gestor.nome}</option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div
                      onClick={(event) => event.stopPropagation()}
                      className="flex min-w-[230px] flex-col gap-1"
                    >
                      <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Distribuição definida na concessionária</span>
                      {isAdmin ? (
                        <select value={normalizeLeadDistributionModel(c.distribuicao_modelo)} disabled={savingDistribution === c.id} onChange={(event) => void updateDistributionModel(c, event.target.value as LeadDistributionModel)} className="min-h-10 rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-3 text-[11px] font-black uppercase tracking-widest text-cyan-700 outline-none focus:ring-2 focus:ring-cyan-400 dark:bg-[#111827] dark:text-cyan-300">
                          {(Object.entries(leadDistributionModelLabels) as [LeadDistributionModel, string][]).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                      ) : (
                        <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1.5 text-[11px] font-black uppercase tracking-widest text-cyan-700 dark:text-cyan-300">{leadDistributionModelLabels[normalizeLeadDistributionModel(c.distribuicao_modelo)]}</span>
                      )}
                      <span className="text-[10px] font-bold text-slate-400">{leadDistributionAudienceLabels[normalizeLeadDistributionAudience(c.distribuicao_publico)]}</span>
                      {isAdmin && c.corretoresRows[0]?.id && (
                        <Link
                          href={`/admin/corretores/${c.corretoresRows[0].id}/time`}
                          onClick={(event) => event.stopPropagation()}
                          className="mt-1 inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-cyan-500 transition hover:text-cyan-300"
                        >
                          <Users size={12} /> Definir quem recebe e a visão inicial
                        </Link>
                      )}
                    </div>

                    {isAdmin && (
                      <Link
                        href={newCorretorHref(c.nome)}
                        onClick={(event) => event.stopPropagation()}
                        className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-3.5 py-1.5 text-xs font-black uppercase tracking-widest text-white transition hover:bg-blue-500"
                      >
                        <UserPlus size={13} /> Adicionar corretor
                      </Link>
                    )}

                    {isAdmin && c.corretora_id && (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          void deleteBrokerage(c);
                        }}
                        disabled={deletingBrokerageId === c.corretora_id}
                        className="inline-flex items-center gap-2 rounded-full border border-rose-500/20 bg-rose-500/10 px-3.5 py-1.5 text-xs font-black uppercase tracking-widest text-rose-300 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {deletingBrokerageId === c.corretora_id ? <Loader2 className="animate-spin" size={13} /> : <Trash2 size={13} />}
                        Excluir
                      </button>
                    )}

                    {/* Conta Meta Vinculada */}
                    {c.meta_ad_account_name ? (
                      <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3.5 py-1.5 text-xs font-black uppercase tracking-widest text-emerald-700 border border-emerald-100">
                        <Link2 size={13} /> {c.meta_ad_account_name}
                      </div>
                    ) : (
                      <div className="inline-flex items-center gap-2 rounded-full bg-slate-50 px-3.5 py-1.5 text-xs font-black uppercase tracking-widest text-slate-400 border border-slate-100">
                        Sem Conta Meta
                      </div>
                    )}

                    <div className="text-slate-400 hover:text-gray-900 transition-colors">
                      {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                    </div>
                  </div>
                </div>

                {/* Lista de Corretores (Expandida) */}
                {isExpanded && (
                  <div className="border-t border-gray-100/10 bg-slate-950/[0.03] dark:bg-slate-950/40 px-6 py-4 animate-in fade-in slide-in-from-top-2 duration-200">
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[700px] text-left border-collapse">
                        <thead>
                          <tr className="border-b border-gray-100/10">
                            <th className="py-3 text-[10px] font-black text-gray-400 uppercase tracking-widest">Nome do Corretor</th>
                            <th className="py-3 text-[10px] font-black text-gray-400 uppercase tracking-widest">E-mail Orion</th>
                            <th className="py-3 text-[10px] font-black text-gray-400 uppercase tracking-widest">Telefone</th>
                            <th className="py-3 text-[10px] font-black text-gray-400 uppercase tracking-widest text-center">Status</th>
                            <th className="py-3 text-[10px] font-black text-gray-400 uppercase tracking-widest text-right">Ações</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100/10">
                          {members.map((member) => {
                            const phone = member.telefone || 'Sem telefone';
                            return (
                              <tr key={member.key} className="hover:bg-slate-950/[0.02] dark:hover:bg-slate-900/30 transition-colors">
                                <td className="py-4">
                                  <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center font-bold text-white text-sm shrink-0 overflow-hidden">
                                      {member.foto_url ? (
                                        <img src={member.foto_url} alt={member.nome} className="h-full w-full object-cover object-top" />
                                      ) : (
                                        member.nome[0].toUpperCase()
                                      )}
                                    </div>
                                    <div>
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <p className="font-bold text-gray-900 text-sm">{member.nome}</p>
                                        <span className={`px-2 py-0.5 rounded-md text-[8px] font-black uppercase tracking-widest border ${
                                          member.tipo_usuario === 'corretor' 
                                            ? 'bg-blue-50 text-blue-700 border-blue-100 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/20' 
                                            : member.tipo_usuario === 'corretor_admin'
                                            ? 'bg-cyan-50 text-cyan-700 border-cyan-100 dark:bg-cyan-500/10 dark:text-cyan-400 dark:border-cyan-500/20'
                                            : 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700'
                                        }`}>
                                          {member.tipo_usuario === 'corretor' 
                                            ? 'Corretor Admin' 
                                            : member.tipo_usuario === 'corretor_admin' 
                                            ? 'Corretor Admin' 
                                            : member.has_profile
                                            ? 'Corretor integrante'
                                            : 'Cadastro sem acesso'}
                                        </span>
                                      </div>
                                      {member.email_real && (
                                        <p className="text-[10px] text-gray-400 font-medium mt-0.5">Real: {member.email_real}</p>
                                      )}
                                    </div>
                                  </div>
                                </td>
                                <td className="py-4 text-xs font-semibold text-slate-600">{member.email || 'Sem e-mail'}</td>
                                <td className="py-4 text-xs font-semibold text-slate-600">{phone}</td>
                                <td className="py-4 text-center">
                                  <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border ${
                                    (member.status?.toLowerCase() === 'active' || member.status?.toLowerCase() === 'ativo')
                                      ? "bg-green-50 text-green-600 border-green-100" 
                                      : "bg-red-50 text-red-600 border-red-100"
                                  }`}>
                                    {(member.status?.toLowerCase() === 'active' || member.status?.toLowerCase() === 'ativo') ? 'Ativo' : 'Inativo'}
                                  </span>
                                </td>
                                <td className="py-4 text-right">
                                  <div className="flex items-center justify-end gap-1">
                                    {member.corretor_id && (
                                      <button
                                        type="button"
                                        onClick={() => startViewingAsCorretor(member.corretor_id!, member.profile_id)}
                                        className="cursor-pointer p-2.5 text-slate-400 transition-all hover:bg-emerald-50 hover:text-emerald-600 rounded-lg"
                                        title="Entrar como corretor"
                                      >
                                        <Eye size={16} />
                                      </button>
                                    )}
                                    <Link 
                                      href={member.profile_id ? `/admin/usuarios?edit=${member.profile_id}` : `/admin/corretores/${member.corretor_id}/editar`}
                                      className="cursor-pointer p-2.5 text-slate-400 transition-all hover:bg-blue-50 hover:text-blue-600 rounded-lg"
                                      title="Editar Usuário"
                                    >
                                      <Edit2 size={16} />
                                    </Link>
                                    <button
                                      type="button"
                                      onClick={() => copyId(member.corretor_id || member.profile_id || member.key)}
                                      className="cursor-pointer p-2.5 text-slate-400 transition-all hover:bg-slate-100 rounded-lg"
                                      title="Copiar ID para n8n"
                                    >
                                      <Copy size={16} />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </InternalLayout>
  );
}

export default function AdminCorretorasPage() {
  return (
    <Suspense fallback={
      <InternalLayout>
        <div className="flex items-center justify-center h-screen">
          <Loader2 className="animate-spin text-blue-600" size={40} />
        </div>
      </InternalLayout>
    }>
      <CorretorasContent />
    </Suspense>
  );
}
