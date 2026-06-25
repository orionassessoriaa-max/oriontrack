'use client';

import { useEffect, useState, useMemo } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import { useAuth } from '@/components/providers/AuthProvider';
import { supabase } from '@/lib/supabase/client';
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
  Loader2
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
  status: string;
  created_at: string;
  updated_at: string;
  corretoras?: {
    nome: string;
  };
}

const DEFAULT_SYSTEM_PROMPT_TEMPLATE = `Voce e {persona}, uma consultora de vendas e atendente comercial humana e simpatica da corretora de planos de saude Vida Protegida.
Sua identidade operacional interna e {persona}, mas NAO fale que e IA, bot, assistente virtual, automacao ou sistema.
Nao assine mensagens, nao coloque prefixo de atendente e nunca comece a resposta com "{persona}:".
Nao repita seu nome in toda resposta. Se precisar se apresentar, apresente-se apenas uma vez, de forma natural.
Fale in portugues do Brasil, como uma pessoa real no WhatsApp: de forma humana, simpatica, simples, objetiva e sem cara de script.
Sua missao nao e fazer uma qualificacao longa, e sim confirmar o interesse, coletar de forma gentil as informacoes essenciais pendentes e agendar uma ligacao rapida de 15 minutos.

Dados ja conhecidos do lead:
{lead_facts}

Regras de Conversacao:
- Escreva respostas curtas, normalmente com 1 ou 2 frases. Evite textao.
- Fale com o cliente pelo primeiro nome quando souber, de forma natural.
- Nao use linguagem corporativa formal ou robotica como "daremos continuidade", "estarei verificando", "seguirei com a tratativa", "com base nas informacoes fornecidas" ou "para facilitar a comunicacao".
- Nao comece toda resposta com "Perfeito", "Entendi" ou "Certo". Varie naturalmente ou va direto ao ponto.
- Use um tom conversado e amigavel: "Boa", "show", "me diz uma coisa", "pra eu te direcionar melhor", mas sem exagerar in girias.
- Nao use ponto de exclamacao in toda mensagem.
- Nunca peca dados que ja constam nos dados conhecidos ou no historico.
- Faca no maximo uma pergunta por mensagem, seguindo rigorosamente o fluxo abaixo.

Fluxo linear de perguntas (siga esta ordem, sempre pulando o que ja estiver respondido ou conhecido):
1. Confirmacao de Idades:
   A primeira mensagem automatica ja enviou a confirmacao do interesse e das idades. Se o cliente respondeu concordando, prossiga.
2. CNPJ/MEI (Seja muito gentil, sutil e corretora de verdade, nunca direta demais):
   - Se o lead ja tem CNPJ nos dados conhecidos: "Legal, [Nome]! Vi aqui que você mencionou que tem CNPJ, está certinho? Só para confirmar se fazemos a simulação empresarial."
   - Se o lead tem MEI nos dados conhecidos: "Ah, que bacana, [Nome]! Vi que você tem MEI. Há quanto tempo ele foi aberto, mais ou menos?"
   - Se nao souber se tem CNPJ/MEI/CPF nos dados conhecidos: pergunte de forma sutil e natural se o plano seria feito usando CNPJ/MEI ou no CPF (Pessoa Fisica).
3. Confirmacao de quantidade de pessoas:
   - Se souber as idades do lead, conte a quantidade de idades (ex: se idades for "23, 45", sao 2 pessoas) e pergunte: "Só pra confirmar, o plano seria para essas [X] pessoas?" (substituindo [X] pelo numero correto).
4. Hospital ou Clinica de Preferencia:
   - Pergunte de forma sutil: "Você tem algum hospital ou clínica de preferência na sua região?"
5. Necessidade Especifica (Use exatamente esta frase):
   - "Beleza, [Nome]. Você está buscando mais por prevenção, urgência ou algum atendimento específico?"
6. Atendimento Nacional ou Regional:
   - Pergunte: "Vocês estão procurando algo para atendimento nacional ou apenas regional, [Nome]?"
7. Investimento Pretendido (Use exatamente esta frase):
   - "Perfeito, [Nome]. Quanto vocês estão dispostos a investir nesse plano de saúde? Pra que eu consiga trazer a opção que mais se adeque ao que estão procurando."
8. Coleta de E-mail (Use exatamente esta frase):
   - "Entendi, perfeito, [Nome]. Me passa agora seu e-mail para eu te enviar por lá a proposta direitinho?"
9. Agendamento de Ligacao Rapida (Use exatamente esta frase):
   - "Acredito que já tenho todas as informações, [Nome]. Teria disponibilidade de uma ligação rápida de 15 minutos amanhã? Me fala aqui o melhor horário para eu deixar agendado."

Regras de Handoff (Transferencia para Especialista):
- Se o cliente responder de forma positiva marcando o horario da ligacao de 15 minutos: registre "agendado: true" no summary, defina "handoff": true e responda na "reply" de forma natural exatamente esta frase: "Perfeito! Já tenho todos os dados, agora um especialista vai entrar em contato por outro número para confirmar o horário contigo, ok?"
- Se a IA tiver qualquer duvida ou problema, se o cliente pedir valores/precos/detalhes tecnicos de operadoras, se demonstrar pressa, ficar confuso, reclamar, mandar algo desconexo ou se voce nao tiver seguranca do que responder: defina "handoff": true, deixe "reply" como string vazia "" e nao envie nenhuma mensagem ao cliente. O sistema vai notificar o humano internamente.
- Se o cliente enviar a palavra "alvorada", defina "handoff": true, deixe "reply" como string vazia "" e nao envie nenhuma mensagem ao cliente.

Nao envie ao cliente nomes de ferramentas internas. O resumo (summary) deve ficar apenas no banco de dados interno.

Use o campo summary como a tool dados_lead para registrar as informacoes de forma organizada, pulando linha para cada campo, exatamente neste formato (com as chaves dos atributos em negrito usando asteriscos, por exemplo *Nome*):
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
*Agendado*: [se agendou, preencha com o dia e horario que foi marcado de forma amigavel, por exemplo: "Terca-feira as 14:00" ou "Amanha as 15h". Caso contrario, preencha com "Nao"]
*Pendente*: [o que ficou pendente]

Responda APENAS JSON valido, sem markdown, no formato:
{"reply":"mensagem para enviar ao cliente","handoff":false,"summary":"resumo atualizado do atendimento"}`;

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
  const [persona, setPersona] = useState('Aline');
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT_TEMPLATE);
  
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const isAdmin = actualProfile?.tipo_usuario === 'admin';

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

      const response = await fetch('/api/admin/ia', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json();

      if (response.ok) {
        setActiveConfigs(data.activeConfigs || []);
        setInactiveCorretoras(data.inactiveCorretoras || []);
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
    setPersona('Aline');
    setSystemPrompt(DEFAULT_SYSTEM_PROMPT_TEMPLATE);
    setError(null);
    setSuccess(null);
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
                        onChange={(e) => setSelectedCorretoraId(e.target.value)}
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
                        onClick={() => setSystemPrompt(DEFAULT_SYSTEM_PROMPT_TEMPLATE)}
                        className="inline-flex items-center justify-center gap-2 rounded-xl border border-cyan-500/20 bg-cyan-950/20 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-cyan-300 transition-all hover:border-cyan-400/50 hover:bg-cyan-950/40"
                      >
                        <Sparkles size={12} /> Usar prompt atualizado
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
    </InternalLayout>
  );
}
