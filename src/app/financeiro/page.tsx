'use client';

import { useEffect, useMemo, useState } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import { useAuth } from '@/components/providers/AuthProvider';
import { supabase } from '@/lib/supabase/client';
import { Banknote, CalendarDays, CheckCircle2, Loader2, Save, WalletCards } from 'lucide-react';

type Receita = {
  id: string;
  lead_id: string;
  parcela_numero: number;
  total_parcelas: number;
  valor_total: number;
  valor_parcela: number;
  vencimento: string;
  status: 'pendente' | 'recebida';
  leads?: { id: string; nome: string | null; telefone: string | null } | null;
};

function brl(value: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);
}

function monthKey(value: string | Date) {
  const date = value instanceof Date ? value : new Date(`${value}T00:00:00`);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function monthStart() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;
}

export default function FinanceiroPage() {
  const { profile } = useAuth();
  const [receitas, setReceitas] = useState<Receita[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [leadId, setLeadId] = useState('');
  const [form, setForm] = useState({ valor_total: '', total_parcelas: '1', vencimento: monthStart(), primeira_recebida: false });

  async function token() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token;
  }

  async function fetchReceitas(targetLeadId?: string) {
    const accessToken = await token();
    if (!accessToken) return;

    setLoading(true);
    const params = new URLSearchParams();
    if (targetLeadId) params.set('lead_id', targetLeadId);
    const response = await fetch(`/api/financeiro/receitas?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const payload = await response.json().catch(() => ({}));
    setLoading(false);

    if (!response.ok) {
      setMessage(payload.error || 'Erro ao carregar financeiro.');
      return;
    }

    const rows = payload.receitas || [];
    setReceitas(rows);
    if (targetLeadId && rows.length) {
      setForm({
        valor_total: String(rows[0].valor_total || ''),
        total_parcelas: String(rows[0].total_parcelas || 1),
        vencimento: rows[0].vencimento || monthStart(),
        primeira_recebida: rows[0].status === 'recebida',
      });
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const currentLead = params.get('lead') || '';
    setLeadId(currentLead);
    void fetchReceitas(currentLead);
  }, []);

  const nowKey = monthKey(new Date());
  const next = new Date();
  next.setMonth(next.getMonth() + 1);
  const nextKey = monthKey(next);

  const summary = useMemo(() => {
    const totalVendido = new Map<string, number>();
    receitas.forEach((item) => totalVendido.set(item.lead_id, Number(item.valor_total || 0)));

    return {
      totalVendido: Array.from(totalVendido.values()).reduce((sum, value) => sum + value, 0),
      receitaMes: receitas
        .filter((item) => monthKey(item.vencimento) === nowKey)
        .reduce((sum, item) => sum + Number(item.valor_parcela || 0), 0),
      recebidoMes: receitas
        .filter((item) => monthKey(item.vencimento) === nowKey && item.status === 'recebida')
        .reduce((sum, item) => sum + Number(item.valor_parcela || 0), 0),
      esperadoProximoMes: receitas
        .filter((item) => monthKey(item.vencimento) === nextKey)
        .reduce((sum, item) => sum + Number(item.valor_parcela || 0), 0),
    };
  }, [receitas, nowKey, nextKey]);

  async function savePlan() {
    const accessToken = await token();
    if (!accessToken || !leadId) return;

    setSaving(true);
    setMessage('');
    const response = await fetch('/api/financeiro/receitas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        action: 'save_plan',
        lead_id: leadId,
        valor_total: form.valor_total,
        total_parcelas: form.total_parcelas,
        vencimento: form.vencimento,
        primeira_recebida: form.primeira_recebida,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    setSaving(false);

    if (!response.ok) {
      setMessage(payload.error || 'Erro ao salvar parcelamento.');
      return;
    }

    setMessage('Controle financeiro atualizado.');
    await fetchReceitas(leadId);
  }

  const targetLeadName = receitas.find((item) => item.lead_id === leadId)?.leads?.nome || 'Venda selecionada';

  return (
    <InternalLayout>
      <div className="mb-8 flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-cyan-400">Controle financeiro</p>
          <h1 className="text-4xl font-black tracking-tight text-white">
            Financeiro {profile?.nome_empresa ? `da ${profile.nome_empresa}` : 'do corretor'}
          </h1>
          <p className="mt-2 max-w-2xl text-sm font-bold text-slate-400">
            Acompanhe quanto vendeu, quanto entra neste mes e quanto fica previsto para o mes que vem.
          </p>
        </div>
      </div>

      <div className="mb-8 grid gap-4 md:grid-cols-4">
        <Metric icon={WalletCards} label="Total vendido" value={brl(summary.totalVendido)} />
        <Metric icon={Banknote} label="Receita do mes" value={brl(summary.receitaMes)} />
        <Metric icon={CheckCircle2} label="Recebido no mes" value={brl(summary.recebidoMes)} />
        <Metric icon={CalendarDays} label="Esperado mes que vem" value={brl(summary.esperadoProximoMes)} />
      </div>

      {leadId && (
        <div className="mb-8 rounded-[2rem] border border-cyan-500/10 bg-[#07111f] p-6 shadow-2xl shadow-black/20">
          <div className="mb-5">
            <p className="text-[10px] font-black uppercase tracking-widest text-cyan-300">Configurar venda</p>
            <h2 className="mt-1 text-2xl font-black text-white">{targetLeadName}</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-4">
            <label className="space-y-2">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Valor total vendido</span>
              <input value={form.valor_total} onChange={(event) => setForm({ ...form, valor_total: event.target.value })} className="w-full rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-sm font-black text-white outline-none focus:border-cyan-400" />
            </label>
            <label className="space-y-2">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Parcelas</span>
              <select value={form.total_parcelas} onChange={(event) => setForm({ ...form, total_parcelas: event.target.value })} className="w-full rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-sm font-black text-white outline-none focus:border-cyan-400">
                {Array.from({ length: 12 }, (_, index) => index + 1).map((item) => <option key={item} value={item}>{item}x</option>)}
              </select>
            </label>
            <label className="space-y-2">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Primeira entrada</span>
              <input type="date" value={form.vencimento} onChange={(event) => setForm({ ...form, vencimento: event.target.value })} className="w-full rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-sm font-black text-white outline-none focus:border-cyan-400" />
            </label>
            <label className="flex items-end gap-3 rounded-2xl border border-white/10 bg-slate-950 px-4 py-3">
              <input type="checkbox" checked={form.primeira_recebida} onChange={(event) => setForm({ ...form, primeira_recebida: event.target.checked })} />
              <span className="text-xs font-black text-slate-200">Primeira parcela ja recebida</span>
            </label>
          </div>
          <button onClick={savePlan} disabled={saving} className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-cyan-500 px-6 py-3 text-sm font-black text-slate-950 transition hover:bg-cyan-400 disabled:opacity-60">
            {saving ? <Loader2 className="animate-spin" size={17} /> : <Save size={17} />}
            Salvar financeiro
          </button>
          {message && <p className="mt-3 text-sm font-bold text-cyan-200">{message}</p>}
        </div>
      )}

      <div className="rounded-[2rem] border border-white/10 bg-[#07111f] p-5">
        <h2 className="mb-4 text-sm font-black uppercase tracking-widest text-white">Receitas e previsoes</h2>
        {loading ? (
          <div className="py-12 text-center text-slate-400"><Loader2 className="mx-auto animate-spin" /></div>
        ) : receitas.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-sm font-bold text-slate-400">Nenhuma venda financeira registrada ainda.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-widest text-slate-500">
                  <th className="px-4 py-3">Cliente</th>
                  <th className="px-4 py-3">Parcela</th>
                  <th className="px-4 py-3">Vencimento</th>
                  <th className="px-4 py-3">Valor total</th>
                  <th className="px-4 py-3">Valor da parcela</th>
                  <th className="px-4 py-3">Situacao</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {receitas.map((item) => (
                  <tr key={item.id} className="text-slate-200">
                    <td className="px-4 py-4 font-black">{item.leads?.nome || 'Lead'}</td>
                    <td className="px-4 py-4 font-bold">{item.parcela_numero}/{item.total_parcelas}</td>
                    <td className="px-4 py-4 font-bold">{new Date(`${item.vencimento}T00:00:00`).toLocaleDateString('pt-BR')}</td>
                    <td className="px-4 py-4 font-bold">{brl(Number(item.valor_total))}</td>
                    <td className="px-4 py-4 font-black text-cyan-300">{brl(Number(item.valor_parcela))}</td>
                    <td className="px-4 py-4">
                      <span className={`rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest ${item.status === 'recebida' ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-300'}`}>
                        {item.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </InternalLayout>
  );
}

function Metric({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="rounded-[1.5rem] border border-white/10 bg-[#07111f] p-5 shadow-xl shadow-black/20">
      <Icon className="mb-4 text-cyan-300" size={22} />
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-black text-white">{value}</p>
    </div>
  );
}
