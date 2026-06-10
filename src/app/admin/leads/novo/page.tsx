'use client';

import { useState, useEffect } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import { useRouter } from 'next/navigation';
import { 
  User, 
  Smartphone, 
  MapPin, 
  Calendar, 
  Briefcase, 
  Tag, 
  Loader2, 
  Save, 
  ArrowLeft,
  AlertCircle,
  CheckCircle2,
  Users,
  Building2,
  FileText
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { Corretor, LeadStatus } from '@/types';
import Link from 'next/link';

export default function AdminNovoLeadPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [corretores, setCorretores] = useState<Corretor[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [formData, setFormData] = useState({
    corretor_id: '',
    nome: '',
    telefone: '',
    idades: '',
    possui_cnpj: 'Não informado',
    tem_plano_ativo: 'Não informado',
    plano_atual: '',
    custo_plano_atual: '',
    investimento: '',
    cidade: '',
    operadora: '',
    status: 'Aguardando atendimento' as LeadStatus,
    data_entrada: new Date().toISOString().split('T')[0]
  });

  async function fetchCorretores() {
    const { data } = await supabase
      .from('corretores')
      .select('*')
      .order('nome', { ascending: true });

    setCorretores(data || []);
  }

  useEffect(() => {
    void Promise.resolve().then(fetchCorretores);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.corretor_id) {
      setError('Selecione um corretor para este lead.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      if (!token) {
        throw new Error('Sessao expirada. Entre novamente.');
      }

      const response = await fetch('/api/admin/leads', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(formData),
      });

      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Erro ao salvar lead.');

      setSuccess(true);
      setTimeout(() => router.push('/admin/leads'), 3000);
    } catch (err: any) {
      console.error('Error saving lead:', err);
      setError(err?.message || err?.details || err?.hint || 'Erro ao salvar lead.');
    } finally {
      setLoading(false);
    }
  };

  const statusOptions: LeadStatus[] = [
    'Aguardando atendimento',
    'Inicio',
    'Contato feito',
    'Cotação enviada',
    'Região sem comercialização',
    'Venda realizada',
    'Chamou duas vezes',
    'Telefone não existe',
    'Não tive retorno',
    'Em negociação',
    'Sem interesse'
  ];

  const selectedCorretor = corretores.find(c => c.id === formData.corretor_id);
  const operadorasSelecionadas = selectedCorretor?.operadoras_info?.selecionadas;
  const operadorasDoCorretor = Array.isArray(operadorasSelecionadas) ? operadorasSelecionadas : [];

  return (
    <InternalLayout>
      <div className="mb-10">
        <Link 
          href="/admin/leads"
          className="text-gray-500 hover:text-blue-600 flex items-center gap-2 mb-4 font-bold text-sm transition-colors"
        >
          <ArrowLeft size={16} />
          Voltar para Leads
        </Link>
        <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Novo Lead</h1>
        <p className="text-gray-500 font-medium">Cadastre leads seguindo o padrão da planilha de corretores.</p>
      </div>

      <div className="max-w-5xl">
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-2xl flex items-center gap-3 text-red-600 text-sm font-medium">
            <AlertCircle size={18} /> {error}
          </div>
        )}

        {success ? (
          <div className="bg-white p-12 rounded-[2.5rem] border border-green-100 shadow-xl text-center">
            <div className="w-20 h-20 bg-green-100 text-green-600 rounded-3xl flex items-center justify-center mx-auto mb-6">
              <CheckCircle2 size={40} />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Lead Cadastrado!</h2>
            <p className="text-gray-500 mb-8 max-w-md mx-auto font-medium">
              O lead foi registrado e já está disponível no painel do corretor.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-8">
            <div className="bg-white p-8 md:p-10 rounded-[2.5rem] border border-gray-100 shadow-sm space-y-8">
              
              {/* Vínculo e Data */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pb-8 border-b border-gray-50">
                <div className="space-y-2 group">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">CORRETOR</label>
                  <div className="relative">
                    <Users className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-blue-500 transition-colors" size={18} />
                    <select 
                      required
                      value={formData.corretor_id}
                      onChange={e => setFormData({...formData, corretor_id: e.target.value, operadora: ''})}
                      className="w-full bg-slate-50 border-none rounded-2xl py-4 pl-12 pr-4 focus:ring-2 focus:ring-blue-500 transition-all font-bold appearance-none"
                    >
                      <option value="">Selecione um corretor...</option>
                      {corretores.map(c => (
                        <option key={c.id} value={c.id}>{c.nome}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="space-y-2 group">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">DATA</label>
                  <div className="relative">
                    <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-blue-500 transition-colors" size={18} />
                    <input 
                      type="date" required
                      value={formData.data_entrada}
                      onChange={e => setFormData({...formData, data_entrada: e.target.value})}
                      className="w-full bg-slate-50 border-none rounded-2xl py-4 pl-12 pr-4 focus:ring-2 focus:ring-blue-500 transition-all font-bold"
                    />
                  </div>
                </div>
              </div>

              {/* Dados Pessoais */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                <div className="space-y-2 group">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">NOME</label>
                  <div className="relative">
                    <User className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                    <input 
                      type="text" required
                      value={formData.nome}
                      onChange={e => setFormData({...formData, nome: e.target.value})}
                      placeholder="Nome completo do lead"
                      className="w-full bg-slate-50 border-none rounded-2xl py-4 pl-12 pr-4 focus:ring-2 focus:ring-blue-500 transition-all font-medium"
                    />
                  </div>
                </div>
                <div className="space-y-2 group">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">OPERADORA</label>
                  <div className="relative">
                    <Briefcase className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                    <select
                      value={formData.operadora}
                      onChange={e => setFormData({...formData, operadora: e.target.value})}
                      className="w-full bg-slate-50 border-none rounded-2xl py-4 pl-12 pr-4 focus:ring-2 focus:ring-blue-500 transition-all font-bold appearance-none"
                    >
                      <option value="">Não informada</option>
                      {operadorasDoCorretor.map((operadora) => (
                        <option key={operadora} value={operadora}>{operadora}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="space-y-2 group">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">TELEFONE</label>
                  <div className="relative">
                    <Smartphone className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                    <input 
                      type="text" required
                      value={formData.telefone}
                      onChange={e => setFormData({...formData, telefone: e.target.value})}
                      placeholder="(00) 00000-0000"
                      className="w-full bg-slate-50 border-none rounded-2xl py-4 pl-12 pr-4 focus:ring-2 focus:ring-blue-500 transition-all font-medium"
                    />
                  </div>
                </div>
              </div>

              {/* Perfil do Lead */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                <div className="space-y-2 group">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">IDADES</label>
                  <div className="relative">
                    <Users className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                    <input 
                      type="text"
                      value={formData.idades}
                      onChange={e => setFormData({...formData, idades: e.target.value})}
                      placeholder="Ex: 32, 28, 5"
                      className="w-full bg-slate-50 border-none rounded-2xl py-4 pl-12 pr-4 focus:ring-2 focus:ring-blue-500 transition-all font-medium"
                    />
                  </div>
                </div>
                <div className="space-y-2 group">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">POSSUI CNPJ</label>
                  <div className="relative">
                    <Building2 className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                    <select 
                      value={formData.possui_cnpj}
                      onChange={e => setFormData({...formData, possui_cnpj: e.target.value})}
                      className="w-full bg-slate-50 border-none rounded-2xl py-4 pl-12 pr-4 focus:ring-2 focus:ring-blue-500 transition-all font-medium appearance-none"
                    >
                      <option value="Sim">Sim</option>
                      <option value="Não">Não</option>
                      <option value="Não informado">Não informado</option>
                    </select>
                  </div>
                </div>
                <div className="space-y-2 group">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">TEM PLANO ATIVO?</label>
                  <div className="relative">
                    <FileText className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                    <select 
                      value={formData.tem_plano_ativo}
                      onChange={e => setFormData({...formData, tem_plano_ativo: e.target.value})}
                      className="w-full bg-slate-50 border-none rounded-2xl py-4 pl-12 pr-4 focus:ring-2 focus:ring-blue-500 transition-all font-medium appearance-none"
                    >
                      <option value="Sim">Sim</option>
                      <option value="Não">Não</option>
                      <option value="Não informado">Não informado</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Informações Complementares */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                <div className="space-y-2 group">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">PLANO ATUAL</label>
                  <div className="relative">
                    <Briefcase className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                    <input 
                      type="text"
                      value={formData.plano_atual}
                      onChange={e => setFormData({...formData, plano_atual: e.target.value})}
                      placeholder="Qual plano o lead tem hoje?"
                      className="w-full bg-slate-50 border-none rounded-2xl py-4 pl-12 pr-4 focus:ring-2 focus:ring-blue-500 transition-all font-medium"
                    />
                  </div>
                </div>
                <div className="space-y-2 group">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">CUSTO DO PLANO ATUAL</label>
                  <div className="relative">
                    <Tag className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                    <input
                      type="text"
                      value={formData.custo_plano_atual}
                      onChange={e => setFormData({...formData, custo_plano_atual: e.target.value})}
                      placeholder="Quanto paga hoje?"
                      className="w-full bg-slate-50 border-none rounded-2xl py-4 pl-12 pr-4 focus:ring-2 focus:ring-blue-500 transition-all font-medium"
                    />
                  </div>
                </div>
                <div className="space-y-2 group">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">INVESTIMENTO PRETENDIDO</label>
                  <div className="relative">
                    <Tag className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                    <input 
                      type="text"
                      value={formData.investimento}
                      onChange={e => setFormData({...formData, investimento: e.target.value})}
                      placeholder="Quanto pretende investir?"
                      className="w-full bg-slate-50 border-none rounded-2xl py-4 pl-12 pr-4 focus:ring-2 focus:ring-blue-500 transition-all font-medium"
                    />
                  </div>
                </div>
              </div>

              {/* Localização e Status */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-2 group">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">CIDADE</label>
                  <div className="relative">
                    <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                    <input 
                      type="text"
                      value={formData.cidade}
                      onChange={e => setFormData({...formData, cidade: e.target.value})}
                      placeholder="Cidade do lead"
                      className="w-full bg-slate-50 border-none rounded-2xl py-4 pl-12 pr-4 focus:ring-2 focus:ring-blue-500 transition-all font-medium"
                    />
                  </div>
                </div>
                <div className="space-y-2 group">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">STATUS</label>
                  <div className="relative">
                    <Briefcase className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                    <select 
                      required
                      value={formData.status}
                      onChange={e => setFormData({...formData, status: e.target.value as LeadStatus})}
                      className="w-full bg-slate-50 border-none rounded-2xl py-4 pl-12 pr-4 focus:ring-2 focus:ring-blue-500 transition-all font-bold appearance-none"
                    >
                      {statusOptions.map(opt => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div className="flex justify-end pt-4">
                <button
                  type="submit"
                  disabled={loading}
                  className="bg-blue-600 text-white px-10 py-5 rounded-2xl font-black text-lg hover:bg-blue-700 transition-all shadow-xl shadow-blue-600/20 disabled:opacity-50 flex items-center gap-3"
                >
                  {loading ? <Loader2 className="animate-spin" size={24} /> : <><Save size={24} /> Salvar Lead</>}
                </button>
              </div>
              <p className="text-right text-xs font-bold text-slate-400">Ao salvar, o lead aparece automaticamente no CRM do corretor.</p>
            </div>
          </form>
        )}
      </div>
    </InternalLayout>
  );
}
