'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/components/providers/AuthProvider';
import InternalLayout from '@/components/layout/InternalLayout';
import { supabase } from '@/lib/supabase/client';
import {
  Calculator,
  Plus,
  Minus,
  Upload,
  Download,
  Check,
  FileText,
  Layers,
  Sparkles,
  Filter,
  ArrowRight,
  Search,
  Share2,
  Trash2,
  Settings,
  AlertCircle,
  HelpCircle,
  FileSpreadsheet,
  RefreshCw,
  Building,
  User,
  Heart,
  ChevronRight,
  Award,
  ChevronDown,
  Edit2,
  Save,
  X,
  Bell,
  Eye,
  Info,
  ArrowLeft,
  Copy,
  ExternalLink,
  AlertTriangle
} from 'lucide-react';

// Formato de operadora
interface Operadora {
  id: string;
  nome: string;
  corGradiente: string;
  logoUrl?: string;
}

// Formato de plano
interface Plano {
  id: string;
  operadoraId: string;
  nome: string;
  tipo: 'PF' | 'PME' | 'Adesão';
  coparticipacao: 'Sim' | 'Não';
  acomodacao: 'Coletivo' | 'Individual';
  reembolso: string;
  hospitais: string[];
  laboratorios: string[];
  precos: number[]; // 10 faixas etárias ANS
  isDemo?: boolean;
}

// Faixas etárias ANS
const FAIXAS_ETARIAS = [
  { label: '0 a 18 anos', key: '0_18' },
  { label: '19 a 23 anos', key: '19_23' },
  { label: '24 a 28 anos', key: '24_28' },
  { label: '29 a 33 anos', key: '29_33' },
  { label: '34 a 38 anos', key: '34_38' },
  { label: '39 a 43 anos', key: '39_43' },
  { label: '44 a 48 anos', key: '44_48' },
  { label: '49 a 53 anos', key: '49_53' },
  { label: '54 a 58 anos', key: '54_58' },
  { label: '59 anos ou +', key: '59_mais' }
];

// Dados Iniciais / Mock de Operadoras
const OPERADORAS_PADRAO: Operadora[] = [
  { id: 'amil', nome: 'Amil Saúde', corGradiente: 'from-blue-600 to-cyan-500' },
  { id: 'bradesco', nome: 'Bradesco Saúde', corGradiente: 'from-red-600 to-rose-500' },
  { id: 'sulamerica', nome: 'SulAmérica', corGradiente: 'from-sky-700 to-blue-500' },
  { id: 'porto', nome: 'Porto Seguro', corGradiente: 'from-blue-800 to-indigo-600' },
  { id: 'unimed', nome: 'Unimed Nacional', corGradiente: 'from-emerald-600 to-teal-500' },
  { id: 'hapvida', nome: 'Hapvida', corGradiente: 'from-blue-600 to-indigo-500' },
  { id: 'notredame', nome: 'NotreDame Intermédica', corGradiente: 'from-green-600 to-emerald-500' },
  { id: 'sami', nome: 'Sami Saúde', corGradiente: 'from-rose-500 to-pink-500' },
  { id: 'sao_cristovao', nome: 'São Cristóvão', corGradiente: 'from-sky-600 to-blue-500' },
  { id: 'seguros_unimed', nome: 'Seguros Unimed', corGradiente: 'from-teal-600 to-emerald-500' }
];

// Dados Iniciais / Mock de Planos
const PLANOS_PADRAO: Plano[] = [
  {
    id: 'p1',
    operadoraId: 'amil',
    nome: 'Amil S380',
    tipo: 'PME',
    coparticipacao: 'Sim',
    acomodacao: 'Coletivo',
    reembolso: 'Sem reembolso',
    hospitais: ['Hospital Samaritano', 'Hospital São Luiz', 'Hospital da Luz', 'Hospital Metropolitano'],
    laboratorios: ['Delboni Auriemo', 'Lavoisier', 'A+ Medicina Diagnóstica'],
    precos: [250, 310, 380, 420, 480, 550, 680, 820, 1100, 1950],
    isDemo: true
  },
  {
    id: 'p2',
    operadoraId: 'amil',
    nome: 'Amil S450',
    tipo: 'PME',
    coparticipacao: 'Não',
    acomodacao: 'Individual',
    reembolso: 'R$ 80,00',
    hospitais: ['Hospital Samaritano', 'Hospital São Luiz', 'Hospital 9 de Julho', 'Hospital Alvorada'],
    laboratorios: ['Delboni Auriemo', 'Lavoisier', 'Feme', 'A+'],
    precos: [310, 380, 470, 520, 595, 680, 840, 1020, 1360, 2410],
    isDemo: true
  },
  {
    id: 'p3',
    operadoraId: 'bradesco',
    nome: 'Bradesco Top Nacional Flex',
    tipo: 'PME',
    coparticipacao: 'Sim',
    acomodacao: 'Individual',
    reembolso: 'R$ 120,00',
    hospitais: ['Hospital Sírio-Libanês', 'Hospital Albert Einstein', 'Oswaldo Cruz', 'São Luiz'],
    laboratorios: ['Fleury', 'Delboni Auriemo', 'Salomão Zoppi'],
    precos: [450, 560, 690, 780, 890, 1020, 1250, 1500, 2100, 3600],
    isDemo: true
  },
  {
    id: 'p4',
    operadoraId: 'sulamerica',
    nome: 'SulAmérica Especial 100',
    tipo: 'PME',
    coparticipacao: 'Sim',
    acomodacao: 'Individual',
    reembolso: 'R$ 150,00',
    hospitais: ['Hospital Sírio-Libanês', 'Hospital Samaritano', 'Hospital São Luiz', 'Pro-Cardíaco'],
    laboratorios: ['Fleury', 'Alta Diagnósticos', 'Delboni'],
    precos: [420, 520, 650, 730, 840, 960, 1180, 1420, 1980, 3400],
    isDemo: true
  },
  {
    id: 'p5',
    operadoraId: 'porto',
    nome: 'Porto Seguro Ouro Max',
    tipo: 'PME',
    coparticipacao: 'Não',
    acomodacao: 'Individual',
    reembolso: 'R$ 180,00',
    hospitais: ['Hospital Albert Einstein', 'Hospital Sírio-Libanês', 'Hospital Samaritano', 'Hospital São Luiz'],
    laboratorios: ['Fleury', 'Delboni Auriemo', 'CDB', 'A+'],
    precos: [490, 610, 760, 860, 985, 1130, 1390, 1670, 2335, 4010],
    isDemo: true
  },
  {
    id: 'p6',
    operadoraId: 'unimed',
    nome: 'Unimed Estilo Nacional',
    tipo: 'PME',
    coparticipacao: 'Sim',
    acomodacao: 'Coletivo',
    reembolso: 'Sem reembolso',
    hospitais: ['Hospital Unimed', 'Hospital Paulistano', 'Oswaldo Cruz', 'Hospital da Luz'],
    laboratorios: ['Delboni Auriemo', 'Lavoisier', 'A+'],
    precos: [320, 390, 480, 540, 620, 710, 870, 1050, 1450, 2500],
    isDemo: true
  },
  {
    id: 'p7',
    operadoraId: 'amil',
    nome: 'Amil Individual S280',
    tipo: 'PF',
    coparticipacao: 'Sim',
    acomodacao: 'Coletivo',
    reembolso: 'Sem reembolso',
    hospitais: ['Hospital da Luz', 'Hospital Metropolitano', 'Hospital Paulistano'],
    laboratorios: ['Lavoisier', 'A+'],
    precos: [190, 230, 280, 310, 360, 410, 510, 610, 820, 1450],
    isDemo: true
  },
  {
    id: 'p8',
    operadoraId: 'unimed',
    nome: 'Unimed Individual Personal',
    tipo: 'PF',
    coparticipacao: 'Não',
    acomodacao: 'Coletivo',
    reembolso: 'Sem reembolso',
    hospitais: ['Hospital Unimed', 'Hospital da Luz', 'Hospital Beneficência Portuguesa'],
    laboratorios: ['Lavoisier', 'Delboni Auriemo'],
    precos: [230, 280, 345, 380, 440, 500, 620, 745, 1010, 1785],
    isDemo: true
  },
  {
    id: 'p9',
    operadoraId: 'hapvida',
    nome: 'Hapvida Mix Coletivo',
    tipo: 'PF',
    coparticipacao: 'Sim',
    acomodacao: 'Coletivo',
    reembolso: 'Sem reembolso',
    hospitais: ['Hospital Hapvida', 'Hospital São Francisco'],
    laboratorios: ['Hapvida Lab'],
    precos: [140, 180, 220, 250, 290, 340, 420, 510, 700, 1200],
    isDemo: true
  },
  {
    id: 'p10',
    operadoraId: 'notredame',
    nome: 'GNDI Smart 200 SP',
    tipo: 'PME',
    coparticipacao: 'Sim',
    acomodacao: 'Coletivo',
    reembolso: 'Sem reembolso',
    hospitais: ['Hospital NotreCare', 'Hospital Cruzeiro do Sul'],
    laboratorios: ['Nasa', 'Lavoisier'],
    precos: [180, 220, 270, 310, 360, 420, 520, 640, 880, 1550],
    isDemo: true
  },
  {
    id: 'p11',
    operadoraId: 'sami',
    nome: 'Sami Orion Individual',
    tipo: 'PF',
    coparticipacao: 'Não',
    acomodacao: 'Coletivo',
    reembolso: 'Sem reembolso',
    hospitais: ['Hospital Beneficência Portuguesa', 'Hospital Oswaldo Cruz'],
    laboratorios: ['Sami Labs'],
    precos: [195, 245, 295, 335, 395, 460, 580, 710, 950, 1680],
    isDemo: true
  },
  {
    id: 'p12',
    operadoraId: 'sulamerica',
    nome: 'SulAmérica Adesão Especial',
    tipo: 'Adesão',
    coparticipacao: 'Sim',
    acomodacao: 'Individual',
    reembolso: 'R$ 130,00',
    hospitais: ['Hospital Oswaldo Cruz', 'Hospital São Luiz'],
    laboratorios: ['Fleury', 'A+'],
    precos: [380, 480, 590, 670, 770, 880, 1080, 1300, 1820, 3120],
    isDemo: true
  }
];

