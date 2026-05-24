'use client';

import { useState, useEffect } from 'react';
import InternalLayout from '@/components/layout/InternalLayout';
import { StatCard } from '@/components/ui/Stats';
import { 
  Users, 
  Target, 
  Clock, 
  TrendingUp, 
  ArrowRight,
  UserPlus,
  Loader2,
  Calendar,
  Search,
  Globe,
  BarChart3,
  HelpCircle,
  FileSearch,
  CheckCircle2,
  ChevronRight,
  UserCog,
  LayoutDashboard
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { Lead, Corretor, Profile } from '@/types';
import Link from 'next/link';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

function normalizeText(value?: string | null) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function inferGestorIdFromTeam(corretor: any, gestores: Array<{ id: string; nome: string }>) {
  if (corretor.gestor_trafego_id) return corretor.gestor_trafego_id;

  const team = Array.isArray(corretor.time_operacional) ? corretor.time_operacional : [];
  const managerMember = team.find((member: any) => {
    const role = normalizeText(member?.tipo_usuario);
    const cargo = normalizeText(member?.cargo);
    const nome = normalizeText(member?.nome);
    return role === 'gestor_trafego' || cargo.includes('trafego') || gestores.some((gestor) => normalizeText(gestor.nome) === nome);
  });

  if (!managerMember) return null;
  if (managerMember.profile_id) return String(managerMember.profile_id);

  const memberName = normalizeText(managerMember.nome);
  return gestores.find((gestor) => normalizeText(gestor.nome) === memberName)?.id || null;
}

export default function AdminCentralPage() {
  const [stats, setStats] = useState({
    totalCorretores: 0,
    totalGestores: 0,
    totalAccounts: 0,
    totalDesigners: 0,
    suportePendente: 0
  });
  const [gestoresStats, setGestoresStats] = useState<any[]>([]);
  const [corretoresSemGestor, setCorretoresSemGestor] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    setLoading(true);
    try {
      // 1. Total Corretores
      const { count: countCorretores } = await supabase
        .from('corretores')
        .select('*', { count: 'exact', head: true })
        .in('status', ['active', 'ativo', 'Ativo']);

      const { count: countGestores } = await supabase
        .from('profiles')
        .select('*', { count: 'exact', head: true })
        .eq('tipo_usuario', 'gestor_trafego')
        .in('status', ['active', 'ativo', 'Ativo']);

      const { count: countAccounts } = await supabase
        .from('profiles')
        .select('*', { count: 'exact', head: true })
        .eq('tipo_usuario', 'account_manager')
        .in('status', ['active', 'ativo', 'Ativo']);

      const { count: countDesigners } = await supabase
        .from('profiles')
        .select('*', { count: 'exact', head: true })
        .eq('tipo_usuario', 'designer')
        .in('status', ['active', 'ativo', 'Ativo']);

      // 4. Suporte Pendente
      const { count: countSuporte } = await supabase
        .from('solicitacoes_suporte')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'nova');

      // 5. Gestores e seus corretores
      const [profilesRes, corretoresRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, nome, email')
          .eq('tipo_usuario', 'gestor_trafego')
          .in('status', ['active', 'ativo', 'Ativo']),
        supabase
          .from('corretores')
          .select('id, gestor_trafego_id, time_operacional')
      ]);

      const gestores = profilesRes.data || [];
      const corretores = (corretoresRes.data || []).map((corretor) => ({
        ...corretor,
        gestor_resolvido_id: inferGestorIdFromTeam(corretor, gestores),
      }));

      const statsPorGestor = gestores.map(g => {
        const count = corretores.filter(c => c.gestor_resolvido_id === g.id).length;
        return { ...g, count };
      });

      const semGestor = corretores.filter(c => !c.gestor_resolvido_id).length;

      setStats({
        totalCorretores: countCorretores || 0,
        totalGestores: countGestores || 0,
        totalAccounts: countAccounts || 0,
        totalDesigners: countDesigners || 0,
        suportePendente: countSuporte || 0
      });
      setGestoresStats(statsPorGestor);
      setCorretoresSemGestor(semGestor);
    } catch (err) {
      console.error('Error fetching admin stats:', err);
    } finally {
      setLoading(false);
    }
  };

  const quickActions = [
    { 
      title: 'Novo Corretor', 
      desc: 'Registrar parceiro e acesso', 
      href: '/admin/corretores/novo', 
      icon: UserPlus, 
      color: 'bg-blue-600', 
      textColor: 'text-white' 
    },
    { 
      title: 'Todos os Leads', 
      desc: 'Auditar e cadastrar leads', 
      href: '/admin/leads', 
      icon: FileSearch, 
      color: 'bg-white', 
      textColor: 'text-gray-900' 
    },
    { 
      title: 'Gerenciar Páginas', 
      desc: 'Vincular links dos corretores', 
      href: '/admin/paginas', 
      icon: Globe, 
      color: 'bg-white', 
      textColor: 'text-gray-900' 
    },
    { 
      title: 'Relatórios', 
      desc: 'Gerar relatório e CPL', 
      href: '/trafego/relatorios', 
      icon: BarChart3, 
      color: 'bg-white', 
      textColor: 'text-gray-900' 
    },
    { 
      title: 'Suporte', 
      desc: 'Acompanhar solicitações', 
      href: '/admin/suporte', 
      icon: HelpCircle, 
      color: 'bg-white', 
      textColor: 'text-gray-900' 
    },
  ];

  return (
    <InternalLayout>
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-12 gap-6">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-4xl font-black text-gray-900 tracking-tight">Painel Orion Track</h1>
            <span className="bg-blue-50 text-blue-600 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border border-blue-100">
              Admin Orion
            </span>
          </div>
          <p className="text-gray-500 font-medium text-lg">Gestão centralizada de corretores, leads e operação.</p>
        </div>
        <div className="bg-white px-6 py-4 rounded-[2rem] border border-gray-100 shadow-sm flex items-center gap-4">
          <div className="w-10 h-10 bg-slate-50 rounded-xl flex items-center justify-center text-slate-400">
            <Calendar size={20} />
          </div>
          <div>
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest leading-none mb-1">Data Atual</p>
            <p className="font-bold text-gray-900 leading-none">
              {format(new Date(), "dd 'de' MMMM", { locale: ptBR })}
            </p>
          </div>
        </div>
      </div>

      {/* Main Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-16">
        <Link href="/admin/corretores">
          <StatCard
            title="Corretores Ativos"
            value={stats.totalCorretores}
            icon={Users}
            color="blue"
            loading={loading}
          />
        </Link>
        <Link href="/admin/gestores">
          <StatCard
            title="Gestores ativos"
            value={stats.totalGestores}
            icon={UserCog}
            color="green"
            loading={loading}
          />
        </Link>
        <Link href="/admin/accounts">
          <StatCard
            title="Accounts ativos"
            value={stats.totalAccounts}
            icon={Users}
            color="purple"
            loading={loading}
          />
        </Link>
        <Link href="/admin/designers">
          <StatCard
            title="Designers ativos"
            value={stats.totalDesigners}
            icon={LayoutDashboard}
            color="blue"
            loading={loading}
          />
        </Link>
      </div>

      {/* Corretores por Gestor Section */}
      <div className="mb-16">
        <div className="flex items-center gap-4 mb-8">
          <h2 className="text-2xl font-black text-gray-900 tracking-tight">Corretores por Gestor</h2>
          <div className="h-px flex-1 bg-gray-100" />
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {loading ? (
             Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-48 bg-white rounded-[2rem] border border-gray-100 animate-pulse" />
            ))
          ) : (
            <>
              {gestoresStats.map((gestor) => (
                <div key={gestor.id} className="bg-white p-6 rounded-[2rem] border border-gray-100 shadow-sm flex flex-col justify-between group hover:shadow-xl hover:border-blue-200 transition-all">
                  <div>
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center font-black text-lg group-hover:bg-blue-600 group-hover:text-white transition-all">
                        {gestor.nome[0]}
                      </div>
                      <div>
                        <h3 className="font-black text-gray-900 leading-tight">{gestor.nome}</h3>
                        <p className="text-[10px] font-medium text-gray-400">{gestor.email}</p>
                      </div>
                    </div>
                    <div className="bg-slate-50 p-4 rounded-xl">
                      <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Corretores Vinculados</p>
                      <p className="text-2xl font-black text-gray-900">{gestor.count}</p>
                    </div>
                  </div>
                  <Link 
                    href={`/admin/corretores?gestor=${gestor.id}`}
                    className="mt-6 w-full py-3 bg-white border border-gray-100 text-gray-900 font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-blue-600 hover:text-white hover:border-blue-600 transition-all flex items-center justify-center gap-2"
                  >
                    Ver corretores <ArrowRight size={14} />
                  </Link>
                </div>
              ))}

              <div className="bg-slate-50 p-6 rounded-[2rem] border border-dashed border-slate-200 flex flex-col justify-between group hover:border-orange-200 transition-all">
                <div>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-12 h-12 bg-white text-slate-400 rounded-2xl flex items-center justify-center font-black text-lg group-hover:bg-orange-500 group-hover:text-white transition-all shadow-sm">
                      ?
                    </div>
                    <div>
                      <h3 className="font-black text-gray-900 leading-tight">Sem gestor definido</h3>
                      <p className="text-[10px] font-medium text-gray-400">Aguardando atribuição</p>
                    </div>
                  </div>
                  <div className="bg-white p-4 rounded-xl border border-white">
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Corretores Livres</p>
                    <p className="text-2xl font-black text-gray-900">{corretoresSemGestor}</p>
                  </div>
                </div>
                <Link 
                  href="/admin/corretores?gestor=sem-gestor"
                  className="mt-6 w-full py-3 bg-white border border-gray-100 text-gray-900 font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-orange-500 hover:text-white hover:border-orange-500 transition-all flex items-center justify-center gap-2"
                >
                  Ver corretores <ArrowRight size={14} />
                </Link>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Quick Actions Section */}
      <div className="space-y-8">
        <div className="flex items-center gap-4">
          <h2 className="text-2xl font-black text-gray-900 tracking-tight">Ações rápidas</h2>
          <div className="h-px flex-1 bg-gray-100" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {quickActions.map((action, idx) => (
            <Link 
              key={idx} 
              href={action.href}
              className={`group p-8 rounded-[2.5rem] border transition-all duration-300 flex flex-col justify-between h-64 ${
                action.color === 'bg-blue-600' 
                  ? 'bg-blue-600 border-blue-600 shadow-xl shadow-blue-600/20 hover:bg-blue-700 hover:scale-[1.02]' 
                  : 'bg-white border-gray-100 shadow-sm hover:shadow-xl hover:border-blue-200 hover:scale-[1.02]'
              }`}
            >
              <div className="flex justify-between items-start">
                <div className={`p-4 rounded-2xl transition-all duration-300 transform group-hover:scale-110 ${
                  action.color === 'bg-blue-600' ? 'bg-white/20 text-white' : 'bg-slate-50 text-blue-600 group-hover:bg-blue-600 group-hover:text-white'
                }`}>
                  <action.icon size={28} />
                </div>
                <ChevronRight size={20} className={action.color === 'bg-blue-600' ? 'text-white/40' : 'text-gray-300 group-hover:text-blue-600'} />
              </div>
              
              <div>
                <h3 className={`text-xl font-black mb-2 ${action.textColor}`}>{action.title}</h3>
                <p className={`text-sm font-medium ${action.color === 'bg-blue-600' ? 'text-blue-100' : 'text-gray-400'}`}>
                  {action.desc}
                </p>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Footer Decoration */}
      <div className="mt-20 pt-10 border-t border-gray-100 flex justify-between items-center opacity-40">
        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Orion Track v2.0</p>
        <div className="flex gap-4">
          <div className="w-2 h-2 rounded-full bg-green-500" />
          <div className="w-2 h-2 rounded-full bg-green-500" />
          <div className="w-2 h-2 rounded-full bg-green-500" />
        </div>
      </div>
    </InternalLayout>
  );
}
