'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bot, Loader2, Power, RefreshCw, Save, Send, Settings, Smartphone } from 'lucide-react';
import { useCommercial } from '@/components/commercial/CommercialShell';
import { DEFAULT_COMMERCIAL_SDR_PROMPT } from '@/lib/commercialSdrPrompt';

const DEFAULT_BOT_PROMPT = 'Ola, {primeiro_nome}! Tudo bem?\n\nVi que voce acabou de preencher nosso formulario. Vou te fazer algumas perguntas bem rapidinhas para entender seu momento e te direcionar melhor, tudo bem?';

export default function CommercialAiPage() {
  const { api, role } = useCommercial();
  const [active, setActive] = useState(true);
  const [prompt, setPrompt] = useState(DEFAULT_COMMERCIAL_SDR_PROMPT);
  const [botActive, setBotActive] = useState(false);
  const [botPrompt, setBotPrompt] = useState(DEFAULT_BOT_PROMPT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [testPhone, setTestPhone] = useState('');
  const [testName, setTestName] = useState('Teste IA');
  const [testAges, setTestAges] = useState('32');
  const [testEmail, setTestEmail] = useState('');
  const [testTraffic, setTestTraffic] = useState('');
  const [testRevenue, setTestRevenue] = useState('');
  const [testInvestment, setTestInvestment] = useState('');
  const [testPriority, setTestPriority] = useState('');
  const [testLives, setTestLives] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState('');

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await api('/api/comercial/ia-config');
      setActive(payload.active !== false);
      setPrompt(payload.prompt || DEFAULT_COMMERCIAL_SDR_PROMPT);
      setBotActive(payload.botActive === true);
      setBotPrompt(payload.botPrompt || DEFAULT_BOT_PROMPT);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { void loadConfig(); }, [loadConfig]);

  async function saveConfig() {
    setSaving(true);
    setNotice('');
    try {
      await api('/api/comercial/ia-config', {
        method: 'PATCH',
        body: JSON.stringify({ active, prompt, botActive, botPrompt }),
      });
      setNotice('Configuracao da IA e do Bot salva.');
      await loadConfig();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Nao foi possivel salvar.');
    } finally {
      setSaving(false);
    }
  }

  async function sendTest(event: React.FormEvent) {
    event.preventDefault();
    setTesting(true);
    setTestResult('');
    setNotice('');
    try {
      const payload = await api('/api/comercial/ai/test', {
        method: 'POST',
        body: JSON.stringify({ telefone: testPhone, nome: testName, idades: testAges, email: testEmail, ja_investiu_trafego: testTraffic, faturamento_mensal: testRevenue, investimento: testInvestment, prioridade: testPriority, vidas: testLives }),
      });
      setTestResult(`Teste enviado para ${payload.lead?.nome || testName}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Nao foi possivel enviar o teste.');
    } finally {
      setTesting(false);
    }
  }

  const canEdit = role === 'coordenador';

  return <div>
    <header className="kh-page-head"><div><div className="kh-eyebrow">Automacao comercial</div><h1>IA</h1><p>Configure a IA SDR e o Bot que fazem o primeiro contato com os leads.</p></div><button className="kh-icon-button" onClick={() => void loadConfig()} aria-label="Atualizar"><RefreshCw size={17} className={loading ? 'kh-spin' : ''} /></button></header>

    <section className="kh-panel kh-sdr-config"><div className="kh-panel-header"><div><span>Atendimento inteligente</span><h2>IA SDR da Orion</h2></div><span className={`kh-badge ${active ? 'green' : 'red'}`}><Power size={12} /> {active ? 'Ativa' : 'Inativa'}</span></div><div className="kh-sdr-config-body"><div className="kh-sdr-status"><div className="kh-ai-mark"><Bot size={23} /></div><div><strong>IA SDR</strong><p>A IA conversa com o lead, entende o momento comercial e conduz a qualificacao.</p></div><button type="button" className={`kh-toggle ${active ? 'active' : ''}`} onClick={() => { setActive((value) => !value); setBotActive(false); }} aria-pressed={active} disabled={!canEdit}><span /></button></div><label className="kh-sdr-prompt"><span><Settings size={14} /> Prompt da IA SDR</span><textarea className="kh-textarea" value={prompt} onChange={(event) => setPrompt(event.target.value)} disabled={!canEdit} /><small>{canEdit ? 'A IA usa este prompt para responder aos leads.' : 'Somente o coordenador pode alterar o prompt.'}</small></label></div></section>

    <section className="kh-panel kh-sdr-config kh-commercial-bot-config"><div className="kh-panel-header"><div><span>Primeiro contato</span><h2>Bot de primeira mensagem</h2></div><span className={`kh-badge ${botActive ? 'green' : 'red'}`}><Power size={12} /> {botActive ? 'Ativo' : 'Inativo'}</span></div><div className="kh-sdr-config-body"><div className="kh-sdr-status"><div className="kh-ai-mark"><Send size={23} /></div><div><strong>Bot de abertura</strong><p>Envia apenas a primeira mensagem assim que o lead entra no CRM. Quando ele estiver ativo, a IA SDR fica desativada.</p></div><button type="button" className={`kh-toggle ${botActive ? 'active' : ''}`} onClick={() => { setBotActive((value) => !value); setActive(false); }} aria-pressed={botActive} disabled={!canEdit}><span /></button></div><label className="kh-sdr-prompt"><span><Smartphone size={14} /> Primeira mensagem do bot</span><textarea className="kh-textarea" value={botPrompt} onChange={(event) => setBotPrompt(event.target.value)} disabled={!canEdit} placeholder="Use {primeiro_nome} para inserir o primeiro nome do lead." /><small>Variaveis disponiveis: {'{primeiro_nome}'} e {'{nome}'}. O bot nao continua a conversa.</small></label></div></section>

    {canEdit && <section className="kh-panel kh-sdr-test"><div className="kh-panel-header"><div><span>Validacao da operacao</span><h2>Enviar teste da IA SDR</h2></div><span className="kh-badge blue"><Send size={12} /> WhatsApp</span></div><p className="kh-sdr-test-copy">Preencha os mesmos dados do funil para testar a abordagem da Aline com um lead real.</p><form className="kh-sdr-test-grid" onSubmit={(event) => void sendTest(event)}><label><span>WhatsApp destino</span><input className="kh-input" value={testPhone} onChange={(event) => setTestPhone(event.target.value)} placeholder="Ex.: 5561999999999" required /></label><label><span>Nome do lead</span><input className="kh-input" value={testName} onChange={(event) => setTestName(event.target.value)} required /></label><label><span>E-mail</span><input className="kh-input" type="email" value={testEmail} onChange={(event) => setTestEmail(event.target.value)} /></label><label><span>Idades</span><input className="kh-input" value={testAges} onChange={(event) => setTestAges(event.target.value)} /></label><label className="kh-test-wide"><span>Ja investiu em trafego pago?</span><select className="kh-select" value={testTraffic} onChange={(event) => setTestTraffic(event.target.value)}><option value="">Selecione uma opcao</option><option>Ja contratei uma agencia no passado</option><option>Nunca fiz anuncios</option><option>Ja fiz anuncios por conta propria</option></select></label><label className="kh-test-wide"><span>Faturamento mensal</span><select className="kh-select" value={testRevenue} onChange={(event) => setTestRevenue(event.target.value)}><option value="">Selecione uma faixa</option><option>Abaixo de R$10 mil</option><option>R$10 mil a R$20 mil</option><option>R$20 mil a R$50 mil</option><option>Acima de R$50 mil</option></select></label><label><span>Investimento mensal</span><select className="kh-select" value={testInvestment} onChange={(event) => setTestInvestment(event.target.value)}><option value="">Selecione uma faixa</option><option>Ate 1500</option><option>Ate 2500</option><option>Ate 5000</option><option>Mais de 5000</option></select></label><label><span>Prioridade</span><select className="kh-select" value={testPriority} onChange={(event) => setTestPriority(event.target.value)}><option value="">Selecione uma opcao</option><option>Baixa</option><option>Media</option><option>Alta</option></select></label><label><span>Vidas por mes</span><select className="kh-select" value={testLives} onChange={(event) => setTestLives(event.target.value)}><option value="">Selecione uma faixa</option><option>Ate 10</option><option>De 10 a 30</option><option>De 30 a 100</option><option>Mais de 100</option></select></label><button className="kh-button primary" disabled={testing || (!active && !botActive)}>{testing ? <Loader2 size={15} className="kh-spin" /> : <Send size={15} />}{testing ? 'Enviando...' : 'Testar IA'}</button></form>{testResult && <p className="kh-sdr-test-success">{testResult}</p>}</section>}

    <footer className="kh-sdr-config-footer kh-commercial-ai-save">{notice && <span>{notice}</span>}{canEdit && <button className="kh-button primary" onClick={() => void saveConfig()} disabled={saving}><Save size={15} /> {saving ? 'Salvando...' : 'Salvar configuracao'}</button>}</footer>
  </div>;
}
