'use client';

import Image from 'next/image';
import { useState } from 'react';
import { FileText, LockKeyhole, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import styles from './OrionCredCard.module.css';

type LedgerItem = {
  id: string;
  tipo: string;
  quantidade: number;
  referencia?: string | null;
  corretor_id?: string | null;
  concessionaria?: string | null;
  operadora?: string | null;
  regiao?: string | null;
  resultado?: string | null;
  custo_estimado_usd?: number | null;
  criado_em: string;
};

type Props = {
  holderName: string;
  gestorId?: string;
  balance?: number | null;
  used?: number;
  limit?: number;
  usagePercent?: number;
  cycleLabel?: string;
  cycleEnd?: string;
};

function formatCredits(value: number) {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(value);
}

function formatDate(value?: string) {
  if (!value) return 'A definir';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(new Date(`${value}T12:00:00`));
  }
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

export default function OrionCredCard({ holderName, gestorId, balance = null, used = 0, limit = 0, usagePercent = 0, cycleLabel = 'Ciclo de 20 dias', cycleEnd }: Props) {
  const [statementOpen, setStatementOpen] = useState(false);
  const [ledger, setLedger] = useState<LedgerItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openStatement = async () => {
    setStatementOpen(true);
    setLoading(true);
    setError(null);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('Sessao expirada. Entre novamente.');
      const params = new URLSearchParams({ include_ledger: '1' });
      if (gestorId) params.set('gestor_id', gestorId);
      const response = await fetch(`/api/criativos/credits?${params.toString()}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Nao foi possivel carregar o extrato.');
      setLedger(payload.ledger || []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao carregar o extrato.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <section aria-label="Cartao Orion Cred" className={styles.card}>
        <div className="flex h-full flex-col justify-between p-6 sm:p-7">
          <div className="flex items-start justify-between gap-5">
            <Image src="/brand-logo.png" alt="Orion Track" width={1920} height={1080} className={styles.logo} priority />
            <span className={styles.monogram}>BLACK</span>
          </div>
          <div>
            <div className="mb-5 flex items-center justify-between gap-5">
              <div className={styles.chip} aria-hidden="true" />
              <div className="text-right"><p className={styles.creditLabel}>Orion Cred</p><p className="mt-1 text-[11px] font-semibold text-cyan-100/55">Somente para criativos</p></div>
            </div>
            <p className={styles.creditLabel}>Saldo disponivel</p>
            <p className={`${styles.creditValue} mt-1`}>{balance === null ? 'Limite em configuracao' : `${formatCredits(balance)} creditos`}</p>
            {balance !== null && (
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10" aria-label={`${usagePercent}% do limite utilizado`}>
                <div className={`h-full rounded-full ${usagePercent >= 100 ? 'bg-rose-400' : usagePercent >= 80 ? 'bg-amber-300' : 'bg-cyan-400'}`} style={{ width: `${Math.min(Math.max(usagePercent, 0), 100)}%` }} />
              </div>
            )}
            {balance !== null && <p className="mt-2 text-[10px] font-bold uppercase tracking-wider text-cyan-100/50">Usado {formatCredits(used)} de {formatCredits(limit)} | Renova em {formatDate(cycleEnd)}</p>}
          </div>
          <div className="flex items-end justify-between gap-4">
            <div className="min-w-0"><p className={styles.holder}>{holderName || 'Gestor Orion'}</p><p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-100/40">{cycleLabel}</p></div>
            <button type="button" onClick={() => void openStatement()} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-cyan-200/15 px-3 text-xs font-black text-cyan-100/70 hover:bg-cyan-300/10 hover:text-white"><FileText size={15} /> Extrato</button>
            <LockKeyhole size={17} className="shrink-0 text-cyan-200/50" aria-label="Saldo protegido" />
          </div>
        </div>
      </section>

      {statementOpen && (
        <div className="fixed inset-0 z-[190] flex items-center justify-center bg-slate-950/90 p-4" role="dialog" aria-modal="true" aria-labelledby="orion-statement-title">
          <div className="max-h-[85vh] w-full max-w-5xl overflow-hidden rounded-3xl border border-cyan-400/20 bg-[#081321] shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 p-5 sm:p-6"><div><p className="text-xs font-black uppercase tracking-wider text-cyan-400">Orion Cred</p><h2 id="orion-statement-title" className="mt-1 text-2xl font-black text-white">Extrato de criativos</h2></div><button type="button" onClick={() => setStatementOpen(false)} className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-slate-700 text-slate-400 hover:text-white" aria-label="Fechar extrato"><X size={19} /></button></div>
            <div className="max-h-[65vh] overflow-auto p-5 sm:p-6">
              {loading ? <p className="text-sm font-bold text-slate-400">Carregando extrato...</p> : error ? <p className="rounded-xl border border-red-400/20 bg-red-500/10 p-4 text-sm font-bold text-red-200">{error}</p> : ledger.length === 0 ? <p className="text-sm font-bold text-slate-500">Nenhum movimento neste ciclo.</p> : (
                <div className="overflow-x-auto"><table className="min-w-[1000px] w-full text-left text-sm"><thead className="text-xs uppercase text-slate-500"><tr><th className="p-3">Data</th><th className="p-3">Movimento</th><th className="p-3">Creditos</th><th className="p-3">Concessionaria</th><th className="p-3">Operadora / Regiao</th><th className="p-3">Resultado</th><th className="p-3">Custo estimado</th></tr></thead><tbody>{ledger.map((item) => <tr key={item.id} className="border-t border-slate-800 text-slate-200"><td className="p-3 whitespace-nowrap">{formatDate(item.criado_em)}</td><td className="p-3 font-bold">{item.tipo}</td><td className={`p-3 font-black ${item.tipo === 'consumo' || item.tipo === 'debito' || item.tipo === 'transferencia_saida' ? 'text-rose-300' : 'text-emerald-300'}`}>{item.quantidade}</td><td className="p-3">{item.concessionaria || item.corretor_id || '-'}</td><td className="p-3">{[item.operadora, item.regiao].filter(Boolean).join(' / ') || '-'}</td><td className="p-3">{item.resultado || '-'}</td><td className="p-3">{item.custo_estimado_usd == null ? '-' : `US$ ${Number(item.custo_estimado_usd).toFixed(3)}`}</td></tr>)}</tbody></table></div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
