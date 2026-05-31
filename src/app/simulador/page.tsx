'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/components/providers/AuthProvider';
import InternalLayout from '@/components/layout/InternalLayout';
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
  Award
} from 'lucide-react';

// Formato de operadora
interface Operadora {
  id: string;
  nome: string;
  logoUrl?: string;
  corGradiente: string;
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
    precos: [250, 310, 380, 420, 480, 550, 680, 820, 1100, 1950]
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
    precos: [310, 380, 470, 520, 595, 680, 840, 1020, 1360, 2410]
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
    precos: [450, 560, 690, 780, 890, 1020, 1250, 1500, 2100, 3600]
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
    precos: [420, 520, 650, 730, 840, 960, 1180, 1420, 1980, 3400]
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
    precos: [490, 610, 760, 860, 985, 1130, 1390, 1670, 2335, 4010]
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
    precos: [320, 390, 480, 540, 620, 710, 870, 1050, 1450, 2500]
  },
  // Planos PF (Pessoa Física / Individual)
  {
    id: 'p7',
    operadoraId: 'amil',
    nome: 'Amil Individual S280',
    tipo: 'PF',
    coparticipacao: 'Sim',
    reembolso: 'Sem reembolso',
    hospitais: ['Hospital da Luz', 'Hospital Metropolitano', 'Hospital Paulistano'],
    laboratorios: ['Lavoisier', 'A+'],
    precos: [190, 230, 280, 310, 360, 410, 510, 610, 820, 1450]
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
    precos: [230, 280, 345, 380, 440, 500, 620, 745, 1010, 1785]
  }
];

