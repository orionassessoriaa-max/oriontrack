'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, Link2, Loader2, Plus, Power, ShieldCheck, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';

type RouteRow = {
  id: string;
  source_type: string;
  source_id: string;
  label: string | null;
  active: boolean;
};

const sourceLabels: Record<string, string> = {
  meta_ad_account: 'Conta Meta',
  meta_page: 'Pagina Meta',
  meta_form: 'Formulario Meta',
  n8n_workflow: 'Workflow n8n',
  spreadsheet: 'Planilha',
  custom: 'Origem personalizada',
};

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

async function authorizedFetch(input: RequestInfo | URL, init?: RequestInit) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Sessao expirada. Entre novamente.');
  return fetch(input, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
}

export default function LeadSourceRoutingManager({
  corretoraId,
  corretoraNome,
  suggestedMetaAccountId,
}: {
  corretoraId: string;
  corretoraNome: string;
  suggestedMetaAccountId?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [routes, setRoutes] = useState<RouteRow[]>([]);
  const [quarantineCount, setQuarantineCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    source_type: 'meta_form',
    source_id: '',
    label: '',
  });

  async function loadRoutes() {
    setLoading(true);
    setError(null);
    try {
      const response = await authorizedFetch(`/api/admin/integracao-rotas?corretora_id=${encodeURIComponent(corretoraId)}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Erro ao carregar origens.');
      setRoutes(payload.routes || []);
      setQuarantineCount(Number(payload.quarantine_count || 0));
      if (payload.migration_pending) setError('A migration de roteamento ainda precisa ser aplicada no Supabase.');
      setLoaded(true);
    } catch (loadError: unknown) {
      setError(errorMessage(loadError, 'Erro ao carregar origens.'));
    } finally {
      setLoading(false);
    }
  }

  async function toggleOpen() {
    const next = !open;
    setOpen(next);
    if (next && !loaded) await loadRoutes();
  }

  async function addRoute(sourceType = form.source_type, sourceId = form.source_id, label = form.label) {
    if (!sourceId.trim()) {
      setError('Informe o ID da origem.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await authorizedFetch('/api/admin/integracao-rotas', {
        method: 'POST',
        body: JSON.stringify({
          corretora_id: corretoraId,
          source_type: sourceType,
          source_id: sourceId,
          label: label || `${corretoraNome} - ${sourceLabels[sourceType] || sourceType}`,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Erro ao cadastrar origem.');
      setRoutes((current) => {
        const remaining = current.filter((route) => route.id !== payload.route.id);
        return [...remaining, payload.route].sort((a, b) => a.source_type.localeCompare(b.source_type));
      });
      setForm((current) => ({ ...current, source_id: '', label: '' }));
    } catch (saveError: unknown) {
      setError(errorMessage(saveError, 'Erro ao cadastrar origem.'));
    } finally {
      setSaving(false);
    }
  }

  async function setRouteActive(route: RouteRow, active: boolean) {
    setSaving(true);
    setError(null);
    try {
      const response = await authorizedFetch('/api/admin/integracao-rotas', {
        method: 'PATCH',
        body: JSON.stringify({ id: route.id, active }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Erro ao atualizar origem.');
      setRoutes((current) => current.map((item) => item.id === route.id ? payload.route : item));
    } catch (saveError: unknown) {
      setError(errorMessage(saveError, 'Erro ao atualizar origem.'));
    } finally {
      setSaving(false);
    }
  }

  const normalizedSuggestedAccount = String(suggestedMetaAccountId || '').replace(/^act_/i, '');
  const suggestedAccountMissing = Boolean(
    normalizedSuggestedAccount
    && !routes.some((route) => route.source_type === 'meta_ad_account' && route.source_id === normalizedSuggestedAccount && route.active),
  );

  return (
    <div className="mb-4 rounded-2xl border border-cyan-500/15 bg-cyan-500/[0.04]">
      <button
        type="button"
        onClick={() => void toggleOpen()}
        className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left"
      >
        <span className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-400">
            <ShieldCheck size={18} />
          </span>
          <span>
            <span className="block text-xs font-black uppercase tracking-widest text-cyan-300">Roteamento global de leads</span>
            <span className="mt-0.5 block text-[11px] font-semibold text-slate-400">
              {routes.filter((route) => route.active).length} origens ativas
              {quarantineCount > 0 ? ` · ${quarantineCount} em quarentena` : ''}
            </span>
          </span>
        </span>
        {loading ? <Loader2 className="animate-spin text-cyan-400" size={18} /> : open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
      </button>

      {open && (
        <div className="border-t border-cyan-500/10 px-4 py-4">
          <p className="mb-4 text-xs font-medium leading-relaxed text-slate-400">
            Cadastre os IDs que chegam no webhook global. O CRM usa essas origens para escolher a concessionaria e bloqueia um ID legado que aponte para outro destino.
          </p>

          {error && <div className="mb-4 rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs font-bold text-rose-300">{error}</div>}

          {suggestedAccountMissing && (
            <div className="mb-4 flex flex-col gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] p-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-black text-emerald-300">Conta Meta encontrada: {normalizedSuggestedAccount}</p>
                <p className="mt-1 text-[11px] font-medium text-slate-400">Cadastre esta conta como origem da concessionaria.</p>
              </div>
              <button
                type="button"
                disabled={saving}
                onClick={() => void addRoute('meta_ad_account', normalizedSuggestedAccount, `${corretoraNome} - Conta Meta`)}
                className="inline-flex min-h-9 items-center justify-center gap-2 rounded-xl bg-emerald-500 px-3 text-xs font-black text-slate-950 disabled:opacity-50"
              >
                <Plus size={14} /> Cadastrar conta
              </button>
            </div>
          )}

          <div className="grid gap-2 lg:grid-cols-[180px_minmax(220px,1fr)_minmax(180px,1fr)_auto]">
            <select
              value={form.source_type}
              onChange={(event) => setForm((current) => ({ ...current, source_type: event.target.value }))}
              className="min-h-11 rounded-xl border border-white/10 bg-slate-950 px-3 text-xs font-bold text-white outline-none focus:border-cyan-400"
            >
              {Object.entries(sourceLabels).map(([sourceType, label]) => <option key={sourceType} value={sourceType}>{label}</option>)}
            </select>
            <input
              value={form.source_id}
              onChange={(event) => setForm((current) => ({ ...current, source_id: event.target.value }))}
              placeholder="ID da conta, pagina, formulario ou workflow"
              className="min-h-11 rounded-xl border border-white/10 bg-slate-950 px-3 text-xs font-semibold text-white outline-none placeholder:text-slate-600 focus:border-cyan-400"
            />
            <input
              value={form.label}
              onChange={(event) => setForm((current) => ({ ...current, label: event.target.value }))}
              placeholder="Descricao opcional"
              className="min-h-11 rounded-xl border border-white/10 bg-slate-950 px-3 text-xs font-semibold text-white outline-none placeholder:text-slate-600 focus:border-cyan-400"
            />
            <button
              type="button"
              disabled={saving}
              onClick={() => void addRoute()}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-cyan-500 px-4 text-xs font-black text-slate-950 disabled:opacity-50"
            >
              {saving ? <Loader2 className="animate-spin" size={14} /> : <Plus size={14} />} Adicionar
            </button>
          </div>

          <div className="mt-4 space-y-2">
            {routes.length === 0 && !loading ? (
              <div className="rounded-xl border border-dashed border-white/10 px-4 py-5 text-center text-xs font-semibold text-slate-500">Nenhuma origem cadastrada.</div>
            ) : routes.map((route) => (
              <div key={route.id} className={`flex flex-col gap-3 rounded-xl border px-3 py-3 sm:flex-row sm:items-center sm:justify-between ${route.active ? 'border-cyan-500/15 bg-slate-950/40' : 'border-white/5 bg-slate-950/20 opacity-60'}`}>
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-xs font-black text-white"><Link2 size={13} className="text-cyan-400" /> {sourceLabels[route.source_type] || route.source_type}</p>
                  <p className="mt-1 break-all font-mono text-[11px] text-cyan-300">{route.source_id}</p>
                  {route.label && <p className="mt-1 text-[10px] font-semibold text-slate-500">{route.label}</p>}
                </div>
                <div className="flex items-center gap-2">
                  {!route.active && (
                    <button type="button" disabled={saving} onClick={() => void setRouteActive(route, true)} className="inline-flex h-9 items-center gap-2 rounded-lg border border-emerald-500/20 px-3 text-[10px] font-black uppercase tracking-wider text-emerald-300"><Power size={13} /> Reativar</button>
                  )}
                  {route.active && (
                    <button type="button" disabled={saving} onClick={() => void setRouteActive(route, false)} className="inline-flex h-9 items-center gap-2 rounded-lg border border-rose-500/20 px-3 text-[10px] font-black uppercase tracking-wider text-rose-300"><Trash2 size={13} /> Desativar</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