function RenderLogo({ id, nome, className = "h-12 w-12" }: { id: string; nome: string; className?: string }) {
  const mapping: { [key: string]: string } = {
    'amil': '/operadoras/2.png',
    'bradesco': '/operadoras/5.png',
    'sulamerica': '/operadoras/1.png',
    'porto': '/operadoras/3.png',
    'unimed': '/operadoras/4.png'
  };

  const src = mapping[id.toLowerCase()];
  if (src) {
    return (
      <div className={`${className} flex items-center justify-center rounded-2xl bg-white border border-slate-200/20 shadow-sm overflow-hidden p-1.5 shrink-0`}>
        <img
          src={src}
          alt={nome}
          className="h-full w-full object-contain"
        />
      </div>
    );
  }

  // Fallback com gradientes
  const gradients: { [key: string]: string } = {
    'amil': 'from-blue-600 to-cyan-500',
    'bradesco': 'from-red-600 to-rose-500',
    'sulamerica': 'from-sky-700 to-blue-500',
    'porto': 'from-blue-800 to-indigo-600',
    'unimed': 'from-emerald-600 to-teal-500',
    'hapvida': 'from-blue-600 to-indigo-500',
    'notredame': 'from-green-600 to-emerald-500',
    'sami': 'from-rose-500 to-pink-500',
    'sao_cristovao': 'from-sky-600 to-blue-500',
    'seguros_unimed': 'from-teal-600 to-emerald-500'
  };

  const grad = gradients[id.toLowerCase()] || 'from-slate-700 to-slate-600';

  return (
    <div className={`${className} flex flex-col items-center justify-center rounded-2xl bg-gradient-to-br ${grad} p-2 text-center shadow-lg border border-white/10 shrink-0`}>
      <span className="text-[10px] font-black uppercase text-white tracking-wider leading-none">{nome.split(' ')[0]}</span>
      <span className="text-[8px] font-bold text-white/70 uppercase mt-0.5">{nome.split(' ')[1] || ''}</span>
    </div>
  );
}

function copyTextToClipboard(text: string) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text);
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.top = '0';
  textarea.style.left = '0';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  try {
    document.execCommand('copy');
  } catch (err) {
    console.error('Erro no fallback de copia:', err);
  }
  document.body.removeChild(textarea);
  return Promise.resolve();
}

