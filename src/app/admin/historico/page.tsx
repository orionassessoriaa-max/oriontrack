'use client';

import { useEffect, useMemo, useState } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/components/providers/AuthProvider';
import { Activity, Clock3, Database, Loader2, RefreshCw, Search, ShieldCheck, UserRound } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

type AuditLog = {
  id: string;
  actor_profile_id: string | null;
  actor_email: string | null;
  actor_role: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  metadata: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
};

const ACTION_LABELS: Record<string, string> = {
  'user.create': 'Usuario criado',
  'user.update': 'Usuario editado',
  'user.password.reset': 'Nova senha gerada',
  'user.delete': 'Usuario removido',
  'lead.delete': 'Lead removido',
  'lead.status.update': 'Status do lead alterado',
  'team.name.update': 'Nome do time alterado',
  'team.owner.toggle': 'Dono do time atualizado',
  'team.member.create': 'Integrante criado',
  'team.member.update': 'Integrante editado',
  'team.member.delete': 'Integrante removido',
  'team.lead.assign': 'Lead enviado ao time',
  'lead.cadence.start': 'Cadencia iniciada',
  'lead.cadence.stop': 'Cadencia encerrada',
  'whatsapp.terms.accept': 'Aceite WhatsApp registrado',
  'whatsapp.connect.request': 'Conexao WhatsApp iniciada',
  'whatsapp.message.send': 'Mensagem enviada',
};

const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin',
  corretor: 'Admin',
  corretor_membro: 'Corretor integrante',
  gestor_trafego: 'Gestor',
  designer: 'Designer',
  account_manager: 'Account',
};

function getActionLabel(action: string) {
  return ACTION_LABELS[action] || action;
}

function getRoleLabel(role?: string | null) {
  return role ? ROLE_LABELS[role] || role : 'Sistema';
}

function getMetadataPreview(metadata?: Record<string, unknown> | null) {
  if (!metadata) return [];

  const keys = [
    'email',
    'member_email',
    'member_name',
    'nome',
    'role',
    'removed_role',
    'status',
    'corretor_id',
    'lead_id',
    'member_id',
    'removed_access',
  ];

  return keys
    .filter((key) => metadata[key] !== undefined && metadata[key] !== null && metadata[key] !== '')
    .map((key) => ({ key, value: String(metadata[key]) }));
}

