'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import {
  Users,
  TrendingUp,
  Loader2,
  AlertTriangle,
  ChevronRight,
  ChevronDown,
  ShieldAlert,
  Sparkles,
  Image as ImageIcon,
  ListChecks,
  Pause,
  PlugZap,
  X,
  Check,
  Ban,
  Maximize2,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/components/providers/AuthProvider';
import Link from 'next/link';
import MetaDatePicker from '@/components/ui/MetaDatePicker';
import { isGestorLinkedToConcessionariaCorretor } from '@/lib/gestorAccess';
import {
  ACTION_LABELS,
  TRACKING_LABELS,
  classifyAccount,
  formatBRL,
  scoreAccount,
  type AccountLike,
  type RecommendationAction,
  type TrackingStatus,
} from '@/lib/trafego/rules';

type Corretor = {
  id: string;
  nome: string;
  nome_empresa?: string | null;
  campanhas_ativas: boolean;
};

type MetaAccount = AccountLike & {
  corretor_nome: string;
  meta_ad_account_name: string | null;
  rastreio: TrackingStatus;
  rastreio_desde?: string | null;
};

type ActiveCreative = {
  id: string;
  ad_name: string;
  concessionaria_nome: string;
  thumbnail_url?: string | null;
  image_url?: string | null;
  spend: number;
  leads: number;
  cpl: number | null;
  currency: string;
  status?: string;
};

type Recomendacao = {
  id?: string;
  concessionaria_nome: string;
  meta_ad_account_id: string | null;
  nivel: string;
  alvo_id: string | null;
  alvo_nome: string | null;
  acao: RecommendationAction;
  severidade: 'critico' | 'atencao' | 'informativo';
  motivo: string;
  metricas: Record<string, any>;
};

const TONE_VAR: Record<string, { fg: string; bg: string; border: string }> = {
  red: { fg: 'var(--tf-crit)', bg: 'var(--tf-crit-soft)', border: 'var(--tf-crit-border)' },
  amber: { fg: 'var(--tf-warn)', bg: 'var(--tf-warn-soft)', border: 'var(--tf-warn-border)' },
  emerald: { fg: 'var(--tf-ok)', bg: 'var(--tf-ok-soft)', border: 'var(--tf-ok-border)' },
  blue: { fg: 'var(--tf-info)', bg: 'var(--tf-info-soft)', border: 'var(--tf-info-border)' },
  slate: { fg: 'var(--tf-idle)', bg: 'var(--tf-idle-soft)', border: 'var(--tf-idle-border)' },
};

const ACTION_ICON: Record<RecommendationAction, any> = {
  pausar_campanha: Pause,
  pausar_conjunto: Pause,
  pausar_anuncio: Pause,
  trocar_criativo: ImageIcon,
  revisar_publico: Users,
  revisar_rastreio: PlugZap,
  avisar_admin: ShieldAlert,
};

