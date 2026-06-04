'use client';

import { useState, useEffect } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import { useRouter } from 'next/navigation';
import { 
  User, 
  Mail, 
  Smartphone, 
  Globe, 
  Shield, 
  Loader2, 
  Save, 
  ArrowLeft,
  AlertCircle,
  CheckCircle2,
  Lock,
  FileText,
  Users,
  ShieldCheck
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import Link from 'next/link';
import { Profile, TipoCampanha } from '@/types';
import { buildOperationalTeamMembers, getTeamMemberAvatar, isTrafficManagerMember, ORION_TEAM_MEMBERS, OrionTeamMember } from '@/lib/orionTeam';

const formatarTelefone = (value: string) => {
  if (!value) return '';
  const apenasDigitos = value.replace(/\D/g, '');
  const digitosLimitados = apenasDigitos.slice(0, 11);
  
  if (digitosLimitados.length <= 2) {
    return digitosLimitados.length > 0 ? `(${digitosLimitados}` : '';
  }
  if (digitosLimitados.length <= 7) {
    return `(${digitosLimitados.slice(0, 2)})${digitosLimitados.slice(2)}`;
  }
  return `(${digitosLimitados.slice(0, 2)})${digitosLimitados.slice(2, 7)}-${digitosLimitados.slice(7)}`;
};

export default function NovoCorretorPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [gestoresProfiles, setGestoresProfiles] = useState<Profile[]>([]);
  const [teamMembers, setTeamMembers] = useState<OrionTeamMember[]>(ORION_TEAM_MEMBERS);
  const [brokerageOptions, setBrokerageOptions] = useState<string[]>([]);

  const [formData, setFormData] = useState({
    nome: '',
    email: '',
    telefone: '',
    link_pagina: '',
    status: 'ativo' as 'ativo' | 'inativo',
    tipo_campanha: 'ambos' as TipoCampanha,
    senha_provisoria: '',
    observacoes: '',
    time_operacional: [] as OrionTeamMember[],
    nome_empresa: '',
  });

  async function fetchGestores() {
    try {
      const [gestoresRes, brokeragesRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('*')
          .in('tipo_usuario', ['gestor_trafego', 'designer', 'account_manager', 'admin'])
          .in('status', ['active', 'ativo', 'Ativo']),
        supabase
          .from('corretores')
          .select('nome_empresa')
          .not('nome_empresa', 'is', null)
      ]);

      if (gestoresRes.error) throw gestoresRes.error;
      if (brokeragesRes.error) throw brokeragesRes.error;

      const brokerageNames = new Map<string, string>();
      (brokeragesRes.data || []).forEach((item) => {
        const name = String(item.nome_empresa || '').trim();
        if (name) brokerageNames.set(name.toLowerCase(), name);
      });

      setBrokerageOptions(Array.from(brokerageNames.values()).sort((a, b) => a.localeCompare(b, 'pt-BR')));
      setGestoresProfiles((gestoresRes.data || []).filter((profile) => profile.tipo_usuario === 'gestor_trafego'));
      setTeamMembers(buildOperationalTeamMembers(gestoresRes.data || []));
    } catch (err: unknown) {
      console.error('Erro ao buscar gestores:', err);
    }
  }

  useEffect(() => {
    void Promise.resolve().then(fetchGestores);
  }, []);

  const calcularGestorTrafegoId = (timeOperacional: OrionTeamMember[]) => {
    const gestorSelecionado = timeOperacional.find(isTrafficManagerMember);

    if (!gestorSelecionado) return null;

    if (gestorSelecionado.profile_id) return gestorSelecionado.profile_id;

    const gestorProfile = gestoresProfiles.find((profile) =>
      profile.nome.toLowerCase() === gestorSelecionado.nome.toLowerCase()
    );

    return gestorProfile?.id || null;
  };

  const toggleTeamMember = (member: OrionTeamMember) => {
    let newTime = [...formData.time_operacional];
    const exists = newTime.find(m => m.nome === member.nome);
    
    if (exists) {
      newTime = newTime.filter(m => m.nome !== member.nome);
    } else {
      // Regra de exclusão mútua para gestores
      if (isTrafficManagerMember(member)) {
        newTime = newTime.filter(m => !isTrafficManagerMember(m));
      } else if (member.nome === 'Ewertton') {
        newTime = newTime.filter(m => m.nome !== 'Geovana');
      } else if (member.nome === 'Geovana') {
        newTime = newTime.filter(m => m.nome !== 'Ewertton');
      }
      newTime.push(member);
    }
    
    setFormData({ 
      ...formData, 
      time_operacional: newTime,
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const gestorTrafegoId = calcularGestorTrafegoId(formData.time_operacional);
    const payload = {
      ...formData,
      gestor_trafego_id: gestorTrafegoId
    };

    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session?.access_token) {
        throw new Error("Sessão expirada. Faça login novamente.");
      }

      const response = await fetch('/api/admin/corretores', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify(payload)
      });

      const contentType = response.headers.get("content-type");
      let result = null;

      if (contentType && contentType.includes("application/json")) {
        result = await response.json();
      } else {
        const text = await response.text();
        throw new Error(text || "Resposta inválida da API");
      }

      if (!response.ok) {
        throw new Error(result?.error || 'Erro ao cadastrar corretor.');
      }

      setSuccess(true);
      setTimeout(() => {
        router.push('/admin/corretores');
      }, 1500);
    } catch (err: unknown) {
      console.error('Erro ao cadastrar corretor:', err);
      setError(err instanceof Error ? err.message : 'Erro inesperado ao salvar corretor.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <InternalLayout>
      <div className="mb-10">
        <Link 
          href="/admin/corretores"
          className="text-gray-500 hover:text-blue-600 flex items-center gap-2 mb-4 font-bold text-sm transition-colors"
        >
          <ArrowLeft size={16} /> Voltar para Lista
        </Link>
        <h1 className="text-3xl font-black text-gray-900 tracking-tight">Novo Corretor</h1>
        <p className="text-gray-500 font-medium">Cadastre um novo parceiro e vincule a equipe Orion.</p>
      </div>

      <div className="max-w-4xl">
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-2xl flex items-center gap-3 text-red-600 text-sm font-bold animate-in fade-in slide-in-from-top-4">
            <AlertCircle size={18} /> {error}
          </div>
        )}

        {success && (
          <div className="mb-6 p-6 bg-green-50 border border-green-100 rounded-[2rem] text-green-700 font-black flex items-center gap-4 animate-in zoom-in-95">
            <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
              <CheckCircle2 size={24} />
            </div>
            Corretor salvo com sucesso! Redirecionando...
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-8">
          <div className="bg-white p-8 md:p-10 rounded-[2.5rem] border border-gray-100 shadow-sm space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-2 group">
                <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-1">Nome Completo</label>
                <div className="relative">
                  <User className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-blue-500 transition-colors" size={18} />
                  <input 
                    type="text" 
                    required
                    value={formData.nome}
                    onChange={e => setFormData({...formData, nome: e.target.value})}
                    placeholder="Ex: João Silva"
                    className="w-full bg-gray-50 border-none rounded-2xl py-4 pl-12 pr-4 focus:ring-2 focus:ring-blue-500 transition-all font-medium"
                  />
                </div>
              </div>

              <div className="space-y-2 group">
                <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-1">Nome da Corretora</label>
                <div className="relative">
                  <Globe className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-blue-500 transition-colors" size={18} />
                  <input 
                    type="text" 
                    list="brokerage-options"
                    value={formData.nome_empresa}
                    onChange={e => setFormData({...formData, nome_empresa: e.target.value})}
                    placeholder="Digite ou selecione uma corretora"
                    className="w-full bg-gray-50 border-none rounded-2xl py-4 pl-12 pr-4 focus:ring-2 focus:ring-blue-500 transition-all font-medium"
                  />
                  <datalist id="brokerage-options">
                    {brokerageOptions.map((name) => (
                      <option key={name} value={name} />
                    ))}
                  </datalist>
                </div>
                <p className="text-[10px] font-bold text-gray-400">Selecione uma corretora existente para agrupar socios no mesmo painel.</p>
              </div>

              <div className="space-y-2 group">
                <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-1">Email</label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-blue-500 transition-colors" size={18} />
                  <input 
                    type="email" 
                    required
                    value={formData.email}
                    onChange={e => setFormData({...formData, email: e.target.value})}
                    placeholder="email@corretor.com"
                    className="w-full bg-gray-50 border-none rounded-2xl py-4 pl-12 pr-4 focus:ring-2 focus:ring-blue-500 transition-all font-medium"
                  />
                </div>
              </div>

              <div className="space-y-2 group">
                <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-1">WhatsApp</label>
                <div className="relative">
                  <Smartphone className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-blue-500 transition-colors" size={18} />
                  <input 
                    type="text" 
                    required
                    value={formData.telefone}
                    onChange={e => {
                      const formatted = formatarTelefone(e.target.value);
                      setFormData({...formData, telefone: formatted});
                    }}
                    placeholder="(99)99999-9999"
                    maxLength={14}
                    pattern="\(\d{2}\)\d{5}-\d{4}"
                    title="Formato correto: (99)99999-9999"
                    className="w-full bg-gray-50 border-none rounded-2xl py-4 pl-12 pr-4 focus:ring-2 focus:ring-blue-500 transition-all font-medium"
                  />
                </div>
              </div>

              <div className="space-y-2 group">
                <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-1">Link da Página (LP)</label>
                <div className="relative">
                  <Globe className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-blue-500 transition-colors" size={18} />
                  <input 
                    type="url" 
                    value={formData.link_pagina}
                    onChange={e => setFormData({...formData, link_pagina: e.target.value})}
                    placeholder="https://orion.com.br/parceiro"
                    className="w-full bg-gray-50 border-none rounded-2xl py-4 pl-12 pr-4 focus:ring-2 focus:ring-blue-500 transition-all font-medium"
                  />
                </div>
              </div>

              <div className="space-y-2 group">
                <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-1">Senha Provisória</label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-blue-500 transition-colors" size={18} />
                  <input 
                    type="text" 
                    required
                    value={formData.senha_provisoria}
                    onChange={e => setFormData({...formData, senha_provisoria: e.target.value})}
                    placeholder="Mínimo 6 caracteres"
                    className="w-full bg-gray-50 border-none rounded-2xl py-4 pl-12 pr-4 focus:ring-2 focus:ring-blue-500 transition-all font-medium"
                  />
                </div>
              </div>

              <div className="space-y-2 group">
                <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-1">Status</label>
                <div className="relative">
                  <Shield className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-blue-500 transition-colors" size={18} />
                  <select 
                    value={formData.status}
                    onChange={e => setFormData({...formData, status: e.target.value as 'ativo' | 'inativo'})}
                    className="w-full bg-slate-50 border-none rounded-2xl py-4 pl-12 pr-4 focus:ring-2 focus:ring-blue-500 transition-all font-bold appearance-none cursor-pointer"
                  >
                    <option value="ativo">Ativo</option>
                    <option value="inativo">Inativo</option>
                  </select>
                </div>
              </div>

              <div className="space-y-2 group md:col-span-2">
                <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-1">Tipo de Campanha</label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {[
                    { value: 'pme', label: 'PME', desc: 'CNPJ é critério de fit' },
                    { value: 'adesao', label: 'Individual', desc: 'CNPJ não é obrigatório' },
                    { value: 'ambos', label: 'Ambos', desc: 'Avaliação flexível' },
                  ].map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setFormData({ ...formData, tipo_campanha: option.value as TipoCampanha })}
                      className={`rounded-2xl border p-4 text-left transition-all ${
                        formData.tipo_campanha === option.value
                          ? 'border-blue-600 bg-blue-50 text-blue-700 shadow-sm'
                          : 'border-gray-100 bg-slate-50 text-gray-500 hover:border-blue-200'
                      }`}
                    >
                      <p className="text-sm font-black uppercase tracking-widest">{option.label}</p>
                      <p className="mt-1 text-[10px] font-bold">{option.desc}</p>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Time Operacional Section */}
            <div className="pt-8 border-t border-gray-100">
              <div className="flex items-center gap-2 mb-6">
                <div className="w-8 h-8 bg-blue-50 text-blue-600 rounded-lg flex items-center justify-center">
                  <Users size={18} />
                </div>
                <div>
                  <h3 className="text-sm font-black text-gray-900 uppercase tracking-wider">Time Operacional</h3>
                  <p className="text-[10px] text-gray-400 font-bold">Selecione a equipe que acompanha este corretor. O gestor de tráfego selecionado será definido automaticamente como responsável pela conta.</p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                {teamMembers.map((member) => {
                  const isSelected = formData.time_operacional.some(m => m.nome === member.nome);
                  const isGestor = isTrafficManagerMember(member);
                  const foto = getTeamMemberAvatar(member);
                  
                  return (
                    <button
                      key={member.profile_id || member.nome}
                      type="button"
                      onClick={() => toggleTeamMember(member)}
                      className={`flex items-center gap-4 p-5 rounded-[2rem] border transition-all text-left group relative ${
                        isSelected 
                          ? 'bg-blue-600 border-blue-600 text-white shadow-xl shadow-blue-600/20 scale-[1.02]' 
                          : 'bg-white border-gray-100 hover:border-blue-200 hover:bg-slate-50'
                      }`}
                    >
                      <div className={`w-12 h-12 rounded-2xl overflow-hidden flex items-center justify-center font-black text-sm transition-all ${
                        isSelected ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-400 group-hover:bg-blue-100 group-hover:text-blue-600'
                      }`}>
                        {foto ? (
                          <img src={foto} alt={member.nome} className="h-full w-full object-cover object-top" />
                        ) : (
                          member.nome[0]
                        )}
                      </div>
                      <div className="flex-1 overflow-hidden">
                        <div className="flex items-center gap-1.5">
                          <p className={`text-sm font-black leading-tight truncate ${isSelected ? 'text-white' : 'text-gray-900'}`}>{member.nome}</p>
                          {isSelected && isGestor && <ShieldCheck size={14} className="text-blue-100 shrink-0" />}
                        </div>
                        <p className={`text-[10px] font-bold leading-tight mt-0.5 ${isSelected ? 'text-blue-100' : 'text-gray-400'}`}>{member.cargo}</p>
                        
                        {isSelected && isGestor && (
                          <p className="text-[8px] font-black uppercase tracking-widest mt-2 text-blue-200 animate-in fade-in">Responsável pelo tráfego</p>
                        )}
                        {!isSelected && isGestor && (
                          <p className="text-[8px] font-black uppercase tracking-widest mt-2 text-gray-300">Gestor de tráfego</p>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2 group">
              <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-1">Observações (Interno)</label>
              <div className="relative">
                <FileText className="absolute left-4 top-4 text-gray-400 group-focus-within:text-blue-500 transition-colors" size={18} />
                <textarea 
                  value={formData.observacoes}
                  onChange={e => setFormData({...formData, observacoes: e.target.value})}
                  placeholder="Notas internas..."
                  rows={3}
                  className="w-full bg-gray-50 border-none rounded-2xl py-4 pl-12 pr-4 focus:ring-2 focus:ring-blue-500 transition-all font-medium resize-none"
                />
              </div>
            </div>

            <div className="flex justify-end pt-4">
              <button
                type="submit"
                disabled={loading || success}
                className="bg-blue-600 text-white px-12 py-5 rounded-2xl font-black flex items-center gap-3 hover:bg-blue-700 transition-all shadow-xl shadow-blue-600/20 disabled:opacity-50"
              >
                {loading ? <Loader2 className="animate-spin" size={22} /> : <><Save size={22} /> Salvar Corretor</>}
              </button>
            </div>
          </div>
        </form>
      </div>
    </InternalLayout>
  );
}
