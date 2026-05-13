'use client';

import { useState } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import { useRouter } from 'next/navigation';
import { 
  User, 
  Mail, 
  Lock,
  Shield, 
  Loader2, 
  Save, 
  ArrowLeft,
  AlertCircle,
  CheckCircle2,
  Copy,
  ExternalLink,
  ShieldCheck
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import Link from 'next/link';

export default function NovoGestorPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successData, setSuccessData] = useState<any>(null);
  const [copied, setCopied] = useState(false);

  const [formData, setFormData] = useState({
    nome: '',
    email: '',
    senha_provisoria: '',
    status: 'active'
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      const response = await fetch('/api/admin/gestores', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`
        },
        body: JSON.stringify(formData)
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Erro ao cadastrar gestor.');
      }

      setSuccessData(result);
    } catch (err: any) {
      console.error('Error saving gestor:', err);
      setError(err.message || 'Erro inesperado.');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    if (!successData) return;
    const { credentials } = successData;
    const message = `Olá, ${formData.nome}! Seu acesso de GESTOR DE TRÁFEGO ao ORION TRACK foi criado.\n\nLink do Painel: ${credentials.link_login}\nLogin: ${credentials.email}\nSenha provisória: ${credentials.senha_provisoria}\n\nVocê terá acesso à área de conferência de leads e relatórios.`;
    
    navigator.clipboard.writeText(message);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <InternalLayout>
      <div className="mb-10">
        <Link 
          href="/admin/gestores"
          className="text-gray-500 hover:text-blue-600 flex items-center gap-2 mb-4 font-bold text-sm transition-colors"
        >
          <ArrowLeft size={16} />
          Voltar para Lista
        </Link>
        <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Cadastrar Gestor de Tráfego</h1>
        <p className="text-gray-500 font-medium">Crie o acesso para um novo gestor de tráfego e performance.</p>
      </div>

      <div className="max-w-4xl">
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-2xl flex items-center gap-3 text-red-600 text-sm font-medium animate-in fade-in slide-in-from-top-4">
            <AlertCircle size={18} /> {error}
          </div>
        )}

        {successData ? (
          <div className="bg-white p-12 rounded-[2.5rem] border border-green-100 shadow-xl animate-in zoom-in-95 duration-500">
            <div className="text-center mb-10">
              <div className="w-20 h-20 bg-green-100 text-green-600 rounded-3xl flex items-center justify-center mx-auto mb-6">
                <ShieldCheck size={40} />
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Gestor Criado com Sucesso!</h2>
              <p className="text-gray-500 max-w-md mx-auto font-medium">
                O gestor já pode acessar as áreas de tráfego e relatórios.
              </p>
            </div>

            <div className="space-y-6 bg-slate-50 p-8 rounded-[2rem] border border-slate-100 mb-8 text-center">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Email de Acesso</p>
                  <p className="font-bold text-gray-900">{successData.credentials.email}</p>
                </div>
                <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Senha Provisória</p>
                  <p className="font-mono font-bold text-blue-600">{successData.credentials.senha_provisoria}</p>
                </div>
              </div>
            </div>

            <div className="flex flex-col md:flex-row gap-4">
              <button
                onClick={handleCopy}
                className="flex-1 bg-gray-900 text-white py-5 rounded-2xl font-black flex items-center justify-center gap-3 hover:bg-black transition-all shadow-xl"
              >
                {copied ? <CheckCircle2 size={20} /> : <Copy size={20} />}
                {copied ? 'Copiado!' : 'Copiar Convite WhatsApp'}
              </button>
              <button
                onClick={() => setSuccessData(null)}
                className="flex-1 bg-white text-gray-900 border border-gray-200 py-5 rounded-2xl font-black hover:bg-gray-50 transition-all"
              >
                Cadastrar Outro
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-8">
            <div className="bg-white p-8 md:p-10 rounded-[2.5rem] border border-gray-100 shadow-sm space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-2 group">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">Nome do Gestor</label>
                  <div className="relative">
                    <User className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-blue-500 transition-colors" size={18} />
                    <input 
                      type="text" 
                      required
                      value={formData.nome}
                      onChange={e => setFormData({...formData, nome: e.target.value})}
                      placeholder="Ex: Carlos Tráfego"
                      className="w-full bg-gray-50 border-none rounded-2xl py-4 pl-12 pr-4 focus:ring-2 focus:ring-blue-500 transition-all font-medium"
                    />
                  </div>
                </div>

                <div className="space-y-2 group">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">Email de Login</label>
                  <div className="relative">
                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-blue-500 transition-colors" size={18} />
                    <input 
                      type="email" 
                      required
                      value={formData.email}
                      onChange={e => setFormData({...formData, email: e.target.value})}
                      placeholder="gestor@orion.com"
                      className="w-full bg-gray-50 border-none rounded-2xl py-4 pl-12 pr-4 focus:ring-2 focus:ring-blue-500 transition-all font-medium"
                    />
                  </div>
                </div>

                <div className="space-y-2 group">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">Senha Provisória</label>
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
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">Status Inicial</label>
                  <div className="relative">
                    <Shield className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-blue-500 transition-colors" size={18} />
                    <select 
                      value={formData.status}
                      onChange={e => setFormData({...formData, status: e.target.value})}
                      className="w-full bg-slate-50 border-none rounded-2xl py-4 pl-12 pr-4 focus:ring-2 focus:ring-blue-500 transition-all font-bold appearance-none"
                    >
                      <option value="active">Ativo</option>
                      <option value="inactive">Inativo</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="flex justify-end pt-4">
                <button
                  type="submit"
                  disabled={loading}
                  className="bg-blue-600 text-white px-10 py-5 rounded-2xl font-black flex items-center gap-3 hover:bg-blue-700 transition-all shadow-xl shadow-blue-600/20 disabled:opacity-50"
                >
                  {loading ? <Loader2 className="animate-spin" size={22} /> : <><Save size={22} /> Cadastrar Gestor</>}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </InternalLayout>
  );
}
