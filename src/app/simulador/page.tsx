'use client';

import { useState, useEffect, useRef } from 'react';
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
  Info
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
  tipo: 'PF' | 'PME';
  coparticipacao: 'Sim' | 'Não';
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
  { id: 'unimed', nome: 'Unimed Nacional', corGradiente: 'from-emerald-600 to-teal-500' }
];

// Dados Iniciais / Mock de Planos
const PLANOS_PADRAO: Plano[] = [
  {
    id: 'p1',
    operadoraId: 'amil',
    nome: 'Amil S380',
    tipo: 'PME',
    coparticipacao: 'Sim',
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
    reembolso: 'Sem reembolso',
    hospitais: ['Hospital Unimed', 'Hospital da Luz', 'Hospital Beneficência Portuguesa'],
    laboratorios: ['Lavoisier', 'Delboni Auriemo'],
    precos: [230, 280, 345, 380, 440, 500, 620, 745, 1010, 1785],
    isDemo: true
  }
];

// Logos Vetoriais Premium Customizados em SVG
// Logos Vetoriais Premium Customizados em Imagem
function RenderLogo({ id, className = "h-8 w-8" }: { id: string; className?: string }) {
  const mapping: { [key: string]: string } = {
    'amil': '/operadoras/2.png',
    'bradesco': '/operadoras/5.png',
    'sulamerica': '/operadoras/1.png',
    'porto': '/operadoras/3.png',
    'alice': '/operadoras/4.png'
  };

  const src = mapping[id.toLowerCase()];
  if (src) {
    return (
      <div className={`${className} flex items-center justify-center rounded-xl bg-white border border-slate-200/60 shadow-sm overflow-hidden p-1 shrink-0`}>
        <img
          src={src}
          alt={id}
          className="h-full w-full object-contain"
        />
      </div>
    );
  }

  // Fallback para novas operadoras
  return (
    <div className={`${className} flex items-center justify-center rounded-xl bg-gradient-to-br from-slate-700 to-slate-600 text-[10px] font-black uppercase text-white shadow-md shrink-0`}>
      {id.slice(0, 2)}
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
  const isBrokerAccess = ['corretor', 'corretor_admin', 'corretor_membro'].includes(String(profile?.tipo_usuario || ''));

  // Estados dos dados
  const [operadoras, setOperadoras] = useState<Operadora[]>(OPERADORAS_PADRAO);
  const [planos, setPlanos] = useState<Plano[]>(PLANOS_PADRAO);

  // Estados de navegação interna
  const [activeTab, setActiveTab] = useState<'simulacao' | 'catalogo' | 'admin'>('simulacao');

  // Estados dos filtros da simulação
  const [tipoContrato, setTipoContrato] = useState<'PF' | 'PME'>('PME');
  const [coparticipacaoFiltro, setCoparticipacaoFiltro] = useState<'Ambos' | 'Sim' | 'Não'>('Ambos');
  const [ufFiltro, setUfFiltro] = useState<string>('SP');
  const [buscaPlanos, setBuscaPlanos] = useState<string>('');

  // Estado para Catálogo Hierárquico
  const [selectedOperadoraId, setSelectedOperadoraId] = useState<string | null>(null);
  const [expandedPlanId, setExpandedPlanId] = useState<string | null>(null);

  // Estado de Edição Inline (Admins)
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [editFormData, setEditFormData] = useState<Partial<Plano>>({});

  // Estados para comparação lado a lado
  const [comparedPlanIds, setComparedPlanIds] = useState<string[]>([]);
  const [isCompareModalOpen, setIsCompareModalOpen] = useState(false);
  const [expandedResultId, setExpandedResultId] = useState<string | null>(null);

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

  // Estado para proposta selecionada / modal
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

  // Webhook visual log do WhatsApp
  const [whatsAppLog, setWhatsAppLog] = useState<string | null>(null);

  // Carregar dependências de PDF.js e SheetJS
  useEffect(() => {
    // XLSX (SheetJS)
    if (!(window as any).XLSX) {
      const scriptX = document.createElement('script');
      scriptX.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      scriptX.async = true;
      document.body.appendChild(scriptX);
    }
    // PDF.js
    if (!(window as any).pdfjsLib) {
      const scriptP = document.createElement('script');
      scriptP.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.min.js';
      scriptP.async = true;
      document.body.appendChild(scriptP);
    }
  }, []);

  // Carregar dados salvos no LocalStorage (se houver)
  useEffect(() => {
    const savedOperadoras = localStorage.getItem('orion:sim_operadoras');
    const savedPlanos = localStorage.getItem('orion:sim_planos');
    if (savedOperadoras) setOperadoras(JSON.parse(savedOperadoras));
    if (savedPlanos) setPlanos(JSON.parse(savedPlanos));
  }, []);

  // Carregar dados da URL (para integração com o CRM)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const idadesParam = params.get('idades');
      const pjParam = params.get('pj');

      if (idadesParam) {
        const idadesArray = idadesParam
          .split(',')
          .map(i => parseInt(i.trim(), 10))
          .filter(i => !isNaN(i));

        const novasVidas = {
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
        };

        idadesArray.forEach(idade => {
          if (idade <= 18) novasVidas['0_18']++;
          else if (idade <= 23) novasVidas['19_23']++;
          else if (idade <= 28) novasVidas['24_28']++;
          else if (idade <= 33) novasVidas['29_33']++;
          else if (idade <= 38) novasVidas['34_38']++;
          else if (idade <= 43) novasVidas['39_43']++;
          else if (idade <= 48) novasVidas['44_48']++;
          else if (idade <= 53) novasVidas['49_53']++;
          else if (idade <= 58) novasVidas['54_58']++;
          else novasVidas['59_mais']++;
        });

        setVidas(novasVidas);
      }

      if (pjParam) {
        setTipoContrato(pjParam === '1' ? 'PME' : 'PF');
      }
    }
  }, []);

  // Bloquear scroll do body quando o modal de proposta ou comparativo estiver aberto
  useEffect(() => {
    if (propostaModal || isCompareModalOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [propostaModal, isCompareModalOpen]);

  // Salvar dados no LocalStorage
  const salvarDados = (novasOps: Operadora[], novosPlanos: Plano[]) => {
    setOperadoras(novasOps);
    setPlanos(novosPlanos);
    localStorage.setItem('orion:sim_operadoras', JSON.stringify(novasOps));
    localStorage.setItem('orion:sim_planos', JSON.stringify(novosPlanos));
  };

  // Disparar Notificação Interna e Simular WhatsApp Webhook
  const dispararNotificacoes = async (operadoraNome: string, planoNome: string) => {
    const titulo = `Tabela Atualizada: ${operadoraNome}!`;
    const mensagem = `Apolo AI identificou novos reajustes de preços no plano "${planoNome}". As tabelas atualizadas já estão disponíveis no Simulador!`;

    // 1. Inserir no Supabase (Notificação Interna)
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

    // 2. Simular Webhook do WhatsApp (Imprimir no console e exibir log visual para o usuário)
    const logInfo = `[WhatsApp Webhook n8n Triggered]
Payload: {
  event: "price_update",
  operator: "${operadoraNome}",
  plan: "${planoNome}",
  text: "🚨 *Aviso Orion Track*: A tabela de preços do plano *${planoNome}* (${operadoraNome}) acaba de ser atualizada com novas faixas de valores! Acesse o simulador para calcular propostas atualizadas."
}`;
    console.log(logInfo);
    setWhatsAppLog(logInfo);
    setTimeout(() => {
      setWhatsAppLog(null);
    }, 8000);
  };

  // Contagem total de vidas selecionadas
  const totalVidas = Object.values(vidas).reduce((a, b) => a + b, 0);

  // Ajustar vidas
  const incrementarVida = (key: string) => {
    setVidas(prev => ({ ...prev, [key]: prev[key] + 1 }));
  };

  const decrementarVida = (key: string) => {
    setVidas(prev => ({ ...prev, [key]: Math.max(0, prev[key] - 1) }));
  };

  const limparVidas = () => {
    setVidas({
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
    setComparedPlanIds([]);
    setExpandedResultId(null);
  };

  const aplicarPerfilRapido = (preset: 'familia' | 'casal' | 'empresa') => {
    const presets = {
      familia: { '0_18': 2, '19_23': 0, '24_28': 0, '29_33': 1, '34_38': 1, '39_43': 0, '44_48': 0, '49_53': 0, '54_58': 0, '59_mais': 0 },
      casal: { '0_18': 0, '19_23': 0, '24_28': 1, '29_33': 1, '34_38': 0, '39_43': 0, '44_48': 0, '49_53': 0, '54_58': 0, '59_mais': 0 },
      empresa: { '0_18': 0, '19_23': 2, '24_28': 3, '29_33': 3, '34_38': 2, '39_43': 1, '44_48': 1, '49_53': 0, '54_58': 0, '59_mais': 0 },
    };

    setVidas(presets[preset]);
    setTipoContrato(preset === 'casal' ? 'PF' : 'PME');
    setComparedPlanIds([]);
    setExpandedResultId(null);
  };

  const togglePlanoComparacao = (planId: string) => {
    setComparedPlanIds((current) => {
      if (current.includes(planId)) return current.filter((id) => id !== planId);
      if (current.length >= 4) {
        alert('Voce pode comparar no maximo 4 planos simultaneamente.');
        return current;
      }
      return [...current, planId];
    });
  };

  // Filtragem e Cálculo dos Planos Elegíveis
  const planosCalculados = planos
    .filter(plano => {
      // Filtro de Tipo de Contrato
      if (plano.tipo !== tipoContrato) return false;
      // Filtro de Coparticipação
      if (coparticipacaoFiltro !== 'Ambos' && plano.coparticipacao !== coparticipacaoFiltro) return false;
      // Filtro de Busca
      if (buscaPlanos) {
        const op = operadoras.find(o => o.id === plano.operadoraId);
        const searchString = `${plano.nome} ${op?.nome || ''} ${plano.hospitais.join(' ')}`.toLowerCase();
        if (!searchString.includes(buscaPlanos.toLowerCase())) return false;
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
    .sort((a, b) => a.custoTotal - b.custoTotal);

  const melhorPlano = planosCalculados[0];
  const segundoPlano = planosCalculados[1];
  const economiaMelhorPlano = melhorPlano && segundoPlano ? Math.max(0, segundoPlano.custoTotal - melhorPlano.custoTotal) : 0;
  const planosComparados = planosCalculados.filter((plano) => comparedPlanIds.includes(plano.id));
  const faixasAtivas = FAIXAS_ETARIAS.filter((faixa) => (vidas[faixa.key] || 0) > 0);

  // Iniciar Edição Inline
  const startEditing = (plano: Plano) => {
    setEditingPlanId(plano.id);
    setEditFormData({ ...plano });
  };

  // Salvar Edição Inline
  const saveInlineEdit = (planId: string) => {
    const updatedPlanos = planos.map(p => {
      if (p.id === planId) {
        const fullyUpdated = { ...p, ...editFormData } as Plano;
        // Trigar notificações quando um preço é alterado
        const op = operadoras.find(o => o.id === fullyUpdated.operadoraId);
        dispararNotificacoes(op?.nome || 'Operadora', fullyUpdated.nome);
        return fullyUpdated;
      }
      return p;
    });

    salvarDados(operadoras, updatedPlanos);
    setEditingPlanId(null);
    setSuccessMessage('Plano atualizado com sucesso e notificações enviadas!');
    setTimeout(() => setSuccessMessage(null), 4000);
  };

  // Excluir Plano
  const handleExcluirPlano = (planId: string) => {
    if (window.confirm('Tem certeza de que deseja excluir permanentemente este plano?')) {
      const updatedPlanos = planos.filter(p => p.id !== planId);
      salvarDados(operadoras, updatedPlanos);
      setSuccessMessage('Plano removido com sucesso!');
      setTimeout(() => setSuccessMessage(null), 3000);
    }
  };

  // Excluir Operadora
  const handleExcluirOperadora = (operadoraId: string) => {
    if (window.confirm('Excluir esta operadora removerá todos os planos associados a ela. Prosseguir?')) {
      const novasOps = operadoras.filter(o => o.id !== operadoraId);
      const novosPlanos = planos.filter(p => p.operadoraId !== operadoraId);
      salvarDados(novasOps, novosPlanos);
      setSelectedOperadoraId(null);
      setSuccessMessage('Operadora e planos deletados!');
      setTimeout(() => setSuccessMessage(null), 3000);
    }
  };

  // Restaurar Tabelas Iniciais
  const restaurarTabelasPadrao = () => {
    if (window.confirm("Deseja restaurar os planos e preços padrão demonstrativos? Suas importações manuais serão perdidas.")) {
      salvarDados(OPERADORAS_PADRAO, PLANOS_PADRAO);
      setSuccessMessage('Dados de fábrica restaurados!');
      setTimeout(() => setSuccessMessage(null), 3000);
    }
  };

  // Extração de PDF e Excel usando bibliotecas do cliente (PDF.js e SheetJS)
  const parseDocumentClientSide = async (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      
      // Tratamento para Excel
      if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls') || file.name.endsWith('.csv')) {
        reader.onload = (e) => {
          try {
            const data = new Uint8Array(e.target?.result as ArrayBuffer);
            const XLSX = (window as any).XLSX;
            if (!XLSX) {
              reject(new Error('Biblioteca SheetJS (XLSX) não carregou. Verifique sua conexão.'));
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
      } 
      // Tratamento para PDF
      else if (file.name.endsWith('.pdf')) {
        reader.onload = async (e) => {
          try {
            const typedarray = new Uint8Array(e.target?.result as ArrayBuffer);
            const pdfjsLib = (window as any).pdfjsLib;
            if (!pdfjsLib) {
              reject(new Error('Biblioteca PDF.js não carregou. Verifique sua conexão.'));
              return;
            }
            // Definir worker de CDN
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';
            const pdf = await pdfjsLib.getDocument({ data: typedarray }).promise;
            
            let fullText = '';
            const maxPages = Math.min(pdf.numPages, 8); // Lê no máximo 8 páginas para evitar sobrecarga
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
      } 
      // Arquivos de texto comuns
      else {
        reader.onload = (e) => {
          resolve(e.target?.result as string || '');
        };
        reader.readAsText(file);
      }
    });
  };

  // Upload e Parsing com Apolo AI
  const handleApoloFileUpload = async (file: File) => {
    setAiParsing(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    
    try {
      const extractedText = await parseDocumentClientSide(file);
      
      if (!extractedText.trim()) {
        throw new Error('Não conseguimos extrair texto deste documento. Verifique se o arquivo não está vazio ou corrompido.');
      }

      // Envia conteúdo textual para o endpoint de parsing inteligente
      const response = await fetch('/api/admin/simulador/parse-ai', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fileContent: extractedText,
          fileName: file.name
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'A API do Apolo AI encontrou um erro no processamento do texto.');
      }

      const resData = await response.json();
      const extractedJson = resData.data;

      // Monta dados de preview
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
      console.error('Erro no parser Apolo AI:', err);
      setErrorMessage(err.message || 'Falha geral ao processar documento com Apolo AI.');
    } finally {
      setAiParsing(false);
    }
  };

  // Salvar plano extraído pela IA
  const confirmarSalvarAiPreview = () => {
    if (!aiPreviewData) return;

    const opNome = aiPreviewData.operadoraNome || 'Operadora Detectada';
    let opId = opNome.toLowerCase().replace(/[^a-z0-9]/g, '');
    
    // 1. Verificar ou criar operadora
    const novasOperadoras = [...operadoras];
    let opExistente = novasOperadoras.find(o => o.id === opId);
    if (!opExistente) {
      const cores = [
        'from-blue-600 to-indigo-600',
        'from-emerald-600 to-teal-600',
        'from-purple-600 to-violet-600',
        'from-amber-600 to-orange-600',
        'from-pink-600 to-rose-600'
      ];
      const corAleatoria = cores[Math.floor(Math.random() * cores.length)];
      opExistente = {
        id: opId,
        nome: opNome,
        corGradiente: corAleatoria
      };
      novasOperadoras.push(opExistente);
    }

    // 2. Criar novo plano
    const novoPlano: Plano = {
      id: `ai_${Date.now()}`,
      operadoraId: opId,
      nome: aiPreviewData.nome || 'Novo Plano AI',
      tipo: aiPreviewData.tipo || 'PME',
      coparticipacao: aiPreviewData.coparticipacao || 'Sim',
      reembolso: aiPreviewData.reembolso || 'Sem reembolso',
      hospitais: aiPreviewData.hospitais || ['Hospitais locais'],
      laboratorios: ['Delboni Auriemo', 'Lavoisier'],
      precos: aiPreviewData.precos || [150, 200, 250, 300, 350, 400, 450, 500, 600, 800],
      isDemo: false // Marcado como real
    };

    const novosPlanos = [novoPlano, ...planos];
    salvarDados(novasOperadoras, novosPlanos);
    
    // 3. Trigar notificações
    dispararNotificacoes(opNome, novoPlano.nome);

    setAiPreviewData(null);
    setSuccessMessage(`Tabela de preços "${novoPlano.nome}" integrada e corretores notificados via WhatsApp & Sistema!`);
    setActiveTab('catalogo');
    setSelectedOperadoraId(opId);
    setTimeout(() => setSuccessMessage(null), 6000);
  };

  // Manipulação de Drop de arquivos
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleApoloFileUpload(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleApoloFileUpload(file);
  };

  // Exportar dados da tabela ativa para CSV
  const exportarParaCsv = (operadoraId: string) => {
    const op = operadoras.find(o => o.id === operadoraId);
    const planosDaOp = planos.filter(p => p.operadoraId === operadoraId);
    
    if (planosDaOp.length === 0) {
      alert('Esta operadora não possui planos cadastrados para exportação.');
      return;
    }

    let csvContent = "data:text/csv;charset=utf-8," 
      + "Operadora,Plano,Tipo,Coparticipacao,Reembolso,Hospitais,Preco_0_18,Preco_19_23,Preco_24_28,Preco_29_33,Preco_34_38,Preco_39_43,Preco_44_48,Preco_49_53,Preco_54_58,Preco_59_mais\n";
    
    planosDaOp.forEach(p => {
      const hospString = p.hospitais.join(';');
      const precosString = p.precos.join(',');
      csvContent += `"${op?.nome || ''}","${p.nome}","${p.tipo}","${p.coparticipacao}","${p.reembolso}","${hospString}",${precosString}\n`;
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `tabela_precos_${operadoraId}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (isBrokerAccess) {
    return (
      <InternalLayout>
        <div className="flex min-h-[calc(100vh-9rem)] items-center justify-center px-4">
          <div className="max-w-xl rounded-[2rem] border border-cyan-400/15 bg-[#08111f] p-8 text-center shadow-2xl shadow-cyan-500/5">
            <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-cyan-400/10 text-cyan-300">
              <Calculator size={30} />
            </div>
            <p className="mb-3 text-[10px] font-black uppercase tracking-[0.25em] text-cyan-300">Modulo em desenvolvimento</p>
            <h1 className="text-2xl font-black text-white">Simulador em desenvolvimento</h1>
            <p className="mt-3 text-sm font-bold leading-relaxed text-slate-400">
              Esta area ainda esta em teste pelo time Orion. Por enquanto, use Leads, CRM e Inbox para operar seus atendimentos.
            </p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:justify-center">
              <a href="/leads" className="rounded-2xl bg-blue-600 px-6 py-3 text-xs font-black uppercase tracking-widest text-white transition hover:bg-blue-500">
                Ir para leads
              </a>
              <a href="/crm" className="rounded-2xl border border-white/10 bg-white/5 px-6 py-3 text-xs font-black uppercase tracking-widest text-slate-200 transition hover:bg-white/10">
                Abrir CRM
              </a>
            </div>
          </div>
        </div>
      </InternalLayout>
    );
  }

  return (
    <InternalLayout>
      <div className="space-y-6">
        
        {/* Notificações de Banner Superior */}
        {successMessage && (
          <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/30 p-4 text-xs font-extrabold text-emerald-400 flex items-center gap-3 animate-in fade-in-50 slide-in-from-top-4 duration-300">
            <Check size={16} className="shrink-0" />
            <p>{successMessage}</p>
          </div>
        )}

        {/* WhatsApp Simulated Webhook Banner */}
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
          {/* Header Title */}
          <div>
            <div className="flex items-center gap-2 text-cyan-400 font-extrabold text-xs uppercase tracking-widest">
              <img src="/orion-empty-logo.png" alt="Orion" className="object-contain animate-pulse shrink-0" style={{ height: 14, width: 14 }} />
              <span>Simulador Inteligente Apolo</span>
            </div>
            <h1 className="mt-1 text-2xl font-black tracking-tight text-white sm:text-3xl">
              Simulador & Tabelas de Saúde
            </h1>
            <p className="mt-1 text-xs sm:text-sm font-bold text-slate-400">
              Calcule planos instantaneamente ou navegue no catálogo de preços de forma hierárquica e inteligente.
            </p>
          </div>

          {/* Seletor de Abas Principal */}
          <div className="flex items-center bg-white/5 border border-white/5 p-1 rounded-2xl self-start md:self-auto shrink-0 shadow-lg">
            <button
              onClick={() => setActiveTab('simulacao')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all duration-200 ${
                activeTab === 'simulacao'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Calculator size={14} />
              <span>Simulador</span>
            </button>
            <button
              onClick={() => {
                setActiveTab('catalogo');
                setSelectedOperadoraId(null);
                setExpandedPlanId(null);
              }}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all duration-200 ${
                activeTab === 'catalogo'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Layers size={14} />
              <span>Catálogo ({planos.length})</span>
            </button>
            {isAdmin && (
              <button
                onClick={() => setActiveTab('admin')}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all duration-200 ${
                  activeTab === 'admin'
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <Settings size={14} />
                <span>Importador Apolo</span>
              </button>
            )}
          </div>
        </div>

        {/* ================= ABA 1: SIMULADOR ================= */}
        {activeTab === 'simulacao' && (
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
            
            {/* LADO ESQUERDO: CONFIGURAÇÕES E QUANTIDADE DE VIDAS (5 colunas) */}
            <div className="xl:col-span-5 space-y-6">
              
              {/* Painel de Filtros e Tipo de Contrato */}
              <div className="orion-panel rounded-[2rem] border border-white/5 bg-[#0f172a]/40 p-5 backdrop-blur-md shadow-2xl">
                <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-widest text-slate-300">
                  <Filter size={16} className="text-blue-500" />
                  <span>Configurações do Perfil</span>
                </h3>

                <div className="mt-4 grid grid-cols-2 gap-4">
                  {/* Tipo de Contrato */}
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Contratação</label>
                    <div className="mt-1.5 flex bg-white/5 border border-white/5 p-1 rounded-xl gap-0.5">
                      <button
                        onClick={() => { setTipoContrato('PME'); limparVidas(); }}
                        className={`flex-1 min-w-0 flex items-center justify-center gap-1 py-2 px-1 rounded-lg text-2xs font-extrabold uppercase transition-all ${
                          tipoContrato === 'PME' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        <Building size={12} className="shrink-0" />
                        <span className="truncate">PME</span>
                      </button>
                      <button
                        onClick={() => { setTipoContrato('PF'); limparVidas(); }}
                        className={`flex-1 min-w-0 flex items-center justify-center gap-1 py-2 px-1 rounded-lg text-2xs font-extrabold uppercase transition-all ${
                          tipoContrato === 'PF' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        <User size={12} className="shrink-0" />
                        <span className="truncate">PF</span>
                      </button>
                    </div>
                  </div>

                  {/* Estado / UF */}
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">UF / Região</label>
                    <select
                      value={ufFiltro}
                      onChange={(e) => setUfFiltro(e.target.value)}
                      className="mt-1.5 w-full bg-white/5 border border-white/5 rounded-xl px-3 py-2 text-xs font-bold text-white focus:outline-none"
                    >
                      <option value="SP">São Paulo (SP)</option>
                      <option value="RJ">Rio de Janeiro (RJ)</option>
                      <option value="MG">Minas Gerais (MG)</option>
                      <option value="PR">Paraná (PR)</option>
                      <option value="SC">Santa Catarina (SC)</option>
                    </select>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-4">
                  {/* Coparticipação */}
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Coparticipação</label>
                    <div className="mt-1.5 flex bg-white/5 border border-white/5 p-1 rounded-xl">
                      {['Ambos', 'Sim', 'Não'].map((opt) => (
                        <button
                          key={opt}
                          onClick={() => setCoparticipacaoFiltro(opt as any)}
                          className={`flex-1 py-1.5 rounded-lg text-2xs font-extrabold uppercase transition-all ${
                            coparticipacaoFiltro === opt ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Busca por Hospitais/Nome */}
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Filtrar por Hospital</label>
                    <div className="mt-1.5 relative">
                      <input
                        type="text"
                        placeholder="Ex: Einstein..."
                        value={buscaPlanos}
                        onChange={(e) => setBuscaPlanos(e.target.value)}
                        className="w-full bg-white/5 border border-white/5 rounded-xl pl-8 pr-3 py-2 text-xs font-bold text-white focus:outline-none"
                      />
                      <Search className="absolute left-2.5 top-2.5 text-slate-500" size={13} />
                    </div>
                  </div>
                </div>
              </div>

              <div className="orion-panel rounded-[2rem] border border-white/5 bg-[#0f172a]/40 p-5 backdrop-blur-md shadow-2xl">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-widest text-slate-300">
                      <Sparkles size={16} className="text-cyan-400" />
                      <span>Perfis rapidos</span>
                    </h3>
                    <p className="mt-1 text-[10px] font-bold text-slate-500">
                      Monte uma cotacao em um clique e ajuste as vidas depois.
                    </p>
                  </div>
                  {faixasAtivas.length > 0 && (
                    <span className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-cyan-400">
                      {faixasAtivas.length} faixas ativas
                    </span>
                  )}
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <button
                    type="button"
                    onClick={() => aplicarPerfilRapido('familia')}
                    className="rounded-2xl border border-white/5 bg-white/5 p-4 text-left transition-all hover:border-cyan-500/30 hover:bg-cyan-500/10"
                  >
                    <p className="text-xs font-black uppercase tracking-widest text-white">Familia</p>
                    <p className="mt-1 text-[10px] font-bold text-slate-500">2 criancas + 2 adultos</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => aplicarPerfilRapido('casal')}
                    className="rounded-2xl border border-white/5 bg-white/5 p-4 text-left transition-all hover:border-cyan-500/30 hover:bg-cyan-500/10"
                  >
                    <p className="text-xs font-black uppercase tracking-widest text-white">Casal PF</p>
                    <p className="mt-1 text-[10px] font-bold text-slate-500">2 vidas individuais</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => aplicarPerfilRapido('empresa')}
                    className="rounded-2xl border border-white/5 bg-white/5 p-4 text-left transition-all hover:border-cyan-500/30 hover:bg-cyan-500/10"
                  >
                    <p className="text-xs font-black uppercase tracking-widest text-white">Empresa</p>
                    <p className="mt-1 text-[10px] font-bold text-slate-500">12 vidas PME</p>
                  </button>
                </div>
              </div>

              {/* Seletor de População por Faixa Etária */}
              <div className="orion-panel rounded-[2rem] border border-white/5 bg-[#0f172a]/40 p-5 backdrop-blur-md shadow-2xl">
                <div className="flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-widest text-slate-300">
                    <User size={16} className="text-cyan-400" />
                    <span>Vidas por Faixa Etária</span>
                  </h3>
                  {totalVidas > 0 && (
                    <button
                      onClick={limparVidas}
                      className="text-[10px] font-black text-rose-400 uppercase tracking-wider hover:text-rose-300 transition-colors"
                    >
                      Limpar tudo
                    </button>
                  )}
                </div>

                <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {FAIXAS_ETARIAS.map((faixa) => {
                    const quantidade = vidas[faixa.key] || 0;
                    return (
                      <div
                        key={faixa.key}
                        className={`flex items-center justify-between p-3 rounded-2xl border transition-all duration-200 ${
                          quantidade > 0
                            ? 'bg-blue-600/10 border-blue-500/30'
                            : 'bg-white/2 border-white/5'
                        }`}
                      >
                        <div>
                          <p className="text-xs font-black text-white">{faixa.label}</p>
                          <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">
                            {quantidade === 1 ? '1 Vida' : `${quantidade} Vidas`}
                          </p>
                        </div>
                        
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => decrementarVida(faixa.key)}
                            disabled={quantidade === 0}
                            className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/5 border border-white/5 text-slate-400 transition-all hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                          >
                            <Minus size={10} />
                          </button>
                          <span className="w-6 text-center text-xs font-black text-white">{quantidade}</span>
                          <button
                            onClick={() => incrementarVida(faixa.key)}
                            className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600/20 border border-blue-500/20 text-cyan-400 transition-all hover:bg-blue-600 hover:text-white cursor-pointer"
                          >
                            <Plus size={10} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* LADO DIREITO: RESULTADOS DO CÁLCULO (7 colunas) */}
            <div className="xl:col-span-7 space-y-5">
              <div className="flex items-center justify-between bg-white/3 border border-white/5 rounded-2xl px-5 py-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600/20 text-cyan-400 border border-blue-500/10">
                    <Calculator size={18} className="animate-spin-slow" />
                  </div>
                  <div>
                    <h2 className="text-xs font-black uppercase tracking-wider text-slate-300">Planos Calculados</h2>
                    <p className="text-[10px] font-bold text-slate-500">
                      Exibindo {planosCalculados.length} opções com preços em tempo real.
                    </p>
                  </div>
                </div>

                <div className="text-right">
                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">Total de Vidas</span>
                  <p className="text-base font-black text-cyan-400">{totalVidas} vidas</p>
                </div>
              </div>

              {totalVidas > 0 && (
                <div className="orion-panel rounded-[2rem] border border-white/5 bg-[#0f172a]/40 p-5 backdrop-blur-md shadow-2xl">
                  <div className="grid gap-4 md:grid-cols-3">
                    <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-4">
                      <p className="text-[10px] font-black uppercase tracking-widest text-cyan-400">Melhor custo</p>
                      <h3 className="mt-1 truncate text-sm font-black text-white" title={melhorPlano?.nome}>
                        {melhorPlano?.nome || 'Sem plano'}
                      </h3>
                      <p className="mt-2 text-2xl font-black text-cyan-400">
                        {melhorPlano ? `R$ ${melhorPlano.custoTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'R$ 0,00'}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4">
                      <p className="text-[10px] font-black uppercase tracking-widest text-emerald-400">Economia vs proximo</p>
                      <p className="mt-1 text-sm font-bold text-slate-400">Diferença mensal estimada</p>
                      <p className="mt-2 text-2xl font-black text-emerald-400">
                        R$ {economiaMelhorPlano.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-blue-500/20 bg-blue-500/10 p-4">
                      <p className="text-[10px] font-black uppercase tracking-widest text-blue-400">Comparacao ativa</p>
                      <p className="mt-1 text-sm font-bold text-slate-400">{planosComparados.length} de 4 planos selecionados</p>
                      <button
                        type="button"
                        onClick={() => setIsCompareModalOpen(true)}
                        disabled={planosComparados.length < 2}
                        className="mt-3 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Eye size={12} />
                        Abrir comparativo
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {totalVidas === 0 ? (
                <div className="orion-panel flex flex-col items-center justify-center rounded-[2rem] border border-white/5 bg-[#0f172a]/20 p-12 text-center backdrop-blur-md shadow-inner">
                  <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-blue-600/10 text-blue-400 border border-blue-500/10 mb-4 animate-bounce overflow-hidden p-3 bg-white shadow-md">
                    <img src="/orion-empty-logo.png" alt="Orion" className="h-10 w-10 object-contain animate-pulse" />
                  </div>
                  <h3 className="text-lg font-black text-white">Insira as vidas para começar</h3>
                  <p className="mt-1 max-w-sm text-xs font-bold leading-relaxed text-slate-500">
                    Ajuste o número de pessoas por faixa etária no painel esquerdo para que o simulador calcule instantaneamente as propostas e preços de todas as operadoras parceiras.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {planosCalculados.map((plano) => {
                    const op = operadoras.find(o => o.id === plano.operadoraId);
                    const precoMedio = plano.custoTotal / totalVidas;
                    
                    return (
                      <div
                        key={plano.id}
                        className="orion-panel group relative overflow-hidden rounded-[2rem] border border-white/5 bg-[#0f172a]/40 p-5 backdrop-blur-md transition-all duration-300 hover:-translate-y-0.5 hover:shadow-2xl"
                      >
                        {/* Indicador superior de operadora */}
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/5 pb-4">
                          <div className="flex items-center gap-3">
                            {/* Renderizador de Logo Premium */}
                            <div className="shadow-lg shrink-0">
                              <RenderLogo id={plano.operadoraId} className="h-12 w-12" />
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                                  {op?.nome || 'Operadora'}
                                </span>
                                <span className={`text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-md ${
                                  plano.coparticipacao === 'Sim'
                                    ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                    : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                }`}>
                                  {plano.coparticipacao === 'Sim' ? 'Com Coparticipação' : 'Sem Coparticipação'}
                                </span>
                                {plano.isDemo && (
                                  <span className="bg-blue-500/15 border border-blue-500/30 text-blue-400 text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-md">
                                    Exemplo de Demonstração
                                  </span>
                                )}
                              </div>
                              <h4 className="text-base font-black text-white group-hover:text-cyan-400 transition-colors">
                                {plano.nome}
                              </h4>
                            </div>
                          </div>

                          <div className="flex items-center gap-4 self-end sm:self-center">
                            <button
                              type="button"
                              onClick={() => togglePlanoComparacao(plano.id)}
                              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-[9px] font-black uppercase tracking-wider transition-all border cursor-pointer shrink-0 ${
                                comparedPlanIds.includes(plano.id)
                                  ? 'bg-cyan-500/20 border-cyan-500/30 text-cyan-300'
                                  : 'bg-white/5 border-white/5 text-slate-400 hover:text-white hover:bg-white/10'
                              }`}
                            >
                              <Check size={11} className={comparedPlanIds.includes(plano.id) ? 'opacity-100' : 'opacity-30'} />
                              <span>{comparedPlanIds.includes(plano.id) ? 'Comparando' : 'Comparar'}</span>
                            </button>

                            <div className="text-left sm:text-right">
                              <span className="text-[9px] font-black uppercase tracking-wider text-slate-500 block">Custo Total Mensal</span>
                              <div className="flex items-baseline sm:justify-end gap-1.5">
                                <span className="text-xs font-black text-slate-400">R$</span>
                                <span className="text-xl sm:text-2xl font-black text-cyan-400 tracking-tight">
                                  {plano.custoTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </span>
                              </div>
                              <span className="text-[9px] font-bold text-slate-500 block">
                                Média de R$ {precoMedio.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} por vida
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Detalhes de Reembolso e Hospitais Credenciados */}
                        <div className="mt-4 grid grid-cols-1 md:grid-cols-12 gap-4">
                          {/* Hospitais */}
                          <div className="md:col-span-8">
                            <p className="text-[9px] font-black uppercase tracking-wider text-slate-500">Principais Hospitais Credenciados</p>
                            <div className="mt-1.5 flex flex-wrap gap-1.5">
                              {plano.hospitais.slice(0, 3).map((hosp, i) => (
                                <span key={i} className="flex items-center gap-1 bg-white/2 border border-white/5 px-2.5 py-1 rounded-xl text-2xs font-extrabold text-slate-300">
                                  <Heart size={8} className="text-rose-500 animate-pulse" />
                                  {hosp}
                                </span>
                              ))}
                              {plano.hospitais.length > 3 && (
                                <span className="bg-blue-600/10 border border-blue-500/20 px-2 py-0.5 rounded-lg text-2xs font-extrabold text-cyan-400">
                                  +{plano.hospitais.length - 3} mais
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Reembolso */}
                          <div className="md:col-span-4 flex flex-col justify-center">
                            <p className="text-[9px] font-black uppercase tracking-wider text-slate-500">Reembolso Clínicas/Consultas</p>
                            <p className="mt-1 text-xs font-black text-slate-200 flex items-center gap-1.5">
                              <Award size={14} className="text-amber-500" />
                              {plano.reembolso}
                            </p>
                          </div>
                        </div>

                        {/* Ações Rápidas */}
                        <div className="mt-4 flex items-center justify-between border-t border-white/5 pt-4">
                          <button
                            onClick={() => setExpandedResultId(expandedResultId === plano.id ? null : plano.id)}
                            className="text-2xs font-black text-slate-500 uppercase tracking-widest hover:text-white transition-colors cursor-pointer"
                          >
                            {expandedResultId === plano.id ? 'Ocultar detalhes' : 'Ver detalhes do cálculo'}
                          </button>

                          <button
                            onClick={() => setPropostaModal({
                              plano,
                              total: plano.custoTotal,
                              vidasPorFaixa: plano.detalheVidas.filter(v => v.count > 0),
                              totalVidas
                            })}
                            className="flex items-center gap-1 bg-blue-600 text-white px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-blue-700 transition-all cursor-pointer shadow-md shadow-blue-600/10"
                          >
                            <span>Gerar Proposta</span>
                            <ArrowRight size={12} />
                          </button>
                        </div>

                        {expandedResultId === plano.id && (
                          <div className="mt-4 rounded-2xl border border-white/5 bg-white/3 p-4 animate-in fade-in-50 slide-in-from-top-2 duration-200">
                            <div className="flex items-center gap-2">
                              <Info size={14} className="text-cyan-400" />
                              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Composição do cálculo</p>
                            </div>
                            <div className="mt-3 grid gap-2 sm:grid-cols-2">
                              {plano.detalheVidas.filter(v => v.count > 0).map((item) => (
                                <div key={item.label} className="flex items-center justify-between rounded-xl border border-white/5 bg-slate-950/30 px-3 py-2">
                                  <div>
                                    <p className="text-xs font-black text-white">{item.count}x {item.label}</p>
                                    <p className="text-[9px] font-bold text-slate-500">R$ {item.precoUnitario.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} por vida</p>
                                  </div>
                                  <p className="text-xs font-black text-cyan-400">
                                    R$ {item.subtotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                  </p>
                                </div>
                              ))}
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

        {/* ================= ABA 2: EXPLORADOR / CATÁLOGO HIERÁRQUICO ================= */}
        {activeTab === 'catalogo' && (
          <div className="space-y-6">
            
            {/* Visual 1: Se nenhuma operadora estiver selecionada, exibe a grade de operadoras */}
            {!selectedOperadoraId ? (
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <h3 className="text-base font-black text-white">Selecione uma Operadora Parceira</h3>
                    <p className="text-xs font-bold text-slate-500">Navegue pelas tabelas comerciais completas indexadas no sistema.</p>
                  </div>
                  {isAdmin && (
                    <button
                      onClick={restaurarTabelasPadrao}
                      className="flex items-center gap-1.5 bg-rose-600/20 border border-rose-500/20 text-rose-400 px-3.5 py-2 rounded-xl text-2xs font-black uppercase tracking-widest hover:bg-rose-600 hover:text-white transition-all cursor-pointer"
                    >
                      <RefreshCw size={12} />
                      <span>Restaurar Fábrica</span>
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                  {operadoras.map((op) => {
                    const planosDaOp = planos.filter(p => p.operadoraId === op.id);
                    return (
                      <div
                        key={op.id}
                        onClick={() => setSelectedOperadoraId(op.id)}
                        className="orion-panel cursor-pointer group flex flex-col justify-between overflow-hidden rounded-[2.5rem] border border-white/5 bg-[#0f172a]/40 p-6 backdrop-blur-md transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl hover:border-blue-500/20"
                      >
                        <div className="flex items-center gap-4">
                          <div className="shadow-lg transition-transform group-hover:scale-105">
                            <RenderLogo id={op.id} className="h-16 w-16" />
                          </div>
                          <div>
                            <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">Operadora de Saúde</span>
                            <h4 className="text-lg font-black text-white group-hover:text-cyan-400 transition-colors">{op.nome}</h4>
                            <p className="text-xs font-bold text-slate-400 mt-0.5">
                              {planosDaOp.length} planos cadastrados
                            </p>
                          </div>
                        </div>

                        <div className="mt-6 flex items-center justify-between border-t border-white/5 pt-4 text-xs font-black uppercase tracking-widest text-slate-500 group-hover:text-white transition-colors">
                          <span>Explorar Planos</span>
                          <ChevronRight size={16} className="text-blue-500 group-hover:translate-x-1 transition-transform" />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              // Visual 2: Operadora selecionada, exibe seus planos de forma hierárquica
              <div className="orion-panel rounded-[2rem] border border-white/5 bg-[#0f172a]/40 p-6 backdrop-blur-md shadow-2xl space-y-6">
                
                {/* Cabeçalho da Operadora Selecionada */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/5 pb-5">
                  <div className="flex items-center gap-4">
                    <RenderLogo id={selectedOperadoraId} className="h-14 w-14" />
                    <div>
                      <button
                        onClick={() => setSelectedOperadoraId(null)}
                        className="text-[10px] font-black text-blue-500 uppercase tracking-widest hover:text-cyan-400 transition-colors"
                      >
                        ← Voltar para operadoras
                      </button>
                      <h2 className="text-xl font-black text-white mt-0.5">
                        {operadoras.find(o => o.id === selectedOperadoraId)?.nome || 'Planos'}
                      </h2>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => exportarParaCsv(selectedOperadoraId)}
                      className="flex items-center gap-1.5 bg-white/5 border border-white/5 text-slate-300 px-3.5 py-2 rounded-xl text-2xs font-black uppercase tracking-widest hover:bg-white/10 hover:text-white transition-all cursor-pointer shadow-md"
                    >
                      <Download size={12} />
                      <span>Exportar CSV</span>
                    </button>
                    {isAdmin && (
                      <button
                        onClick={() => handleExcluirOperadora(selectedOperadoraId)}
                        className="flex items-center gap-1.5 bg-rose-600/10 border border-rose-500/20 text-rose-400 px-3.5 py-2 rounded-xl text-2xs font-black uppercase tracking-widest hover:bg-rose-600 hover:text-white transition-all cursor-pointer"
                      >
                        <Trash2 size={12} />
                        <span>Remover Operadora</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Planos desta Operadora */}
                <div className="space-y-4">
                  {planos.filter(p => p.operadoraId === selectedOperadoraId).length === 0 ? (
                    <div className="text-center py-12 text-slate-500">
                      <Layers className="mx-auto h-12 w-12 text-slate-600 mb-3" />
                      <p className="text-xs font-bold">Nenhum plano ativo cadastrado para esta operadora.</p>
                      {isAdmin && (
                        <p className="text-3xs font-extrabold uppercase tracking-widest text-blue-500 mt-2 hover:underline cursor-pointer" onClick={() => setActiveTab('admin')}>
                          Importe ou crie um agora
                        </p>
                      )}
                    </div>
                  ) : (
                    planos.filter(p => p.operadoraId === selectedOperadoraId).map((plano) => {
                      const isExpanded = expandedPlanId === plano.id;
                      const isEditing = editingPlanId === plano.id;

                      return (
                        <div
                          key={plano.id}
                          className={`rounded-[2rem] border transition-all duration-300 overflow-hidden ${
                            isExpanded ? 'bg-slate-950/40 border-blue-500/20 shadow-xl' : 'bg-white/1 border-white/5'
                          }`}
                        >
                          {/* Cabeçalho do Plano */}
                          <div
                            onClick={() => !isEditing && setExpandedPlanId(isExpanded ? null : plano.id)}
                            className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 cursor-pointer hover:bg-white/2 transition-colors"
                          >
                            <div className="flex items-center gap-3">
                              <div className={`h-8 w-8 rounded-lg bg-blue-600/10 border border-blue-500/10 text-cyan-400 flex items-center justify-center`}>
                                <FileText size={16} />
                              </div>
                              <div>
                                <div className="flex items-center gap-2 flex-wrap">
                                  <h4 className="text-sm font-black text-white">{plano.nome}</h4>
                                  <span className="bg-white/5 border border-white/5 text-slate-400 text-[8px] font-black px-1.5 py-0.5 rounded">
                                    {plano.tipo === 'PME' ? 'PME' : 'PF'}
                                  </span>
                                  <span className={`text-[8px] font-black px-1.5 py-0.5 rounded ${
                                    plano.coparticipacao === 'Sim' ? 'bg-amber-500/10 text-amber-400' : 'bg-emerald-500/10 text-emerald-400'
                                  }`}>
                                    {plano.coparticipacao === 'Sim' ? 'Coparticipação' : 'Sem Copart.'}
                                  </span>
                                  {plano.isDemo && (
                                    <span className="bg-blue-600/10 text-cyan-400 border border-blue-500/20 text-[8px] font-black px-1.5 py-0.5 rounded">
                                      Exemplo
                                    </span>
                                  )}
                                </div>
                                <p className="text-[10px] font-bold text-slate-500 mt-1">
                                  Reembolso: {plano.reembolso} | {plano.hospitais.length} hospitais credenciados
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center gap-3 self-end sm:self-auto">
                              {isAdmin && (
                                <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                  {isEditing ? (
                                    <button
                                      onClick={() => saveInlineEdit(plano.id)}
                                      className="flex items-center gap-1 bg-emerald-600 text-white px-3 py-1.5 rounded-xl text-2xs font-black uppercase tracking-wider hover:bg-emerald-700 transition-colors cursor-pointer shadow-md"
                                    >
                                      <Save size={12} />
                                      <span>Salvar</span>
                                    </button>
                                  ) : (
                                    <button
                                      onClick={() => {
                                        setExpandedPlanId(plano.id);
                                        startEditing(plano);
                                      }}
                                      className="flex items-center gap-1 bg-white/5 border border-white/5 text-slate-300 px-3 py-1.5 rounded-xl text-2xs font-black uppercase tracking-wider hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
                                    >
                                      <Edit2 size={12} />
                                      <span>Editar</span>
                                    </button>
                                  )}

                                  <button
                                    onClick={() => handleExcluirPlano(plano.id)}
                                    className="p-1.5 bg-rose-600/10 border border-rose-500/20 text-rose-400 hover:bg-rose-600 hover:text-white rounded-xl transition-all cursor-pointer"
                                  >
                                    <Trash2 size={12} />
                                  </button>
                                </div>
                              )}

                              <ChevronDown
                                size={18}
                                className={`text-slate-400 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`}
                              />
                            </div>
                          </div>

                          {/* Seção Expandida: Tabela e Detalhes */}
                          {isExpanded && (
                            <div className="border-t border-white/5 bg-slate-950/20 p-5 space-y-5 animate-in fade-in-50 duration-200">
                              
                              {/* Formulário/Inputs se estiver em Edição */}
                              {isEditing ? (
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-white/3 border border-white/5 p-4 rounded-2xl">
                                  <div>
                                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Nome do Plano</label>
                                    <input
                                      type="text"
                                      value={editFormData.nome || ''}
                                      onChange={(e) => setEditFormData({ ...editFormData, nome: e.target.value })}
                                      className="mt-1 w-full bg-white/5 border border-white/5 rounded-xl px-3 py-2 text-xs font-bold text-white focus:outline-none"
                                    />
                                  </div>
                                  <div>
                                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Reembolso</label>
                                    <input
                                      type="text"
                                      value={editFormData.reembolso || ''}
                                      onChange={(e) => setEditFormData({ ...editFormData, reembolso: e.target.value })}
                                      className="mt-1 w-full bg-white/5 border border-white/5 rounded-xl px-3 py-2 text-xs font-bold text-white focus:outline-none"
                                    />
                                  </div>
                                  <div>
                                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Coparticipação</label>
                                    <select
                                      value={editFormData.coparticipacao || 'Sim'}
                                      onChange={(e) => setEditFormData({ ...editFormData, coparticipacao: e.target.value as any })}
                                      className="mt-1 w-full bg-white/5 border border-white/5 rounded-xl px-3 py-2 text-xs font-bold text-white focus:outline-none"
                                    >
                                      <option value="Sim">Sim</option>
                                      <option value="Não">Não</option>
                                    </select>
                                  </div>
                                  <div className="md:col-span-3">
                                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Hospitais (Separados por vírgula)</label>
                                    <input
                                      type="text"
                                      value={editFormData.hospitais?.join(', ') || ''}
                                      onChange={(e) => setEditFormData({ ...editFormData, hospitais: e.target.value.split(',').map(h => h.trim()) })}
                                      className="mt-1 w-full bg-white/5 border border-white/5 rounded-xl px-3 py-2 text-xs font-bold text-white focus:outline-none"
                                    />
                                  </div>
                                </div>
                              ) : null}

                              {/* Tabelas de Preços por Faixa Etária */}
                              <div>
                                <h5 className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2.5">
                                  Tabela de Preços por Faixas ANS (Mensalidade Unitária)
                                </h5>

                                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                                  {FAIXAS_ETARIAS.map((faixa, index) => {
                                    const valor = isEditing 
                                      ? (editFormData.precos?.[index] || 0)
                                      : plano.precos[index];

                                    return (
                                      <div key={faixa.key} className="bg-slate-900 border border-white/5 rounded-2xl p-3.5 flex flex-col justify-between">
                                        <span className="text-[10px] font-extrabold text-slate-400">{faixa.label}</span>
                                        {isEditing ? (
                                          <div className="mt-2 flex items-center bg-white/5 border border-white/5 px-2 rounded-xl">
                                            <span className="text-3xs font-bold text-slate-500 mr-1">R$</span>
                                            <input
                                              type="number"
                                              value={valor}
                                              onChange={(e) => {
                                                const novosPrecos = [...(editFormData.precos || [])];
                                                novosPrecos[index] = parseFloat(e.target.value) || 0;
                                                setEditFormData({ ...editFormData, precos: novosPrecos });
                                              }}
                                              className="w-full bg-transparent border-none py-1 text-xs font-black text-cyan-400 focus:outline-none"
                                            />
                                          </div>
                                        ) : (
                                          <span className="text-sm font-black text-cyan-400 mt-1">
                                            R$ {valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                          </span>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>

                              {/* Hospitais Credenciados */}
                              {!isEditing && (
                                <div className="bg-slate-900 border border-white/5 p-4 rounded-2xl">
                                  <h5 className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2 flex items-center gap-1.5">
                                    <Heart size={12} className="text-rose-500" />
                                    <span>Hospitais Credenciados Recomendados</span>
                                  </h5>
                                  <div className="flex flex-wrap gap-2">
                                    {plano.hospitais.map((hosp, i) => (
                                      <span key={i} className="bg-slate-950 border border-white/5 px-3 py-1.5 rounded-xl text-2xs font-extrabold text-slate-300">
                                        {hosp}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ================= ABA 3: SMART AI UPLOADER (ADMINS) ================= */}
        {activeTab === 'admin' && isAdmin && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            
            {/* Box Principal de Uploader Drag-and-Drop */}
            <div className="lg:col-span-8 orion-panel rounded-[2rem] border border-white/5 bg-[#0f172a]/40 p-6 backdrop-blur-md shadow-2xl space-y-5">
              <div>
                <div className="flex items-center gap-1.5 text-xs font-black uppercase tracking-widest text-cyan-400 mb-1">
                  <img src="/orion-empty-logo.png" alt="Orion" className="object-contain animate-pulse shrink-0" style={{ height: 14, width: 14 }} />
                  <span>Apolo AI OCR & Table Parser</span>
                </div>
                <h3 className="text-lg font-black text-white">Alimentação Inteligente via PDF / Excel</h3>
                <p className="text-xs font-bold text-slate-500">
                  Arraste PDFs oficiais ou planilhas enviadas por representantes. O Apolo AI lerá o conteúdo, extrairá os preços de faixas ANS e estruturará de forma instantânea.
                </p>
              </div>

              {/* Zona Drag-and-Drop */}
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`border-2 border-dashed rounded-[2rem] p-10 flex flex-col items-center justify-center text-center transition-all duration-300 ${
                  isDragging
                    ? 'border-cyan-400 bg-blue-600/10 shadow-2xl shadow-cyan-500/10'
                    : 'border-white/10 bg-white/2 hover:bg-white/3 hover:border-blue-500/30'
                }`}
              >
                <div className={`h-14 w-14 rounded-2xl flex items-center justify-center border transition-all duration-300 mb-4 ${
                  aiParsing 
                    ? 'bg-blue-600/10 text-cyan-400 border-blue-500/30 animate-spin'
                    : 'bg-blue-600/10 text-cyan-400 border-blue-500/10'
                }`}>
                  {aiParsing ? <RefreshCw size={24} /> : <FileSpreadsheet size={24} />}
                </div>

                {aiParsing ? (
                  <div className="space-y-1.5 animate-pulse">
                    <h4 className="text-xs font-black uppercase tracking-wider text-cyan-300">Apolo AI está analisando o documento...</h4>
                    <p className="text-[10px] font-bold text-slate-500">Extraindo faixas de preços, rede credenciada e regras comerciais. Aguarde.</p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <h4 className="text-xs font-black uppercase tracking-wider text-slate-300">Arraste seu arquivo PDF / Excel ou clique aqui</h4>
                    <p className="text-[10px] font-bold text-slate-500">Formatos aceitos: .pdf, .xlsx, .xls, .csv</p>
                  </div>
                )}

                <input
                  type="file"
                  accept=".pdf,.xlsx,.xls,.csv"
                  onChange={handleFileChange}
                  className="hidden"
                  id="apolo-file-input"
                  disabled={aiParsing}
                />
                
                {!aiParsing && (
                  <label
                    htmlFor="apolo-file-input"
                    className="mt-6 flex items-center gap-2 bg-blue-600 text-white px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-blue-700 transition-all cursor-pointer shadow-md shadow-blue-600/20"
                  >
                    <Upload size={12} />
                    <span>Selecionar Documento</span>
                  </label>
                )}
              </div>

              {/* Mensagem de Erro se houver */}
              {errorMessage && (
                <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-xs font-extrabold text-rose-400 flex items-center gap-3">
                  <AlertCircle size={16} className="shrink-0" />
                  <p>{errorMessage}</p>
                </div>
              )}

              {/* Informações Auxiliares */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-white/3 border border-white/5 p-4 rounded-2xl">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center shrink-0">
                    <HelpCircle size={18} />
                  </div>
                  <div>
                    <h4 className="text-2xs font-black uppercase tracking-wider text-slate-300">Prefere enviar uma planilha modelo?</h4>
                    <p className="text-[10px] font-bold text-slate-500">
                      Você também pode baixar nossa planilha modelo padrão e subir com seus dados organizados.
                    </p>
                  </div>
                </div>

                <a
                  href="/modelo_tabela_precos.csv"
                  onClick={(e) => {
                    e.preventDefault();
                    const csvContent = "data:text/csv;charset=utf-8," 
                      + "Operadora,Plano,Tipo,Coparticipacao,Reembolso,Hospitais,Preco_0_18,Preco_19_23,Preco_24_28,Preco_29_33,Preco_34_38,Preco_39_43,Preco_44_48,Preco_49_53,Preco_54_58,Preco_59_mais\n"
                      + "Amil Saude,Amil S380 Premium,PME,Sim,Sem Reembolso,Albert Einstein;Sirio Libanes,250,300,350,400,450,500,600,750,1000,1800\n"
                      + "Porto Seguro,Porto Ouro Max,PME,Nao,R$ 150.00,Hospital Samaritano;Pro-Cardíaco,350,420,490,550,620,700,850,1000,1350,2400";
                    const encodedUri = encodeURI(csvContent);
                    const link = document.createElement("a");
                    link.setAttribute("href", encodedUri);
                    link.setAttribute("download", "modelo_orion_tabela.csv");
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                  }}
                  className="flex items-center gap-1.5 bg-white/5 border border-white/5 text-slate-300 px-3.5 py-2 rounded-xl text-2xs font-black uppercase tracking-widest hover:bg-white/10 hover:text-white transition-all cursor-pointer shrink-0"
                >
                  <Download size={12} />
                  <span>Modelo CSV</span>
                </a>
              </div>
            </div>

            {/* Lado Direito: Regras do Apolo */}
            <div className="lg:col-span-4 orion-panel rounded-[2rem] border border-white/5 bg-[#0f172a]/40 p-6 backdrop-blur-md shadow-2xl space-y-4">
              <h3 className="text-sm font-black uppercase tracking-widest text-slate-300">Como o Apolo AI lê tabelas?</h3>
              
              <div className="space-y-4 text-xs font-bold text-slate-400">
                <div className="flex items-start gap-2.5">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-600/20 text-2xs font-black text-cyan-400 border border-blue-500/10">1</span>
                  <p>Lê as tabelas em PDF ou planilhas Excel cruas de todas as operadoras de saúde.</p>
                </div>
                <div className="flex items-start gap-2.5">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-600/20 text-2xs font-black text-cyan-400 border border-blue-500/10">2</span>
                  <p>Mapeia de forma inteligente as 10 faixas etárias padrão de precificação da ANS brasileira.</p>
                </div>
                <div className="flex items-start gap-2.5">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-600/20 text-2xs font-black text-cyan-400 border border-blue-500/10">3</span>
                  <p>Extrai as regras de **coparticipação**, reembolsos clínicos e a rede de hospitais credenciados.</p>
                </div>
                <div className="flex items-start gap-2.5">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-600/20 text-2xs font-black text-cyan-400 border border-blue-500/10">4</span>
                  <p>Exibe uma pré-visualização completa dos dados antes de registrar qualquer atualização oficial.</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ================= MODAL: SMART AI PREVIEW MODAL (APOLO PARSER) ================= */}
        {aiPreviewData && (
          <div className="fixed inset-0 z-[999] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm animate-in fade-in-50 duration-200">
            <div className="relative w-full max-w-3xl overflow-hidden rounded-[2.5rem] border border-cyan-500/30 bg-[#090e1a]/95 p-6 sm:p-8 shadow-[0_0_50px_rgba(6,182,212,0.2)] animate-in slide-in-from-bottom-6 duration-300">
              
              {/* Header do Modal */}
              <div className="flex items-center justify-between border-b border-white/5 pb-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-cyan-600/10 text-cyan-400 font-black border border-cyan-500/20 overflow-hidden p-2.5 bg-white">
                    <img src="/orion-empty-logo.png" alt="Orion" className="h-6 w-6 object-contain animate-pulse" />
                  </div>
                  <div>
                    <h3 className="text-base font-black text-white flex items-center gap-1.5">
                      <span>Visualizar Extração Apolo AI</span>
                      <span className="bg-cyan-500/20 text-cyan-300 text-[8px] font-black uppercase px-2 py-0.5 rounded-full">Revisão</span>
                    </h3>
                    <p className="text-[10px] font-bold text-slate-500">
                      Revise os dados extraídos pelo Apolo AI antes de salvar.
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => setAiPreviewData(null)}
                  className="rounded-xl bg-white/5 border border-white/5 p-2 text-slate-400 hover:text-white hover:bg-white/10 cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Corpo Editável do Modal */}
              <div className="mt-5 space-y-5 max-h-[400px] overflow-y-auto pr-1">
                
                {/* Informações Básicas */}
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 bg-white/2 border border-white/5 p-4 rounded-2xl">
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Operadora</label>
                    <input
                      type="text"
                      value={aiPreviewData.operadoraNome || ''}
                      onChange={(e) => setAiPreviewData({ ...aiPreviewData, operadoraNome: e.target.value })}
                      className="mt-1 w-full bg-white/5 border border-white/5 rounded-xl px-3 py-2 text-xs font-bold text-white focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Nome do Plano</label>
                    <input
                      type="text"
                      value={aiPreviewData.nome || ''}
                      onChange={(e) => setAiPreviewData({ ...aiPreviewData, nome: e.target.value })}
                      className="mt-1 w-full bg-white/5 border border-white/5 rounded-xl px-3 py-2 text-xs font-bold text-white focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Contratação</label>
                    <select
                      value={aiPreviewData.tipo || 'PME'}
                      onChange={(e) => setAiPreviewData({ ...aiPreviewData, tipo: e.target.value as any })}
                      className="mt-1.5 w-full bg-white/5 border border-white/5 rounded-xl px-3 py-2 text-xs font-bold text-white focus:outline-none"
                    >
                      <option value="PME">PME (Empresarial)</option>
                      <option value="PF">Pessoa Física</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Coparticipação</label>
                    <select
                      value={aiPreviewData.coparticipacao || 'Sim'}
                      onChange={(e) => setAiPreviewData({ ...aiPreviewData, coparticipacao: e.target.value as any })}
                      className="mt-1.5 w-full bg-white/5 border border-white/5 rounded-xl px-3 py-2 text-xs font-bold text-white focus:outline-none"
                    >
                      <option value="Sim">Sim</option>
                      <option value="Não">Não</option>
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Reembolso Clínico</label>
                    <input
                      type="text"
                      value={aiPreviewData.reembolso || ''}
                      onChange={(e) => setAiPreviewData({ ...aiPreviewData, reembolso: e.target.value })}
                      className="mt-1 w-full bg-white/5 border border-white/5 rounded-xl px-3 py-2 text-xs font-bold text-white focus:outline-none"
                    />
                  </div>
                  <div className="md:col-span-3">
                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Hospitais Credenciados (Separados por vírgula)</label>
                    <input
                      type="text"
                      value={aiPreviewData.hospitais?.join(', ') || ''}
                      onChange={(e) => setAiPreviewData({ ...aiPreviewData, hospitais: e.target.value.split(',').map(h => h.trim()) })}
                      className="mt-1 w-full bg-white/5 border border-white/5 rounded-xl px-3 py-2 text-xs font-bold text-white focus:outline-none"
                    />
                  </div>
                </div>

                {/* Preços ANS Extraídos */}
                <div>
                  <h4 className="text-2xs font-black uppercase tracking-wider text-slate-500 mb-2.5">Tabela de Preços Extraída (10 faixas ANS)</h4>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                    {FAIXAS_ETARIAS.map((faixa, idx) => {
                      const preco = aiPreviewData.precos?.[idx] || 0;
                      return (
                        <div key={faixa.key} className="bg-slate-900 border border-white/5 rounded-2xl p-3 flex flex-col justify-between">
                          <span className="text-[9px] font-extrabold text-slate-400">{faixa.label}</span>
                          <div className="mt-1.5 flex items-center bg-white/5 border border-white/5 px-2 rounded-xl">
                            <span className="text-3xs font-bold text-slate-500 mr-1">R$</span>
                            <input
                              type="number"
                              value={preco}
                              onChange={(e) => {
                                const novosPrecos = [...(aiPreviewData.precos || [])];
                                novosPrecos[idx] = parseFloat(e.target.value) || 0;
                                setAiPreviewData({ ...aiPreviewData, precos: novosPrecos });
                              }}
                              className="w-full bg-transparent border-none py-1 text-xs font-black text-cyan-400 focus:outline-none"
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Footer do Modal */}
              <div className="mt-6 flex flex-col sm:flex-row gap-3 border-t border-white/5 pt-4">
                <button
                  onClick={() => setAiPreviewData(null)}
                  className="flex-1 bg-white/5 border border-white/5 text-slate-300 px-4 py-3 rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-white/10 hover:text-white transition-all cursor-pointer text-center"
                >
                  Descartar
                </button>

                <button
                  onClick={confirmarSalvarAiPreview}
                  className="flex-1 flex items-center justify-center gap-2 bg-blue-600 text-white px-4 py-3 rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-blue-700 transition-all cursor-pointer shadow-md shadow-blue-600/20"
                >
                  <Check size={14} />
                  <span>Gravar e Notificar</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ================= MODAL: VISUALIZAÇÃO DE PROPOSTA COMERCIAL ================= */}
        {propostaModal && (
          <div className="fixed inset-0 z-[999] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm overflow-y-auto animate-in fade-in-50 duration-200">
            <div className="relative w-full max-w-2xl overflow-hidden rounded-[2.5rem] border border-blue-500/30 bg-[#090e1a]/95 p-6 sm:p-8 shadow-[0_0_50px_rgba(59,130,246,0.3)] animate-in slide-in-from-bottom-6 duration-300 my-8">
              
              {/* Cabeçalho da Proposta */}
              <div className="flex items-center justify-between border-b border-white/5 pb-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-600 text-white font-black">
                    <FileText size={20} />
                  </div>
                  <div>
                    <h3 className="text-base font-black text-white">Proposta Comercial</h3>
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                      Orion Track — Consultoria de Seguros
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => setPropostaModal(null)}
                  className="text-slate-400 hover:text-white transition-colors cursor-pointer text-xs font-bold bg-white/5 px-3 py-1.5 rounded-xl border border-white/5"
                >
                  Fechar
                </button>
              </div>

              {/* Corpo da Proposta / Detalhes dos Preços por Faixa */}
              <div className="mt-5 space-y-4 max-h-[350px] overflow-y-auto pr-1">
                
                {/* Info Plan & Operadora */}
                <div className="bg-white/2 border border-white/5 p-4 rounded-2xl flex items-center justify-between">
                  <div>
                    <span className="text-[9px] font-black uppercase tracking-wider text-slate-500 block">Plano Selecionado</span>
                    <h4 className="text-base font-black text-cyan-400">{propostaModal.plano.nome}</h4>
                    <span className="text-[9px] font-extrabold text-slate-300 mt-1 inline-block">
                      Reembolso: {propostaModal.plano.reembolso} | Coparticipação: {propostaModal.plano.coparticipacao}
                    </span>
                  </div>
                  
                  <div className="text-right">
                    <span className="text-[9px] font-black uppercase tracking-wider text-slate-500 block">Total Geral Mensal</span>
                    <span className="text-lg font-black text-white">
                      R$ {propostaModal.total.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>

                {/* Tabela de Vidas e Subtotais */}
                <div>
                  <h4 className="text-2xs font-black uppercase tracking-wider text-slate-500 mb-2">Composição da População / Vidas</h4>
                  
                  <div className="space-y-1.5">
                    {propostaModal.vidasPorFaixa.map((item, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between px-4 py-2 rounded-xl bg-white/1 border border-white/5 text-2xs"
                      >
                        <div className="flex items-center gap-2">
                          <span className="flex h-5 w-5 items-center justify-center rounded-md bg-blue-600/10 text-cyan-400 text-[10px] font-black border border-blue-500/10">
                            {item.count}
                          </span>
                          <span className="font-extrabold text-slate-300">{item.label}</span>
                        </div>
                        
                        <div className="flex items-center gap-6">
                          <span className="text-slate-500">Unitário: R$ {item.precoUnitario.toLocaleString('pt-BR')}</span>
                          <span className="font-black text-slate-200">Subtotal: R$ {item.subtotal.toLocaleString('pt-BR')}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Hospitais do Plano */}
                <div className="bg-white/2 border border-white/5 p-4 rounded-2xl">
                  <h4 className="text-2xs font-black uppercase tracking-wider text-slate-500 mb-2">Rede Credenciada Recomendada</h4>
                  <div className="flex flex-wrap gap-1.5">
                    {propostaModal.plano.hospitais.map((hosp, i) => (
                      <span key={i} className="flex items-center gap-1 bg-[#090e1a] border border-white/5 px-2.5 py-1 rounded-xl text-2xs font-extrabold text-slate-300">
                        <Heart size={8} className="text-rose-500" />
                        {hosp}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {/* Rodapé do Modal / Ações de Proposta */}
              <div className="mt-6 flex flex-col sm:flex-row gap-3 border-t border-white/5 pt-4">
                <button
                  onClick={() => {
                    const textContent = `Olá! Tudo bem? 😊

Conforme conversamos, preparei uma simulação muito especial de plano de saúde para você analisar com calma. Busquei selecionar uma opção de excelente qualidade que atende perfeitamente o que você precisa:

🏥 *Plano de Saúde:* ${propostaModal.plano.nome}
⚖️ *Coparticipação:* ${propostaModal.plano.coparticipacao === 'Sim' ? 'Sim (mensalidade menor e taxas muito pequenas apenas quando usar)' : 'Não (mensalidade fixa, sem cobrança adicional em exames ou consultas)'}
💰 *Reembolso para consultas particulares:* ${propostaModal.plano.reembolso !== 'Sem reembolso' ? propostaModal.plano.reembolso : 'Não possui (atendimento completo na rede credenciada)'}
👥 *Quantidade de pessoas:* ${propostaModal.totalVidas} ${propostaModal.totalVidas === 1 ? 'vida' : 'vidas'}

📊 *Resumo de Valores por Faixa Etária:*
${propostaModal.vidasPorFaixa.map(v => `• *${v.count}x ${v.label}:* R$ ${v.precoUnitario.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} cada (Subtotal: R$ ${v.subtotal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`).join('\n')}

⭐ *Investimento Mensal Total:* *R$ ${propostaModal.total.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}*

🏥 *Alguns dos ótimos hospitais inclusos:*
${propostaModal.plano.hospitais.slice(0, 6).map(h => `• ${h}`).join('\n')}

Estou aqui para tirar qualquer dúvida e te ajudar a escolher o melhor caminho para proteger quem você ama ou sua equipe! Se quiser fazer qualquer alteração ou simular outras opções, é só me chamar. O que achou dessa opção? 🚀✨`;

                    copyTextToClipboard(textContent);
                    alert('Proposta copiada para a área de transferência no formato comercial para WhatsApp!');
                    setPropostaModal(null);
                  }}
                  className="flex-1 flex items-center justify-center gap-2 bg-white/5 border border-white/5 text-slate-300 px-4 py-3 rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-white/10 hover:text-white transition-all cursor-pointer"
                >
                  <Share2 size={14} />
                  <span>Copiar Proposta WhatsApp</span>
                </button>

                <button
                  onClick={() => {
                    alert('Simulação concluída com sucesso!');
                    setPropostaModal(null);
                  }}
                  className="flex-1 flex items-center justify-center gap-2 bg-blue-600 text-white px-4 py-3 rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-blue-700 transition-all cursor-pointer shadow-md shadow-blue-600/20"
                >
                  <Check size={14} />
                  <span>Concluir Simulação</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ================= BARRA FLUTUANTE DE SELEÇÃO PARA COMPARAÇÃO ================= */}
        {comparedPlanIds.length > 0 && (
          <div className="fixed bottom-6 left-1/2 z-[800] -translate-x-1/2 flex items-center justify-between gap-6 rounded-2xl border border-blue-500/20 bg-slate-900/90 px-6 py-4 shadow-xl shadow-slate-950/40 backdrop-blur-xl animate-in slide-in-from-bottom-10 duration-300 w-[90%] max-w-lg">
            <div className="flex items-center gap-3">
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-blue-600 text-xs font-black text-white">
                {comparedPlanIds.length}
              </span>
              <span className="text-2xs font-black uppercase tracking-widest text-slate-300">
                {comparedPlanIds.length === 1 ? 'Plano selecionado' : 'Planos selecionados'}
              </span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setComparedPlanIds([])}
                className="rounded-xl border border-white/5 bg-white/5 px-3 py-1.5 text-3xs font-black uppercase tracking-wider text-slate-400 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
              >
                Limpar
              </button>
              <button
                disabled={comparedPlanIds.length < 2}
                onClick={() => setIsCompareModalOpen(true)}
                className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-1.5 text-3xs font-black uppercase tracking-wider text-white hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer shadow-md shadow-blue-600/10"
              >
                <Layers size={11} />
                <span>Comparar lado a lado</span>
              </button>
            </div>
          </div>
        )}

        {/* ================= MODAL: COMPARAÇÃO DE PLANOS LADO A LADO ================= */}
        {isCompareModalOpen && (
          <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm overflow-y-auto animate-in fade-in-50 duration-200">
            <div className="relative w-full max-w-6xl overflow-hidden rounded-[2.5rem] border border-blue-500/30 bg-[#090e1a]/95 p-6 sm:p-8 shadow-[0_0_50px_rgba(59,130,246,0.3)] animate-in slide-in-from-bottom-6 duration-300 my-8">
              
              {/* Cabeçalho do Comparador */}
              <div className="flex items-center justify-between border-b border-white/5 pb-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-600 text-white font-black">
                    <Layers size={20} />
                  </div>
                  <div>
                    <h3 className="text-base font-black text-white">Comparativo de Planos</h3>
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                      Análise detalhada lado a lado para o cliente final
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => setIsCompareModalOpen(false)}
                  className="text-slate-400 hover:text-white transition-colors cursor-pointer text-xs font-bold bg-white/5 px-3 py-1.5 rounded-xl border border-white/5"
                >
                  Fechar
                </button>
              </div>

              {/* Tabela de Comparação */}
              <div className="mt-6 overflow-x-auto scrollbar-thin pb-4">
                <div className="min-w-[800px] grid" style={{ gridTemplateColumns: `200px repeat(${comparedPlanIds.length}, minmax(200px, 1fr))` }}>
                  {/* Cabeçalho das Colunas */}
                  <div className="p-4 flex items-center bg-white/2 rounded-l-2xl border-y border-l border-white/5">
                    <span className="text-3xs font-black uppercase tracking-widest text-slate-500">Característica</span>
                  </div>
                  {comparedPlanIds.map((id, index) => {
                    const plano = planosCalculados.find(p => p.id === id);
                    const op = operadoras.find(o => o.id === plano?.operadoraId);
                    if (!plano) return null;
                    return (
                      <div
                        key={id}
                        className={`p-4 text-center bg-white/2 border-y border-white/5 flex flex-col items-center justify-center gap-2 ${
                          index === comparedPlanIds.length - 1 ? 'rounded-r-2xl border-r' : ''
                        }`}
                      >
                        <RenderLogo id={plano.operadoraId} className="h-10 w-10 shrink-0" />
                        <h4 className="text-xs font-black text-white leading-tight">{plano.nome}</h4>
                        <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wide">{op?.nome}</span>
                      </div>
                    );
                  })}

                  {/* Custo Total */}
                  <div className="p-4 flex items-center border-b border-white/5 text-2xs font-extrabold text-slate-400">Custo Total Mensal</div>
                  {comparedPlanIds.map(id => {
                    const plano = planosCalculados.find(p => p.id === id);
                    if (!plano) return null;
                    return (
                      <div key={id} className="p-4 text-center border-b border-white/5 flex flex-col items-center justify-center">
                        <span className="text-sm font-black text-cyan-400">
                          R$ {plano.custoTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                        <span className="text-[9px] font-bold text-slate-500 mt-0.5">
                          Média: R$ {(plano.custoTotal / totalVidas).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} / vida
                        </span>
                      </div>
                    );
                  })}

                  {/* Coparticipação */}
                  <div className="p-4 flex items-center border-b border-white/5 text-2xs font-extrabold text-slate-400">Coparticipação</div>
                  {comparedPlanIds.map(id => {
                    const plano = planosCalculados.find(p => p.id === id);
                    if (!plano) return null;
                    return (
                      <div key={id} className="p-4 text-center border-b border-white/5 text-2xs font-bold text-slate-200">
                        {plano.coparticipacao === 'Sim' ? (
                          <span className="text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2.5 py-0.5 rounded-lg">
                            Com Coparticipação
                          </span>
                        ) : (
                          <span className="text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 rounded-lg">
                            Sem Coparticipação
                          </span>
                        )}
                      </div>
                    );
                  })}

                  {/* Reembolso */}
                  <div className="p-4 flex items-center border-b border-white/5 text-2xs font-extrabold text-slate-400">Reembolso Clínicas</div>
                  {comparedPlanIds.map(id => {
                    const plano = planosCalculados.find(p => p.id === id);
                    if (!plano) return null;
                    return (
                      <div key={id} className="p-4 text-center border-b border-white/5 text-2xs font-bold text-slate-200">
                        {plano.reembolso}
                      </div>
                    );
                  })}

                  {/* Hospitais Principais */}
                  <div className="p-4 flex items-center border-b border-white/5 text-2xs font-extrabold text-slate-400">Rede Credenciada</div>
                  {comparedPlanIds.map(id => {
                    const plano = planosCalculados.find(p => p.id === id);
                    if (!plano) return null;
                    return (
                      <div key={id} className="p-4 border-b border-white/5 text-center flex flex-col items-center justify-center gap-1.5">
                        {plano.hospitais.slice(0, 4).map((hosp, i) => (
                          <span key={i} className="inline-flex items-center gap-1 bg-white/2 border border-white/5 px-2 py-0.5 rounded-lg text-3xs text-slate-300">
                            <Heart size={7} className="text-rose-500 shrink-0" />
                            <span className="truncate max-w-[150px]">{hosp}</span>
                          </span>
                        ))}
                      </div>
                    );
                  })}

                  {/* Laboratórios Principais */}
                  <div className="p-4 flex items-center border-b border-white/5 text-2xs font-extrabold text-slate-400">Laboratórios</div>
                  {comparedPlanIds.map(id => {
                    const plano = planosCalculados.find(p => p.id === id);
                    if (!plano) return null;
                    return (
                      <div key={id} className="p-4 border-b border-white/5 text-center flex flex-col items-center justify-center gap-1.5">
                        {plano.laboratorios.slice(0, 3).map((lab, i) => (
                          <span key={i} className="inline-flex items-center bg-blue-500/5 border border-blue-500/10 px-2 py-0.5 rounded-lg text-3xs text-cyan-400">
                            {lab}
                          </span>
                        ))}
                      </div>
                    );
                  })}

                  {/* Diferencial Competitivo */}
                  <div className="p-4 flex items-center border-b border-white/5 text-2xs font-extrabold text-slate-400">Diferencial / Destaque</div>
                  {comparedPlanIds.map(id => {
                    const plano = planosCalculados.find(p => p.id === id);
                    if (!plano) return null;
                    
                    let destaque = 'Melhor custo-benefício para a região.';
                    if (plano.operadoraId === 'bradesco') destaque = 'Reconhecido nacionalmente pela rede médica e rapidez no reembolso.';
                    else if (plano.operadoraId === 'amil' && plano.nome.includes('S450')) destaque = 'Excelente cobertura hospitalar incluindo hospitais de ponta.';
                    else if (plano.operadoraId === 'porto') destaque = 'Pontuação extra de fidelidade e excelente suporte corporativo.';
                    else if (plano.operadoraId === 'sulamerica') destaque = 'Melhores taxas de reembolso para consultas particulares.';
                    else if (plano.coparticipacao === 'Não') destaque = 'Total previsibilidade financeira sem sustos no fim do mês.';

                    return (
                      <div key={id} className="p-4 text-center border-b border-white/5 text-3xs font-extrabold text-slate-400 leading-relaxed max-w-[200px] mx-auto flex items-center justify-center text-cyan-300">
                        {destaque}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Ações do Comparador */}
              <div className="mt-6 flex flex-col sm:flex-row gap-3 border-t border-white/5 pt-4 justify-end">
                <button
                  onClick={() => setIsCompareModalOpen(false)}
                  className="bg-white/5 border border-white/5 text-slate-300 px-5 py-3 rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-white/10 hover:text-white transition-all cursor-pointer"
                >
                  Voltar
                </button>
                <button
                  onClick={() => {
                    const headerText = `📊 *COMPARATIVO DE PLANOS DE SAÚDE*
Aqui está uma comparação lado a lado detalhada das opções que selecionei para você analisar:

`;
                    const plansText = comparedPlanIds.map(id => {
                      const plano = planosCalculados.find(p => p.id === id);
                      if (!plano) return '';
                      return `*${plano.nome}*
💰 *Mensalidade:* R$ ${plano.custoTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
⚖️ *Coparticipação:* ${plano.coparticipacao}
💰 *Reembolso:* ${plano.reembolso}
🏥 *Hospitais principais:* ${plano.hospitais.slice(0, 3).join(', ')}
🧪 *Laboratórios:* ${plano.laboratorios.slice(0, 2).join(', ')}
`;
                    }).join('\n-----------------------\n');

                    const footerText = `\n-----------------------\nFico à total disposição para detalhar qualquer um dos planos acima ou prosseguir com o fechamento! Qual das opções se encaixa melhor no que você busca? 😊🚀`;

                    copyTextToClipboard(headerText + plansText + footerText);
                    alert('Comparativo copiado para a área de transferência no formato comercial para WhatsApp!');
                    setIsCompareModalOpen(false);
                  }}
                  className="flex items-center justify-center gap-2 bg-blue-600 text-white px-5 py-3 rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-blue-700 transition-all cursor-pointer shadow-md shadow-blue-600/20"
                >
                  <Share2 size={14} />
                  <span>Copiar Comparativo WhatsApp</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </InternalLayout>
  );
}
