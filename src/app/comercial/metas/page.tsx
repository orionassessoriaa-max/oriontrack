'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, Check, Coins, Target, TrendingUp } from 'lucide-react';
import { useCommercial } from '@/components/commercial/CommercialShell';
import { currency } from '@/lib/comercial';

type GoalData = { goal: { meta_valor: number } | null; month: string; sold: number; negotiation: number; projection: number };

function SeamlessVideoBackground({ src }: { src: string }) {
  return <div className="kh-video-bg-container"><video src={src} muted loop autoPlay playsInline className="kh-video-bg-element active" /><div className="kh-video-bg-overlay" /></div>;
}

export default function CommercialGoalsPage() {
  const { api } = useCommercial();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [goalValue, setGoalValue] = useState('');
  const [data, setData] = useState<GoalData | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    const payload = await api(`/api/comercial/metas?month=${month}`);
    setData(payload);
    setGoalValue(payload.goal?.meta_valor ? String(payload.goal.meta_valor) : '');
  }, [api, month]);

  // This effect synchronizes the page with the selected month through the API.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const target = Number(data?.goal?.meta_valor || 0);
  const progress = target ? Math.min(100, (Number(data?.sold || 0) / target) * 100) : 0;
  const projectionProgress = target ? Math.min(100, (Number(data?.projection || 0) / target) * 100) : 0;
  const monthLabel = useMemo(() => new Date(`${month}-15T12:00:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }), [month]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      await api('/api/comercial/metas', { method: 'POST', body: JSON.stringify({ mes: month, meta_valor: Number(goalValue.replace(',', '.')) }) });
      await load();
      setMessage('Meta comercial atualizada com sucesso.');
    } finally { setSaving(false); }
  }

  return (
    <div className="kh-goals-premium-page">
      <SeamlessVideoBackground src="/fundo comercial.mp4" />
      <div className="kh-premium-goals-content">
        <header className="kh-premium-header">
          <div className="kh-premium-title-group"><h1>Acompanhamento de Metas</h1><p>Monitore o progresso de vendas e projecoes financeiras em tempo real.</p></div>
          <form className="kh-premium-form" onSubmit={save}>
            <input className="kh-input" type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
            <input className="kh-input" inputMode="decimal" value={goalValue} onChange={(event) => setGoalValue(event.target.value)} placeholder="Meta do mes (R$)" />
            <button className="kh-button" disabled={saving}><Target size={16} />{saving ? 'Salvando...' : 'Definir Meta'}</button>
          </form>
        </header>

        <section className="kh-goal-timeline" aria-label="Linha do tempo da meta comercial">
          <div className="kh-goal-timeline-line" />
          <div className="kh-goal-node sold"><span>VENDIDO</span><strong>{currency(data?.sold)}</strong><small>{Math.round(progress)}% da meta</small></div>
          <div className="kh-goal-node negotiation"><span>EM NEGOCIACAO</span><strong>{currency(data?.negotiation)}</strong><small>Pipeline atual</small></div>
          <div className="kh-goal-node target"><span>META FINAL</span><strong>{currency(target)}</strong><small>Projecao: {Math.round(projectionProgress)}%</small></div>
        </section>

        <section className="kh-premium-stats-grid">
          <div className="kh-glass-card kh-premium-stat-card stat-sold"><Coins size={18} /><span>Total vendido</span><strong>{currency(data?.sold)}</strong></div>
          <div className="kh-glass-card kh-premium-stat-card stat-negotiation"><TrendingUp size={18} /><span>Em negociacao</span><strong>{currency(data?.negotiation)}</strong></div>
          <div className="kh-glass-card kh-premium-stat-card stat-projection"><BarChart3 size={18} /><span>Projecao consolidada</span><strong>{currency(data?.projection)}</strong></div>
        </section>

        {message && <div className="kh-inline-success">{message}</div>}
        <footer className="kh-premium-caption-bar"><Check size={14} /><span>Acompanhamento de {monthLabel}. A projecao considera o valor faturado somado as negociacoes ativas no funil.</span></footer>
      </div>
    </div>
  );
}
