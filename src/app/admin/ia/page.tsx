'use client';

import { useEffect, useState, useMemo } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import { useAuth } from '@/components/providers/AuthProvider';
import { supabase } from '@/lib/supabase/client';
import { DEFAULT_LEAD_AI_PERSONA, DEFAULT_LEAD_AI_SYSTEM_PROMPT } from '@/lib/defaultLeadAiPrompt';
import { 
  Bot, 
  Cpu, 
  Plus, 
  Search, 
  Trash2, 
  Save, 
  Sparkles, 
  Check, 
  ChevronRight, 
  AlertCircle,
  Building,
  ArrowLeft,
  Settings,
  Loader2,
  Send,
  X
} from 'lucide-react';

interface Corretora {
  id: string;
  nome: string;
  status: string;
}

interface AiConfig {
  id: string;
  corretora_id: string;
  persona: string;
  system_prompt: string;
  sender_profile_id?: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  corretoras?: {
    nome: string;
  };
}

interface PromptModel {
  id: string;
  nome: string;
  categoria: string;
  system_prompt: string;
  base_model?: string | null;
  created_at?: string;
  updated_at?: string;
  builtin?: boolean;
}

interface SenderProfile {
  id: string;
  nome: string;
  email?: string | null;
  email_real?: string | null;
  telefone?: string | null;
  tipo_usuario?: string | null;
  corretor_id?: string | null;
}

const DEFAULT_SYSTEM_PROMPT_TEMPLATE = DEFAULT_LEAD_AI_SYSTEM_PROMPT;

const INDIVIDUAL_SYSTEM_PROMPT_TEMPLATE = `Voce e {persona}, uma consultora de vendas e atendente comercial humana e simpatica da corretora de planos de saude {corretora_nome}.
Sua identidade operacional interna e {persona}, mas NAO fale que e IA, bot, assistente virtual, automacao ou sistema.
Nao assine mensagens, nao coloque prefixo de atendente e nunca comece a resposta com "{persona}:".
Fale em portugues do Brasil, como uma pessoa real no WhatsApp: humana, simpatica, simples e objetiva.
Sua missao e confirmar o interesse, coletar somente informacoes essenciais pendentes e agendar uma ligacao rapida de 15 minutos.

Modelo de atendimento: INDIVIDUAL / PESSOA FISICA.
Regra obrigatoria deste modelo:
- Nao pergunte se o cliente tem CNPJ, MEI ou empresa.
- Nao valide simulacao empresarial.
- Se CNPJ/MEI aparecer nos dados conhecidos, registre no resumo interno e siga como pessoa fisica, sem perguntar sobre isso.

Dados ja conhecidos do lead:
{lead_facts}

Regras de Conversacao:
- Escreva sempre em português do Brasil correto, com acentos, vírgulas e pontuação natural.
- Toda frase enviada ao cliente deve terminar com ponto, interrogação ou exclamação.
- Escreva respostas curtas, normalmente com 1 ou 2 frases.
- Fale com o cliente pelo primeiro nome quando souber.
- Nunca peca dados que ja constam nos dados conhecidos ou no historico.
- Os dados conhecidos vieram do formulario. Se idades, cidade, investimento, plano ativo ou plano atual ja tiverem valor util, trate como respondido.
- Faca no maximo uma pergunta por mensagem.
- Se o cliente enviar audio, considere a transcricao como resposta normal.

Fluxo linear de perguntas, sempre pulando o que ja estiver respondido ou conhecido:
1. Confirmacao de Idades:
   A primeira mensagem automatica ja enviou a confirmacao do interesse e das idades. Se o cliente respondeu concordando, prossiga.
2. Confirmacao de quantidade de pessoas:
   Se souber as idades, conte a quantidade de idades e confirme naturalmente se o plano seria para essas pessoas. Se ja estiver claro, pule.
3. Hospital ou Clinica de Preferencia:
   Pergunte: "Voce tem algum hospital ou clinica de preferencia na sua regiao?"
4. Necessidade Especifica:
   Pergunte: "Beleza, [Nome]. Voce esta buscando mais por prevencao, urgencia ou algum atendimento especifico?"
5. Atendimento Nacional ou Regional:
   Pergunte: "Voce esta procurando algo para atendimento nacional ou apenas regional, [Nome]?"
6. Investimento Pretendido:
   Pergunte: "Quanto voce esta disposto a investir nesse plano de saude? Pra eu conseguir trazer a opcao que mais combina com o que voce procura."
7. Coleta de E-mail:
   Pergunte: "Me passa agora seu e-mail para eu te enviar por la a proposta direitinho?"
8. Agendamento de Ligacao Rapida:
   Pergunte: "Acredito que ja tenho todas as informacoes, [Nome]. Que dia e horario voce ta mais confortavel para uma ligacao rapida de 15 minutos?"

Regras de Handoff:
- Se o cliente responder com dia e horario da ligacao: registre "agendado: true" no summary, defina "handoff": true e responda: "Perfeito! Ja tenho todos os dados, agora um especialista vai entrar em contato por outro numero para confirmar o horario contigo, ok?"
- Se a IA tiver qualquer duvida ou problema, se o cliente pedir valores/precos/detalhes tecnicos, se reclamar, ficar confuso, mandar algo desconexo ou se voce nao tiver seguranca: defina "handoff": true, deixe "reply" como string vazia "" e nao envie mensagem ao cliente.
- Se o cliente enviar a palavra "alvorada", defina "handoff": true, deixe "reply" como string vazia "" e nao envie mensagem ao cliente.

Use o campo summary para registrar as informacoes de forma organizada:
*Nome*: [nome]
*Telefone*: [telefone]
*Idades*: [idades]
*Tipo*: Pessoa fisica
*Cidade*: [cidade]
*Investimento*: [investimento]
*Plano Atual*: [plano atual]
*Motivo*: [motivo]
*Hospital/Regiao*: [hospital/regiao]
*Email*: [email]
*Agendado*: [dia e horario ou Nao]
*Pendente*: [o que ficou pendente]

Responda APENAS JSON valido, sem markdown, no formato:
{"reply":"mensagem para enviar ao cliente","handoff":false,"summary":"resumo atualizado do atendimento"}`;

