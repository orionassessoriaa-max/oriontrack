'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarDays, Download, Headphones, PhoneCall, RefreshCw, Target, TrendingUp } from 'lucide-react';
import { useCommercial } from '@/components/commercial/CommercialShell';
import { currency } from '@/lib/comercial';

type LinhaSdr = {
  profile_id: string;
  nome: string;
  ligacoes: number;
  voip: number;
  whatsapp: number;
  telefone: number;
  atendidas: number;
  taxa_atendimento: number;
  reunioes: number;
  vendas: number;
  faturado: number;
  meta_periodo: number;
};

type Gravacao = {
  id: string;
  quando: string;
  sdr: string;
  lead: string;
  numero: string | null;
  duracao_segundos: number | null;
  gravacao_url: string | null;
};

type Relatorio = {
  periodo: { start: string; end: string; dias_uteis: number };
  meta: { por_dia: number; no_periodo: number; do_time: number };
  totais: { ligacoes: number; voip: number; whatsapp: number; telefone: number; atendidas: number; reunioes: number; vendas: number; faturado: number; taxa_atendimento: number };
  ranking: LinhaSdr[];
  gravacoes: Gravacao[];
  sdrs: Array<{ id: string; nome: string }>;
  gravacao_ativa: boolean;
};

function isoHoje() {
  return new Date().toISOString().slice(0, 10);
}

function isoDiasAtras(dias: number) {
  const data = new Date();
  data.setDate(data.getDate() - dias);
  return data.toISOString().slice(0, 10);
}

function duracao(segundos: number | null) {
  if (!segundos) return '-';
  const min = Math.floor(segundos / 60);
  const seg = segundos % 60;
  return `${min}:${String(seg).padStart(2, '0')}`;
}