export default function AdminHistoricoPage() {
  const { profile } = useAuth();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('all');

  async function fetchLogs() {
    setLoading(true);
    setError(null);

    const { data, error: logsError } = await supabase
      .from('audit_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);

    if (logsError) {
      setError(logsError.message || 'Nao foi possivel carregar o historico.');
      setLoading(false);
      return;
    }

    setLogs((data || []) as AuditLog[]);
    setLoading(false);
  }

  useEffect(() => {
    void fetchLogs();
  }, []);

  const actions = useMemo(() => {
    return Array.from(new Set(logs.map((log) => log.action))).sort();
  }, [logs]);

  const filteredLogs = useMemo(() => {
    const term = search.trim().toLowerCase();

    return logs.filter((log) => {
      const matchesAction = actionFilter === 'all' || log.action === actionFilter;
      const metadata = JSON.stringify(log.metadata || {}).toLowerCase();
      const searchable = [
        log.actor_email,
        log.actor_role,
        log.action,
        getActionLabel(log.action),
        log.entity_type,
        log.entity_id,
        metadata,
      ].filter(Boolean).join(' ').toLowerCase();

      return matchesAction && (!term || searchable.includes(term));
    });
  }, [logs, search, actionFilter]);

  const todayCount = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return logs.filter((log) => log.created_at?.startsWith(today)).length;
  }, [logs]);

  if (profile?.tipo_usuario && profile.tipo_usuario !== 'admin') {
    return (
      <InternalLayout>
        <div className="orion-panel p-8">
          <p className="text-sm font-black uppercase tracking-widest text-red-500">Acesso negado</p>
          <h1 className="mt-2 text-3xl font-black text-slate-950">Historico exclusivo do admin</h1>
        </div>
      </InternalLayout>
    );
  }

  return (
    <InternalLayout>
      <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.28em] text-blue-600">Admin</p>
          <h1 className="mt-2 text-3xl font-black text-slate-950 dark:text-white">Historico de modificacoes</h1>
          <p className="mt-2 text-base font-semibold text-slate-600 dark:text-slate-300">
            Acompanhe criacoes, remocoes, alteracoes de leads, times e acessos.
          </p>
        </div>
        <button
          onClick={() => fetchLogs()}
          className="inline-flex items-center justify-center gap-2 bg-blue-600 px-5 py-3 text-sm font-black uppercase tracking-widest text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700"
        >
          <RefreshCw size={16} /> Atualizar
        </button>
      </div>

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <div className="orion-panel p-5">
          <Clock3 className="text-blue-600" size={22} />
          <p className="mt-4 text-xs font-black uppercase tracking-widest text-slate-500">Eventos hoje</p>
          <p className="mt-2 text-3xl font-black text-slate-950 dark:text-white">{todayCount}</p>
        </div>
        <div className="orion-panel p-5">
          <Activity className="text-emerald-600" size={22} />
          <p className="mt-4 text-xs font-black uppercase tracking-widest text-slate-500">Ultimos registros</p>
          <p className="mt-2 text-3xl font-black text-slate-950 dark:text-white">{logs.length}</p>
        </div>
        <div className="orion-panel p-5">
          <ShieldCheck className="text-indigo-600" size={22} />
          <p className="mt-4 text-xs font-black uppercase tracking-widest text-slate-500">Acoes monitoradas</p>
          <p className="mt-2 text-3xl font-black text-slate-950 dark:text-white">{actions.length}</p>
        </div>
      </div>

      <div className="orion-panel mb-6 p-4">
        <div className="flex flex-col gap-3 lg:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por usuario, lead, email, acao ou ID..."
              className="orion-control w-full py-3.5 pl-12 pr-4 text-sm"
            />
          </div>
          <select
            value={actionFilter}
            onChange={(event) => setActionFilter(event.target.value)}
            className="orion-control min-w-[260px] px-4 py-3.5 text-sm font-bold"
          >
            <option value="all">Todas as acoes</option>
            {actions.map((action) => (
              <option key={action} value={action}>{getActionLabel(action)}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="orion-panel overflow-hidden">
        {loading ? (
          <div className="flex min-h-[260px] items-center justify-center">
            <Loader2 className="animate-spin text-blue-600" size={28} />
          </div>
        ) : error ? (
          <div className="p-8 text-sm font-bold text-red-600">{error}</div>
        ) : filteredLogs.length === 0 ? (
          <div className="p-10 text-center text-sm font-black uppercase tracking-widest text-slate-400">
            Nenhum registro encontrado
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-white/10">
            {filteredLogs.map((log) => {
              const metadata = getMetadataPreview(log.metadata);

              return (
                <article key={log.id} className="grid gap-4 p-5 transition hover:bg-blue-50/70 dark:hover:bg-white/5 lg:grid-cols-[220px_1fr_220px]">
                  <div>
                    <p className="text-xs font-black uppercase tracking-widest text-slate-400">
                      {format(new Date(log.created_at), "dd/MM/yyyy 'as' HH:mm", { locale: ptBR })}
                    </p>
                    <p className="mt-2 inline-flex items-center gap-2 bg-slate-100 px-3 py-1 text-[11px] font-black uppercase tracking-widest text-slate-600 dark:bg-white/10 dark:text-slate-200">
                      <UserRound size={13} /> {getRoleLabel(log.actor_role)}
                    </p>
                  </div>

                  <div>
                    <h2 className="text-lg font-black text-slate-950 dark:text-white">{getActionLabel(log.action)}</h2>
                    <p className="mt-1 text-sm font-bold text-slate-600 dark:text-slate-300">
                      {log.actor_email || 'Acao do sistema'}
                    </p>
                    {metadata.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {metadata.map((item) => (
                          <span key={`${log.id}-${item.key}`} className="bg-blue-50 px-3 py-1 text-[11px] font-black uppercase tracking-widest text-blue-700 dark:bg-blue-500/10 dark:text-blue-200">
                            {item.key}: {item.value}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="lg:text-right">
                    <p className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-widest text-slate-400">
                      <Database size={14} /> {log.entity_type || 'registro'}
                    </p>
                    {log.entity_id && (
                      <p className="mt-2 break-all text-xs font-bold text-slate-500 dark:text-slate-300">{log.entity_id}</p>
                    )}
                    {log.ip_address && (
                      <p className="mt-3 text-[11px] font-bold text-slate-400">IP {log.ip_address}</p>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </InternalLayout>
  );
}