function daysAgo(days: number) {
  const date = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function today() {
  return new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function bestCreativeImage(creative?: ActiveCreative | null) {
  if (creative?.image_url) return creative.image_url;
  return String(creative?.thumbnail_url || '')
    .replace(/\/p\d+x\d+\//g, '/p1080x1080/')
    .replace(/s\d+x\d+/, 's1080x1080')
    .replace(/\/\d+x\d+\//g, '/1080x1080/');
}

export default function GestorDashboardPage() {
  const { profile, actualProfile } = useAuth();
  const [corretores, setCorretores] = useState<Corretor[]>([]);
  const [metaAccounts, setMetaAccounts] = useState<MetaAccount[]>([]);
  const [activeCreatives, setActiveCreatives] = useState<ActiveCreative[]>([]);
  const [recomendacoes, setRecomendacoes] = useState<Recomendacao[]>([]);
  const [resumoIa, setResumoIa] = useState('');
  const [analisesHoje, setAnalisesHoje] = useState(0);
  const [ultimaAnalise, setUltimaAnalise] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [otimizando, setOtimizando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ tone: 'ok' | 'erro'; texto: string } | null>(null);

  const [dataInicio, setDataInicio] = useState(daysAgo(30));
  const [dataFim, setDataFim] = useState(today());
  const [presetLabel, setPresetLabel] = useState('Últimos 30 dias');

  const [confirmando, setConfirmando] = useState<Recomendacao | null>(null);
  const [decidindo, setDecidindo] = useState<string | null>(null);
  const [fullscreenCreative, setFullscreenCreative] = useState<ActiveCreative | null>(null);

  const requestRef = useRef(0);

  const gestorIdParam = actualProfile?.tipo_usuario === 'admin' && profile?.tipo_usuario === 'gestor_trafego'
    ? profile.id
    : undefined;

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || null;
  }

  async function carregar(analisar: boolean) {
    if (!profile?.id) return;
    const requestId = ++requestRef.current;
    const atual = () => requestRef.current === requestId;

    if (analisar) {
      setOtimizando(true);
    } else {
      setLoading(true);
      // Troca de periodo nao pode exibir os numeros do periodo anterior.
      setMetaAccounts([]);
      setActiveCreatives([]);
    }
    setError(null);

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 60000);

    try {
      const { data: corretoresData } = await supabase
        .from('corretores')
        .select('id, nome, nome_empresa, campanhas_ativas, gestor_trafego_id, time_operacional')
        .in('status', ['active', 'ativo', 'Ativo'])
        .order('nome', { ascending: true });

      let lista = (corretoresData || []) as any[];
      if (profile.tipo_usuario === 'gestor_trafego') {
        lista = lista.filter((c) => isGestorLinkedToConcessionariaCorretor(c, profile));
      }
      if (!atual()) return;
      setCorretores(lista as Corretor[]);

      const token = await getToken();
      if (!token) {
        if (atual()) setError('Sessão expirada. Entre novamente.');
        return;
      }

      const response = await fetch('/api/integrations/meta/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        signal: controller.signal,
        body: JSON.stringify({
          analyze: analisar,
          data_inicio: dataInicio,
          data_fim: dataFim,
          gestor_id: gestorIdParam,
          acumulado_orion: true,
        }),
      });

      const payload = await response.json();
      if (!atual()) return;

      if (!response.ok) {
        setError(payload.error || 'Erro ao carregar o painel.');
        return;
      }

      setMetaAccounts(payload.accounts || []);
      setActiveCreatives(payload.active_creatives || []);
      setRecomendacoes(payload.recomendacoes || []);
      setAnalisesHoje(payload.analises_hoje || 0);
      setUltimaAnalise(payload.ultima_analise_em || null);
      setResumoIa(payload.portfolio_ai_review || '');

      if (analisar) {
        setAviso({
          tone: 'ok',
          texto: `Análise concluída. ${(payload.recomendacoes || []).length} ação(ões) na fila.`,
        });
      }
    } catch (error: any) {
      if (atual()) {
        setError(error?.name === 'AbortError'
          ? 'A análise demorou mais de 60 segundos. Verifique o token Meta e tente novamente.'
          : 'Erro ao carregar dados do painel.');
      }
    } finally {
      window.clearTimeout(timeout);
      if (atual()) {
        setLoading(false);
        setOtimizando(false);
      }
    }
  }

  async function recarregarFila() {
    const token = await getToken();
    if (!token) return;
    const url = new URL('/api/trafego/recomendacoes', window.location.origin);
    if (gestorIdParam) url.searchParams.set('gestor_id', gestorIdParam);

    const response = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) return;
    const payload = await response.json();
    setRecomendacoes(payload.recomendacoes || []);
    setAnalisesHoje(payload.analises_hoje || 0);
    setUltimaAnalise(payload.ultima_analise_em || null);
  }

  async function decidir(recomendacao: Recomendacao, decisao: 'aprovar' | 'ignorar', confirmar = false) {
    if (!recomendacao.id) {
      setAviso({ tone: 'erro', texto: 'Esta recomendação ainda não foi salva. Rode Otimizar novamente.' });
      return;
    }

    setDecidindo(recomendacao.id);
    setAviso(null);

    try {
      const token = await getToken();
      if (!token) {
        setAviso({ tone: 'erro', texto: 'Sessão expirada. Entre novamente.' });
        return;
      }

      const response = await fetch('/api/trafego/recomendacoes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id: recomendacao.id, decisao, confirmar, gestor_id: gestorIdParam }),
      });

      const payload = await response.json();

      if (response.status === 428) {
        setConfirmando(recomendacao);
        return;
      }

      if (!response.ok) {
        setAviso({ tone: 'erro', texto: payload.error || 'Não consegui registrar a decisão.' });
        return;
      }

      setConfirmando(null);
      setAviso({
        tone: 'ok',
        texto: payload.mensagem || (decisao === 'ignorar' ? 'Recomendação ignorada.' : 'Recomendação aprovada.'),
      });
      await recarregarFila();
    } catch {
      setAviso({ tone: 'erro', texto: 'Falha de rede ao registrar a decisão.' });
    } finally {
      setDecidindo(null);
    }
  }

  useEffect(() => {
    void carregar(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id, actualProfile?.id, dataInicio, dataFim]);

  const concessionarias = useMemo(() => {
    const grupos = new Map<string, { nome: string; ativa: boolean }>();
    corretores.forEach((corretor) => {
      const nome = String(corretor.nome_empresa || corretor.nome || '').trim();
      if (!nome) return;
      const chave = nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
      const atual = grupos.get(chave);
      if (atual) atual.ativa = atual.ativa || Boolean(corretor.campanhas_ativas);
      else grupos.set(chave, { nome, ativa: Boolean(corretor.campanhas_ativas) });
    });
    return Array.from(grupos.values());
  }, [corretores]);

  const semRastreio = metaAccounts.filter((conta) => conta.rastreio === 'aguardando_integracao');
  const comRastreio = metaAccounts.filter((conta) => conta.rastreio === 'ativo');
  const emAtencao = metaAccounts
    .map((conta) => ({ conta, status: classifyAccount(conta) }))
    .filter(({ status }) => status.tone !== 'emerald' && status.tone !== 'slate');

  const criticas = recomendacoes.filter((item) => item.severidade === 'critico').length;
  const investimento = metaAccounts.reduce((soma, conta) => soma + Number(conta.spend || 0), 0);
  const leadsTotais = comRastreio.reduce((soma, conta) => soma + Number(conta.leads || 0), 0);
  const investimentoRastreado = comRastreio.reduce((soma, conta) => soma + Number(conta.spend || 0), 0);
  const cplMedio = leadsTotais > 0 ? investimentoRastreado / leadsTotais : null;

  const ranking = metaAccounts.slice().sort((a, b) => scoreAccount(b) - scoreAccount(a));
  const maxSpend = Math.max(...ranking.map((conta) => Number(conta.spend || 0)), 1);
  const criativos = activeCreatives.slice().sort((a, b) => Number(b.spend || 0) - Number(a.spend || 0));

  return (
    <InternalLayout>
      <div className="orion-trafego" style={{ color: 'var(--tf-ink)' }}>
        <header className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--tf-accent-ink)' }}>
              Meta Ads + CRM
            </p>
            <h1 className="mt-1 text-3xl font-black tracking-tight sm:text-[34px]">Gestão de tráfego</h1>
            <p className="mt-1.5 max-w-2xl text-sm" style={{ color: 'var(--tf-ink-soft)' }}>
              As ações abaixo saem de regra fixa sobre os números do período. A IA só resume a carteira.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <MetaDatePicker
              startDate={dataInicio}
              endDate={dataFim}
              preset={presetLabel}
              onChange={(inicio, fim, label) => {
                setDataInicio(inicio);
                setDataFim(fim);
                setPresetLabel(label);
              }}
            />
            <button
              type="button"
              onClick={() => carregar(true)}
              disabled={loading || otimizando}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl px-5 text-sm font-bold text-white transition disabled:opacity-60"
              style={{ background: 'var(--tf-accent)' }}
            >
              {otimizando ? <Loader2 className="animate-spin" size={16} /> : <Sparkles size={16} />}
              {otimizando ? 'Analisando...' : 'Otimizar'}
            </button>
          </div>
        </header>

        {aviso ? (
          <div
            className="mb-5 flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm font-medium"
            style={{
              background: aviso.tone === 'ok' ? 'var(--tf-ok-soft)' : 'var(--tf-crit-soft)',
              borderColor: aviso.tone === 'ok' ? 'var(--tf-ok-border)' : 'var(--tf-crit-border)',
              color: aviso.tone === 'ok' ? 'var(--tf-ok)' : 'var(--tf-crit)',
            }}
          >
            <span>{aviso.texto}</span>
            <button type="button" onClick={() => setAviso(null)} aria-label="Fechar aviso" className="tf-no-lift shrink-0">
              <X size={16} />
            </button>
          </div>
        ) : null}

        {loading ? (
          <div className="flex flex-col items-center justify-center py-28">
            <Loader2 className="animate-spin" size={34} style={{ color: 'var(--tf-accent)' }} />
            <p className="mt-4 text-sm font-medium" style={{ color: 'var(--tf-ink-soft)' }}>Carregando painel...</p>
          </div>
        ) : error ? (
          <div className="rounded-2xl border p-10 text-center" style={{ background: 'var(--tf-surface)', borderColor: 'var(--tf-border)' }}>
            <ShieldAlert size={30} className="mx-auto mb-4" style={{ color: 'var(--tf-crit)' }} />
            <h2 className="text-lg font-bold">Não consegui carregar</h2>
            <p className="mx-auto mt-2 max-w-md text-sm" style={{ color: 'var(--tf-ink-soft)' }}>{error}</p>
            <button
              type="button"
              onClick={() => carregar(false)}
              className="mt-6 inline-flex h-11 items-center rounded-xl px-5 text-sm font-bold text-white"
              style={{ background: 'var(--tf-accent)' }}
            >
              Tentar de novo
            </button>
          </div>
        ) : (
          <>
            {semRastreio.length > 0 ? (
              <IntegrationBanner contas={semRastreio} />
            ) : null}

            {/* Faixa 1 — acao */}
            <Panel
              className="mb-6"
              title="Ações recomendadas"
              subtitle="Cada item aponta o alvo exato e o número que disparou a regra."
              badge={recomendacoes.length > 0 ? `${recomendacoes.length} na fila` : undefined}
              badgeTone={criticas > 0 ? 'red' : 'slate'}
            >
              {recomendacoes.length === 0 ? (
                <Empty
                  titulo="Nada aguardando decisão."
                  texto="Clique em Otimizar para reler as contas e gerar a fila do período selecionado."
                />
              ) : (
                <div className="space-y-3">
                  {recomendacoes.map((item, index) => (
                    <RecommendationCard
                      key={item.id || `${item.meta_ad_account_id}-${item.alvo_id}-${index}`}
                      item={item}
                      ocupado={decidindo === item.id}
                      onAprovar={() => {
                        if (
                          (item.acao === 'pausar_anuncio' && item.nivel === 'anuncio') ||
                          (item.acao === 'pausar_conjunto' && item.nivel === 'conjunto') ||
                          (item.acao === 'pausar_campanha' && item.nivel === 'campanha')
                        ) setConfirmando(item);
                        else void decidir(item, 'aprovar');
                      }}
                      onIgnorar={() => decidir(item, 'ignorar')}
                    />
                  ))}
                </div>
              )}
            </Panel>

            {/* Faixa 2 — leitura */}
            <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Kpi
                icon={Users}
                label="Concessionárias"
                value={String(concessionarias.length)}
                detail={`${comRastreio.length} com rastreio ativo`}
              />
              <Kpi
                icon={ListChecks}
                label="Ações críticas"
                value={String(criticas)}
                detail={`${recomendacoes.length} no total da fila`}
                tone={criticas > 0 ? 'red' : undefined}
              />
              <Kpi
                icon={TrendingUp}
                label="CPL médio"
                value={cplMedio === null ? '—' : formatBRL(cplMedio)}
                detail={cplMedio === null ? 'Sem leads rastreados no período' : `${leadsTotais} leads Orion no CRM`}
              />
              <Kpi
                icon={Sparkles}
                label="Análises hoje"
                value={String(analisesHoje)}
                detail={ultimaAnalise ? `Última: ${new Date(ultimaAnalise).toLocaleString('pt-BR')}` : 'Nenhuma análise registrada'}
              />
            </div>

            <div className="mb-6 grid gap-4 xl:grid-cols-2">
              <Panel title="Concessionárias em atenção" subtitle="Ordenadas por risco.">
                {emAtencao.length === 0 ? (
                  <Empty titulo="Nenhuma concessionária em atenção." texto="Todas as contas com rastreio ativo estão dentro das regras." />
                ) : (
                  <ul className="space-y-1.5">
                    {emAtencao.slice(0, 6).map(({ conta, status }) => (
                      <li key={`atencao-${conta.corretor_id}-${conta.meta_ad_account_id}`}>
                        <Link
                          href={`/trafego/otimizacoes?conta=${encodeURIComponent(conta.meta_ad_account_id || '')}`}
                          className="tf-no-lift flex items-center gap-3 rounded-xl border px-3 py-2.5 transition"
                          style={{ borderColor: 'var(--tf-border)', background: 'var(--tf-surface)' }}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-bold">{conta.concessionaria_nome || conta.corretor_nome}</span>
                            <span className="mt-0.5 block truncate text-xs" style={{ color: 'var(--tf-ink-soft)' }}>{status.detail}</span>
                          </span>
                          <Badge tone={status.tone} label={status.label} />
                          <ChevronRight size={15} style={{ color: 'var(--tf-ink-mute)' }} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>

              <Panel title="Leitura da IA" subtitle="Resumo da carteira. Não gera ação sozinha.">
                {resumoIa ? (
                  <p className="whitespace-pre-line text-sm leading-relaxed" style={{ color: 'var(--tf-ink-soft)' }}>{resumoIa}</p>
                ) : (
                  <Empty titulo="Sem leitura da IA ainda." texto="Clique em Otimizar para gerar o resumo do período." />
                )}
              </Panel>
            </div>

            {/* Faixa 3 — contexto */}
            <Collapsible title="Ranking da carteira" detail={`${ranking.length} conta(s) | ${formatBRL(investimento)} investidos no período`}>
              {ranking.length === 0 ? (
                <Empty titulo="Nenhuma conta Meta no período." texto="Confira se as concessionárias têm conta de anúncio vinculada." />
              ) : (
                <div className="space-y-3">
                  {ranking.map((conta, index) => {
                    const status = classifyAccount(conta);
                    const semRastreioAtivo = conta.rastreio !== 'ativo';
                    return (
                      <div
                        key={`rank-${conta.corretor_id}-${conta.meta_ad_account_id}`}
                        className="grid gap-3 border-b pb-3 last:border-b-0 last:pb-0 lg:grid-cols-[28px_200px_1fr_120px] lg:items-center"
                        style={{ borderColor: 'var(--tf-border)' }}
                      >
                        <span className="text-sm font-bold tabular-nums" style={{ color: 'var(--tf-ink-mute)' }}>{index + 1}</span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold">{conta.concessionaria_nome || conta.corretor_nome}</p>
                          <Badge tone={status.tone} label={status.label} />
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="h-2 flex-1 overflow-hidden rounded-full" style={{ background: 'var(--tf-surface-2)' }}>
                            <span
                              className="block h-full rounded-full"
                              style={{ width: `${Math.max(3, (Number(conta.spend || 0) / maxSpend) * 100)}%`, background: 'var(--tf-accent)' }}
                            />
                          </span>
                          <span className="w-24 text-right text-sm font-semibold tabular-nums">{formatBRL(conta.spend, conta.currency)}</span>
                        </div>
                        <div className="lg:text-right">
                          <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--tf-ink-mute)' }}>CPL</p>
                          <p
                            className="text-base font-black tabular-nums"
                            style={{ color: semRastreioAtivo ? 'var(--tf-ink-mute)' : Number(conta.cpl || 0) >= 28 ? 'var(--tf-crit)' : 'var(--tf-ink)' }}
                          >
                            {semRastreioAtivo ? '—' : formatBRL(conta.cpl, conta.currency)}
                          </p>
                          <p className="text-[11px]" style={{ color: 'var(--tf-ink-mute)' }}>
                            {semRastreioAtivo ? 'sem rastreio' : `${conta.leads || 0} leads`}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Collapsible>

            <Collapsible title="Criativos ativos" detail={`${criativos.length} anúncio(s) rodando`}>
              {criativos.length === 0 ? (
                <Empty titulo="Nenhum criativo ativo no período." texto="Rode Otimizar para reler os anúncios na Meta." />
              ) : (
                <div className="space-y-3">
                  {criativos.map((criativo) => {
                    const preview = bestCreativeImage(criativo);
                    return (
                      <div
                        key={`criativo-${criativo.id}`}
                        className="grid gap-3 border-b pb-3 last:border-b-0 last:pb-0 lg:grid-cols-[52px_1fr_110px_92px_110px] lg:items-center"
                        style={{ borderColor: 'var(--tf-border)' }}
                      >
                        <button
                          type="button"
                          onClick={() => preview && setFullscreenCreative(criativo)}
                          disabled={!preview}
                          className="tf-no-lift group relative grid h-12 w-12 place-items-center overflow-hidden rounded-lg border disabled:cursor-default"
                          style={{ borderColor: 'var(--tf-border)', background: 'var(--tf-surface-2)' }}
                          aria-label="Abrir criativo"
                        >
                          {preview ? (
                            <>
                              <img src={preview} alt={criativo.ad_name} className="h-full w-full object-cover" />
                              <span className="absolute inset-0 grid place-items-center bg-black/45 opacity-0 transition group-hover:opacity-100">
                                <Maximize2 size={14} className="text-white" />
                              </span>
                            </>
                          ) : (
                            <ImageIcon size={15} style={{ color: 'var(--tf-ink-mute)' }} />
                          )}
                        </button>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold">{criativo.ad_name}</p>
                          <p className="truncate text-xs" style={{ color: 'var(--tf-ink-soft)' }}>{criativo.concessionaria_nome}</p>
                        </div>
                        <p className="text-sm font-semibold tabular-nums lg:text-right">{formatBRL(criativo.spend, criativo.currency)}</p>
                        <p className="text-sm tabular-nums lg:text-right" style={{ color: 'var(--tf-ink-soft)' }}>{criativo.leads || 0} leads</p>
                        <p
                          className="text-sm font-bold tabular-nums lg:text-right"
                          style={{ color: Number(criativo.cpl || 0) >= 28 ? 'var(--tf-crit)' : 'var(--tf-ink)' }}
                        >
                          {formatBRL(criativo.cpl, criativo.currency)}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </Collapsible>
          </>
        )}

        {confirmando ? (
          <ConfirmDialog
            item={confirmando}
            ocupado={decidindo === confirmando.id}
            onCancelar={() => setConfirmando(null)}
            onConfirmar={() => decidir(confirmando, 'aprovar', true)}
          />
        ) : null}

        {fullscreenCreative && bestCreativeImage(fullscreenCreative) ? (
          <div className="fixed inset-0 z-50 grid place-items-center bg-black/85 p-4">
            <button
              type="button"
              onClick={() => setFullscreenCreative(null)}
              className="tf-no-lift absolute right-5 top-5 grid h-11 w-11 place-items-center rounded-full bg-white/15 text-white"
              aria-label="Fechar"
            >
              <X size={20} />
            </button>
            <img
              src={bestCreativeImage(fullscreenCreative)}
              alt={fullscreenCreative.ad_name}
              className="max-h-[88vh] w-auto max-w-full rounded-xl object-contain"
            />
          </div>
        ) : null}
      </div>
    </InternalLayout>
  );
}

function IntegrationBanner({ contas }: { contas: MetaAccount[] }) {
  const [aberto, setAberto] = useState(false);

  return (
    <div
      className="mb-6 rounded-2xl border p-4"
      style={{ background: 'var(--tf-idle-soft)', borderColor: 'var(--tf-idle-border)' }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex gap-3">
          <PlugZap size={18} className="mt-0.5 shrink-0" style={{ color: 'var(--tf-idle)' }} />
          <div>
            <p className="text-sm font-bold">
              {contas.length} concessionária{contas.length > 1 ? 's' : ''} ainda sem integração de leads
            </p>
            <p className="mt-1 max-w-3xl text-sm" style={{ color: 'var(--tf-ink-soft)' }}>
              Os leads dessas contas ainda não chegam ao CRM, então o CPL delas não pode ser calculado. Elas ficaram
              fora do ranking, dos alertas e da fila de ações de propósito: o que falta é integração, não campanha.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setAberto((valor) => !valor)}
          className="tf-no-lift text-xs font-bold underline"
          style={{ color: 'var(--tf-accent-ink)' }}
        >
          {aberto ? 'Esconder' : 'Ver quais'}
        </button>
      </div>

      {aberto ? (
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {contas.map((conta) => (
            <li
              key={`sem-rastreio-${conta.corretor_id}-${conta.meta_ad_account_id}`}
              className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2"
              style={{ background: 'var(--tf-surface)', borderColor: 'var(--tf-border)' }}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{conta.concessionaria_nome || conta.corretor_nome}</span>
                <span className="text-xs" style={{ color: 'var(--tf-ink-mute)' }}>
                              {formatBRL(conta.spend, conta.currency)} investidos desde o início Orion
                </span>
              </span>
              <Badge tone="slate" label={TRACKING_LABELS.aguardando_integracao} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function RecommendationCard({
  item,
  ocupado,
  onAprovar,
  onIgnorar,
}: {
  item: Recomendacao;
  ocupado: boolean;
  onAprovar: () => void;
  onIgnorar: () => void;
}) {
  const Icon = ACTION_ICON[item.acao] || AlertTriangle;
  const tone = item.severidade === 'critico' ? 'red' : 'amber';
  const cores = TONE_VAR[tone];
  const pausaNaMeta =
    (item.acao === 'pausar_anuncio' && item.nivel === 'anuncio') ||
    (item.acao === 'pausar_conjunto' && item.nivel === 'conjunto') ||
    (item.acao === 'pausar_campanha' && item.nivel === 'campanha');

  return (
    <div
      className="grid gap-3 rounded-xl border p-4 lg:grid-cols-[40px_1fr_auto] lg:items-start"
      style={{ background: 'var(--tf-surface)', borderColor: 'var(--tf-border)' }}
    >
      <div
        className="grid h-10 w-10 place-items-center rounded-lg border"
        style={{ background: cores.bg, borderColor: cores.border, color: cores.fg }}
      >
        <Icon size={18} />
      </div>

      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-bold">{ACTION_LABELS[item.acao]}</p>
          <Badge tone={tone} label={item.severidade === 'critico' ? 'Crítico' : 'Atenção'} />
          {pausaNaMeta ? (
            <span className="text-[11px] font-semibold" style={{ color: 'var(--tf-ink-mute)' }}>
              executa na Meta
            </span>
          ) : null}
        </div>

        {item.alvo_nome ? (
          <p className="mt-1.5 truncate text-sm font-semibold" style={{ color: 'var(--tf-accent-ink)' }}>
            {item.nivel === 'anuncio' ? 'Anúncio: ' : ''}{item.alvo_nome}
          </p>
        ) : null}

        <p className="mt-1 text-sm leading-relaxed" style={{ color: 'var(--tf-ink-soft)' }}>{item.motivo}</p>

        <p className="mt-1.5 text-xs" style={{ color: 'var(--tf-ink-mute)' }}>
          {item.concessionaria_nome}
        </p>
      </div>

      <div className="flex gap-2 lg:flex-col">
        <button
          type="button"
          onClick={onAprovar}
          disabled={ocupado || !item.id}
          className="tf-no-lift inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-bold text-white transition disabled:opacity-50 lg:w-32"
          style={{ background: 'var(--tf-accent)' }}
        >
          {ocupado ? <Loader2 className="animate-spin" size={13} /> : pausaNaMeta ? <Pause size={13} /> : <Check size={13} />}
          {pausaNaMeta ? 'Pausar' : 'Aprovar'}
        </button>
        <button
          type="button"
          onClick={onIgnorar}
          disabled={ocupado || !item.id}
          className="tf-no-lift inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 text-xs font-bold transition disabled:opacity-50 lg:w-32"
          style={{ borderColor: 'var(--tf-border)', color: 'var(--tf-ink-soft)' }}
        >
          <Ban size={13} />
          Ignorar
        </button>
      </div>
    </div>
  );
}

function ConfirmDialog({
  item,
  ocupado,
  onCancelar,
  onConfirmar,
}: {
  item: Recomendacao;
  ocupado: boolean;
  onCancelar: () => void;
  onConfirmar: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-4">
      <div
        className="w-full max-w-md rounded-2xl border p-6"
        style={{ background: 'var(--tf-surface)', borderColor: 'var(--tf-border)', boxShadow: 'var(--tf-shadow)' }}
      >
        <div
          className="mb-4 grid h-11 w-11 place-items-center rounded-xl border"
          style={{ background: 'var(--tf-crit-soft)', borderColor: 'var(--tf-crit-border)', color: 'var(--tf-crit)' }}
        >
          <Pause size={20} />
        </div>

        <h2 className="text-lg font-bold">Pausar este {item.nivel} na Meta?</h2>
        <p className="mt-2 text-sm leading-relaxed" style={{ color: 'var(--tf-ink-soft)' }}>
          A pausa acontece agora, direto na conta de anúncios. Para religar, é preciso entrar no Gerenciador de Anúncios.
        </p>

        <div className="mt-4 rounded-xl border p-3" style={{ background: 'var(--tf-surface-2)', borderColor: 'var(--tf-border)' }}>
          <p className="text-sm font-bold">{item.alvo_nome}</p>
          <p className="mt-1 text-xs" style={{ color: 'var(--tf-ink-soft)' }}>{item.concessionaria_nome}</p>
          <p className="mt-2 text-sm" style={{ color: 'var(--tf-ink-soft)' }}>{item.motivo}</p>
        </div>

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={onCancelar}
            className="tf-no-lift h-11 flex-1 rounded-xl border text-sm font-bold"
            style={{ borderColor: 'var(--tf-border)', color: 'var(--tf-ink-soft)' }}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirmar}
            disabled={ocupado}
            className="tf-no-lift inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl text-sm font-bold text-white disabled:opacity-60"
            style={{ background: 'var(--tf-crit)' }}
          >
            {ocupado ? <Loader2 className="animate-spin" size={15} /> : <Pause size={15} />}
            Pausar agora
          </button>
        </div>
      </div>
    </div>
  );
}

function Panel({
  title,
  subtitle,
  children,
  badge,
  badgeTone = 'slate',
  className = '',
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  badge?: string;
  badgeTone?: string;
  className?: string;
}) {
  return (
    <section
      className={`rounded-2xl border p-5 ${className}`}
      style={{ background: 'var(--tf-surface)', borderColor: 'var(--tf-border)', boxShadow: 'var(--tf-shadow)' }}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-bold">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-xs" style={{ color: 'var(--tf-ink-soft)' }}>{subtitle}</p> : null}
        </div>
        {badge ? <Badge tone={badgeTone} label={badge} /> : null}
      </div>
      {children}
    </section>
  );
}

function Collapsible({ title, detail, children }: { title: string; detail?: string; children: ReactNode }) {
  const [aberto, setAberto] = useState(false);

  return (
    <section
      className="mb-4 overflow-hidden rounded-2xl border"
      style={{ background: 'var(--tf-surface)', borderColor: 'var(--tf-border)' }}
    >
      <button
        type="button"
        onClick={() => setAberto((valor) => !valor)}
        className="tf-no-lift flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
      >
        <span>
          <span className="block text-base font-bold">{title}</span>
          {detail ? <span className="mt-0.5 block text-xs" style={{ color: 'var(--tf-ink-soft)' }}>{detail}</span> : null}
        </span>
        {aberto ? <ChevronDown size={17} style={{ color: 'var(--tf-ink-mute)' }} /> : <ChevronRight size={17} style={{ color: 'var(--tf-ink-mute)' }} />}
      </button>
      {aberto ? <div className="border-t px-5 py-4" style={{ borderColor: 'var(--tf-border)' }}>{children}</div> : null}
    </section>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: any;
  label: string;
  value: string;
  detail: string;
  tone?: string;
}) {
  const cores = tone ? TONE_VAR[tone] : null;

  return (
    <div
      className="rounded-2xl border p-4"
      style={{ background: 'var(--tf-surface)', borderColor: 'var(--tf-border)', boxShadow: 'var(--tf-shadow)' }}
    >
      <div className="mb-3 flex items-center gap-2">
        <Icon size={15} style={{ color: 'var(--tf-ink-mute)' }} />
        <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--tf-ink-mute)' }}>{label}</p>
      </div>
      <p className="text-3xl font-black tabular-nums" style={{ color: cores ? cores.fg : 'var(--tf-ink)' }}>{value}</p>
      <p className="mt-1.5 text-xs" style={{ color: 'var(--tf-ink-soft)' }}>{detail}</p>
    </div>
  );
}

function Badge({ tone, label }: { tone: string; label: string }) {
  const cores = TONE_VAR[tone] || TONE_VAR.slate;
  return (
    <span
      className="inline-flex w-fit items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold"
      style={{ background: cores.bg, borderColor: cores.border, color: cores.fg }}
    >
      {label}
    </span>
  );
}

function Empty({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <div
      className="rounded-xl border border-dashed px-4 py-6 text-center"
      style={{ borderColor: 'var(--tf-border)' }}
    >
      <p className="text-sm font-semibold">{titulo}</p>
      <p className="mx-auto mt-1 max-w-md text-xs" style={{ color: 'var(--tf-ink-soft)' }}>{texto}</p>
    </div>
  );
}
