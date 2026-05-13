'use client';

import { useState, useEffect, use } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import { useRouter } from 'next/navigation';
import { 
  User, 
  Mail, 
  Shield, 
  Loader2, 
  Save, 
  ArrowLeft,
  AlertCircle,
  CheckCircle2,
  ShieldCheck
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import Link from 'next/link';

export default function EditarGestorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [formData, setFormData] = useState({
    nome: '',
    email: '',
    status: 'active'
  });

  useEffect(() => {
    fetchGestor();
  }, [id]);

  const fetchGestor = async () => {
    setLoading(true);
    try {
      const { data, error: supabaseError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', id)
        .eq('tipo_usuario', 'gestor_trafego')
        .single();

      if (supabaseError) throw supabaseError;
      if (data) {
        setFormData({
          nome: data.nome || '',
          email: data.email || '',
          status: data.status || 'active'
        });
      }
    } catch (err: any) {
      console.error('Error fetching gestor:', err);
      setError('Gestor não encontrado.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          nome: formData.nome,
          email: formData.email,
          status: formData.status
        })
        .eq('id', id);

      if (updateError) throw updateError;

      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err: any) {
      console.error('Error updating gestor:', err);
      setError(err.message || 'Erro ao atualizar gestor.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <InternalLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="animate-spin text-blue-600" size={40} />
        </div>
      </InternalLayout>
    );
  }

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
        <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Editar Gestor</h1>
        <p className="text-gray-500 font-medium">Atualize os dados e o status do gestor de tráfego.</p>
      </div>

      <div className="max-w-4xl">
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-2xl flex items-center gap-3 text-red-600 text-sm font-medium">
            <AlertCircle size={18} /> {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-8">
          <div className="bg-white p-8 md:p-10 rounded-[2.5rem] border border-gray-100 shadow-sm space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-2 group">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">Nome Completo</label>
                <div className="relative">
                  <User className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-blue-500 transition-colors" size={18} />
                  <input 
                    type="text" 
                    required
                    value={formData.nome}
                    onChange={e => setFormData({...formData, nome: e.target.value})}
                    className="w-full bg-gray-50 border-none rounded-2xl py-4 pl-12 pr-4 focus:ring-2 focus:ring-blue-500 transition-all font-medium"
                  />
                </div>
              </div>

              <div className="space-y-2 group">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">Email</label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-blue-500 transition-colors" size={18} />
                  <input 
                    type="email" 
                    required
                    value={formData.email}
                    onChange={e => setFormData({...formData, email: e.target.value})}
                    className="w-full bg-gray-50 border-none rounded-2xl py-4 pl-12 pr-4 focus:ring-2 focus:ring-blue-500 transition-all font-medium"
                  />
                </div>
              </div>

              <div className="space-y-2 group">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">Status</label>
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

            <div className="flex flex-col md:flex-row items-center justify-between gap-4 pt-4">
              <div className="flex items-center gap-4">
                <Link 
                  href="/admin/gestores"
                  className="bg-white text-gray-500 px-8 py-5 rounded-2xl font-black border border-gray-100 hover:bg-gray-50 transition-all"
                >
                  Cancelar
                </Link>
                {success && (
                  <div className="flex items-center gap-2 text-green-600 font-bold text-sm animate-in fade-in slide-in-from-left-4">
                    <CheckCircle2 size={18} /> Atualizado com sucesso!
                  </div>
                )}
              </div>
              
              <button
                type="submit"
                disabled={saving}
                className="w-full md:w-auto bg-blue-600 text-white px-12 py-5 rounded-2xl font-black flex items-center justify-center gap-3 hover:bg-blue-700 transition-all shadow-xl shadow-blue-600/20 disabled:opacity-50"
              >
                {saving ? <Loader2 className="animate-spin" size={22} /> : <><Save size={22} /> Salvar Alterações</>}
              </button>
            </div>
          </div>
        </form>
      </div>
    </InternalLayout>
  );
}