export default function SimuladorPage() {
  const { profile } = useAuth();
  const isAdmin = profile?.tipo_usuario === 'admin';

  // Estados de dados principais
  const [operadoras, setOperadoras] = useState<Operadora[]>(OPERADORAS_PADRAO);
  const [planos, setPlanos] = useState<Plano[]>(PLANOS_PADRAO);

  // Estados de navegação interna
  const [activeTab, setActiveTab] = useState<'simulacao' | 'catalogo' | 'admin'>('simulacao');
  const [simulationStep, setSimulationStep] = useState<1 | 2>(1);

  // Filtros da Simulação (Alinhados com a imagem do Painel do Corretor)
  const [tipoContrato, setTipoContrato] = useState<'PF' | 'PME' | 'Adesão'>('PME');
  const [ufFiltro, setUfFiltro] = useState<string>('SP');
  const [profissaoFiltro, setProfissaoFiltro] = useState<string>('Administrador');
  const [acomodacaoFiltro, setAcomodacaoFiltro] = useState<'Coletivo' | 'Individual' | 'Ambos'>('Ambos');
  const [coparticipacaoFiltro, setCoparticipacaoFiltro] = useState<'Sim' | 'Não' | 'Ambos'>('Ambos');
  const [orcamentoFiltro, setOrcamentoFiltro] = useState<string>('todos');
  const [hospitalFiltro, setHospitalFiltro] = useState<string>('Todos');
  const [selectedOperadoraIds, setSelectedOperadoraIds] = useState<string[]>([]);

  // Quantidade de vidas por faixa etária
  const [vidas, setVidas] = useState<{ [key: string]: number }>({
    '0_18': 0,
    '19_23': 0,
    '24_28': 0,
    '29_33': 0,
    '34_38': 0,
    '39_43': 0,
    '44_48': 0,
    '49_53': 0,
    '54_58': 0,
    '59_mais': 0
  });

  // Estados de comparação de planos
  const [comparedPlanIds, setComparedPlanIds] = useState<string[]>([]);
  const [isCompareModalOpen, setIsCompareModalOpen] = useState(false);
  const [expandedPlanDetail, setExpandedPlanDetail] = useState<string | null>(null);

  // Proposta / Modal de compartilhamento
  const [propostaModal, setPropostaModal] = useState<{
    plano: Plano;
    total: number;
    vidasPorFaixa: { label: string; count: number; precoUnitario: number; subtotal: number }[];
    totalVidas: number;
  } | null>(null);

  // Apolo Smart AI Uploader Estados
  const [isDragging, setIsDragging] = useState(false);
  const [aiParsing, setAiParsing] = useState(false);
  const [aiPreviewData, setAiPreviewData] = useState<Partial<Plano> & { operadoraNome?: string } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [whatsAppLog, setWhatsAppLog] = useState<string | null>(null);

  // Carregar dependências de XLSX e PDF.js
  useEffect(() => {
    if (!(window as any).XLSX) {
      const scriptX = document.createElement('script');
      scriptX.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      scriptX.async = true;
      document.body.appendChild(scriptX);
    }
    if (!(window as any).pdfjsLib) {
      const scriptP = document.createElement('script');
      scriptP.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.min.js';
      scriptP.async = true;
      document.body.appendChild(scriptP);
    }
  }, []);

  // Carregar dados locais
  useEffect(() => {
    const savedOperadoras = localStorage.getItem('orion:sim_operadoras');
    const savedPlanos = localStorage.getItem('orion:sim_planos');
    if (savedOperadoras) setOperadoras(JSON.parse(savedOperadoras));
    if (savedPlanos) setPlanos(JSON.parse(savedPlanos));
  }, []);

  // Total de vidas
  const totalVidas = Object.values(vidas).reduce((a, b) => a + b, 0);

  const incrementarVida = (key: string) => {
    setVidas(prev => ({ ...prev, [key]: prev[key] + 1 }));
  };

  const decrementarVida = (key: string) => {
    setVidas(prev => ({ ...prev, [key]: Math.max(0, prev[key] - 1) }));
  };

  const limparVidas = () => {
    setVidas({
      '0_18': 0, '19_23': 0, '24_28': 0, '29_33': 0, '34_38': 0,
      '39_43': 0, '44_48': 0, '49_53': 0, '54_58': 0, '59_mais': 0
    });
  };

  const toggleOperadoraSelection = (opId: string) => {
    setSelectedOperadoraIds(prev => 
      prev.includes(opId) ? prev.filter(id => id !== opId) : [...prev, opId]
    );
  };

  const limparSelecaoOperadoras = () => {
    setSelectedOperadoraIds([]);
  };

  // Filtragem e cálculo dos planos em tempo real
  const planosCalculados = planos
    .filter(plano => {
      // 1. Tipo de Contrato
      if (plano.tipo !== tipoContrato) return false;
      // 2. Operadoras selecionadas
      if (selectedOperadoraIds.length > 0 && !selectedOperadoraIds.includes(plano.operadoraId)) return false;
      // 3. Coparticipação
      if (coparticipacaoFiltro !== 'Ambos' && plano.coparticipacao !== coparticipacaoFiltro) return false;
      // 4. Acomodação
      if (acomodacaoFiltro !== 'Ambos' && plano.acomodacao !== acomodacaoFiltro) return false;
      // 5. Hospital
      if (hospitalFiltro !== 'Todos') {
        const atendeHospital = plano.hospitais.some(h => h.toLowerCase().includes(hospitalFiltro.toLowerCase()));
        if (!atendeHospital) return false;
      }
      return true;
    })
    .map(plano => {
      let custoTotal = 0;
      const detalheVidas = FAIXAS_ETARIAS.map((faixa, index) => {
        const quantidade = vidas[faixa.key] || 0;
        const precoUnitario = plano.precos[index] || 0;
        const subtotal = quantidade * precoUnitario;
        custoTotal += subtotal;
        return {
          label: faixa.label,
          count: quantidade,
          precoUnitario,
          subtotal
        };
      });

      return {
        ...plano,
        custoTotal,
        detalheVidas
      };
    })
    // 6. Orçamento
    .filter(plano => {
      if (orcamentoFiltro === 'ate_1500' && plano.custoTotal > 1500) return false;
      if (orcamentoFiltro === 'ate_3000' && plano.custoTotal > 3000) return false;
      if (orcamentoFiltro === 'ate_5000' && plano.custoTotal > 5000) return false;
      return true;
    })
    .sort((a, b) => a.custoTotal - b.custoTotal);

  const toggleComparePlan = (planId: string) => {
    setComparedPlanIds(prev => {
      if (prev.includes(planId)) return prev.filter(id => id !== planId);
      if (prev.length >= 4) {
        alert('Você pode comparar no máximo 4 planos simultaneamente.');
        return prev;
      }
      return [...prev, planId];
    });
  };

  const dispararNotificacoes = async (operadoraNome: string, planoNome: string) => {
    const titulo = `Tabela Atualizada: ${operadoraNome}!`;
    const mensagem = `Apolo AI identificou novos reajustes de preços no plano "${planoNome}". As tabelas atualizadas já estão disponíveis no Simulador!`;

    try {
      if (profile?.id) {
        await supabase.from('notificacoes').insert([{
          titulo,
          mensagem,
          destinatario_tipo: 'corretor',
          remetente_profile_id: profile.id,
          lida: false
        }]);
      }
    } catch (dbErr) {
      console.error('Erro ao gravar notificação no Supabase:', dbErr);
    }

    const logInfo = `[WhatsApp Webhook n8n Triggered]
Payload: {
  event: "price_update",
  operator: "${operadoraNome}",
  plan: "${planoNome}",
  text: "🚨 *Aviso Orion Track*: A tabela de preços do plano *${planoNome}* (${operadoraNome}) acaba de ser atualizada com novas faixas de valores! Acesse o simulador para calcular propostas."
}`;
    setWhatsAppLog(logInfo);
    setTimeout(() => {
      setWhatsAppLog(null);
    }, 8000);
  };

  // Uploader de documentos
  const parseDocumentClientSide = async (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
        reader.onload = (e) => {
          try {
            const data = new Uint8Array(e.target?.result as ArrayBuffer);
            const XLSX = (window as any).XLSX;
            if (!XLSX) {
              reject(new Error('Biblioteca SheetJS (XLSX) não carregou.'));
              return;
            }
            const workbook = XLSX.read(data, { type: 'array' });
            let fullText = '';
            workbook.SheetNames.forEach((sheetName: string) => {
              const worksheet = workbook.Sheets[sheetName];
              const csv = XLSX.utils.sheet_to_csv(worksheet);
              fullText += `--- Planilha: ${sheetName} ---\n${csv}\n`;
            });
            resolve(fullText);
          } catch (err) {
            reject(err);
          }
        };
        reader.readAsArrayBuffer(file);
      } else if (file.name.endsWith('.pdf')) {
        reader.onload = async (e) => {
          try {
            const typedarray = new Uint8Array(e.target?.result as ArrayBuffer);
            const pdfjsLib = (window as any).pdfjsLib;
            if (!pdfjsLib) {
              reject(new Error('Biblioteca PDF.js não carregou.'));
              return;
            }
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';
            const pdf = await pdfjsLib.getDocument({ data: typedarray }).promise;
            let fullText = '';
            const maxPages = Math.min(pdf.numPages, 8);
            for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
              const page = await pdf.getPage(pageNum);
              const textContent = await page.getTextContent();
              const pageText = textContent.items.map((item: any) => item.str).join(' ');
              fullText += `--- Página ${pageNum} ---\n${pageText}\n`;
            }
            resolve(fullText);
          } catch (err) {
            reject(err);
          }
        };
        reader.readAsArrayBuffer(file);
      } else {
        reader.onload = (e) => {
          resolve(e.target?.result as string || '');
        };
        reader.readAsText(file);
      }
    });
  };

  const handleApoloFileUpload = async (file: File) => {
    setAiParsing(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const extractedText = await parseDocumentClientSide(file);
      if (!extractedText.trim()) throw new Error('Não conseguimos extrair texto deste documento.');

      const response = await fetch('/api/admin/simulador/parse-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileContent: extractedText, fileName: file.name }),
      });

      if (!response.ok) throw new Error('A API do Apolo AI encontrou um erro no processamento.');

      const resData = await response.json();
      const extractedJson = resData.data;

      setAiPreviewData({
        operadoraNome: extractedJson.operadora || 'Operadora Detectada',
        nome: extractedJson.plano || 'Plano Detectado',
        tipo: extractedJson.tipo === 'PF' ? 'PF' : 'PME',
        coparticipacao: extractedJson.coparticipacao === 'Sim' ? 'Sim' : 'Não',
        reembolso: extractedJson.reembolso || 'Sem reembolso',
        hospitais: extractedJson.hospitais || ['Hospitais locais'],
        laboratorios: ['Laboratórios recomendados'],
        precos: extractedJson.precos && extractedJson.precos.length === 10 ? extractedJson.precos : [150, 200, 250, 300, 350, 400, 450, 500, 600, 800]
      });
    } catch (err: any) {
      setErrorMessage(err.message || 'Falha ao processar documento.');
    } finally {
      setAiParsing(false);
    }
  };

  const confirmarSalvarAiPreview = () => {
    if (!aiPreviewData) return;
    const opNome = aiPreviewData.operadoraNome || 'Operadora Detectada';
    let opId = opNome.toLowerCase().replace(/[^a-z0-9]/g, '');

    const novasOperadoras = [...operadoras];
    let opExistente = novasOperadoras.find(o => o.id === opId);
    if (!opExistente) {
      opExistente = { id: opId, nome: opNome, corGradiente: 'from-blue-600 to-indigo-600' };
      novasOperadoras.push(opExistente);
    }

    const novoPlano: Plano = {
      id: `ai_${Date.now()}`,
      operadoraId: opId,
      nome: aiPreviewData.nome || 'Novo Plano AI',
      tipo: aiPreviewData.tipo || 'PME',
      coparticipacao: aiPreviewData.coparticipacao || 'Sim',
      acomodacao: 'Coletivo',
      reembolso: aiPreviewData.reembolso || 'Sem reembolso',
      hospitais: aiPreviewData.hospitais || ['Hospitais locais'],
      laboratorios: ['Delboni Auriemo', 'Lavoisier'],
      precos: aiPreviewData.precos || [150, 200, 250, 300, 350, 400, 450, 500, 600, 800]
    };

    const novosPlanos = [novoPlano, ...planos];
    setOperadoras(novasOperadoras);
    setPlanos(novosPlanos);
    localStorage.setItem('orion:sim_operadoras', JSON.stringify(novasOperadoras));
    localStorage.setItem('orion:sim_planos', JSON.stringify(novosPlanos));
    dispararNotificacoes(opNome, novoPlano.nome);
    setAiPreviewData(null);
    setSuccessMessage('Plano importado com sucesso via Inteligência Artificial!');
  };

  return (
    <InternalLayout>
      <div className="space-y-6">
        
        {/* Banner Superior de Sucesso */}
        {successMessage && (
          <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/30 p-4 text-xs font-extrabold text-emerald-400 flex items-center gap-3 animate-in fade-in-50 slide-in-from-top-4 duration-300">
            <Check size={16} className="shrink-0" />
            <p>{successMessage}</p>
            <button onClick={() => setSuccessMessage(null)} className="ml-auto text-emerald-400 hover:text-white">✕</button>
          </div>
        )}

        {/* WhatsApp Logs Webhook */}
        {whatsAppLog && (
          <div className="rounded-2xl bg-cyan-950/80 border border-cyan-500/30 p-4 text-2xs font-mono text-cyan-300 space-y-2 animate-in fade-in-50 slide-in-from-top-4 duration-300">
            <div className="flex items-center gap-2 font-black text-cyan-400">
              <Bell size={14} className="animate-bounce" />
              <span>[Apolo Notificador] Webhook do WhatsApp de alta performance disparado com sucesso!</span>
            </div>
            <pre className="whitespace-pre-wrap bg-slate-950/60 p-3 rounded-xl border border-white/5">{whatsAppLog}</pre>
          </div>
        )}

        {/* Header Superior Dinâmico */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/5 pb-5">
          <div>
            <div className="flex items-center gap-2 text-cyan-400 font-extrabold text-xs uppercase tracking-widest">
              <img src="/orion-empty-logo.png" alt="Orion" className="object-contain animate-pulse shrink-0" style={{ height: 14, width: 14 }} />
              <span>Simulador Inteligente Apolo</span>
            </div>
            <h1 className="mt-1 text-2xl font-black tracking-tight text-white sm:text-3xl">
              Simulador & Tabelas de Saúde
            </h1>
            <p className="mt-1 text-xs sm:text-sm font-bold text-slate-400">
              Calcule planos instantaneamente através de um assistente de parametrização totalmente interativo.
            </p>
          </div>

          {/* Abas Superiores */}
          <div className="flex items-center bg-white/5 border border-white/5 p-1 rounded-2xl self-start md:self-auto shrink-0 shadow-lg">
            <button
              onClick={() => { setActiveTab('simulacao'); setSimulationStep(1); }}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all duration-200 ${
                activeTab === 'simulacao' ? 'bg-cyan-600 text-white shadow-md' : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Calculator size={14} />
              <span>Simulador</span>
            </button>
            <button
              onClick={() => setActiveTab('catalogo')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all duration-200 ${
                activeTab === 'catalogo' ? 'bg-cyan-600 text-white shadow-md' : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Layers size={14} />
              <span>Catálogo ({planos.length})</span>
            </button>
            {isAdmin && (
              <button
                onClick={() => setActiveTab('admin')}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all duration-200 ${
                  activeTab === 'admin' ? 'bg-cyan-600 text-white shadow-md' : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <Settings size={14} />
                <span>Importador Apolo</span>
              </button>
            )}
          </div>
        </div>

        {/* ================= ABA: SIMULADOR (INTERATIVO) ================= */}
        {activeTab === 'simulacao' && (
          <div>
            {simulationStep === 1 ? (
              /* PASSO 1: CONFIGURAÇÃO DE FILTROS E OPERADORAS */
              <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
                
                {/* FILTROS LATERAIS (Estilo Painel do Corretor) */}
                <div className="xl:col-span-4 space-y-4">
                  <div className="bg-slate-900/60 rounded-[2rem] border border-white/5 p-6 backdrop-blur-md shadow-2xl space-y-5">
                    <div className="flex items-center gap-2 text-xs font-black text-cyan-400 uppercase tracking-widest pb-3 border-b border-white/5">
                      <Filter size={14} />
                      <span>Filtros do Simulador</span>
                    </div>

                    {/* Contratação */}
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Tipo de Contrato</label>
                      <div className="grid grid-cols-3 bg-white/5 border border-white/5 p-1 rounded-2xl gap-1">
                        {(['PF', 'PME', 'Adesão'] as const).map((tipo) => (
                          <button
                            key={tipo}
                            type="button"
                            onClick={() => { setTipoContrato(tipo); limparVidas(); }}
                            className={`py-2 rounded-xl text-2xs font-extrabold uppercase transition-all ${
                              tipoContrato === tipo ? 'bg-cyan-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
                            }`}
                          >
                            {tipo}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Cidade / Região */}
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Região / UF</label>
                      <select
                        value={ufFiltro}
                        onChange={(e) => setUfFiltro(e.target.value)}
                        className="w-full bg-slate-950 border border-white/5 rounded-xl px-4 py-2.5 text-xs font-bold text-white focus:outline-none focus:border-cyan-500/50 transition-colors"
                      >
                        <option value="SP">São Paulo - SP</option>
                        <option value="RJ">Rio de Janeiro - RJ</option>
                        <option value="MG">Minas Gerais - MG</option>
                        <option value="PR">Paraná - PR</option>
                      </select>
                    </div>

                    {/* Profissão (Somente Adesão) */}
                    {tipoContrato === 'Adesão' && (
                      <div className="space-y-1.5 animate-in fade-in-50 slide-in-from-top-2 duration-200">
                        <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Profissão / Entidade</label>
                        <select
                          value={profissaoFiltro}
                          onChange={(e) => setProfissaoFiltro(e.target.value)}
                          className="w-full bg-slate-950 border border-white/5 rounded-xl px-4 py-2.5 text-xs font-bold text-white focus:outline-none focus:border-cyan-500/50 transition-colors"
                        >
                          <option value="Administrador">Administrador (CRA)</option>
                          <option value="Advogado">Advogado (OAB)</option>
                          <option value="Engenheiro">Engenheiro (CREA)</option>
                          <option value="Médico">Médico (CRM)</option>
                          <option value="Estudante">Estudante (UNE)</option>
                        </select>
                      </div>
                    )}

                    {/* Vidas por Faixa Etária */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Perfil do Cliente (Vidas)</label>
                        {totalVidas > 0 && (
                          <button
                            type="button"
                            onClick={limparVidas}
                            className="text-[9px] font-bold text-rose-400 uppercase tracking-widest hover:text-rose-300"
                          >
                            Limpar
                          </button>
                        )}
                      </div>
                      
                      {/* Grid compacto de vidas para caber na barra lateral */}
                      <div className="max-h-[220px] overflow-y-auto pr-1 space-y-2 border border-white/5 bg-slate-950/40 p-3 rounded-2xl">
                        {FAIXAS_ETARIAS.map((faixa) => {
                          const quantidade = vidas[faixa.key] || 0;
                          return (
                            <div
                              key={faixa.key}
                              className={`flex items-center justify-between p-2 rounded-xl border transition-all duration-200 ${
                                quantidade > 0 ? 'bg-cyan-500/10 border-cyan-500/20' : 'bg-transparent border-transparent'
                              }`}
                            >
                              <span className="text-2xs font-extrabold text-white">{faixa.label}</span>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => decrementarVida(faixa.key)}
                                  disabled={quantidade === 0}
                                  className="h-6 w-6 rounded-lg bg-white/5 border border-white/5 flex items-center justify-center text-slate-400 hover:bg-white/10 hover:text-white disabled:opacity-20 transition-all cursor-pointer"
                                >
                                  <Minus size={8} />
                                </button>
                                <span className="w-5 text-center text-2xs font-black text-white">{quantidade}</span>
                                <button
                                  type="button"
                                  onClick={() => incrementarVida(faixa.key)}
                                  className="h-6 w-6 rounded-lg bg-cyan-600/20 border border-cyan-500/30 flex items-center justify-center text-cyan-400 hover:bg-cyan-600 hover:text-white transition-all cursor-pointer"
                                >
                                  <Plus size={8} />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Acomodação */}
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Acomodação</label>
                      <div className="grid grid-cols-3 bg-white/5 border border-white/5 p-1 rounded-2xl gap-1">
                        {([
                          { key: 'Ambos', label: 'Todos' },
                          { key: 'Coletivo', label: 'Enfermaria' },
                          { key: 'Individual', label: 'Apartamento' }
                        ] as const).map((opt) => (
                          <button
                            key={opt.key}
                            type="button"
                            onClick={() => setAcomodacaoFiltro(opt.key)}
                            className={`py-2 px-1 rounded-xl text-[9px] font-extrabold uppercase truncate transition-all ${
                              acomodacaoFiltro === opt.key ? 'bg-cyan-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Coparticipação */}
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Coparticipação</label>
                      <div className="grid grid-cols-3 bg-white/5 border border-white/5 p-1 rounded-2xl gap-1">
                        {([
                          { key: 'Ambos', label: 'Todos' },
                          { key: 'Sim', label: 'Com' },
                          { key: 'Não', label: 'Sem' }
                        ] as const).map((opt) => (
                          <button
                            key={opt.key}
                            type="button"
                            onClick={() => setCoparticipacaoFiltro(opt.key)}
                            className={`py-2 px-1 rounded-xl text-[9px] font-extrabold uppercase truncate transition-all ${
                              coparticipacaoFiltro === opt.key ? 'bg-cyan-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Faixa de Valor */}
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Orçamento Máximo</label>
                      <select
                        value={orcamentoFiltro}
                        onChange={(e) => setOrcamentoFiltro(e.target.value)}
                        className="w-full bg-slate-950 border border-white/5 rounded-xl px-4 py-2.5 text-xs font-bold text-white focus:outline-none focus:border-cyan-500/50 transition-colors"
                      >
                        <option value="todos">Qualquer Valor</option>
                        <option value="ate_1500">Até R$ 1.500</option>
                        <option value="ate_3000">Até R$ 3.000</option>
                        <option value="ate_5000">Até R$ 5.000</option>
                      </select>
                    </div>

                    {/* Hospital de Preferência */}
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Hospital de Preferência</label>
                      <select
                        value={hospitalFiltro}
                        onChange={(e) => setHospitalFiltro(e.target.value)}
                        className="w-full bg-slate-950 border border-white/5 rounded-xl px-4 py-2.5 text-xs font-bold text-white focus:outline-none focus:border-cyan-500/50 transition-colors"
                      >
                        <option value="Todos">Todos os Hospitais</option>
                        <option value="Einstein">Albert Einstein</option>
                        <option value="Sírio">Sírio-Libanês</option>
                        <option value="Samaritano">Samaritano</option>
                        <option value="São Luiz">São Luiz</option>
                        <option value="BP">Beneficência Portuguesa</option>
                      </select>
                    </div>

                  </div>
                </div>

                {/* GRADE DE OPERADORAS E BOTÃO CONTINUAR (8 colunas) */}
                <div className="xl:col-span-8 flex flex-col space-y-4">
                  <div className="flex-1 bg-slate-900/60 rounded-[2rem] border border-white/5 p-6 backdrop-blur-md shadow-2xl flex flex-col justify-between">
                    
                    <div className="space-y-6">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-white/5 pb-4">
                        <div>
                          <h2 className="text-sm font-black text-white uppercase tracking-widest flex items-center gap-2">
                            <Layers size={16} className="text-cyan-400" />
                            Escolha as Operadoras
                          </h2>
                          <p className="text-2xs text-slate-400 font-bold mt-1">Selecione uma ou mais bandeiras para cotar. Deixe vazio para buscar em todas.</p>
                        </div>
                        {selectedOperadoraIds.length > 0 && (
                          <button
                            type="button"
                            onClick={limparSelecaoOperadoras}
                            className="text-[9px] font-black text-rose-400 uppercase tracking-widest hover:text-rose-300 self-start sm:self-auto"
                          >
                            Limpar Operadoras
                          </button>
                        )}
                      </div>

                      {/* Grid de operadoras */}
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3.5">
                        {operadoras.map((op) => {
                          const isSelected = selectedOperadoraIds.includes(op.id);
                          return (
                            <button
                              key={op.id}
                              type="button"
                              onClick={() => toggleOperadoraSelection(op.id)}
                              className={`relative p-4 rounded-3xl border text-center flex flex-col items-center gap-3 transition-all duration-200 cursor-pointer ${
                                isSelected
                                  ? 'border-cyan-500/50 bg-cyan-950/20 shadow-[0_0_20px_rgba(6,182,212,0.1)] scale-[1.02]'
                                  : 'border-white/5 bg-slate-950/40 hover:border-white/10 hover:bg-slate-950/70 hover:scale-[1.01]'
                              }`}
                            >
                              {/* Checkbox badge no canto do logo */}
                              {isSelected && (
                                <div className="absolute top-2 right-2 h-5 w-5 rounded-full bg-cyan-500 flex items-center justify-center text-slate-950 animate-in zoom-in-50 duration-150">
                                  <Check size={12} className="stroke-[3]" />
                                </div>
                              )}

                              <RenderLogo id={op.id} nome={op.nome} className="h-14 w-14" />
                              <div className="space-y-0.5">
                                <span className="text-[10px] font-black text-white uppercase block leading-tight">{op.nome}</span>
                                <span className="text-[8px] font-bold text-slate-500 block uppercase">
                                  {planos.filter(p => p.operadoraId === op.id && p.tipo === tipoContrato).length} planos
                                </span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Botão de prosseguir no rodapé */}
                    <div className="border-t border-white/5 pt-6 mt-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="text-left">
                        <span className="text-2xs font-extrabold uppercase tracking-widest text-slate-500">Resumo da Simulação</span>
                        <div className="flex items-center gap-3 mt-1.5">
                          <span className="rounded-xl bg-white/5 border border-white/5 px-3 py-1.5 text-xs font-black text-white">
                            {totalVidas} {totalVidas === 1 ? 'Vida' : 'Vidas'}
                          </span>
                          <span className="rounded-xl bg-white/5 border border-white/5 px-3 py-1.5 text-xs font-black text-white">
                            {tipoContrato}
                          </span>
                          <span className="rounded-xl bg-cyan-500/10 border border-cyan-500/20 px-3 py-1.5 text-xs font-black text-cyan-400">
                            {selectedOperadoraIds.length === 0 ? 'Todas Operadoras' : `${selectedOperadoraIds.length} selecionadas`}
                          </span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          if (totalVidas === 0) {
                            alert('Por favor, adicione pelo menos 1 vida para iniciar a simulação.');
                            return;
                          }
                          setSimulationStep(2);
                        }}
                        className="flex items-center justify-center gap-2 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-sm font-black uppercase text-white px-8 py-3.5 rounded-2xl shadow-xl shadow-cyan-950/20 active:scale-95 transition-all w-full sm:w-auto"
                      >
                        Continuar
                        <ArrowRight size={16} />
                      </button>
                    </div>

                  </div>
                </div>

              </div>
            ) : (
              /* PASSO 2: EXIBIÇÃO DE PLANOS FILTRADOS & COMPARAÇÃO */
              <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 animate-in fade-in-50 duration-200">
                
                {/* Resumo lateral esquerdo e tweak rápido de filtros */}
                <div className="xl:col-span-3 space-y-4">
                  
                  {/* Botão de voltar */}
                  <button
                    type="button"
                    onClick={() => setSimulationStep(1)}
                    className="flex items-center gap-2 text-xs font-black text-slate-400 hover:text-white transition-colors cursor-pointer bg-white/5 border border-white/5 px-4 py-2.5 rounded-2xl w-full justify-center"
                  >
                    <ArrowLeft size={14} />
                    Voltar aos Filtros
                  </button>

                  <div className="bg-slate-900/60 rounded-[2rem] border border-white/5 p-5 backdrop-blur-md shadow-2xl space-y-5">
                    <div className="text-xs font-black text-cyan-400 uppercase tracking-widest border-b border-white/5 pb-2.5">
                      Parâmetros Ativos
                    </div>

                    {/* Resumo dos filtros */}
                    <div className="space-y-3.5">
                      <div className="flex justify-between items-center text-xs font-bold text-slate-400 border-b border-white/5 pb-2">
                        <span>Contratação</span>
                        <span className="text-white uppercase font-black">{tipoContrato}</span>
                      </div>
                      <div className="flex justify-between items-center text-xs font-bold text-slate-400 border-b border-white/5 pb-2">
                        <span>Região</span>
                        <span className="text-white font-black">{ufFiltro}</span>
                      </div>
                      <div className="flex justify-between items-center text-xs font-bold text-slate-400 border-b border-white/5 pb-2">
                        <span>Acomodação</span>
                        <span className="text-white font-black">
                          {acomodacaoFiltro === 'Ambos' ? 'Todas' : acomodacaoFiltro}
                        </span>
                      </div>
                      <div className="flex justify-between items-center text-xs font-bold text-slate-400 border-b border-white/5 pb-2">
                        <span>Coparticipação</span>
                        <span className="text-white font-black">
                          {coparticipacaoFiltro === 'Ambos' ? 'Todas' : coparticipacaoFiltro}
                        </span>
                      </div>
                      <div className="flex justify-between items-center text-xs font-bold text-slate-400">
                        <span>Total de Vidas</span>
                        <span className="text-cyan-400 font-black">{totalVidas} vidas</span>
                      </div>
                    </div>

                    {/* Filtros Rápidos (Tweak instantâneo do resultado) */}
                    <div className="border-t border-white/5 pt-4 space-y-4">
                      <div className="text-xs font-black text-slate-400 uppercase tracking-wider">Ajuste Rápido</div>
                      
                      {/* Filtro por Hospital */}
                      <div className="space-y-1.5">
                        <label className="text-[9px] font-black uppercase text-slate-500">Filtrar por Hospital</label>
                        <select
                          value={hospitalFiltro}
                          onChange={(e) => setHospitalFiltro(e.target.value)}
                          className="w-full bg-slate-950 border border-white/5 rounded-xl px-3 py-2 text-2xs font-bold text-white focus:outline-none"
                        >
                          <option value="Todos">Todos os Hospitais</option>
                          <option value="Einstein">Albert Einstein</option>
                          <option value="Sírio">Sírio-Libanês</option>
                          <option value="Samaritano">Samaritano</option>
                          <option value="São Luiz">São Luiz</option>
                        </select>
                      </div>

                      {/* Filtro por Orçamento */}
                      <div className="space-y-1.5">
                        <label className="text-[9px] font-black uppercase text-slate-500">Orçamento Máximo</label>
                        <select
                          value={orcamentoFiltro}
                          onChange={(e) => setOrcamentoFiltro(e.target.value)}
                          className="w-full bg-slate-950 border border-white/5 rounded-xl px-3 py-2 text-2xs font-bold text-white focus:outline-none"
                        >
                          <option value="todos">Qualquer Valor</option>
                          <option value="ate_1500">Até R$ 1.500</option>
                          <option value="ate_3000">Até R$ 3.000</option>
                          <option value="ate_5000">Até R$ 5.000</option>
                        </select>
                      </div>
                    </div>

                  </div>
                </div>

                {/* Lista de planos encontrados (9 colunas) */}
                <div className="xl:col-span-9 space-y-4">
                  <div className="flex items-center justify-between bg-white/3 border border-white/5 rounded-2xl px-5 py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-600/20 text-cyan-400 border border-cyan-500/10">
                        <Calculator size={18} />
                      </div>
                      <div>
                        <h2 className="text-xs font-black uppercase tracking-wider text-slate-300">Planos Calculados</h2>
                        <p className="text-2xs text-slate-500 font-bold">
                          Encontramos {planosCalculados.length} opções compatíveis com o perfil.
                        </p>
                      </div>
                    </div>

                    {comparedPlanIds.length > 0 && (
                      <span className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-3 py-1.5 text-[9px] font-black uppercase tracking-widest text-cyan-400">
                        {comparedPlanIds.length} selecionados
                      </span>
                    )}
                  </div>

                  {planosCalculados.length === 0 ? (
                    <div className="bg-slate-900/40 rounded-[2.5rem] border border-white/5 p-20 text-center shadow-md">
                      <AlertTriangle size={36} className="text-amber-400 mx-auto mb-4 animate-bounce" />
                      <h3 className="text-base font-black text-white uppercase tracking-wider">Nenhum plano encontrado</h3>
                      <p className="text-xs text-slate-500 mt-2 font-bold max-w-md mx-auto leading-relaxed">
                        Tente relaxar os filtros laterais (ex: remover preferência por hospital ou aumentar a faixa de valor) ou voltar para adicionar mais operadoras.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {planosCalculados.map((plano) => {
                        const isCompared = comparedPlanIds.includes(plano.id);
                        const isExpanded = expandedPlanDetail === plano.id;
                        const op = operadoras.find(o => o.id === plano.operadoraId) || { nome: 'Operadora', corGradiente: 'from-blue-600' };

                        return (
                          <div
                            key={plano.id}
                            className={`bg-slate-900/60 rounded-[2rem] border p-6 backdrop-blur-md shadow-xl flex flex-col space-y-4 transition-all duration-300 ${
                              isCompared ? 'border-cyan-500/30 bg-cyan-950/5' : 'border-white/5 hover:border-white/10'
                            }`}
                          >
                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                              {/* Logo e Nome */}
                              <div className="flex items-center gap-4">
                                <RenderLogo id={plano.operadoraId} nome={op.nome} className="h-12 w-12" />
                                <div>
                                  <div className="flex items-center gap-2">
                                    <h3 className="text-base font-black text-white">{plano.nome}</h3>
                                    <span className="rounded-lg bg-white/5 border border-white/5 px-2 py-0.5 text-[8px] font-black uppercase text-slate-400 tracking-wider">
                                      {plano.tipo}
                                    </span>
                                  </div>
                                  <p className="text-2xs text-slate-500 font-bold uppercase tracking-wider mt-0.5">{op.nome}</p>
                                </div>
                              </div>

                              {/* Atributos do Plano */}
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="rounded-xl border border-white/5 bg-white/5 px-3 py-1.5 text-[10px] font-extrabold text-slate-300">
                                  {plano.acomodacao === 'Coletivo' ? 'Enfermaria (Coletivo)' : 'Apartamento (Individual)'}
                                </span>
                                <span className="rounded-xl border border-white/5 bg-white/5 px-3 py-1.5 text-[10px] font-extrabold text-slate-300">
                                  {plano.coparticipacao === 'Sim' ? 'Com Coparticipação' : 'Sem Coparticipação'}
                                </span>
                                <span className="rounded-xl border border-white/5 bg-white/5 px-3 py-1.5 text-[10px] font-extrabold text-slate-300">
                                  Reembolso: {plano.reembolso}
                                </span>
                              </div>

                              {/* Preço e Botão */}
                              <div className="text-left md:text-right shrink-0">
                                <span className="text-[10px] font-extrabold text-slate-500 uppercase tracking-widest block">Mensalidade Total</span>
                                <div className="flex items-baseline gap-1 mt-0.5">
                                  <span className="text-2xl font-black text-cyan-400">
                                    {plano.custoTotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                  </span>
                                  <span className="text-2xs text-slate-500 font-bold">/mês</span>
                                </div>
                                <span className="text-[9px] text-slate-400 font-extrabold uppercase mt-1 block">Para {totalVidas} vidas</span>
                              </div>
                            </div>

                            {/* Rede hospitalar compacta */}
                            <div className="border-t border-white/5 pt-3.5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                              <div className="flex-1">
                                <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block">Hospitais Credenciados</span>
                                <div className="flex flex-wrap gap-1.5 mt-1.5">
                                  {plano.hospitais.slice(0, 4).map((h, i) => (
                                    <span key={i} className="rounded-lg bg-slate-950 px-2.5 py-1 text-[10px] font-bold text-slate-300">
                                      {h}
                                    </span>
                                  ))}
                                  {plano.hospitais.length > 4 && (
                                    <button
                                      onClick={() => setExpandedPlanDetail(isExpanded ? null : plano.id)}
                                      className="rounded-lg bg-white/5 hover:bg-white/10 px-2.5 py-1 text-[10px] font-bold text-cyan-400 cursor-pointer"
                                    >
                                      +{plano.hospitais.length - 4} mais
                                    </button>
                                  )}
                                </div>
                              </div>

                              {/* Botões de Ação do Card */}
                              <div className="flex items-center gap-2 self-start md:self-auto">
                                <button
                                  type="button"
                                  onClick={() => toggleComparePlan(plano.id)}
                                  className={`px-4 py-2 rounded-xl text-2xs font-extrabold uppercase transition-all flex items-center gap-1.5 border active:scale-95 cursor-pointer ${
                                    isCompared
                                      ? 'bg-cyan-500/20 border-cyan-500/30 text-cyan-400'
                                      : 'bg-white/5 border-white/5 hover:bg-white/10 text-slate-300'
                                  }`}
                                >
                                  {isCompared ? <Check size={12} /> : <Layers size={12} />}
                                  {isCompared ? 'Selecionado' : 'Comparar'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setPropostaModal({
                                      plano,
                                      total: plano.custoTotal,
                                      vidasPorFaixa: plano.detalheVidas,
                                      totalVidas
                                    });
                                  }}
                                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-2xs font-black uppercase text-white transition-all shadow-lg active:scale-95 cursor-pointer"
                                >
                                  Gerar Proposta
                                </button>
                              </div>
                            </div>

                            {/* Dropdown com detalhes completos */}
                            {isExpanded && (
                              <div className="border-t border-white/5 pt-4 mt-2 grid grid-cols-1 md:grid-cols-2 gap-4 animate-in fade-in-50 duration-200">
                                <div>
                                  <h4 className="text-2xs font-black text-cyan-400 uppercase tracking-widest mb-2">Rede Completa de Hospitais</h4>
                                  <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-2xs font-bold text-slate-300">
                                    {plano.hospitais.map((h, i) => (
                                      <li key={i} className="flex items-center gap-1.5">
                                        <div className="h-1.5 w-1.5 rounded-full bg-cyan-400 shrink-0" />
                                        {h}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                                <div>
                                  <h4 className="text-2xs font-black text-cyan-400 uppercase tracking-widest mb-2">Laboratórios Principais</h4>
                                  <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-2xs font-bold text-slate-300">
                                    {plano.laboratorios.map((l, i) => (
                                      <li key={i} className="flex items-center gap-1.5">
                                        <div className="h-1.5 w-1.5 rounded-full bg-blue-500 shrink-0" />
                                        {l}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              </div>
                            )}

                          </div>
                        );
                      })}
                    </div>
                  )}

                </div>

              </div>
            )}
          </div>
        )}

        {/* ================= ABA: CATÁLOGO HIERÁRQUICO ================= */}
        {activeTab === 'catalogo' && (
          <div className="bg-slate-900/60 rounded-[2.5rem] border border-white/5 p-6 backdrop-blur-md shadow-2xl">
            <h2 className="text-lg font-black text-white uppercase tracking-widest border-b border-white/5 pb-4">Catálogo de Tabelas e Preços</h2>
            
            <div className="mt-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
              
              {/* Lado esquerdo: Selecionar Operadora (4 colunas) */}
              <div className="lg:col-span-4 space-y-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-2">Operadoras Cadastradas</span>
                {operadoras.map((op) => {
                  const selectOpPlanCount = planos.filter(p => p.operadoraId === op.id).length;
                  return (
                    <button
                      key={op.id}
                      onClick={() => setSelectedOperadoraIds([op.id])}
                      className={`w-full flex items-center justify-between p-3.5 rounded-2xl border transition-all duration-200 cursor-pointer ${
                        selectedOperadoraIds.includes(op.id)
                          ? 'border-cyan-500/30 bg-cyan-950/20 shadow-md'
                          : 'border-white/5 bg-slate-950/30 hover:border-white/10 hover:bg-slate-950/50'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <RenderLogo id={op.id} nome={op.nome} className="h-10 w-10" />
                        <span className="text-xs font-black text-white">{op.nome}</span>
                      </div>
                      <span className="rounded-lg bg-white/5 px-2.5 py-1 text-[9px] font-black text-slate-400">
                        {selectOpPlanCount} {selectOpPlanCount === 1 ? 'Tabela' : 'Tabelas'}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Lado direito: Lista de Planos e Preços (8 colunas) */}
              <div className="lg:col-span-8 space-y-4">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-2">
                  Tabelas de Preços por Faixa Etária
                </span>

                {selectedOperadoraIds.length === 0 ? (
                  <div className="border border-dashed border-white/5 rounded-3xl p-20 text-center text-slate-500 text-xs font-bold uppercase tracking-wider">
                    Selecione uma operadora ao lado para visualizar o catálogo completo de preços.
                  </div>
                ) : (
                  <div className="space-y-4">
                    {planos
                      .filter(p => selectedOperadoraIds.includes(p.operadoraId))
                      .map((plano) => (
                        <div key={plano.id} className="bg-slate-950/40 rounded-3xl border border-white/5 p-6 space-y-4">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-white/5 pb-3">
                            <div>
                              <h3 className="text-sm font-black text-white uppercase tracking-wider">{plano.nome}</h3>
                              <p className="text-[10px] font-bold text-slate-500 mt-0.5">Acomodação: {plano.acomodacao} | Coparticipação: {plano.coparticipacao}</p>
                            </div>
                            <span className="rounded-xl bg-cyan-500/10 border border-cyan-500/20 px-3 py-1 text-2xs font-extrabold text-cyan-400 uppercase tracking-widest self-start sm:self-auto">
                              {plano.tipo}
                            </span>
                          </div>

                          {/* Grid das 10 faixas etárias e preços correspondentes */}
                          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                            {FAIXAS_ETARIAS.map((faixa, i) => (
                              <div key={faixa.key} className="bg-white/2 border border-white/5 rounded-2xl p-3 text-center">
                                <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block">{faixa.label}</span>
                                <span className="text-xs font-black text-white mt-1 block">
                                  {plano.precos[i]?.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) || 'N/A'}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>

            </div>
          </div>
        )}

        {/* ================= ABA: IMPORTADOR INTELIGENTE APOLO ================= */}
        {activeTab === 'admin' && isAdmin && (
          <div className="bg-slate-900/60 rounded-[2.5rem] border border-white/5 p-6 backdrop-blur-md shadow-2xl space-y-6">
            <div>
              <h2 className="text-lg font-black text-white uppercase tracking-widest flex items-center gap-2">
                <Sparkles className="text-cyan-400" size={20} />
                Apolo AI Table Parser (Importador Inteligente)
              </h2>
              <p className="text-xs font-bold text-slate-400 mt-1">
                Arraste um PDF ou planilha de operadora de planos de saúde. A IA estruturará os preços e reajustes automaticamente.
              </p>
            </div>

            {/* Arrastador de arquivos */}
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                const file = e.dataTransfer.files?.[0];
                if (file) handleApoloFileUpload(file);
              }}
              className={`border-2 border-dashed rounded-[2rem] p-16 text-center transition-all flex flex-col items-center justify-center gap-4 cursor-pointer ${
                isDragging 
                  ? 'border-cyan-500 bg-cyan-950/20 shadow-2xl' 
                  : 'border-white/10 bg-slate-950/40 hover:border-white/20'
              }`}
            >
              <input
                type="file"
                id="apolo-file-input"
                className="hidden"
                accept=".pdf,.xlsx,.xls,.txt,.csv"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleApoloFileUpload(file);
                }}
              />
              <label htmlFor="apolo-file-input" className="cursor-pointer flex flex-col items-center justify-center gap-4">
                <div className="h-16 w-16 rounded-full bg-cyan-600/20 text-cyan-400 border border-cyan-500/20 flex items-center justify-center shadow-lg">
                  {aiParsing ? <RefreshCw size={28} className="animate-spin" /> : <Upload size={28} />}
                </div>
                <div>
                  <span className="text-xs font-black text-white uppercase tracking-wider block">
                    {aiParsing ? 'Processando Documento com IA...' : 'Arraste ou Selecione seu arquivo'}
                  </span>
                  <span className="text-[10px] font-bold text-slate-500 block uppercase mt-1">
                    Aceita PDF de reajuste, Planilhas de preços ou TXT (Max 8 Pág.)
                  </span>
                </div>
              </label>
            </div>

            {/* Mensagem de Erro */}
            {errorMessage && (
              <div className="rounded-2xl bg-rose-500/10 border border-rose-500/30 p-4 text-xs font-bold text-rose-400 flex items-center gap-3">
                <AlertCircle size={16} className="shrink-0" />
                <p>{errorMessage}</p>
              </div>
            )}

            {/* Preview de Dados Extraídos por IA */}
            {aiPreviewData && (
              <div className="bg-slate-950/80 rounded-[2rem] border border-cyan-500/20 p-6 space-y-6 animate-in zoom-in-95 duration-200">
                <div className="flex items-center justify-between gap-4 border-b border-white/5 pb-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/20 border border-cyan-500/20 text-cyan-400">
                      <Sparkles size={18} />
                    </div>
                    <div>
                      <h3 className="text-xs font-black text-white uppercase tracking-widest">Preview Estruturado via Inteligência Artificial</h3>
                      <p className="text-[9px] font-bold text-slate-500 uppercase mt-0.5">Revise antes de salvar no banco</p>
                    </div>
                  </div>
                  <span className="rounded-xl bg-cyan-600/20 border border-cyan-500/20 px-3 py-1.5 text-2xs font-extrabold text-cyan-400 uppercase tracking-widest">
                    Apolo AI Parsed
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="bg-white/2 border border-white/5 rounded-2xl p-4">
                    <span className="text-[9px] font-black text-slate-500 uppercase tracking-wider block">Operadora</span>
                    <input
                      type="text"
                      value={aiPreviewData.operadoraNome}
                      onChange={(e) => setAiPreviewData({ ...aiPreviewData, operadoraNome: e.target.value })}
                      className="w-full bg-transparent border-b border-white/10 text-xs font-black text-white focus:outline-none focus:border-cyan-500 mt-1"
                    />
                  </div>
                  <div className="bg-white/2 border border-white/5 rounded-2xl p-4">
                    <span className="text-[9px] font-black text-slate-500 uppercase tracking-wider block">Plano</span>
                    <input
                      type="text"
                      value={aiPreviewData.nome}
                      onChange={(e) => setAiPreviewData({ ...aiPreviewData, nome: e.target.value })}
                      className="w-full bg-transparent border-b border-white/10 text-xs font-black text-white focus:outline-none focus:border-cyan-500 mt-1"
                    />
                  </div>
                  <div className="bg-white/2 border border-white/5 rounded-2xl p-4">
                    <span className="text-[9px] font-black text-slate-500 uppercase tracking-wider block">Contratação</span>
                    <select
                      value={aiPreviewData.tipo}
                      onChange={(e) => setAiPreviewData({ ...aiPreviewData, tipo: e.target.value as any })}
                      className="w-full bg-transparent border-b border-white/10 text-xs font-black text-white focus:outline-none focus:border-cyan-500 mt-1"
                    >
                      <option value="PME">Coletivo PME</option>
                      <option value="PF">Individual PF</option>
                    </select>
                  </div>
                  <div className="bg-white/2 border border-white/5 rounded-2xl p-4">
                    <span className="text-[9px] font-black text-slate-500 uppercase tracking-wider block">Reembolso</span>
                    <input
                      type="text"
                      value={aiPreviewData.reembolso}
                      onChange={(e) => setAiPreviewData({ ...aiPreviewData, reembolso: e.target.value })}
                      className="w-full bg-transparent border-b border-white/10 text-xs font-black text-white focus:outline-none focus:border-cyan-500 mt-1"
                    />
                  </div>
                </div>

                {/* Preços por Faixa ANS no Preview */}
                <div className="space-y-2">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Tabela de Preços Extraída (R$)</span>
                  <div className="grid grid-cols-2 sm:grid-cols-5 md:grid-cols-10 gap-3">
                    {FAIXAS_ETARIAS.map((faixa, i) => (
                      <div key={faixa.key} className="bg-white/2 border border-white/5 rounded-2xl p-3 text-center">
                        <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block leading-tight">{faixa.label.split(' ')[0]}</span>
                        <input
                          type="number"
                          value={aiPreviewData.precos?.[i] || ''}
                          onChange={(e) => {
                            const newPrecos = [...(aiPreviewData.precos || [])];
                            newPrecos[i] = parseFloat(e.target.value) || 0;
                            setAiPreviewData({ ...aiPreviewData, precos: newPrecos });
                          }}
                          className="w-full text-center bg-transparent border-b border-white/5 text-xs font-black text-white focus:outline-none focus:border-cyan-500 mt-1.5"
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex gap-3 justify-end pt-4 border-t border-white/5">
                  <button
                    type="button"
                    onClick={() => setAiPreviewData(null)}
                    className="px-6 py-2.5 rounded-xl text-xs font-bold text-slate-400 hover:bg-white/5 transition-all"
                  >
                    Descartar
                  </button>
                  <button
                    type="button"
                    onClick={confirmarSalvarAiPreview}
                    className="flex items-center gap-2 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-xs font-black uppercase text-white px-8 py-2.5 rounded-xl shadow-lg transition-all"
                  >
                    <Check size={14} />
                    Confirmar e Importar
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

      </div>

      {/* ================= FLOATING COMPARISON FOOTER BAR ================= */}
      {comparedPlanIds.length > 0 && activeTab === 'simulacao' && simulationStep === 2 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 w-[90%] max-w-4xl bg-slate-900/90 border border-cyan-500/20 px-6 py-4 rounded-[2rem] shadow-2xl backdrop-blur-md flex items-center justify-between gap-4 animate-in slide-in-from-bottom-6 duration-300">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-full bg-cyan-600/20 text-cyan-400 flex items-center justify-center font-bold text-xs shrink-0">
              {comparedPlanIds.length}
            </div>
            <div>
              <span className="text-xs font-black text-white uppercase tracking-wider block">Planos Selecionados para Comparação</span>
              <span className="text-[10px] text-slate-500 font-bold block uppercase mt-0.5">Compare valores e rede hospitalar lado a lado</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setComparedPlanIds([])}
              className="px-4 py-2 rounded-xl text-2xs font-bold text-slate-400 hover:bg-white/5 transition-all"
            >
              Limpar Seleção
            </button>
            <button
              onClick={() => setIsCompareModalOpen(true)}
              className="flex items-center gap-1.5 px-6 py-2 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-2xs font-black uppercase text-white transition-all shadow-lg active:scale-95 cursor-pointer"
            >
              <Layers size={12} />
              Comparar Agora
            </button>
          </div>
        </div>
      )}

      {/* ================= MODAL 1: COMPARATIVO LADO A LADO ================= */}
      {isCompareModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 animate-in fade-in-50 duration-200">
          <div className="bg-slate-900 rounded-[2.5rem] border border-white/10 w-full max-w-6xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
            
            <div className="p-6 border-b border-white/5 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <Layers size={20} className="text-cyan-400 animate-pulse" />
                <div>
                  <h3 className="text-sm font-black text-white uppercase tracking-widest">Comparação Geral de Tabelas</h3>
                  <p className="text-[9px] font-bold text-slate-500 uppercase mt-0.5">Analise preços, reembolso e hospitais credenciados</p>
                </div>
              </div>
              <button
                onClick={() => setIsCompareModalOpen(false)}
                className="h-9 w-9 rounded-xl bg-white/5 border border-white/5 flex items-center justify-center text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-x-auto p-6">
              <table className="w-full border-collapse text-left text-xs text-white">
                <thead>
                  <tr className="border-b border-white/5">
                    <th className="pb-4 pr-4 font-black uppercase text-slate-500 text-[10px]">Atributo</th>
                    {comparedPlanIds.map((id) => {
                      const pl = planosCalculados.find(p => p.id === id);
                      if (!pl) return null;
                      return (
                        <th key={id} className="pb-4 px-4 min-w-[200px]">
                          <div className="flex items-center gap-2 mb-2">
                            <RenderLogo id={pl.operadoraId} nome={pl.nome} className="h-8 w-8" />
                            <div>
                              <span className="font-black block uppercase tracking-wide leading-tight">{pl.nome}</span>
                              <span className="text-[8px] font-bold text-slate-500 block uppercase mt-0.5">
                                {operadoras.find(o => o.id === pl.operadoraId)?.nome || ''}
                              </span>
                            </div>
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  <tr>
                    <td className="py-4 pr-4 font-bold text-slate-400 uppercase text-[9px]">Mensalidade Total</td>
                    {comparedPlanIds.map((id) => {
                      const pl = planosCalculados.find(p => p.id === id);
                      return (
                        <td key={id} className="py-4 px-4 font-black text-cyan-400 text-sm">
                          {pl?.custoTotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                        </td>
                      );
                    })}
                  </tr>
                  <tr>
                    <td className="py-4 pr-4 font-bold text-slate-400 uppercase text-[9px]">Contratação</td>
                    {comparedPlanIds.map((id) => (
                      <td key={id} className="py-4 px-4 font-bold text-slate-200">
                        {planosCalculados.find(p => p.id === id)?.tipo}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="py-4 pr-4 font-bold text-slate-400 uppercase text-[9px]">Acomodação</td>
                    {comparedPlanIds.map((id) => (
                      <td key={id} className="py-4 px-4 font-bold text-slate-200">
                        {planosCalculados.find(p => p.id === id)?.acomodacao}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="py-4 pr-4 font-bold text-slate-400 uppercase text-[9px]">Coparticipação</td>
                    {comparedPlanIds.map((id) => (
                      <td key={id} className="py-4 px-4 font-bold text-slate-200">
                        {planosCalculados.find(p => p.id === id)?.coparticipacao === 'Sim' ? 'Sim' : 'Não'}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="py-4 pr-4 font-bold text-slate-400 uppercase text-[9px]">Reembolso</td>
                    {comparedPlanIds.map((id) => (
                      <td key={id} className="py-4 px-4 font-bold text-slate-200">
                        {planosCalculados.find(p => p.id === id)?.reembolso}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="py-4 pr-4 font-bold text-slate-400 uppercase text-[9px]">Hospitais Principais</td>
                    {comparedPlanIds.map((id) => {
                      const pl = planosCalculados.find(p => p.id === id);
                      return (
                        <td key={id} className="py-4 px-4 align-top">
                          <ul className="space-y-1 text-slate-300 font-medium">
                            {pl?.hospitais.map((h, i) => (
                              <li key={i} className="flex items-center gap-1">
                                <div className="h-1 w-1 rounded-full bg-cyan-400 shrink-0" />
                                {h}
                              </li>
                            ))}
                          </ul>
                        </td>
                      );
                    })}
                  </tr>
                  <tr>
                    <td className="py-4 pr-4 font-bold text-slate-400 uppercase text-[9px]">Laboratórios</td>
                    {comparedPlanIds.map((id) => {
                      const pl = planosCalculados.find(p => p.id === id);
                      return (
                        <td key={id} className="py-4 px-4 align-top">
                          <ul className="space-y-1 text-slate-300 font-medium">
                            {pl?.laboratorios.map((l, i) => (
                              <li key={i} className="flex items-center gap-1">
                                <div className="h-1 w-1 rounded-full bg-blue-500 shrink-0" />
                                {l}
                              </li>
                            ))}
                          </ul>
                        </td>
                      );
                    })}
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="p-6 border-t border-white/5 bg-slate-950/20 flex justify-end shrink-0">
              <button
                type="button"
                onClick={() => setIsCompareModalOpen(false)}
                className="px-6 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-xs font-black uppercase text-white shadow-lg cursor-pointer"
              >
                Voltar
              </button>
            </div>

          </div>
        </div>
      )}

      {/* ================= MODAL 2: DETALHES E COMPARTILHAMENTO DE PROPOSTA ================= */}
      {propostaModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 animate-in fade-in-50 duration-200">
          <div className="bg-slate-900 rounded-[2.5rem] border border-white/10 w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
            
            <div className="p-6 border-b border-white/5 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <FileText size={20} className="text-cyan-400" />
                <div>
                  <h3 className="text-sm font-black text-white uppercase tracking-widest">Compartilhar Proposta Comercial</h3>
                  <p className="text-[9px] font-bold text-slate-500 uppercase mt-0.5">Envie a cotação estruturada para o cliente</p>
                </div>
              </div>
              <button
                onClick={() => setPropostaModal(null)}
                className="h-9 w-9 rounded-xl bg-white/5 border border-white/5 flex items-center justify-center text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              
              {/* Card visual do plano */}
              <div className="bg-slate-950/50 rounded-2xl border border-white/5 p-4 space-y-3.5">
                <div className="flex items-center justify-between border-b border-white/5 pb-2">
                  <div className="flex items-center gap-2">
                    <RenderLogo id={propostaModal.plano.operadoraId} nome={propostaModal.plano.nome} className="h-8 w-8" />
                    <div>
                      <span className="text-xs font-black text-white uppercase block">{propostaModal.plano.nome}</span>
                      <span className="text-[8px] font-bold text-slate-500 block uppercase">
                        {operadoras.find(o => o.id === propostaModal.plano.operadoraId)?.nome || ''}
                      </span>
                    </div>
                  </div>
                  <span className="text-sm font-black text-cyan-400">
                    {propostaModal.total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                  </span>
                </div>

                {/* Tabela de faixas */}
                <div className="space-y-1.5">
                  <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block">Divisão de Custos por Idade</span>
                  <div className="grid grid-cols-2 gap-2">
                    {propostaModal.vidasPorFaixa
                      .filter(f => f.count > 0)
                      .map((faixa, i) => (
                        <div key={i} className="flex justify-between items-center text-[10px] bg-slate-950 p-2 rounded-xl">
                          <span className="text-slate-400 font-bold">{faixa.count}x {faixa.label}</span>
                          <span className="text-white font-black">
                            {faixa.subtotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              </div>

              {/* Pré-visualização do texto da proposta */}
              <div className="space-y-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Mensagem que será enviada</span>
                <textarea
                  readOnly
                  rows={8}
                  className="w-full bg-slate-950 border border-white/5 rounded-2xl p-4 text-[10px] font-mono text-slate-300 leading-normal focus:outline-none"
                  value={`📋 *PROPOSTA COMERCIAL - ORION SEGUROS*

Olá! Segue o demonstrativo do cálculo para o plano de saúde solicitado:

*Operadora:* ${operadoras.find(o => o.id === propostaModal.plano.operadoraId)?.nome || ''}
*Plano:* ${propostaModal.plano.nome} (ANS: ${propostaModal.plano.tipo})
*Acomodação:* ${propostaModal.plano.acomodacao}
*Coparticipação:* ${propostaModal.plano.coparticipacao}
*Reembolso:* ${propostaModal.plano.reembolso}

👥 *Resumo de Vidas:*
${propostaModal.vidasPorFaixa.filter(f => f.count > 0).map(f => `• ${f.count}x ${f.label} (${f.precoUnitario.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} un)`).join('\n')}

💵 *VALOR TOTAL MENSAL: ${propostaModal.total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}*

*Hospitais de Destaque:*
${propostaModal.plano.hospitais.slice(0, 3).map(h => `• ${h}`).join('\n')}

_Dúvidas ou alterações, estou à disposição!_`}
                />
              </div>

            </div>

            <div className="p-6 border-t border-white/5 bg-slate-950/20 flex flex-col sm:flex-row gap-3 justify-between items-center shrink-0">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">
                *Proposta copiada com sucesso ao disparar
              </span>
              <div className="flex gap-2 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={() => setPropostaModal(null)}
                  className="flex-1 sm:flex-none px-6 py-2.5 rounded-xl text-xs font-bold text-slate-400 hover:bg-white/5 transition-all text-center"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const text = `📋 *PROPOSTA COMERCIAL - ORION SEGUROS*

Olá! Segue o demonstrativo do cálculo para o plano de saúde solicitado:

*Operadora:* ${operadoras.find(o => o.id === propostaModal.plano.operadoraId)?.nome || ''}
*Plano:* ${propostaModal.plano.nome} (ANS: ${propostaModal.plano.tipo})
*Acomodação:* ${propostaModal.plano.acomodacao}
*Coparticipação:* ${propostaModal.plano.coparticipacao}
*Reembolso:* ${propostaModal.plano.reembolso}

👥 *Resumo de Vidas:*
${propostaModal.vidasPorFaixa.filter(f => f.count > 0).map(f => `• ${f.count}x ${f.label} (${f.precoUnitario.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} un)`).join('\n')}

💵 *VALOR TOTAL MENSAL: ${propostaModal.total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}*

*Hospitais de Destaque:*
${propostaModal.plano.hospitais.slice(0, 3).map(h => `• ${h}`).join('\n')}

_Dúvidas ou alterações, estou à disposição!_`;
                    await copyTextToClipboard(text);
                    alert('Proposta copiada para a área de transferência! Enviando notificação...');
                    
                    // Simular envio do webhook WhatsApp via Apolo AI
                    dispararNotificacoes(
                      operadoras.find(o => o.id === propostaModal.plano.operadoraId)?.nome || 'Operadora',
                      propostaModal.plano.nome
                    );
                    setPropostaModal(null);
                  }}
                  className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-8 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-xs font-black uppercase text-white shadow-lg transition-all"
                >
                  <Share2 size={12} />
                  Copiar e Disparar
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

    </InternalLayout>
  );
}
