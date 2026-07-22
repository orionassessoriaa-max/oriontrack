'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Target } from 'lucide-react';
import { useCommercial } from '@/components/commercial/CommercialShell';
import { currency } from '@/lib/comercial';

type GoalData = { goal: { meta_valor: number } | null; month: string; sold: number; negotiation: number; projection: number };

export default function CommercialGoalsPage() {
  const { api } = useCommercial();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [goalValue, setGoalValue] = useState('');
  const [data, setData] = useState<GoalData | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const load = useCallback(async () => { const payload = await api(`/api/comercial/metas?month=${month}`); setData(payload); setGoalValue(payload.goal?.meta_valor ? String(payload.goal.meta_valor) : ''); }, [api, month]);
  useEffect(() => { void load(); }, [load]);
  const target = Number(data?.goal?.meta_valor || 0);
  const progress = target ? Math.min(100, (Number(data?.sold || 0) / target) * 100) : 0;
  const projectionProgress = target ? Math.min(100, (Number(data?.projection || 0) / target) * 100) : 0;
  const monthLabel = useMemo(() => new Date(`${month}-15T12:00:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }), [month]);
  async function save(event: React.FormEvent) { event.preventDefault(); setSaving(true); setMessage(''); try { await api('/api/comercial/metas', { method: 'POST', body: JSON.stringify({ mes: month, meta_valor: Number(goalValue.replace(',', '.')) }) }); await load(); setMessage('Meta salva.'); } finally { setSaving(false); } }
  return <div className="kh-goals-page"><header className="kh-page-head"><div><div className="kh-eyebrow">Gestão comercial</div><h1>Acompanhamento de meta</h1><p>Visão do progresso e da projeção da meta comercial.</p></div><form className="kh-goal-form" onSubmit={save}><input className="kh-input" type="month" value={month} onChange={(event) => setMonth(event.target.value)} /><input className="kh-input" inputMode="decimal" value={goalValue} onChange={(event) => setGoalValue(event.target.value)} placeholder="Meta do mês" /><button className="kh-button primary" disabled={saving}><Target size={16} /> {saving ? 'Salvando...' : 'Salvar meta'}</button></form></header><section className="kh-goal-hero"><div className="kh-goal-progress"><span>Progresso atual</span><strong>{Math.round(progress)}%</strong><div><i style={{ width: `${progress}%` }} /></div></div><div className="kh-goal-timeline"><div className="kh-goal-line"><i style={{ left: `${progress}%` }} /><b style={{ left: `${projectionProgress}%` }} /></div><div className="kh-goal-point sold"><span>Vendido</span><strong>{currency(data?.sold)}</strong></div><div className="kh-goal-point negotiation"><span>Em negociação</span><strong>{currency(data?.negotiation)}</strong></div><div className="kh-goal-point target"><span>Meta final</span><strong>{currency(target)}</strong></div></div><div className="kh-goal-summary"><div><span>Valor vendido</span><strong>{currency(data?.sold)}</strong></div><div><span>Em negociação</span><strong>{currency(data?.negotiation)}</strong></div><div><span>Projeção total</span><strong>{currency(data?.projection)}</strong></div></div><p className="kh-goal-caption"><Check size={13} /> Acompanhamento de {monthLabel}. A projeção considera negociações em andamento.</p></section>{message && <div className="kh-inline-success">{message}</div>}</div>;
}
