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
  const journeyProgress = target ? Math.max(2, progress) : 2;
  const journeyLabel = progress >= 100 ? 'Meta alcançada' : data?.negotiation ? 'Em negociação' : 'Início da jornada';
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

        <section className="kh-goal-cover" aria-label="Progresso da meta comercial">
          <div className="kh-goal-cover-heading"><div><span>Jornada comercial</span><h2>{journeyLabel}</h2><p>O time avança conforme as oportunidades se transformam em vendas.</p></div><strong>{Math.round(progress)}%<small>da meta vendida</small></strong></div>
          <div className="kh-goal-progress-stage"><div className="kh-goal-progress-track"><div className="kh-goal-progress-fill" style={{ width: `${journeyProgress}%` }} /><span className="kh-goal-marker sold" style={{ left: '0%' }}><b>Vendido</b><small>{currency(data?.sold)}</small></span><span className="kh-goal-marker negotiation" style={{ left: '50%' }}><b>Em negociação</b><small>{currency(data?.negotiation)}</small></span><span className="kh-goal-marker target" style={{ left: '100%' }}><b>Meta final</b><small>{currency(target)}</small></span><div className="kh-goal-rocket" style={{ left: `${journeyProgress}%` }}><img src="/comercial-foguete.png" alt="Time comercial avançando" /><span>Momento atual</span></div></div></div>
          <div className="kh-goal-cover-footer"><span>Projeção consolidada: <b>{Math.round(projectionProgress)}%</b></span><span>Pipeline em negociação: <b>{currency(data?.negotiation)}</b></span></div>
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
