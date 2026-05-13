'use client';

import { useState, useEffect } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import { 
  BarChart3, 
  TrendingUp, 
  Users, 
  DollarSign, 
  Copy, 
  Save, 
  Loader2, 
  Check, 
  FileText,
  Eye,
  ShieldAlert,
  RefreshCw
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/components/providers/AuthProvider';
import { format } from 'date-fns';

type ReportCorretor = {
  id: string;
  nome: string;
};

interface TrafficReport {
  id: string;
  corretor_id: string;
  gestor_id: string;
  data_inicio: string;
  data_fim: string;
  quantidade_leads: number;
  valor_investido: number;
  cpl: number | null;
  observacoes: string;
  created_at: string;
  corretores: { nome: string };
}

export default function TrafficReportsPage() {
  const { profile } = useAuth();
  const [corretores, setCorretores] = useState<ReportCorretor[]>([]);
  const [reports, setReports] = useState<TrafficReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  // Form State
  const [formData, setFormData] = useState({
    corretor_id: '',
    data_inicio: format(new Date(new Date().setDate(new Date().getDate() - 7)), 'yyyy-MM-dd'),
    data_fim: format(new Date(), 'yyyy-MM-dd'),
    valor_investido: '',
    usar_leads_manuais: false,
    quantidade_leads_manual: ''
  });

  // Preview State
  const [preview, setPreview] = useState<{
    leads: number;
    corretor: ReportCorretor;
    cpl: number | null;
    fonteLeads: 'sistema' | 'manual';
  } | null>(null);

  useEffect(() => {
    fetchData();
  }, [profile?.id, profile?.tipo_usuario]);

  async function fetchData() {
    if (!profile?.id) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const corretoresQuery = supabase
        .from('corretores')
        .select('id, nome')
        .in('status', ['active', 'ativo', 'Ativo'])
        .order('nome', { ascending: true });

      const reportsQuery = supabase
        .from('relatorios_trafego')
        .select('*, corretores(nome)')
        .order('created_at', { ascending: false });

      if (profile.tipo_usuario === 'gestor_trafego') {
        corretoresQuery.eq('gestor_trafego_id', profile.id);
        reportsQuery.eq('gestor_id', profile.id);
      }

      const [{ data: corretoresData, error: errC }, { data: reportsData, error: errR }] = await Promise.all([
        corretoresQuery,
        reportsQuery
      ]);

      if (errC || errR) {
        const supabaseError = errC || errR;
        console.error('Supabase Error:', supabaseError);
        if (supabaseError?.code === '42501' || supabaseError?.message?.toLowerCase().includes('row-level security')) {
          setError("Acesso Negado: Você não tem permissão para visualizar relatórios de tráfego.");
        } else {
          setError("Erro ao carregar dados: " + supabaseError?.message);
        }
        return;
      }

      setCorretores(corretoresData || []);
      setReports((reportsData as TrafficReport[]) || []);
    } catch (err: unknown) {
      console.error('Catch Error:', err);
      setError("Erro inesperado ao carregar dados.");
    } finally {
      setLoading(false);
    }
  }

  const generatePreview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.corretor_id || !formData.valor_investido) return;
    if (!corretores.some((corretor) => corretor.id === formData.corretor_id)) {
      alert('Selecione um corretor vinculado à sua gestão.');
      return;
    }

    const investido = parseFloat(formData.valor_investido);
    if (Number.isNaN(investido) || investido < 0) {
      alert('Informe um valor investido valido.');
      return;
    }

    setGenerating(true);
    try {
      let numLeads = 0;
      let fonteLeads: 'sistema' | 'manual' = 'sistema';

      if (formData.usar_leads_manuais) {
        const leadsManual = Number(formData.quantidade_leads_manual);
        if (formData.quantidade_leads_manual.trim() === '') {
          alert('Informe a quantidade de leads gerados.');
          return;
        }

        if (!Number.isFinite(leadsManual) || leadsManual < 0) {
          alert('Informe uma quantidade de leads valida.');
          return;
        }

        numLeads = Math.floor(leadsManual);
        fonteLeads = 'manual';
      } else {
        const { count, error: supabaseError } = await supabase
          .from('leads')
          .select('*', { count: 'exact', head: true })
          .eq('corretor_id', formData.corretor_id)
          .gte('data_entrada', new Date(formData.data_inicio).toISOString())
          .lte('data_entrada', new Date(formData.data_fim + 'T23:59:59').toISOString());

        if (supabaseError) {
          alert('Erro ao buscar leads: ' + supabaseError.message);
          return;
        }

        numLeads = count || 0;
      }

      const cpl = numLeads > 0 ? investido / numLeads : null;
      const corretor = corretores.find(c => c.id === formData.corretor_id);

      if (!corretor) {
        alert('Corretor não encontrado para este gestor.');
        return;
      }

      setPreview({
        leads: numLeads,
        corretor,
        cpl,
        fonteLeads
      });
    } catch (err) {
      console.error('Error generating preview:', err);
      alert('Erro inesperado ao buscar leads.');
    } finally {
      setGenerating(false);
    }
  };

  const saveReport = async () => {
    if (!preview || !profile) return;
    if (!corretores.some((corretor) => corretor.id === formData.corretor_id)) {
      alert('Selecione um corretor vinculado à sua gestão.');
      return;
    }

    setSaving(true);
    try {
      const { error: supabaseError } = await supabase.from('relatorios_trafego').insert([{
        corretor_id: formData.corretor_id,
        gestor_id: profile.id,
        data_inicio: formData.data_inicio,
        data_fim: formData.data_fim,
        quantidade_leads: preview.leads,
        valor_investido: parseFloat(formData.valor_investido),
        cpl: preview.cpl
      }]);

      if (supabaseError) {
        alert('Erro ao salvar relatório: ' + supabaseError.message);
      } else {
        alert('Relatório salvo com sucesso!');
        fetchData();
        setPreview(null);
      }
    } catch {
      alert('Erro inesperado ao salvar.');
    } finally {
      setSaving(false);
    }
  };

  const copyToClipboard = () => {
    if (!preview) return;
    
    const dataInicioFmt = format(new Date(formData.data_inicio), 'dd/MM/yyyy');
    const dataFimFmt = format(new Date(formData.data_fim), 'dd/MM/yyyy');
    const valorFmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(parseFloat(formData.valor_investido));
    const cplFmt = preview.cpl ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(preview.cpl) : 'Indisponível';

    let text = `📊 *Relatório de Leads - Orion Track*\n\n`;
    text += `Cliente: ${preview.corretor.nome}\n`;
    text += `Período: ${dataInicioFmt} a ${dataFimFmt}\n`;
    text += `Leads Gerados: ${preview.leads}\n`;
    text += `Investimento Meta: ${valorFmt}\n`;
    text += `CPL Médio: ${cplFmt}\n\n`;
    
    const origemLeads = preview.fonteLeads === 'manual' ? 'informados manualmente' : 'registrados no Orion Track';

    if (preview.leads > 0) {
      text += `Resumo: Durante o período, foram ${origemLeads} ${preview.leads} leads para ${preview.corretor.nome}. O investimento informado no Meta Ads foi de ${valorFmt}, resultando em um CPL médio de ${cplFmt}.`;
    } else {
      text += `Resumo: Durante o período, não foram ${origemLeads} leads para ${preview.corretor.nome}. O investimento informado foi de ${valorFmt}, mas o CPL não pôde ser calculado por ausência de leads no período.`;
    }

    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <InternalLayout>
      <div className="mb-10">
        <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Relatórios de Tráfego</h1>
        <p className="text-gray-500 font-medium">Gere relatórios de performance e CPL para os parceiros.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
        {/* Form Column */}
        <div className="lg:col-span-1 space-y-8">
          <div className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm">
            <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center gap-2">
              <BarChart3 size={20} className="text-blue-600" />
              Configurar Relatório
            </h2>
            
            <form onSubmit={generatePreview} className="space-y-6">
              <div className="space-y-2">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">Corretor / Cliente</label>
                <select 
                  required
                  value={formData.corretor_id}
                  onChange={e => setFormData({...formData, corretor_id: e.target.value})}
                  className="w-full bg-slate-50 border-none rounded-2xl py-4 px-6 focus:ring-2 focus:ring-blue-500 transition-all font-bold appearance-none"
                >
                  <option value="">Selecione...</option>
                  {corretores.map(c => (
                    <option key={c.id} value={c.id}>{c.nome}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">Início</label>
                  <input 
                    type="date" 
                    required
                    value={formData.data_inicio}
                    onChange={e => setFormData({...formData, data_inicio: e.target.value})}
                    className="w-full bg-slate-50 border-none rounded-2xl py-4 px-4 focus:ring-2 focus:ring-blue-500 transition-all font-medium text-sm"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">Fim</label>
                  <input 
                    type="date" 
                    required
                    value={formData.data_fim}
                    onChange={e => setFormData({...formData, data_fim: e.target.value})}
                    className="w-full bg-slate-50 border-none rounded-2xl py-4 px-4 focus:ring-2 focus:ring-blue-500 transition-all font-medium text-sm"
                  />
                </div>
              </div>

              <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={formData.usar_leads_manuais}
                    onChange={e => setFormData({
                      ...formData,
                      usar_leads_manuais: e.target.checked,
                      quantidade_leads_manual: e.target.checked ? formData.quantidade_leads_manual : ''
                    })}
                    className="mt-1 h-5 w-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span>
                    <span className="block text-sm font-black text-gray-900">Inserir leads manualmente</span>
                    <span className="mt-1 block text-xs font-medium leading-relaxed text-gray-500">
                      Desmarcado, o relatorio puxa automaticamente os leads registrados para o corretor no periodo.
                    </span>
                  </span>
                </label>

                {formData.usar_leads_manuais && (
                  <div className="mt-4 space-y-2">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">Leads gerados</label>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      required={formData.usar_leads_manuais}
                      value={formData.quantidade_leads_manual}
                      onChange={e => setFormData({...formData, quantidade_leads_manual: e.target.value})}
                      placeholder="0"
                      className="w-full bg-white border-none rounded-2xl py-4 px-6 focus:ring-2 focus:ring-blue-500 transition-all font-bold"
                    />
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">Valor Investido (Meta)</label>
                <div className="relative">
                  <span className="absolute left-6 top-1/2 -translate-y-1/2 text-gray-400 font-bold">R$</span>
                  <input 
                    type="number" 
                    step="0.01"
                    required
                    value={formData.valor_investido}
                    onChange={e => setFormData({...formData, valor_investido: e.target.value})}
                    placeholder="0,00"
                    className="w-full bg-slate-50 border-none rounded-2xl py-4 pl-14 pr-6 focus:ring-2 focus:ring-blue-500 transition-all font-bold"
                  />
                </div>
              </div>

              <button 
                type="submit"
                disabled={generating}
                className="w-full bg-blue-600 text-white py-5 rounded-2xl font-black flex items-center justify-center gap-3 hover:bg-blue-700 transition-all shadow-xl shadow-blue-600/20 disabled:opacity-50"
              >
                {generating ? <Loader2 className="animate-spin" size={24} /> : 'Gerar Prévia'}
              </button>
            </form>
          </div>
        </div>

        {/* Preview Column */}
        <div className="lg:col-span-2">
          {preview ? (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="bg-white p-10 rounded-[2.5rem] border border-gray-100 shadow-xl relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-blue-50 rounded-bl-[100%] -mr-10 -mt-10" />
                
                <h2 className="text-2xl font-bold text-gray-900 mb-8 relative">Prévia do Relatório</h2>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-10 relative">
                  <div className="p-6 bg-slate-50 rounded-[2rem] border border-slate-100">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-2">
                      <Users size={12} /> Leads Gerados
                    </p>
                    <p className="text-3xl font-black text-gray-900">{preview.leads}</p>
                    <span className="mt-3 inline-flex rounded-full bg-white px-3 py-1 text-[10px] font-black uppercase tracking-widest text-slate-400">
                      {preview.fonteLeads === 'manual' ? 'Manual' : 'Sistema'}
                    </span>
                  </div>
                  <div className="p-6 bg-slate-50 rounded-[2rem] border border-slate-100">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-2">
                      <DollarSign size={12} /> Investimento
                    </p>
                    <p className="text-3xl font-black text-gray-900">
                      {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(parseFloat(formData.valor_investido))}
                    </p>
                  </div>
                  <div className="p-6 bg-blue-600 text-white rounded-[2rem] shadow-xl shadow-blue-600/20">
                    <p className="text-[10px] font-black text-blue-200 uppercase tracking-widest mb-2 flex items-center gap-2">
                      <TrendingUp size={12} /> CPL Médio
                    </p>
                    <p className="text-3xl font-black">
                      {preview.cpl ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(preview.cpl) : 'N/A'}
                    </p>
                  </div>
                </div>

                <div className="bg-slate-50 p-6 rounded-2xl border border-dashed border-slate-200 mb-8">
                  <p className="text-sm text-gray-600 leading-relaxed font-medium italic">
                    Durante o período de {format(new Date(formData.data_inicio), 'dd/MM/yyyy')} até {format(new Date(formData.data_fim), 'dd/MM/yyyy')}, 
                    {preview.leads > 0 
                      ? ` foram ${preview.fonteLeads === 'manual' ? 'informados manualmente' : 'registrados no Orion Track'} ${preview.leads} leads para ${preview.corretor.nome}. O investimento informado no Meta Ads foi de ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(parseFloat(formData.valor_investido))}, resultando em um CPL médio de ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(preview.cpl!)}.`
                      : ` não foram ${preview.fonteLeads === 'manual' ? 'informados manualmente' : 'registrados no Orion Track'} leads para ${preview.corretor.nome}. O investimento informado foi de ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(parseFloat(formData.valor_investido))}, mas o CPL não pôde ser calculado por ausência de leads no período.`
                    }
                  </p>
                </div>

                <div className="flex flex-col md:flex-row gap-4">
                  <button 
                    onClick={copyToClipboard}
                    className="flex-1 bg-gray-900 text-white py-5 rounded-2xl font-black flex items-center justify-center gap-3 hover:bg-black transition-all"
                  >
                    {copied ? <Check size={20} className="text-green-400" /> : <Copy size={20} />}
                    {copied ? 'Copiado!' : 'Copiar para WhatsApp'}
                  </button>
                  <button 
                    onClick={saveReport}
                    disabled={saving}
                    className="flex-1 bg-blue-600 text-white py-5 rounded-2xl font-black flex items-center justify-center gap-3 hover:bg-blue-700 transition-all shadow-xl shadow-blue-600/20"
                  >
                    {saving ? <Loader2 className="animate-spin" size={20} /> : <Save size={20} />}
                    Salvar Relatório
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-slate-50 border-2 border-dashed border-slate-200 rounded-[2.5rem] p-20 flex flex-col items-center justify-center text-center opacity-60 h-full min-h-[400px]">
              <div className="w-16 h-16 bg-white rounded-2xl shadow-sm flex items-center justify-center mb-6 text-slate-300">
                <FileText size={32} />
              </div>
              <h3 className="text-xl font-bold text-slate-400">Nenhuma prévia gerada</h3>
              <p className="text-slate-400 text-sm font-medium mt-2">Configure os dados ao lado para gerar o relatório.</p>
            </div>
          )}
        </div>
      </div>

      {/* History Table */}
      <div className="mt-12 space-y-6">
        <h2 className="text-2xl font-bold text-gray-900">Histórico de Relatórios</h2>
        <div className="bg-white rounded-[2.5rem] border border-gray-100 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            {error ? (
              <div className="py-24 text-center">
                <div className="w-16 h-16 bg-red-50 text-red-600 rounded-2xl flex items-center justify-center mx-auto mb-6">
                  <ShieldAlert size={32} />
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-2">Acesso Restrito</h3>
                <p className="text-red-500 font-medium max-w-md mx-auto mb-6">{error}</p>
                <button 
                  onClick={fetchData}
                  className="inline-flex items-center gap-2 text-blue-600 font-black uppercase tracking-widest text-xs hover:underline"
                >
                  <RefreshCw size={14} /> Recarregar
                </button>
              </div>
            ) : (
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-50/50">
                    <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest">Geração</th>
                    <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest">Corretor</th>
                    <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest">Período</th>
                    <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest">Leads</th>
                    <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest">Investimento</th>
                    <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest">CPL</th>
                    <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest text-right">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {loading ? (
                    <tr>
                      <td colSpan={7} className="py-20 text-center"><Loader2 className="animate-spin mx-auto text-blue-600" /></td>
                    </tr>
                  ) : reports.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-gray-400 font-medium">Nenhum relatório salvo ainda.</td>
                    </tr>
                  ) : reports.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-8 py-5 text-sm text-gray-500 font-medium">
                        {format(new Date(r.created_at), 'dd/MM/yyyy')}
                      </td>
                      <td className="px-8 py-5">
                        <p className="font-bold text-gray-900">{r.corretores?.nome || 'N/A'}</p>
                      </td>
                      <td className="px-8 py-5 text-xs text-gray-500 font-medium">
                        {format(new Date(r.data_inicio), 'dd/MM/yyyy')} - {format(new Date(r.data_fim), 'dd/MM/yyyy')}
                      </td>
                      <td className="px-8 py-5 font-bold text-gray-900">{r.quantidade_leads}</td>
                      <td className="px-8 py-5 text-sm text-gray-600 font-medium">
                        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(r.valor_investido)}
                      </td>
                      <td className="px-8 py-5">
                        <span className="bg-blue-50 text-blue-600 px-3 py-1 rounded-full text-xs font-black">
                          {r.cpl ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(r.cpl) : 'N/A'}
                        </span>
                      </td>
                      <td className="px-8 py-5 text-right">
                        <button className="p-2 text-slate-400 hover:text-blue-600 transition-colors">
                          <Eye size={18} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </InternalLayout>
  );
}