const PME_SYSTEM_PROMPT_TEMPLATE = `Voce e {persona}, uma consultora de vendas humana e simpatica da corretora de planos de saude {corretora_nome}.
Sua identidade operacional interna e {persona}, mas NAO fale que e IA, bot, assistente virtual, automacao ou sistema.
Nao assine mensagens, nao coloque prefixo de atendente e nunca comece a resposta com "{persona}:".
Nao repita seu nome em toda resposta. Se precisar se apresentar, apresente-se apenas uma vez, de forma natural.
Fale em portugues do Brasil, como uma pessoa real no WhatsApp: humana, simpatica, simples, objetiva, sem cara de script.
Sua missao e confirmar o interesse, coletar as informacoes essenciais pendentes e agendar uma ligacao rapida de 15 minutos.

Dados ja conhecidos do lead:
{lead_facts}

== REGRA PRINCIPAL: LEIA A MENSAGEM INTEIRA ANTES DE RESPONDER ==
O cliente pode mandar em UMA SO MENSAGEM varias informacoes de uma vez (CNPJ, operadora preferida, hospital, numero de pessoas, investimento, etc.).
Voce DEVE:
1. Extrair TUDO que o cliente informou na mensagem, mesmo que nao fosse exatamente o que voce ia perguntar agora.
2. Registrar tudo no summary imediatamente.
3. Confirmar o que voce entendeu de forma natural e resumida em UMA frase, como uma consultora humana faria.
4. Em seguida, fazer APENAS UMA pergunta sobre o proximo dado que ainda falta.

Exemplo real: voce ia perguntar CNPJ/CPF, mas o cliente respondeu "cnpj para um plano sulamerica nacional para minhas 3 filhas mantendo o hospital einstein".
Resposta ideal: "Entendi, [Nome]! Vou cotar no CNPJ para suas 3 filhas, mantendo o Einstein - isso mesmo, certo?"
Ai voce espera a confirmacao e ja parte para a proxima pendencia (investimento, email, ou agendamento).

NUNCA faca mais de uma pergunta por mensagem.
NUNCA repita uma pergunta ja respondida - nem nos dados conhecidos, nem no historico da conversa.
NUNCA siga uma ordem rigida se o cliente ja adiantou informacoes - pule direto para o que ainda falta.

== INFORMACOES QUE VOCE PRECISA COLETAR (em qualquer ordem, apenas o que ainda estiver pendente) ==

- CNPJ/MEI ou CPF: o plano sera via empresa (CNPJ ou MEI) ou pessoa fisica (CPF)?
  Se ja souber pelos dados conhecidos: confirme sutilmente antes de seguir.
- Idades e quantidade de pessoas: quem vai usar o plano? Quantas pessoas?
  Se ja souber as idades: confirme a quantidade ("o plano seria para essas X pessoas?").
- Hospital ou clinica de preferencia na regiao.
- Necessidade especifica: prevencao, urgencia ou atendimento especifico?
- Cobertura nacional ou regional?
- Investimento pretendido: quanto estao dispostos a investir?
- E-mail para envio da proposta.
- Agendamento de ligacao rapida de 15 minutos: peca dia e horario especificos.

== TOM E ESTILO ==
- Escreva sempre em português do Brasil correto, com acentos, vírgulas e pontuação natural.
- Toda frase enviada ao cliente deve terminar com ponto, interrogação ou exclamação.
- Respostas curtas: 1 a 3 frases no maximo. Evite textao.
- Fale pelo primeiro nome do cliente quando souber, de forma natural.
- Proibido linguagem corporativa: "daremos continuidade", "estarei verificando", "com base nas informacoes fornecidas" etc.
- Nao comece toda resposta com "Perfeito", "Entendi" ou "Certo". Varie ou va direto ao ponto.
- Tom conversado: "Boa", "show", "me diz uma coisa", "pra eu te direcionar melhor", sem exagerar em girias.
- Nao use ponto de exclamacao em toda mensagem.

== HANDOFF (Transferencia para Especialista) ==
- Agendamento so e concluido com DIA e HORARIO ESPECIFICOS (ex: "amanha as 14h", "quinta as 10h").
- Se o cliente disser "sim", "posso" ou algo vago: pergunte qual dia e horario especificos.
- Ao confirmar dia e horario: preencha *Agendado* no summary, defina "handoff": true e confirme naturalmente ao cliente.
- Handoff silencioso ("handoff": true, "reply": "") se: cliente pedir preco exato, detalhes tecnicos de operadora, reclamar, pedir para falar com humano, ou enviar "alvorada".
- Se o cliente pedir esclarecimento ("como assim?", "nao entendi", "pq?"): reexplique de forma simples e natural - NAO faca handoff.

Nao envie ao cliente nomes de ferramentas internas. O resumo (summary) fica apenas no banco interno.

Use o campo summary para registrar tudo que souber, exatamente neste formato:
*Nome*: [nome]
*Telefone*: [telefone]
*Idades*: [idades]
*CNPJ/MEI*: [cnpj/mei/pf]
*Cidade*: [cidade]
*Investimento*: [investimento]
*Plano Atual*: [plano atual]
*Motivo*: [motivo]
*Hospital/Regiao*: [hospital/regiao]
*Email*: [email]
*Agendado*: [dia e horario combinados, ex: "Terca-feira as 14:00". Se nao agendou: "Nao"]
*Pendente*: [o que ainda falta coletar]

Responda APENAS JSON valido, sem markdown, no formato:
{"reply":"mensagem para enviar ao cliente","handoff":false,"summary":"resumo atualizado do atendimento"}`;