export default function ComercialRelatoriosPage() {
  const { api } = useCommercial();
  const [start, setStart] = useState(isoDiasAtras(6));
  const [end, setEnd] = useState(isoHoje());
  const [sdr, setSdr] = useState('');
  const [dados, setDados] = useState<Relatorio | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const busca = new URLSearchParams({ start, end, ...(sdr ? { sdr } : {}) });
      setDados(await api(`/api/comercial/relatorios/sdr?${busca.toString()}`));
    } catch (causa) {
      setErro(causa instanceof Error ? causa.message : 'Nao foi possivel carregar o relatorio.');
    } finally {
      setCarregando(false);
    }
  }, [api, end, sdr, start]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar(); }, [carregar]);

  function exportarCsv() {
    if (!dados) return;
    const linhas = [
      'sdr,ligacoes,voip,whatsapp,telefone,atendidas,taxa,reunioes,vendas,faturado,meta',
      ...dados.ranking.map((linha) => [
        `"${linha.nome}"`, linha.ligacoes, linha.voip, linha.whatsapp, linha.telefone, linha.atendidas,
        `${(linha.taxa_atendimento * 100).toFixed(1)}%`, linha.reunioes, linha.vendas, linha.faturado, linha.meta_periodo,
      ].join(',')),
    ].join('\n');
    const url = URL.createObjectURL(new Blob([linhas], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `relatorio-sdr-${start}-a-${end}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const totais = dados?.totais;
  const atalhos: Array<[string, () => void]> = [
    ['Hoje', () => { setStart(isoHoje()); setEnd(isoHoje()); }],
    ['7 dias', () => { setStart(isoDiasAtras(6)); setEnd(isoHoje()); }],
    ['30 dias', () => { setStart(isoDiasAtras(29)); setEnd(isoHoje()); }],
    ['Este mes', () => { setStart(`${isoHoje().slice(0, 7)}-01`); setEnd(isoHoje()); }],
  ];

  return (
    <div>
      <header className="kh-page-head">
        <div>
          <div className="kh-eyebrow">Esforco comercial</div>
          <h1>Relatorio do SDR</h1>
          <p>Ligacoes pela central, pelo telefone e pelo WhatsApp, com meta, reunioes e vendas do periodo.</p>
        </div>
        <div className="kh-actions">
          <button className="kh-icon-button" onClick={() => void carregar()} aria-label="Atualizar">
            <RefreshCw size={17} className={carregando ? 'kh-spin' : ''} />
          </button>
          <button className="kh-button" onClick={exportarCsv} disabled={!dados}>
            <Download size={16} /> Exportar CSV
          </button>
        </div>
      </header>

      <section className="kh-relatorio-filtros">
        <div className="kh-relatorio-atalhos">
          {atalhos.map(([rotulo, aplicar]) => (
            <button key={rotulo} type="button" className="kh-button" onClick={aplicar}>{rotulo}</button>
          ))}
        </div>
        <label>
          <span>De</span>
          <input className="kh-input" type="date" value={start} max={end} onChange={(evento) => setStart(evento.target.value)} />
        </label>
        <label>
          <span>Ate</span>
          <input className="kh-input" type="date" value={end} min={start} onChange={(evento) => setEnd(evento.target.value)} />
        </label>
        <label>
          <span>SDR</span>
          <select className="kh-select" value={sdr} onChange={(evento) => setSdr(evento.target.value)}>
            <option value="">Todos os SDRs</option>
            {(dados?.sdrs || []).map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}
          </select>
        </label>
      </section>

      {erro && <div className="kh-inline-error">{erro}</div>}

      <section className="kh-task-summary kh-relatorio-kpis">
        <div className="blue"><PhoneCall size={17} /><span>Ligacoes</span><strong>{totais?.ligacoes ?? '—'}</strong></div>
        <div className="green"><Headphones size={17} /><span>Atendidas</span><strong>{totais?.atendidas ?? '—'}</strong></div>
        <div className="yellow"><Target size={17} /><span>Meta do periodo</span><strong>{dados?.meta.do_time ?? '—'}</strong></div>
        <div className="blue"><CalendarDays size={17} /><span>Reunioes</span><strong>{totais?.reunioes ?? '—'}</strong></div>
        <div className="green"><TrendingUp size={17} /><span>Vendas</span><strong>{totais?.vendas ?? '—'}</strong></div>
      </section>

      <section className="kh-panel kh-relatorio-tabela">
        <div className="kh-panel-header">
          <div>
            <span>Ranking do periodo</span>
            <h2>{dados ? `${dados.periodo.start.split('-').reverse().join('/')} a ${dados.periodo.end.split('-').reverse().join('/')}` : 'Carregando'}</h2>
          </div>
          <span>{dados?.periodo.dias_uteis || 0} dias uteis · meta {dados?.meta.por_dia || 100}/dia</span>
        </div>
        <table className="kh-relatorio-grade">
          <thead>
            <tr>
              <th>SDR</th><th>Ligacoes</th><th>Central</th><th>WhatsApp</th><th>Telefone</th>
              <th>Atendidas</th><th>Taxa</th><th>Reunioes</th><th>Vendas</th><th>Meta</th>
            </tr>
          </thead>
          <tbody>
            {(dados?.ranking || []).map((linha) => {
              const percentualMeta = linha.meta_periodo ? (linha.ligacoes / linha.meta_periodo) * 100 : 0;
              return (
                <tr key={linha.profile_id}>
                  <td><strong>{linha.nome}</strong></td>
                  <td><b>{linha.ligacoes}</b></td>
                  <td>{linha.voip}</td>
                  <td>{linha.whatsapp}</td>
                  <td>{linha.telefone}</td>
                  <td className="kh-relatorio-ok">{linha.atendidas}</td>
                  <td>{(linha.taxa_atendimento * 100).toFixed(0)}%</td>
                  <td>{linha.reunioes}</td>
                  <td>{linha.vendas ? `${linha.vendas} · ${currency(linha.faturado)}` : '0'}</td>
                  <td>
                    <div className="kh-relatorio-meta">
                      <i style={{ width: `${Math.min(100, percentualMeta)}%` }} />
                      <span>{linha.ligacoes}/{linha.meta_periodo}</span>
                    </div>
                  </td>
                </tr>
              );
            })}
            {!carregando && !dados?.ranking.length && (
              <tr><td colSpan={10} className="kh-relatorio-vazio">Nenhum SDR ativo no periodo.</td></tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="kh-panel kh-relatorio-tabela">
        <div className="kh-panel-header">
          <div>
            <span>Escuta</span>
            <h2>Gravacoes das ligacoes atendidas</h2>
          </div>
          <span>{dados?.gravacoes.length || 0} chamadas</span>
        </div>
        {dados && !dados.gravacao_ativa && (
          <div className="kh-relatorio-aviso">
            A gravacao esta desativada nas duas linhas da central. Assim que a operadora ligar, o audio de cada
            chamada atendida aparece aqui automaticamente.
          </div>
        )}
        <table className="kh-relatorio-grade">
          <thead>
            <tr><th>Quando</th><th>SDR</th><th>Lead</th><th>Numero</th><th>Duracao</th><th>Audio</th></tr>
          </thead>
          <tbody>
            {(dados?.gravacoes || []).map((item) => (
              <tr key={item.id}>
                <td>{new Date(item.quando).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                <td>{item.sdr}</td>
                <td>{item.lead}</td>
                <td>{item.numero || '-'}</td>
                <td>{duracao(item.duracao_segundos)}</td>
                <td>
                  {item.gravacao_url
                    ? <audio controls preload="none" src={item.gravacao_url} className="kh-relatorio-audio" />
                    : <span className="kh-relatorio-sem-audio">sem gravacao</span>}
                </td>
              </tr>
            ))}
            {!carregando && !dados?.gravacoes.length && (
              <tr><td colSpan={6} className="kh-relatorio-vazio">Nenhuma ligacao atendida pela central neste periodo.</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
