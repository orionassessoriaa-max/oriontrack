'use client';

import { useState, useEffect } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import { 
  Globe, 
  ExternalLink, 
  Copy, 
  Check, 
  Loader2, 
  Edit2, 
  Save, 
  X,
  AlertCircle,
  Users,
  Search,
  CheckCircle2,
  FileText,
  ShieldAlert,
  RefreshCw
} from 'lucide-react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase/client';
import { Corretor } from '@/types';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function AdminPaginasPage() {
  const [corretores, setCorretores] = useState<Corretor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Form State
  const [selectedCorretorId, setSelectedCorretorId] = useState('');
  const [linkPagina, setLinkPagina] = useState('');
  const [observacoes, setObservacoes] = useState('');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    fetchCorretores();
  }, []);

  const fetchCorretores = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: supabaseError } = await supabase
        .from('corretores')
        .select('*')
        .order('nome', { ascending: true });
      
      if (supabaseError) {
        console.error('Supabase Error:', supabaseError);
        if (supabaseError.code === '42501' || supabaseError.message?.toLowerCase().includes('row-level security')) {
          setError("Acesso Negado: Você não tem permissão para gerenciar estas páginas.");
        } else {
          setError("Erro ao carregar dados: " + supabaseError.message);
        }
        return;
      }
      setCorretores(data || []);
    } catch (err: any) {
      console.error('Catch Error:', err);
      setError("Erro inesperado ao carregar corretores.");
    } finally {
      setLoading(false);
    }
  };

  const handleSelectCorretor = (id: string) => {
    setSelectedCorretorId(id);
    const corretor = corretores.find(c => c.id === id);
    if (corretor) {
      setLinkPagina(corretor.link_pagina || '');
      setObservacoes(corretor.observacoes || '');
    } else {
      setLinkPagina('');
      setObservacoes('');
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCorretorId) return;

    setSaving(true);
    try {
      const { error } = await supabase
        .from('corretores')
        .update({ 
          link_pagina: linkPagina,
          observacoes: observacoes 
        })
        .eq('id', selectedCorretorId);

      if (error) {
        console.error('Save Error:', error);
        alert('Erro ao salvar página: ' + error.message);
      } else {
        setSuccessMessage('Página vinculada com sucesso.');
        setTimeout(() => setSuccessMessage(null), 3000);
        
        // Update local state
        setCorretores(corretores.map(c => 
          c.id === selectedCorretorId 
            ? { ...c, link_pagina: linkPagina, observacoes: observacoes } 
            : c
        ));
      }
    } catch (err) {
      alert('Erro inesperado ao salvar.');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (corretor: Corretor) => {
    setSelectedCorretorId(corretor.id);
    setLinkPagina(corretor.link_pagina || '');
    setObservacoes(corretor.observacoes || '');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const filtered = corretores.filter(c => 
    (c.nome?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
    (c.email?.toLowerCase() || '').includes(searchTerm.toLowerCase())
  );

  return (
    <InternalLayout>
      <div className="mb-10">
        <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Gerenciamento de Páginas</h1>
        <p className="text-gray-500 font-medium">Vincule URLs de Landing Pages externas aos perfis dos corretores.</p>
      </div>

      <div className="grid grid-cols-1 gap-10">
        {/* Form Card */}
        <div className="bg-white p-8 md:p-10 rounded-[2.5rem] border border-gray-100 shadow-sm">
          <div className="flex items-center gap-4 mb-8">
            <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center">
              <Globe size={24} />
            </div>
            <h2 className="text-xl font-bold text-gray-900">Vincular Página do Corretor</h2>
          </div>

          <form onSubmit={handleSave} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-2 group">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Selecionar Corretor</label>
                <div className="relative">
                  <Users className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-blue-500 transition-colors" size={18} />
                  <select 
                    required
                    value={selectedCorretorId}
                    onChange={(e) => handleSelectCorretor(e.target.value)}
                    className="w-full bg-slate-50 border-none rounded-2xl py-4 pl-12 pr-4 focus:ring-2 focus:ring-blue-500 transition-all font-bold appearance-none"
                  >
                    <option value="">Selecione um corretor...</option>
                    {corretores.map(c => (
                      <option key={c.id} value={c.id}>{c.nome} ({c.email})</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-2 group">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">URL da Página (LP)</label>
                <div className="relative">
                  <Globe className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-blue-500 transition-colors" size={18} />
                  <input 
                    type="url"
                    value={linkPagina}
                    onChange={(e) => setLinkPagina(e.target.value)}
                    placeholder="https://seudominio.com.br/nome-do-corretor"
                    className="w-full bg-slate-50 border-none rounded-2xl py-4 pl-12 pr-4 focus:ring-2 focus:ring-blue-500 transition-all font-medium"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-2 group">
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Observações (Opcional)</label>
              <div className="relative">
                <FileText className="absolute left-4 top-4 text-gray-400 group-focus-within:text-blue-500 transition-colors" size={18} />
                <textarea 
                  value={observacoes}
                  onChange={(e) => setObservacoes(e.target.value)}
                  placeholder="Notas sobre esta página ou link..."
                  rows={2}
                  className="w-full bg-slate-50 border-none rounded-2xl py-4 pl-12 pr-4 focus:ring-2 focus:ring-blue-500 transition-all font-medium resize-none"
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-4">
              {successMessage ? (
                <div className="flex items-center gap-2 text-green-600 font-bold text-sm animate-in fade-in slide-in-from-left-4">
                  <CheckCircle2 size={18} /> {successMessage}
                </div>
              ) : <div />}
              
              <button
                type="submit"
                disabled={saving || !selectedCorretorId}
                className="bg-blue-600 text-white px-10 py-5 rounded-2xl font-black flex items-center gap-3 hover:bg-blue-700 transition-all shadow-xl shadow-blue-600/20 disabled:opacity-50"
              >
                {saving ? <Loader2 className="animate-spin" size={22} /> : <><Save size={22} /> Salvar Página</>}
              </button>
            </div>
          </form>
        </div>

        {/* Table Card */}
        <div className="bg-white rounded-[2.5rem] border border-gray-100 shadow-sm overflow-hidden">
          <div className="p-8 border-b border-gray-50 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <h2 className="text-xl font-bold text-gray-900">Páginas Cadastradas</h2>
            <div className="relative max-w-sm group w-full">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-blue-500 transition-colors" size={16} />
              <input 
                type="text" 
                placeholder="Buscar corretor..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-slate-50 border-none pl-12 pr-4 py-3 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/10 transition-all font-medium"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            {error ? (
              <div className="py-24 text-center">
                <div className="w-16 h-16 bg-red-50 text-red-600 rounded-2xl flex items-center justify-center mx-auto mb-6">
                  <ShieldAlert size={32} />
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-2">Acesso Restrito</h3>
                <p className="text-red-500 font-medium max-w-md mx-auto mb-6">{error}</p>
                <button 
                  onClick={fetchCorretores}
                  className="inline-flex items-center gap-2 text-blue-600 font-black uppercase tracking-widest text-xs hover:underline"
                >
                  <RefreshCw size={14} /> Recarregar
                </button>
              </div>
            ) : (
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-50/50">
                    <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest">Corretor</th>
                    <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest">Link da Página</th>
                    <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest">Status</th>
                    <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {loading ? (
                    <tr>
                      <td colSpan={4} className="py-20 text-center">
                        <Loader2 className="animate-spin text-blue-600 mx-auto" size={40} />
                      </td>
                    </tr>
                  ) : filtered.map((c) => (
                    <tr key={c.id} className="hover:bg-blue-50/30 transition-colors group">
                      <td className="px-8 py-6">
                        <div>
                          <p className="font-bold text-gray-900 group-hover:text-blue-600 transition-colors">{c.nome}</p>
                          <p className="text-[10px] text-gray-400 font-bold uppercase tracking-tighter">{c.email}</p>
                        </div>
                      </td>
                      <td className="px-8 py-6">
                        {c.link_pagina ? (
                          <div className="flex items-center gap-2 max-w-sm">
                            <Globe size={14} className="text-blue-500 shrink-0" />
                            <span className="text-sm font-medium text-slate-600 truncate">{c.link_pagina}</span>
                          </div>
                        ) : (
                          <span className="text-xs italic text-gray-400 font-medium">Sem página cadastrada</span>
                        )}
                      </td>
                      <td className="px-8 py-6">
                        <span className={cn(
                          "text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full",
                          c.status === 'active' || c.status?.toLowerCase() === 'ativo' ? "bg-green-50 text-green-600" : "bg-red-50 text-red-600"
                        )}>
                          {c.status === 'active' || c.status?.toLowerCase() === 'ativo' ? 'Ativa' : 'Inativa'}
                        </span>
                      </td>
                      <td className="px-8 py-6 text-right">
                        <div className="flex justify-end gap-2">
                          <Link 
                          href={`/admin/corretores/${c.id}/editar`}
                          className="p-2.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600 rounded-xl transition-all"
                          title="Editar Corretor"
                        >
                          <Edit2 size={18} />
                        </Link>
                          {c.link_pagina && (
                            <>
                              <button 
                                onClick={() => handleCopy(c.link_pagina!, c.id)}
                                className="p-2.5 text-slate-400 hover:bg-slate-100 rounded-xl transition-all relative"
                                title="Copiar Link"
                              >
                                {copiedId === c.id ? <Check size={18} className="text-green-500" /> : <Copy size={18} />}
                              </button>
                              <a 
                                href={c.link_pagina} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="p-2.5 text-blue-600 hover:bg-blue-100 rounded-xl transition-all"
                                title="Abrir Página"
                              >
                                <ExternalLink size={18} />
                              </a>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          
          {!loading && !error && filtered.length === 0 && (
            <div className="py-24 text-center">
              <div className="w-16 h-16 bg-slate-50 text-slate-300 rounded-full flex items-center justify-center mx-auto mb-4">
                <AlertCircle size={32} />
              </div>
              <p className="text-slate-400 font-bold uppercase tracking-widest text-[10px]">Nenhuma página encontrada</p>
            </div>
          )}
        </div>
      </div>
    </InternalLayout>
  );
}