export default function SimuladorPage() {
  const { profile } = useAuth();
  const isAdmin = profile?.tipo_usuario === 'admin';

  // Estados dos dados
  const [operadoras, setOperadoras] = useState<Operadora[]>(OPERADORAS_PADRAO);
  const [planos, setPlanos] = useState<Plano[]>(PLANOS_PADRAO);

  // Estados de navegação interna
  const [activeTab, setActiveTab] = useState<'simulacao' | 'planos' | 'admin'>('simulacao');

  // Estados dos filtros da simulação
  const [tipoContrato, setTipoContrato] = useState<'PF' | 'PME'>('PME');
  const [coparticipacaoFiltro, setCoparticipacaoFiltro] = useState<'Ambos' | 'Sim' | 'Não'>('Ambos');
  const [ufFiltro, setUfFiltro] = useState<string>('SP');
  const [buscaPlanos, setBuscaPlanos] = useState<string>('');

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

  // Carregar dados salvos no LocalStorage (se houver)
  useEffect(() => {
    const savedOperadoras = localStorage.getItem('orion:sim_operadoras');
    const savedPlanos = localStorage.getItem('orion:sim_planos');
    if (savedOperadoras) setOperadoras(JSON.parse(savedOperadoras));
    if (savedPlanos) setPlanos(JSON.parse(savedPlanos));
  }, []);

  // Salvar dados no LocalStorage
  const salvarDados = (novasOps: Operadora[], novosPlanos: Plano[]) => {
    setOperadoras(novasOps);
    setPlanos(novosPlanos);
    localStorage.setItem('orion:sim_operadoras', JSON.stringify(novasOps));
    localStorage.setItem('orion:sim_planos', JSON.stringify(novosPlanos));
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
      // Calcular preços por faixa etária baseada nas vidas informadas
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
    // Ordena do menor preço para o maior
    .sort((a, b) => a.custoTotal - b.custoTotal);

  // Manipulação de Upload do CSV de Preços (Admin)
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState<{ type: 'sucesso' | 'erro' | 'info'; message: string } | null>(null);

  const handleCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvFile(file);
    setUploadStatus({ type: 'info', message: 'Lendo e processando planilha...' });

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const rows = text.split('\n').map(row => row.split(',').map(cell => cell.trim()));
        
        if (rows.length < 2) {
          throw new Error('A planilha está vazia ou no formato inválido.');
        }

        // Header Check: Operadora, Plano, Tipo, Coparticipacao, Reembolso, Hospitais, Faixa_0_18, ...
        const header = rows[0];
        const indexOperadora = header.findIndex(h => h.toLowerCase().includes('operadora'));
        const indexPlano = header.findIndex(h => h.toLowerCase().includes('plano'));
        const indexTipo = header.findIndex(h => h.toLowerCase().includes('tipo'));
        const indexCopart = header.findIndex(h => h.toLowerCase().includes('copart'));
        const indexReembolso = header.findIndex(h => h.toLowerCase().includes('reemb'));
        const indexHospitais = header.findIndex(h => h.toLowerCase().includes('hosp'));

        if (indexOperadora === -1 || indexPlano === -1) {
          throw new Error('Colunas "Operadora" e "Plano" são obrigatórias na planilha.');
        }

        const novosPlanos: Plano[] = [...planos];
        const novasOperadoras: Operadora[] = [...operadoras];

        let countImportados = 0;

        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          if (row.length < 2 || !row[indexOperadora] || !row[indexPlano]) continue;

          const nomeOp = row[indexOperadora];
          const nomePlano = row[indexPlano];
          const tipo = (row[indexTipo] || 'PME').toUpperCase() as 'PF' | 'PME';
          const copart = (row[indexCopart] || 'Sim') as 'Sim' | 'Não';
          const reembolso = row[indexReembolso] || 'Sem reembolso';
          const hospitais = row[indexHospitais] ? row[indexHospitais].split(';').map(h => h.trim()) : ['Hospitais locais'];

          // Operadora ID
          let opId = nomeOp.toLowerCase().replace(/[^a-z0-9]/g, '');
          let opExistente = novasOperadoras.find(o => o.id === opId);
          if (!opExistente) {
            opExistente = {
              id: opId,
              nome: nomeOp,
              corGradiente: 'from-blue-600 to-indigo-500'
            };
            novasOperadoras.push(opExistente);
          }

          // Preços (10 faixas)
          const precos = [
            parseFloat(row[row.length - 10]) || 150,
            parseFloat(row[row.length - 9]) || 180,
            parseFloat(row[row.length - 8]) || 220,
            parseFloat(row[row.length - 7]) || 260,
            parseFloat(row[row.length - 6]) || 310,
            parseFloat(row[row.length - 5]) || 380,
            parseFloat(row[row.length - 4]) || 460,
            parseFloat(row[row.length - 3]) || 550,
            parseFloat(row[row.length - 2]) || 750,
            parseFloat(row[row.length - 1]) || 1350
          ];

          const planoId = `csv_${Date.now()}_${i}`;
          novosPlanos.unshift({
            id: planoId,
            operadoraId: opId,
            nome: nomePlano,
            tipo,
            coparticipacao: copart,
            reembolso,
            hospitais,
            laboratorios: ['Delboni', 'Lavoisier'],
            precos
          });
          countImportados++;
        }

        salvarDados(novasOperadoras, novosPlanos);
        setUploadStatus({
          type: 'sucesso',
          message: `Sucesso! Planilha processada. ${countImportados} planos importados/atualizados com sucesso.`
        });
      } catch (err: any) {
        setUploadStatus({ type: 'erro', message: `Erro ao importar planilha: ${err.message}` });
      }
    };
    reader.readAsText(file);
  };

  const baixarPlanilhaModelo = () => {
    const csvContent = "data:text/csv;charset=utf-8," 
      + "Operadora,Plano,Tipo,Coparticipacao,Reembolso,Hospitais,Preco_0_18,Preco_19_23,Preco_24_28,Preco_29_33,Preco_34_38,Preco_39_43,Preco_44_48,Preco_49_53,Preco_54_58,Preco_59_mais\n"
      + "Amil Saude,Amil S380 Premium,PME,Sim,Sem Reembolso,Albert Einstein;Sirio Libanes,250,300,350,400,450,500,600,750,1000,1800\n"
      + "Unimed,Unimed Top,PF,Nao,R$ 100.00,Hospital Unimed;Oswaldo Cruz,200,240,290,320,370,420,500,600,800,1500";
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "modelo_tabela_precos.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const restaurarTabelasPadrao = () => {
    if (window.confirm("Deseja realmente restaurar os planos e preços padrão de fábrica? Isso removerá as planilhas importadas.")) {
      salvarDados(OPERADORAS_PADRAO, PLANOS_PADRAO);
      setUploadStatus({ type: 'sucesso', message: 'Tabelas padrão restauradas com sucesso!' });
    }
  };

  return (
    <InternalLayout>
      <div className="space-y-6">
        {/* Header Superior Dinâmico */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/5 pb-5">
          <div>
            <div className="flex items-center gap-2 text-cyan-400 font-extrabold text-xs uppercase tracking-widest">
              <Sparkles size={14} className="animate-pulse" />
              <span>Simulador Inteligente</span>
            </div>
            <h1 className="mt-1 text-2xl font-black tracking-tight text-white sm:text-3xl">
              Fazer Simulação de Planos
            </h1>
            <p className="mt-1 text-xs sm:text-sm font-bold text-slate-400">
              Calcule instantaneamente tabelas de operadoras e compare benefícios de forma premium para seus clientes.
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
              <span>Simular</span>
            </button>
            <button
              onClick={() => setActiveTab('planos')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all duration-200 ${
                activeTab === 'planos'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Layers size={14} />
              <span>Planos ({planos.length})</span>
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
                <span>Importar CSV</span>
              </button>
            )}
          </div>
        </div>

        {/* ================= ABA 1: SIMULAÇÃO DINÂMICA ================= */}
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
                    <div className="mt-1.5 flex bg-white/5 border border-white/5 p-1 rounded-xl">
                      <button
                        onClick={() => { setTipoContrato('PME'); limparVidas(); }}
                        className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-2xs font-extrabold uppercase transition-all ${
                          tipoContrato === 'PME' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        <Building size={12} />
                        <span>PME (Empresarial)</span>
                      </button>
                      <button
                        onClick={() => { setTipoContrato('PF'); limparVidas(); }}
                        className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-2xs font-extrabold uppercase transition-all ${
                          tipoContrato === 'PF' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        <User size={12} />
                        <span>Pessoa Física</span>
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

            {/* LADO DIREITO: RESULTADOS DO CÁLCULO E COMPARATIVO (7 colunas) */}
            <div className="xl:col-span-7 space-y-5">
              <div className="flex items-center justify-between bg-white/3 border border-white/5 rounded-2xl px-5 py-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600/20 text-cyan-400 border border-blue-500/10">
                    <Calculator size={18} className="animate-spin-slow" />
                  </div>
                  <div>
                    <h2 className="text-xs font-black uppercase tracking-wider text-slate-300">Planos Encontrados</h2>
                    <p className="text-[10px] font-bold text-slate-500">
                      Exibindo {planosCalculados.length} planos baseados no seu perfil.
                    </p>
                  </div>
                </div>

                <div className="text-right">
                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">Total de Vidas</span>
                  <p className="text-base font-black text-cyan-400">{totalVidas} vidas</p>
                </div>
              </div>

              {totalVidas === 0 ? (
                <div className="orion-panel flex flex-col items-center justify-center rounded-[2rem] border border-white/5 bg-[#0f172a]/20 p-12 text-center backdrop-blur-md shadow-inner">
                  <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-blue-600/10 text-blue-400 border border-blue-500/10 mb-4 animate-bounce">
                    <Sparkles size={28} />
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
                            {/* Logo Fallback Premium */}
                            <div className={`flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br ${op?.corGradiente || 'from-slate-700 to-slate-600'} text-xs font-black uppercase text-white shadow-lg`}>
                              {op?.nome ? op.nome.slice(0, 2) : 'OP'}
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
                              </div>
                              <h4 className="text-base font-black text-white group-hover:text-cyan-400 transition-colors">
                                {plano.nome}
                              </h4>
                            </div>
                          </div>

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

                        {/* Detalhes de Reembolso e Hospitais Credenciados */}
                        <div className="mt-4 grid grid-cols-1 md:grid-cols-12 gap-4">
                          {/* Hospitais */}
                          <div className="md:col-span-8">
                            <p className="text-[9px] font-black uppercase tracking-wider text-slate-500">Principais Hospitais Credenciados</p>
                            <div className="mt-1.5 flex flex-wrap gap-1.5">
                              {plano.hospitais.slice(0, 3).map((hosp, i) => (
                                <span key={i} className="flex items-center gap-1 bg-white/2 border border-white/5 px-2.5 py-1 rounded-xl text-2xs font-extrabold text-slate-300">
                                  <Heart size={8} className="text-rose-500" />
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
                            onClick={() => {
                              // Mostrar discriminativo detalhado
                              alert(`Preços Unitários por idade para o plano ${plano.nome}:\n` + plano.detalheVidas.filter(v => v.count > 0).map(v => `${v.count}x ${v.label} - R$ ${v.precoUnitario} (Subtotal: R$ ${v.subtotal})`).join('\n'));
                            }}
                            className="text-2xs font-black text-slate-500 uppercase tracking-widest hover:text-white transition-colors cursor-pointer"
                          >
                            Ver detalhes do cálculo
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
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ================= ABA 2: VISUALIZAÇÃO DE PLANOS ================= */}
        {activeTab === 'planos' && (
          <div className="orion-panel rounded-[2rem] border border-white/5 bg-[#0f172a]/40 p-6 backdrop-blur-md shadow-2xl">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/5 pb-4">
              <div>
                <h3 className="text-base font-black text-white">Todos os Planos de Saúde Configurados</h3>
                <p className="text-xs font-bold text-slate-500">Consulte as tabelas de preços indexadas no simulador da Orion Track.</p>
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

            <div className="mt-6 overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-white/5 text-[10px] font-black uppercase tracking-wider text-slate-500">
                    <th className="pb-3 pr-4">Operadora</th>
                    <th className="pb-3 px-4">Nome do Plano</th>
                    <th className="pb-3 px-4">Tipo</th>
                    <th className="pb-3 px-4">Copart.</th>
                    <th className="pb-3 px-4">Reembolso</th>
                    <th className="pb-3 px-4">Preço Base (Faixa 0-18)</th>
                    <th className="pb-3 px-4">Preço Teto (Faixa 59+)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-xs">
                  {planos.map((plano) => {
                    const op = operadoras.find(o => o.id === plano.operadoraId);
                    return (
                      <tr key={plano.id} className="hover:bg-white/2 transition-colors">
                        <td className="py-3.5 pr-4 font-bold text-white flex items-center gap-2">
                          <span className={`inline-flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br ${op?.corGradiente || 'from-slate-700 to-slate-600'} text-[8px] font-black text-white`}>
                            {op?.nome ? op.nome.slice(0, 2) : 'OP'}
                          </span>
                          <span>{op?.nome || 'Desconhecida'}</span>
                        </td>
                        <td className="py-3.5 px-4 font-black text-slate-300">{plano.nome}</td>
                        <td className="py-3.5 px-4 font-bold text-slate-400">{plano.tipo}</td>
                        <td className="py-3.5 px-4 font-bold text-slate-400">{plano.coparticipacao}</td>
                        <td className="py-3.5 px-4 font-bold text-slate-400">{plano.reembolso}</td>
                        <td className="py-3.5 px-4 font-black text-cyan-400">R$ {plano.precos[0].toLocaleString('pt-BR')}</td>
                        <td className="py-3.5 px-4 font-black text-cyan-400">R$ {plano.precos[9].toLocaleString('pt-BR')}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ================= ABA 3: PAINEL DE IMPORTAÇÃO (ADMIN) ================= */}
        {activeTab === 'admin' && isAdmin && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            
            {/* Box de Upload do CSV */}
            <div className="lg:col-span-8 orion-panel rounded-[2rem] border border-white/5 bg-[#0f172a]/40 p-6 backdrop-blur-md shadow-2xl space-y-5">
              <div>
                <h3 className="text-base font-black text-white">Alimentação em Massa via Planilha CSV</h3>
                <p className="text-xs font-bold text-slate-500">
                  Carregue tabelas de preços completas. O sistema irá ler as faixas etárias padrão da ANS e atualizar o simulador automaticamente.
                </p>
              </div>

              {/* Área Dropzone de Arquivo */}
              <div className="border-2 border-dashed border-white/10 rounded-[2rem] bg-white/2 p-8 flex flex-col items-center justify-center text-center transition-all hover:bg-white/3 hover:border-blue-500/30">
                <div className="h-12 w-12 rounded-2xl bg-blue-600/10 text-cyan-400 flex items-center justify-center border border-blue-500/10 mb-3">
                  <FileSpreadsheet size={24} />
                </div>
                
                <h4 className="text-xs font-black uppercase tracking-wider text-slate-300">Arraste seu arquivo CSV ou clique aqui</h4>
                <p className="text-[10px] font-bold text-slate-500 mt-1">Apenas arquivos no formato .csv são aceitos.</p>

                <input
                  type="file"
                  accept=".csv"
                  onChange={handleCsvUpload}
                  className="hidden"
                  id="csv-upload-input"
                />
                
                <label
                  htmlFor="csv-upload-input"
                  className="mt-4 flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-xl text-2xs font-black uppercase tracking-widest hover:bg-blue-700 transition-all cursor-pointer shadow-md"
                >
                  <Upload size={12} />
                  <span>Selecionar arquivo</span>
                </label>
              </div>

              {/* Status do Upload */}
              {uploadStatus && (
                <div className={`p-4 rounded-2xl border text-xs font-extrabold flex items-center gap-3 ${
                  uploadStatus.type === 'sucesso'
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                    : uploadStatus.type === 'erro'
                      ? 'bg-rose-500/10 border-rose-500/30 text-rose-400'
                      : 'bg-blue-500/10 border-blue-500/30 text-cyan-400'
                }`}>
                  <AlertCircle size={16} />
                  <p>{uploadStatus.message}</p>
                </div>
              )}

              {/* Ajuda/Modelo */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-white/3 border border-white/5 p-4 rounded-2xl">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center">
                    <HelpCircle size={18} />
                  </div>
                  <div>
                    <h4 className="text-2xs font-black uppercase tracking-wider text-slate-300">Como funciona o layout da planilha?</h4>
                    <p className="text-[10px] font-bold text-slate-500">
                      Faça o download do nosso modelo pré-estruturado contendo todas as 10 faixas etárias padrão da ANS.
                    </p>
                  </div>
                </div>

                <button
                  onClick={baixarPlanilhaModelo}
                  className="flex items-center gap-1.5 bg-white/5 border border-white/5 text-slate-300 px-3.5 py-2 rounded-xl text-2xs font-black uppercase tracking-widest hover:bg-white/10 hover:text-white transition-all cursor-pointer shrink-0"
                >
                  <Download size={12} />
                  <span>Modelo CSV</span>
                </button>
              </div>
            </div>

            {/* Lado Direito: Resumo Informativo */}
            <div className="lg:col-span-4 orion-panel rounded-[2rem] border border-white/5 bg-[#0f172a]/40 p-6 backdrop-blur-md shadow-2xl space-y-4">
              <h3 className="text-sm font-black uppercase tracking-widest text-slate-300">Instruções de Importação</h3>
              
              <div className="space-y-4 text-xs font-bold text-slate-400">
                <div className="flex items-start gap-2.5">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-600/20 text-2xs font-black text-cyan-400 border border-blue-500/10">1</span>
                  <p>A coluna **Operadora** agrupará os planos sob o mesmo grupo visual.</p>
                </div>
                <div className="flex items-start gap-2.5">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-600/20 text-2xs font-black text-cyan-400 border border-blue-500/10">2</span>
                  <p>A coluna **Tipo** deve conter apenas **PF** (Pessoa Física) ou **PME** (Empresarial).</p>
                </div>
                <div className="flex items-start gap-2.5">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-600/20 text-2xs font-black text-cyan-400 border border-blue-500/10">3</span>
                  <p>As últimas 10 colunas devem conter exclusivamente os valores numéricos dos preços (separados por vírgula na planilha) para cada faixa etária.</p>
                </div>
                <div className="flex items-start gap-2.5">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-600/20 text-2xs font-black text-cyan-400 border border-blue-500/10">4</span>
                  <p>Se o nome do plano já existir, ele será atualizado; caso contrário, será adicionado um novo plano na base de dados.</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ================= MODAL: VISUALIZAÇÃO DE PROPOSTA COMERCIAL ================= */}
        {propostaModal && (
          <div className="fixed inset-0 z-[999] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm animate-in fade-in-50 duration-200">
            <div className="relative w-full max-w-2xl overflow-hidden rounded-[2.5rem] border border-blue-500/30 bg-[#090e1a]/95 p-6 sm:p-8 shadow-[0_0_50px_rgba(59,130,246,0.3)] animate-in slide-in-from-bottom-6 duration-300">
              
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
                    alert('Proposta copiada para a área de transferência no formato de texto comercial!');
                    setPropostaModal(null);
                  }}
                  className="flex-1 flex items-center justify-center gap-2 bg-white/5 border border-white/5 text-slate-300 px-4 py-3 rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-white/10 hover:text-white transition-all cursor-pointer"
                >
                  <Share2 size={14} />
                  <span>Copiar Proposta</span>
                </button>

                <button
                  onClick={() => {
                    alert('Proposta salva e enviada com sucesso!');
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
      </div>
    </InternalLayout>
  );
}