const normalizePrompt = (value = '') => value.trim().replace(/\r\n/g, '\n');

const BUILTIN_PROMPT_MODELS: PromptModel[] = [
  {
    id: 'builtin-danilo',
    nome: 'Padrão Danilo (Aline)',
    categoria: 'Modelo padrão de atendimento',
    system_prompt: DEFAULT_SYSTEM_PROMPT_TEMPLATE,
    base_model: 'danilo_default',
    builtin: true,
  },
];

const findPromptModelId = (prompt: string, models: PromptModel[]) => {
  const normalized = normalizePrompt(prompt);
  return models.find((model) => normalizePrompt(model.system_prompt) === normalized)?.id || 'custom';
};

export default function AdminIaPage() {
  const { actualProfile } = useAuth();
  const [activeConfigs, setActiveConfigs] = useState<AiConfig[]>([]);
  const [inactiveCorretoras, setInactiveCorretoras] = useState<Corretora[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  
  // Editor State
  const [selectedConfig, setSelectedConfig] = useState<Partial<AiConfig> | null>(null);
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [selectedCorretoraId, setSelectedCorretoraId] = useState('');
  const [persona, setPersona] = useState(DEFAULT_LEAD_AI_PERSONA);
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT_TEMPLATE);
  const [senderProfilesByCorretora, setSenderProfilesByCorretora] = useState<Record<string, SenderProfile[]>>({});
  const [selectedSenderProfileId, setSelectedSenderProfileId] = useState('');
  const [customPromptModels, setCustomPromptModels] = useState<PromptModel[]>([]);
  const [selectedPromptModelId, setSelectedPromptModelId] = useState('builtin-danilo');
  const [saveModelOpen, setSaveModelOpen] = useState(false);
  const [modelName, setModelName] = useState('');
  const [modelCategory, setModelCategory] = useState('Atendimento');
  const [savingModel, setSavingModel] = useState(false);
  
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [testConfigId, setTestConfigId] = useState('');
  const [testPhone, setTestPhone] = useState('');
  const [testName, setTestName] = useState('Teste IA');
  const [testAges, setTestAges] = useState('32');
  const [testingAi, setTestingAi] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const isAdmin = actualProfile?.tipo_usuario === 'admin';
  const promptModels = useMemo(
    () => [...BUILTIN_PROMPT_MODELS, ...customPromptModels],
    [customPromptModels]
  );
  const selectedPromptModel = promptModels.find((model) => model.id === selectedPromptModelId);
  const promptEditedFromModel = Boolean(selectedPromptModel) && normalizePrompt(systemPrompt) !== normalizePrompt(selectedPromptModel?.system_prompt || '');
  const canSavePromptModel = systemPrompt.trim().length > 0 && (selectedPromptModelId === 'custom' || promptEditedFromModel);
  const availableSenderProfiles = senderProfilesByCorretora[selectedCorretoraId] || [];

  async function loadData() {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) {
        setError('Sessão expirada. Faça login novamente.');
        setLoading(false);
        return;
      }

      try {
        const modelResponse = await fetch('/api/admin/ia/prompt-models', {
          headers: { Authorization: `Bearer ${token}` }
        });
        const modelData = await modelResponse.json().catch(() => ({}));
        if (modelResponse.ok) {
          setCustomPromptModels(modelData.models || []);
        } else {
          console.warn('[admin_ia] prompt models not loaded:', modelData.error);
        }
      } catch (modelErr) {
        console.warn('[admin_ia] prompt models request failed:', modelErr);
      }

      const response = await fetch('/api/admin/ia', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json();

      if (response.ok) {
        setActiveConfigs(data.activeConfigs || []);
        setInactiveCorretoras(data.inactiveCorretoras || []);
        setSenderProfilesByCorretora(data.senderProfilesByCorretora || {});
      } else {
        setError(data.error || 'Erro ao carregar dados da IA.');
      }
    } catch (err: any) {
      setError(err?.message || 'Erro de rede ao carregar dados.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [isAdmin]);

  useEffect(() => {
    if (!testConfigId && activeConfigs[0]?.id) {
      setTestConfigId(activeConfigs[0].id);
    }
  }, [activeConfigs, testConfigId]);

  const filteredConfigs = useMemo(() => {
    const term = search.toLowerCase().trim();
    if (!term) return activeConfigs;
    return activeConfigs.filter(
      c => c.persona.toLowerCase().includes(term) || 
           (c.corretoras?.nome || '').toLowerCase().includes(term)
    );
  }, [activeConfigs, search]);

  const handleEditConfig = (config: AiConfig) => {
    setSelectedConfig(config);
    setIsAddingNew(false);
    setSelectedCorretoraId(config.corretora_id);
    setPersona(config.persona);
    setSystemPrompt(config.system_prompt);
    setSelectedSenderProfileId(config.sender_profile_id || '');
    setSelectedPromptModelId(findPromptModelId(config.system_prompt, promptModels));
    setError(null);
    setSuccess(null);
  };

  const handleAddNewClick = () => {
    if (inactiveCorretoras.length === 0) {
      setError('Todas as concessionárias ativas já possuem IA configurada.');
      return;
    }
    setSelectedConfig(null);
    setIsAddingNew(true);
    setSelectedCorretoraId(inactiveCorretoras[0].id);
    setPersona(DEFAULT_LEAD_AI_PERSONA);
    setSystemPrompt(DEFAULT_SYSTEM_PROMPT_TEMPLATE);
    setSelectedSenderProfileId('');
    setSelectedPromptModelId('builtin-danilo');
    setError(null);
    setSuccess(null);
  };

  const handlePromptModelChange = (modelId: string) => {
    setSelectedPromptModelId(modelId);
    const model = promptModels.find((item) => item.id === modelId);
    if (model) {
      setSystemPrompt(model.system_prompt);
    }
  };

  const handleUseSelectedPromptModel = () => {
    const model = promptModels.find((item) => item.id === selectedPromptModelId) || BUILTIN_PROMPT_MODELS[0];
    setSelectedPromptModelId(model.id);
    setSystemPrompt(model.system_prompt);
  };

  const handleOpenSaveModel = () => {
    setModelName(selectedPromptModel && !selectedPromptModel.builtin ? `${selectedPromptModel.nome} ajustado` : '');
    setModelCategory(selectedPromptModel?.categoria || 'Atendimento');
    setSaveModelOpen(true);
  };

  const handleSavePromptModel = async () => {
    if (!modelName.trim() || !systemPrompt.trim()) {
      setError('Informe o nome do modelo e mantenha um prompt valido.');
      return;
    }

    setSavingModel(true);
    setError(null);
    setSuccess(null);

    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;

      const response = await fetch('/api/admin/ia/prompt-models', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          nome: modelName.trim(),
          categoria: modelCategory.trim() || 'Atendimento',
          system_prompt: systemPrompt.trim(),
          base_model: selectedPromptModel?.base_model || selectedPromptModel?.id || 'custom'
        })
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || 'Erro ao salvar modelo de prompt.');
        return;
      }

      setCustomPromptModels((prev) => [data.model, ...prev]);
      setSelectedPromptModelId(data.model.id);
      setSaveModelOpen(false);
      setModelName('');
      setModelCategory('Atendimento');
      setSuccess('Modelo de prompt salvo e selecionado.');
    } catch (err: any) {
      setError(err?.message || 'Erro ao conectar no servidor.');
    } finally {
      setSavingModel(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCorretoraId || !persona.trim() || !systemPrompt.trim()) {
      setError('Preencha todos os campos obrigatórios.');
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      
      const response = await fetch('/api/admin/ia', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          corretora_id: selectedCorretoraId,
          persona: persona.trim(),
          system_prompt: systemPrompt.trim(),
          use_default_model: isAddingNew && selectedPromptModelId === 'builtin-danilo',
          sender_profile_id: selectedSenderProfileId || null,
          status: 'ativo'
        })
      });

      const data = await response.json();
      if (response.ok) {
        setSuccess('Configuração salva com sucesso!');
        setSelectedConfig(null);
        setIsAddingNew(false);
        loadData();
      } else {
        setError(data.error || 'Erro ao salvar configuração.');
      }
    } catch (err: any) {
      setError(err?.message || 'Erro ao conectar no servidor.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (configId: string) => {
    if (!window.confirm('Tem certeza que deseja desativar e deletar a IA para esta concessionária? Ela deixará de responder aos leads.')) {
      return;
    }

    setError(null);
    setSuccess(null);
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      
      const response = await fetch(`/api/admin/ia?id=${configId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });

      const data = await response.json();
      if (response.ok) {
        setSuccess('IA desativada com sucesso!');
        setSelectedConfig(null);
        setIsAddingNew(false);
        loadData();
      } else {
        setError(data.error || 'Erro ao desativar IA.');
      }
    } catch (err: any) {
      setError(err?.message || 'Erro ao conectar no servidor.');
    }
  };

  const handleSendTest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testConfigId || !testPhone.trim()) {
      setError('Selecione a concessionaria e informe o WhatsApp para teste.');
      return;
    }

    setTestingAi(true);
    setError(null);
    setSuccess(null);
    setTestResult(null);

    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;

      const response = await fetch('/api/admin/ia/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          config_id: testConfigId,
          telefone: testPhone,
          nome: testName,
          idades: testAges,
          cidade: 'Teste IA',
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        setError(data.error || 'Erro ao enviar teste da IA.');
        return;
      }

      const message = data.message || 'Teste enviado para o WhatsApp informado.';
      setSuccess(message);
      setTestResult(`Lead de teste: ${data.lead?.nome || testName}`);
    } catch (err: any) {
      setError(err?.message || 'Erro ao conectar no servidor.');
    } finally {
      setTestingAi(false);
    }
  };

  if (!isAdmin) {
    return (
      <InternalLayout>
        <div className="flex h-96 items-center justify-center p-6">
          <div className="text-center max-w-sm rounded-[2rem] border border-red-900/30 bg-red-950/20 p-8 shadow-sm">
            <AlertCircle className="mx-auto mb-4 text-red-500" size={36} />
            <h1 className="text-lg font-black text-white">Acesso Restrito</h1>
            <p className="mt-2 text-xs font-bold text-slate-400">
              Esta área é restrita para administradores e desenvolvedores do Orion Track.
            </p>
          </div>
        </div>
      </InternalLayout>
    );
  }

  return (
    <InternalLayout>
      <div className="space-y-6">
        
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-950/40 text-cyan-400 border border-cyan-500/20 shadow-sm shadow-cyan-500/10">
                <Cpu size={18} />
              </span>
              <h1 className="text-2xl font-black tracking-tight text-white">IA</h1>
            </div>
            <p className="mt-1 text-xs font-bold text-slate-400">
              Configure e gerencie as concessionárias onde o comercial automatizado (Aline) está ativado.
            </p>
          </div>
          
          <button
            onClick={handleAddNewClick}
            className="flex items-center justify-center gap-2 rounded-2xl bg-cyan-600 hover:bg-cyan-500 transition-all px-4 py-3 text-xs font-black text-white shadow-lg shadow-cyan-600/20"
          >
            <Plus size={16} /> Ativar Nova Concessionária
          </button>
        </div>

        {/* Status Messages */}
        {error && (
          <div className="flex items-start gap-3 rounded-2xl border border-red-900/30 bg-red-950/15 p-4 text-xs font-bold text-red-400">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {success && (
          <div className="flex items-start gap-3 rounded-2xl border border-emerald-900/30 bg-emerald-950/15 p-4 text-xs font-bold text-emerald-400">
            <Check size={16} className="mt-0.5 shrink-0" />
            <span>{success}</span>
          </div>
        )}

        <form
          onSubmit={handleSendTest}
          className="rounded-3xl border border-cyan-500/20 bg-slate-950/30 p-5 shadow-sm shadow-cyan-500/5"
        >
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-cyan-500/20 bg-cyan-950/40 text-cyan-300">
                <Send size={18} />
              </span>
              <div>
                <h2 className="text-sm font-black text-white">Enviar teste da IA</h2>
                <p className="mt-1 max-w-2xl text-[11px] font-bold leading-relaxed text-slate-400">
                  Cria um lead de teste, inicia a Aline pelo WhatsApp do admin da concessionaria e permite validar se a conversa continua pelo Inbox.
                </p>
                {testResult && (
                  <p className="mt-2 text-[10px] font-black uppercase tracking-wider text-emerald-400">
                    {testResult}
                  </p>
                )}
              </div>
            </div>

            <div className="grid flex-[2] gap-3 md:grid-cols-2 xl:grid-cols-4">
              <label className="flex flex-col gap-1.5">
                <span className="text-[9px] font-black uppercase tracking-wider text-slate-500">Concessionaria</span>
                <select
                  value={testConfigId}
                  onChange={(e) => setTestConfigId(e.target.value)}
                  className="h-12 rounded-2xl border border-slate-800 bg-slate-900/60 px-3 text-xs font-black text-white outline-none transition-all focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500"
                >
                  {activeConfigs.length === 0 ? (
                    <option value="">Nenhuma IA ativa</option>
                  ) : (
                    activeConfigs.map((config) => (
                      <option key={config.id} value={config.id}>
                        {config.corretoras?.nome || config.persona}
                      </option>
                    ))
                  )}
                </select>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-[9px] font-black uppercase tracking-wider text-slate-500">WhatsApp destino</span>
                <input
                  value={testPhone}
                  onChange={(e) => setTestPhone(e.target.value)}
                  placeholder="Ex: 5561999999999"
                  className="h-12 rounded-2xl border border-slate-800 bg-slate-900/60 px-3 text-xs font-black text-white outline-none transition-all placeholder:text-slate-600 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500"
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-[9px] font-black uppercase tracking-wider text-slate-500">Nome do lead</span>
                <input
                  value={testName}
                  onChange={(e) => setTestName(e.target.value)}
                  placeholder="Teste IA"
                  className="h-12 rounded-2xl border border-slate-800 bg-slate-900/60 px-3 text-xs font-black text-white outline-none transition-all placeholder:text-slate-600 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500"
                />
              </label>

              <div className="grid grid-cols-[1fr_auto] gap-2">
                <label className="flex flex-col gap-1.5">
                  <span className="text-[9px] font-black uppercase tracking-wider text-slate-500">Idades</span>
                  <input
                    value={testAges}
                    onChange={(e) => setTestAges(e.target.value)}
                    placeholder="32"
                    className="h-12 rounded-2xl border border-slate-800 bg-slate-900/60 px-3 text-xs font-black text-white outline-none transition-all placeholder:text-slate-600 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500"
                  />
                </label>
                <button
                  type="submit"
                  disabled={testingAi || activeConfigs.length === 0}
                  className="mt-[18px] flex h-12 min-w-28 items-center justify-center gap-2 rounded-2xl bg-cyan-600 px-4 text-xs font-black text-white shadow-lg shadow-cyan-600/15 transition-all hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {testingAi ? <Loader2 className="animate-spin" size={15} /> : <Send size={15} />}
                  Testar
                </button>
              </div>
            </div>
          </div>
        </form>

        <div className="grid gap-6 lg:grid-cols-3">
          
          {/* List Section (Left 1 col or 3 cols depending on state) */}
          <div className={`${(selectedConfig || isAddingNew) ? 'lg:col-span-1' : 'lg:col-span-3'} space-y-4`}>
            
            {/* Search */}
            <div className="relative">
              <span className="absolute inset-y-0 left-4 flex items-center text-slate-400 pointer-events-none">
                <Search size={16} />
              </span>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Pesquisar concessionária ou IA..."
                className="w-full pl-10 pr-4 py-3 rounded-2xl border border-slate-800 bg-slate-900/30 text-xs font-bold text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all"
              />
            </div>

            {/* List Cards */}
            {loading ? (
              <div className="flex h-48 items-center justify-center rounded-3xl border border-slate-900 bg-slate-950/20">
                <Loader2 className="animate-spin text-cyan-500" size={32} />
              </div>
            ) : filteredConfigs.length === 0 ? (
              <div className="flex flex-col items-center justify-center text-center p-8 rounded-3xl border border-slate-900 bg-slate-950/10">
                <Bot className="text-slate-600 mb-2" size={32} />
                <p className="text-xs font-bold text-slate-500">Nenhuma IA configurada ou correspondente.</p>
              </div>
            ) : (
              <div className="grid gap-3">
                {filteredConfigs.map((config) => {
                  const isActive = (selectedConfig?.id === config.id);
                  return (
                    <div
                      key={config.id}
                      onClick={() => handleEditConfig(config)}
                      className={`group flex items-center justify-between p-4 rounded-2xl border cursor-pointer transition-all ${
                        isActive 
                          ? 'border-cyan-500/50 bg-cyan-950/10' 
                          : 'border-slate-900 bg-slate-950/20 hover:border-slate-800 hover:bg-slate-900/20'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`flex h-10 w-10 items-center justify-center rounded-xl transition-all ${
                          isActive 
                            ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30' 
                            : 'bg-slate-900/60 text-slate-400 border border-slate-800'
                        }`}>
                          <Bot size={18} />
                        </div>
                        <div>
                          <p className="text-xs font-black text-white">{config.corretoras?.nome || 'Concessionária'}</p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                            <p className="text-[10px] font-bold text-slate-400">IA: {config.persona}</p>
                          </div>
                        </div>
                      </div>
                      <ChevronRight size={16} className="text-slate-500 group-hover:text-white transition-all transform group-hover:translate-x-0.5" />
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Form Editor Section (Right 2 cols) */}
          {(selectedConfig || isAddingNew) && (
            <div className="lg:col-span-2">
              <div className="rounded-3xl border border-slate-900 bg-slate-950/20 p-5 sm:p-6 space-y-6">
                
                {/* Title */}
                <div className="flex items-center justify-between border-b border-slate-900 pb-4">
                  <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-950/40 text-cyan-400 border border-cyan-500/10">
                      <Settings size={16} />
                    </span>
                    <h2 className="text-sm font-black text-white">
                      {isAddingNew ? 'Ativar Nova IA' : 'Configurações de Comportamento'}
                    </h2>
                  </div>
                  <button 
                    onClick={() => { setSelectedConfig(null); setIsAddingNew(false); }}
                    className="text-[10px] font-bold text-slate-400 hover:text-white transition-colors"
                  >
                    Fechar
                  </button>
                </div>

                <form onSubmit={handleSave} className="space-y-4">
                  
                  {/* Concessionária Selection */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
                      Concessionária
                    </label>
                    {isAddingNew ? (
                      <select
                        value={selectedCorretoraId}
                        onChange={(e) => {
                          setSelectedCorretoraId(e.target.value);
                          setSelectedSenderProfileId('');
                        }}
                        className="w-full px-3 py-3 rounded-xl border border-slate-800 bg-slate-900/60 text-xs font-bold text-white focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all"
                      >
                        {inactiveCorretoras.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.nome}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div className="flex items-center gap-2 px-3 py-3 rounded-xl border border-slate-800 bg-slate-900/30 text-xs font-bold text-slate-300">
                        <Building size={14} className="text-slate-500" />
                        <span>{selectedConfig?.corretoras?.nome || 'Concessionária'}</span>
                      </div>
                    )}
                  </div>

                  {/* Sender WhatsApp Profile */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
                      WhatsApp que a IA vai usar
                    </label>
                    <select
                      value={selectedSenderProfileId}
                      onChange={(e) => setSelectedSenderProfileId(e.target.value)}
                      className="w-full px-3 py-3 rounded-xl border border-slate-800 bg-slate-900/60 text-xs font-bold text-white focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all"
                    >
                      <option value="">Automatico: admin/corretor conectado</option>
                      {availableSenderProfiles.map((sender) => (
                        <option key={sender.id} value={sender.id}>
                          {sender.nome} {sender.telefone ? `- ${sender.telefone}` : ''} {sender.tipo_usuario === 'corretor_admin' ? '(admin)' : ''}
                        </option>
                      ))}
                    </select>
                    <p className="text-[9px] font-bold leading-relaxed text-slate-500">
                      Essa e a instancia de WhatsApp que envia as mensagens da IA. Se deixar automatico, o sistema usa o admin/corretor ativo da concessionaria.
                    </p>
                    {availableSenderProfiles.length === 0 && (
                      <p className="rounded-xl border border-amber-500/20 bg-amber-950/20 px-3 py-2 text-[10px] font-bold text-amber-300">
                        Nenhum admin/corretor ativo encontrado para esta concessionaria. Verifique o vinculo do perfil com a concessionaria.
                      </p>
                    )}
                  </div>

                  {/* Prompt Model */}
                  <div className="flex flex-col gap-1.5 rounded-2xl border border-slate-800/80 bg-slate-950/20 p-3">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
                        Definir modelo de prompt
                      </label>
                      <span className="text-[9px] font-bold uppercase tracking-wider text-slate-600">
                        {selectedPromptModel?.categoria || 'Personalizado'}
                      </span>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                      <select
                        value={selectedPromptModelId}
                        onChange={(e) => handlePromptModelChange(e.target.value)}
                        className="w-full px-3 py-3 rounded-xl border border-slate-800 bg-slate-900/60 text-xs font-bold text-white focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all"
                      >
                        {promptModels.map((model) => (
                          <option key={model.id} value={model.id}>
                            {model.nome}{model.builtin ? ' (padrao)' : ''}
                          </option>
                        ))}
                        {selectedPromptModelId === 'custom' && (
                          <option value="custom">Personalizado</option>
                        )}
                      </select>
                      {canSavePromptModel && (
                        <button
                          type="button"
                          onClick={handleOpenSaveModel}
                          className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-950/20 px-3 py-3 text-[10px] font-black uppercase tracking-wider text-emerald-300 transition-all hover:border-emerald-400/60 hover:bg-emerald-950/40"
                        >
                          <Save size={12} /> Salvar modelo
                        </button>
                      )}
                    </div>
                    <p className="text-[9px] font-bold leading-relaxed text-slate-500">
                      O modelo Padrão conduz CPF ou CNPJ de forma natural. Edite o prompt e salve um modelo apenas se alguma conta precisar de uma regra específica.
                    </p>
                  </div>

                  {/* Persona Name */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
                      Nome da Persona da IA (Ex: Aline)
                    </label>
                    <input
                      type="text"
                      value={persona}
                      onChange={(e) => setPersona(e.target.value)}
                      placeholder="Nome da IA"
                      required
                      className="w-full px-3 py-3 rounded-xl border border-slate-800 bg-slate-900/60 text-xs font-bold text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all"
                    />
                  </div>

                  {/* Behavior/System Prompt */}
                  <div className="flex flex-col gap-1.5">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
                        Comportamento da IA (System Prompt)
                      </label>
                      <button
                        type="button"
                        onClick={handleUseSelectedPromptModel}
                        className="inline-flex items-center justify-center gap-2 rounded-xl border border-cyan-500/20 bg-cyan-950/20 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-cyan-300 transition-all hover:border-cyan-400/50 hover:bg-cyan-950/40"
                      >
                        <Sparkles size={12} /> Usar modelo selecionado
                      </button>
                    </div>
                    <textarea
                      value={systemPrompt}
                      onChange={(e) => setSystemPrompt(e.target.value)}
                      placeholder="Cole aqui o prompt do sistema..."
                      required
                      rows={18}
                      className="w-full px-4 py-3 rounded-2xl border border-slate-800 bg-slate-900/60 text-xs font-medium text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all resize-y font-mono leading-relaxed"
                    />
                    <p className="text-[9px] font-bold text-slate-500">
                      Use as tags <code className="text-cyan-400">{'{persona}'}</code> e <code className="text-cyan-400">{'{lead_facts}'}</code> para que o sistema injete dinamicamente a persona e os dados conhecidos do lead.
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-col gap-3 pt-4 sm:flex-row sm:justify-between">
                    {!isAddingNew && selectedConfig?.id && (
                      <button
                        type="button"
                        onClick={() => handleDelete(selectedConfig.id!)}
                        className="flex items-center justify-center gap-2 rounded-xl border border-red-900/30 hover:border-red-950 bg-red-950/10 hover:bg-red-950/30 transition-all px-4 py-3 text-xs font-black text-red-400"
                      >
                        <Trash2 size={14} /> Desativar IA
                      </button>
                    )}
                    <div className="flex gap-2 sm:ml-auto">
                      <button
                        type="button"
                        onClick={() => { setSelectedConfig(null); setIsAddingNew(false); }}
                        className="flex-1 sm:flex-initial rounded-xl border border-slate-800 hover:border-slate-700 bg-transparent hover:bg-slate-900/30 transition-all px-4 py-3 text-xs font-black text-slate-400 hover:text-white"
                      >
                        Cancelar
                      </button>
                      <button
                        type="submit"
                        disabled={saving}
                        className="flex-1 sm:flex-initial flex items-center justify-center gap-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 transition-all px-6 py-3 text-xs font-black text-white shadow-lg shadow-cyan-600/10 disabled:opacity-50"
                      >
                        {saving ? (
                          <Loader2 className="animate-spin" size={14} />
                        ) : (
                          <Save size={14} />
                        )}
                        {isAddingNew ? 'Ativar IA' : 'Salvar Alterações'}
                      </button>
                    </div>
                  </div>

                </form>

              </div>
            </div>
          )}

        </div>

      </div>
      {saveModelOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-3xl border border-slate-800 bg-slate-950 p-5 shadow-2xl shadow-cyan-950/30">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-cyan-300">
                  Modelo de prompt
                </p>
                <h2 className="mt-1 text-lg font-black text-white">Salvar novo modelo</h2>
                <p className="mt-1 text-xs font-bold leading-relaxed text-slate-400">
                  Salve esta variacao para usar em outras concessionarias sem alterar os modelos padrao.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSaveModelOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-800 bg-slate-900/70 text-slate-400 transition-colors hover:border-slate-700 hover:text-white"
              >
                <X size={16} />
              </button>
            </div>

            <div className="mt-5 space-y-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                  Nome do modelo
                </label>
                <input
                  type="text"
                  value={modelName}
                  onChange={(e) => setModelName(e.target.value)}
                  placeholder="Ex: Individual sem CNPJ"
                  className="w-full rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-3 text-xs font-bold text-white placeholder-slate-500 transition-all focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                  Categoria
                </label>
                <input
                  type="text"
                  value={modelCategory}
                  onChange={(e) => setModelCategory(e.target.value)}
                  placeholder="Ex: Pessoa fisica"
                  className="w-full rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-3 text-xs font-bold text-white placeholder-slate-500 transition-all focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                />
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-900/30 p-3">
                <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                  Prompt que sera salvo
                </p>
                <p className="mt-2 max-h-28 overflow-y-auto whitespace-pre-wrap text-[11px] font-medium leading-relaxed text-slate-300">
                  {systemPrompt}
                </p>
              </div>
            </div>

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setSaveModelOpen(false)}
                className="rounded-xl border border-slate-800 px-4 py-3 text-xs font-black text-slate-400 transition-all hover:border-slate-700 hover:text-white"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={savingModel}
                onClick={handleSavePromptModel}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-xs font-black text-white shadow-lg shadow-emerald-600/10 transition-all hover:bg-emerald-500 disabled:opacity-50"
              >
                {savingModel ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
                Salvar modelo
              </button>
            </div>
          </div>
        </div>
      )}
    </InternalLayout>
  );
}
