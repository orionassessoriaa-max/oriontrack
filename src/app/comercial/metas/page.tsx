'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, Check, Coins, Info, Target, TrendingUp } from 'lucide-react';
import { useCommercial } from '@/components/commercial/CommercialShell';
import { currency } from '@/lib/comercial';

type GoalData = {
  goal: { meta_valor: number; meta_vendas?: number | null; meta_conversao?: number | null } | null;
  // metasEfetivas só existe depois do deploy da rota nova; trate como opcional.
  metasEfetivas?: { receita?: number | null; vendas?: number | null; conversao?: number | null } | null;
  month: string;
  sold: number;
  negotiation: number;
  projection: number;
};

// Mantém a semântica antiga: valor ausente ou zerado abre o campo em branco.
function toField(...candidates: Array<number | null | undefined>) {
  const value = candidates.find((candidate) => Number(candidate) > 0);
  return value ? String(value) : '';
}

function toNumber(value: string) {
  return Number(value.replace(',', '.')) || 0;
}

function SeamlessVideoBackground({ src }: { src: string }) {
  return <div className="kh-video-bg-container"><video src={src} muted loop autoPlay playsInline className="kh-video-bg-element active" /><div className="kh-video-bg-overlay" /></div>;
}

export default function CommercialGoalsPage() {
  const { api } = useCommercial();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [goalValue, setGoalValue] = useState('');
  const [salesGoalValue, setSalesGoalValue] = useState('');
  const [conversionGoalValue, setConversionGoalValue] = useState('');
  const [data, setData] = useState<GoalData | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  // Erro e sucesso usam caixas diferentes: verde para quem salvou, vermelho
  // para quem tomou 403. Sem isso o SDR le "acao restrita" num aviso verde.
  const [messageIsError, setMessageIsError] = useState(false);

  const load = useCallback(async () => {
    const payload: GoalData = await api(`/api/comercial/metas?month=${month}`);
    setData(payload);
    setGoalValue(toField(payload.metasEfetivas?.receita, payload.goal?.meta_valor));
    setSalesGoalValue(toField(payload.metasEfetivas?.vendas, payload.goal?.meta_vendas));
    setConversionGoalValue(toField(payload.metasEfetivas?.conversao, payload.goal?.meta_conversao));
  }, [api, month]);

  // This effect synchronizes the page with the selected month through the API.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const target = Number(data?.goal?.meta_valor || 0);
  const progress = target ? Math.min(100, (Number(data?.sold || 0) / target) * 100) : 0;
  const projectionProgress = target ? Math.min(100, (Number(data?.projection || 0) / target) * 100) : 0;
  const journeyProgress = target ? Math.max(2, Math.min(100, ((Number(data?.sold || 0) + Number(data?.negotiation || 0)) / target) * 100)) : 2;
  const journeyLabel = progress >= 100 ? 'Meta alcançada' : data?.negotiation ? 'Em negociação' : 'Início da jornada';
  const monthLabel = useMemo(() => new Date(`${month}-15T12:00:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }), [month]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    setMessageIsError(false);
    try {
      await api('/api/comercial/metas', {
        method: 'POST',
        body: JSON.stringify({
          mes: month,
          meta_valor: toNumber(goalValue),
          meta_vendas: Math.round(toNumber(salesGoalValue)),
          meta_conversao: toNumber(conversionGoalValue),
        }),
      });
      await load();
      setMessage('Metas comerciais atualizadas com sucesso.');
    } catch (error) {
      // O POST é restrito ao coordenador: sem catch, quem não pode salvar não via retorno nenhum.
      setMessageIsError(true);
      setMessage(error instanceof Error ? error.message : 'Não foi possível salvar as metas.');
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
            {/* .kh-premium-form já tem flex-wrap; o minWidth evita que os campos espremam antes de quebrar a linha. */}
            <input className="kh-input" style={{ minWidth: 160 }} inputMode="decimal" value={goalValue} onChange={(event) => setGoalValue(event.target.value)} placeholder="Meta de receita (R$)" />
            <input className="kh-input" style={{ minWidth: 150 }} inputMode="numeric" value={salesGoalValue} onChange={(event) => setSalesGoalValue(event.target.value)} placeholder="Meta de vendas (qtd)" />
            <input className="kh-input" style={{ minWidth: 160 }} inputMode="decimal" value={conversionGoalValue} onChange={(event) => setConversionGoalValue(event.target.value)} placeholder="Meta de conversao (%)" />
            <button className="kh-button" disabled={saving}><Target size={16} />{saving ? 'Salvando...' : 'Definir Metas'}</button>
          </form>
        </header>

        <section className="kh-goal-cover" aria-label="Progresso da meta comercial">
          <div className="kh-goal-cover-heading"><div><span>Jornada comercial</span><h2>{journeyLabel}</h2><p>O time avança conforme as oportunidades se transformam em vendas.</p></div><strong>{Math.round(progress)}%<small>da meta vendida</small></strong></div>
          <div className="kh-goal-progress-stage"><div className="kh-goal-progress-track"><div className="kh-goal-progress-fill" style={{ width: `${journeyProgress}%` }} /><span className="kh-goal-marker sold" style={{ left: '0%' }}><b>Vendido</b><small>{currency(data?.sold)}</small></span><span className="kh-goal-marker target" style={{ left: '100%' }}><b>Meta final</b><small>{currency(target)}</small></span><div className="kh-goal-rocket" style={{ left: `${journeyProgress}%` }}><img src="/comercial-foguete.png" alt="Time comercial avançando" /></div></div></div>
          <div className="kh-goal-cover-footer"><span>Projeção consolidada: <b>{Math.round(projectionProgress)}%</b></span><span>Vendido: <b>{currency(data?.sold)}</b></span><span>Em negociação: <b>{currency(data?.negotiation)}</b></span></div>
        </section>

        <section className="kh-premium-stats-grid">
          <div className="kh-glass-card kh-premium-stat-card stat-sold"><Coins size={18} /><span>Total vendido</span><strong>{currency(data?.sold)}</strong></div>
          <div className="kh-glass-card kh-premium-stat-card stat-negotiation"><TrendingUp size={18} /><span>Em negociacao</span><strong>{currency(data?.negotiation)}</strong></div>
          <div className="kh-glass-card kh-premium-stat-card stat-projection"><BarChart3 size={18} /><span>Projecao consolidada</span><strong>{currency(data?.projection)}</strong></div>
        </section>

        {message && <div className={messageIsError ? 'kh-inline-error' : 'kh-inline-success'}>{message}</div>}
        <div className="kh-premium-caption-bar"><Info size={14} /><span>As metas de 100 ligacoes por SDR e o teto de 20% de no-show sao fixos no sistema e nao sao editaveis nesta tela.</span></div>
        <footer className="kh-premium-caption-bar"><Check size={14} /><span>Acompanhamento de {monthLabel}. A projecao considera o valor faturado somado as negociacoes ativas no funil.</span></footer>
      </div>
    </div>
  );
}
