'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { 
  CheckCircle2, 
  ArrowRight, 
  ShieldCheck, 
  Zap, 
  Clock, 
  Smartphone,
  Loader2,
  AlertCircle
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { Corretor } from '@/types';
import Link from 'next/link';
import { cn } from '@/lib/utils';

export default function CapturePage() {
  const params = useParams();
  const slug = params.slug as string;
  
  const [corretor, setCorretor] = useState<Corretor | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    nome: '',
    telefone: '',
    cidade: '',
    idades: '',
    possui_cnpj: false,
    tem_plano_ativo: false,
    plano_atual: '',
    investimento: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  useEffect(() => {
    const fetchCorretor = async () => {
      try {
        const { data, error } = await supabase
          .from('corretores')
          .select('*')
          .eq('slug_pagina', slug)
          .in('status', ['active', 'ativo', 'Ativo'])
          .maybeSingle();

        if (error) throw error;
        setCorretor(data);
      } catch (err) {
        console.error('Error fetching corretor page:', err);
      } finally {
        setLoading(false);
      }
    };

    if (slug) fetchCorretor();
  }, [slug]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!corretor) return;
    
    setIsSubmitting(true);
    try {
      const { error } = await supabase
        .from('leads')
        .insert([{
          corretor_id: corretor.id,
          nome: formData.nome,
          telefone: formData.telefone,
          cidade: formData.cidade,
          idades: formData.idades,
          possui_cnpj: formData.possui_cnpj,
          tem_plano_ativo: formData.tem_plano_ativo,
          plano_atual: formData.plano_atual,
          investimento: formData.investimento,
          status: 'aguardando-atendimento',
          data_entrada: new Date().toISOString()
        }]);

      if (error) throw error;
      setIsSuccess(true);
    } catch (err) {
      console.error('Error submitting lead:', err);
      alert('Erro ao enviar dados. Tente novamente.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="animate-spin text-blue-600" size={40} />
      </div>
    );
  }

  if (!corretor) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-center">
        <AlertCircle size={64} className="text-red-500 mb-4" />
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Página não encontrada</h1>
        <p className="text-gray-500 mb-8">Esta página de consultoria pode ter sido removida ou o link está incorreto.</p>
        <Link href="/" className="text-blue-600 font-bold hover:underline">Voltar para o início</Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 py-6 sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-6 flex justify-between items-center">
          <Link href="/" className="block">
            <img 
              src="/brand-logo.png" 
              alt="ORION CORRETORA" 
              className="h-16 w-auto" 
            />
          </Link>
          <div className="hidden md:flex items-center gap-2 text-xs font-bold text-blue-600 uppercase tracking-widest">
            <ShieldCheck size={16} />
            Consultoria Oficial
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-12 md:py-20">
        {isSuccess ? (
          <div className="text-center py-12">
            <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-8">
              <CheckCircle2 size={40} />
            </div>
            <h1 className="text-3xl font-black text-gray-900 mb-4">Solicitação Recebida!</h1>
            <p className="text-xl text-gray-500 mb-10 max-w-lg mx-auto">
              {corretor.nome} já recebeu seus dados e entrará em contato em breve via WhatsApp.
            </p>
            <button 
              onClick={() => window.location.reload()}
              className="text-blue-600 font-bold hover:underline"
            >
              Fazer outra simulação
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-start">
            {/* Info Section */}
            <div className="space-y-10">
              <div>
                <h2 className="text-sm font-black text-blue-600 uppercase tracking-[0.2em] mb-4">Consultor Especialista</h2>
                <h1 className="text-4xl md:text-5xl font-black text-gray-900 leading-tight tracking-tighter">
                  Consultoria com <br />
                  <span className="text-blue-600">{corretor.nome}</span>
                </h1>
                <p className="text-xl text-gray-500 mt-6 leading-relaxed font-medium">
                  Encontre o plano de saúde ou seguro ideal para você, sua família ou sua empresa com quem entende do assunto.
                </p>
              </div>

              <div className="space-y-6">
                {[
                  { icon: Zap, title: 'Simulação Rápida', desc: 'Receba valores em poucos minutos.' },
                  { icon: ShieldCheck, title: 'Consultoria Segura', desc: 'Dados protegidos e análise ética.' },
                  { icon: Clock, title: 'Atendimento Ágil', desc: 'Suporte humanizado e direto.' }
                ].map((item, i) => (
                  <div key={i} className="flex gap-4">
                    <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center shrink-0">
                      <item.icon size={24} />
                    </div>
                    <div>
                      <h4 className="font-bold text-gray-900">{item.title}</h4>
                      <p className="text-sm text-gray-500 font-medium">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Form Section */}
            <div className="bg-slate-50 p-8 md:p-10 rounded-[2.5rem] border border-gray-100 shadow-xl shadow-slate-200/50">
              <div className="mb-8 flex items-center justify-between">
                <span className="text-xs font-black text-slate-400 uppercase tracking-widest">Passo {step} de 2</span>
                <div className="flex gap-1">
                  <div className={cn("h-1.5 w-8 rounded-full transition-all", step >= 1 ? "bg-blue-600" : "bg-slate-200")} />
                  <div className={cn("h-1.5 w-8 rounded-full transition-all", step >= 2 ? "bg-blue-600" : "bg-slate-200")} />
                </div>
              </div>

              <form onSubmit={handleSubmit} className="space-y-6">
                {step === 1 ? (
                  <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-6">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">Seu Nome</label>
                      <input 
                        type="text" 
                        required
                        value={formData.nome}
                        onChange={e => setFormData({...formData, nome: e.target.value})}
                        placeholder="Como podemos te chamar?"
                        className="w-full bg-white border-none rounded-2xl py-5 px-6 focus:ring-2 focus:ring-blue-500 transition-all font-medium shadow-sm"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">Seu WhatsApp</label>
                      <input 
                        type="tel" 
                        required
                        value={formData.telefone}
                        onChange={e => setFormData({...formData, telefone: e.target.value})}
                        placeholder="(00) 00000-0000"
                        className="w-full bg-white border-none rounded-2xl py-5 px-6 focus:ring-2 focus:ring-blue-500 transition-all font-medium shadow-sm"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">Sua Cidade</label>
                      <input 
                        type="text" 
                        required
                        value={formData.cidade}
                        onChange={e => setFormData({...formData, cidade: e.target.value})}
                        placeholder="Onde você mora?"
                        className="w-full bg-white border-none rounded-2xl py-5 px-6 focus:ring-2 focus:ring-blue-500 transition-all font-medium shadow-sm"
                      />
                    </div>
                    <button 
                      type="button"
                      onClick={() => setStep(2)}
                      disabled={!formData.nome || !formData.telefone}
                      className="w-full bg-blue-600 text-white py-5 rounded-2xl font-black text-lg shadow-xl shadow-blue-600/20 hover:bg-blue-700 transition-all flex items-center justify-center gap-3 disabled:opacity-50"
                    >
                      Próximo Passo <ArrowRight size={22} />
                    </button>
                  </motion.div>
                ) : (
                  <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-6">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">Idades das pessoas</label>
                      <input 
                        type="text" 
                        required
                        value={formData.idades}
                        onChange={e => setFormData({...formData, idades: e.target.value})}
                        placeholder="Ex: 32, 28, 5"
                        className="w-full bg-white border-none rounded-2xl py-5 px-6 focus:ring-2 focus:ring-blue-500 transition-all font-medium shadow-sm"
                      />
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4">
                      <button 
                        type="button"
                        onClick={() => setFormData({...formData, possui_cnpj: !formData.possui_cnpj})}
                        className={cn(
                          "py-4 px-4 rounded-2xl font-bold text-sm border-2 transition-all",
                          formData.possui_cnpj ? "bg-blue-600 border-blue-600 text-white shadow-lg" : "bg-white border-slate-100 text-slate-500"
                        )}
                      >
                        Tenho CNPJ
                      </button>
                      <button 
                        type="button"
                        onClick={() => setFormData({...formData, tem_plano_ativo: !formData.tem_plano_ativo})}
                        className={cn(
                          "py-4 px-4 rounded-2xl font-bold text-sm border-2 transition-all",
                          formData.tem_plano_ativo ? "bg-blue-600 border-blue-600 text-white shadow-lg" : "bg-white border-slate-100 text-slate-500"
                        )}
                      >
                        Já tenho plano
                      </button>
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">Pretensão de Investimento</label>
                      <select 
                        required
                        value={formData.investimento}
                        onChange={e => setFormData({...formData, investimento: e.target.value})}
                        className="w-full bg-white border-none rounded-2xl py-5 px-6 focus:ring-2 focus:ring-blue-500 transition-all font-medium shadow-sm appearance-none"
                      >
                        <option value="">Selecione um valor</option>
                        <option value="R$ 200 - R$ 500">R$ 200 - R$ 500</option>
                        <option value="R$ 500 - R$ 1.000">R$ 500 - R$ 1.000</option>
                        <option value="R$ 1.000 - R$ 2.000">R$ 1.000 - R$ 2.000</option>
                        <option value="Acima de R$ 2.000">Acima de R$ 2.000</option>
                      </select>
                    </div>

                    <div className="flex gap-4">
                      <button 
                        type="button"
                        onClick={() => setStep(1)}
                        className="flex-1 bg-slate-200 text-slate-600 py-5 rounded-2xl font-black text-lg hover:bg-slate-300 transition-all"
                      >
                        Voltar
                      </button>
                      <button 
                        type="submit"
                        disabled={isSubmitting || !formData.idades || !formData.investimento}
                        className="flex-[2] bg-green-600 text-white py-5 rounded-2xl font-black text-lg shadow-xl shadow-green-600/20 hover:bg-green-700 transition-all flex items-center justify-center gap-3 disabled:opacity-50"
                      >
                        {isSubmitting ? <Loader2 className="animate-spin" /> : <>Solicitar Cotação <ArrowRight size={22} /></>}
                      </button>
                    </div>
                  </motion.div>
                )}
              </form>
            </div>
          </div>
        )}
      </main>

      <footer className="py-12 border-t border-gray-50 bg-slate-50/50">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">© 2024 Orion Track - Todos os direitos reservados</p>
        </div>
      </footer>
    </div>
  );
}

// Minimal Framer Motion replacement if not available
const motion = {
  div: ({ children, className, initial, animate }: any) => <div className={className}>{children}</div>
};
