'use client';

import { useState, useEffect } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import { useAuth } from '@/components/providers/AuthProvider';
import { supabase } from '@/lib/supabase/client';
import { Corretor } from '@/types';
import { 
  Globe, 
  ExternalLink, 
  Copy, 
  Check, 
  Loader2, 
  AlertCircle,
  Smartphone,
  Mail,
  Shield
} from 'lucide-react';

export default function MinhaPaginaPage() {
  const { profile } = useAuth();
  const [corretor, setCorretor] = useState<Corretor | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (profile?.corretor_id) {
      fetchCorretor();
    }
  }, [profile]);

  const fetchCorretor = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('corretores')
      .select('*')
      .eq('id', profile?.corretor_id)
      .single();

    if (error) console.error('Error fetching corretor:', error);
    else setCorretor(data);
    setLoading(false);
  };

  const handleCopy = () => {
    if (corretor?.link_pagina) {
      navigator.clipboard.writeText(corretor.link_pagina);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <InternalLayout>
      <div className="mb-10">
        <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Minha Página</h1>
        <p className="text-gray-500 font-medium">Link da sua página de captação de leads cadastrada no sistema.</p>
      </div>

      <div className="max-w-4xl">
        {loading ? (
          <div className="bg-white p-20 rounded-[2.5rem] border border-gray-100 shadow-sm text-center">
            <Loader2 className="animate-spin text-blue-600 mx-auto" size={40} />
          </div>
        ) : corretor ? (
          <div className="space-y-8">
            {/* Link Principal */}
            <div className="bg-white p-10 rounded-[2.5rem] border border-gray-100 shadow-sm">
              <div className="flex items-center gap-4 mb-8">
                <div className="w-14 h-14 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center">
                  <Globe size={28} />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-gray-900">Link da sua Landing Page</h2>
                  <p className="text-sm text-gray-500 font-medium">Use este link em suas campanhas de marketing.</p>
                </div>
              </div>

              {corretor.link_pagina ? (
                <div className="space-y-6">
                  <div className="flex flex-col md:flex-row items-center gap-4 bg-slate-50 p-6 rounded-[2rem] border border-slate-100">
                    <span className="flex-1 font-mono font-bold text-blue-600 text-lg break-all">
                      {corretor.link_pagina}
                    </span>
                    <div className="flex gap-2 w-full md:w-auto">
                      <button 
                        onClick={handleCopy}
                        className="flex-1 md:flex-none bg-white text-gray-700 px-6 py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 hover:bg-gray-50 transition-all border border-gray-200 shadow-sm"
                      >
                        {copied ? <Check size={18} className="text-green-500" /> : <Copy size={18} />}
                        {copied ? 'Copiado!' : 'Copiar Link'}
                      </button>
                      <a 
                        href={corretor.link_pagina} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="flex-1 md:flex-none bg-blue-600 text-white px-6 py-3 rounded-xl text-sm font-black flex items-center justify-center gap-2 hover:bg-blue-700 transition-all shadow-lg shadow-blue-600/20"
                      >
                        Abrir <ExternalLink size={18} />
                      </a>
                    </div>
                  </div>
                  <div className="p-6 bg-blue-50/50 rounded-2xl border border-blue-100 flex gap-4">
                    <AlertCircle className="text-blue-600 shrink-0" size={20} />
                    <p className="text-sm text-blue-700 leading-relaxed font-medium">
                      Este link foi cadastrado manualmente pela administração da Orion. Todos os leads captados através dele serão vinculados automaticamente ao seu painel.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="py-10 text-center">
                  <div className="w-16 h-16 bg-slate-50 text-slate-300 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Globe size={32} />
                  </div>
                  <p className="text-gray-900 font-bold mb-1">Nenhuma página cadastrada ainda.</p>
                  <p className="text-gray-500 text-sm font-medium">Fale com a Orion para vincular sua Landing Page.</p>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="bg-white p-20 rounded-[2.5rem] border border-gray-100 shadow-sm text-center text-gray-500 font-medium">
            Erro ao carregar dados do corretor.
          </div>
        )}
      </div>
    </InternalLayout>
  );
}
