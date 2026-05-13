'use client';

import { useAuth } from '@/components/providers/AuthProvider';
import InternalLayout from '@/components/layout/InternalLayout';
import { User, Mail, Shield, Smartphone, MapPin, Loader2, Save } from 'lucide-react';

export default function ProfilePage() {
  const { profile, loading } = useAuth();

  if (loading) {
    return (
      <InternalLayout>
        <div className="flex justify-center py-20">
          <Loader2 className="animate-spin text-blue-600" size={40} />
        </div>
      </InternalLayout>
    );
  }

  return (
    <InternalLayout>
      <div className="mb-10">
        <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Meu Perfil</h1>
        <p className="text-gray-500 font-medium">Gerencie suas informações pessoais e de acesso.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <div className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm">
            <h3 className="text-lg font-bold text-gray-900 mb-6">Dados Pessoais</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">Nome Completo</label>
                <div className="relative">
                  <User className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                  <input 
                    type="text" 
                    defaultValue={profile?.nome || ''} 
                    className="w-full bg-gray-50 border-none rounded-2xl py-4 pl-12 pr-4 focus:ring-2 focus:ring-blue-500 transition-all font-medium"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">Email de Acesso</label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                  <input 
                    type="email" 
                    defaultValue={profile?.email || ''} 
                    disabled
                    className="w-full bg-gray-100 border-none rounded-2xl py-4 pl-12 pr-4 text-gray-500 font-medium cursor-not-allowed"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">Telefone / WhatsApp</label>
                <div className="relative">
                  <Smartphone className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                  <input 
                    type="text" 
                    placeholder="(00) 00000-0000"
                    className="w-full bg-gray-50 border-none rounded-2xl py-4 pl-12 pr-4 focus:ring-2 focus:ring-blue-500 transition-all font-medium"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">Cargo / Tipo</label>
                <div className="relative">
                  <Shield className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                  <input 
                    type="text" 
                    value={profile?.tipo_usuario === 'admin' ? 'Administrador' : 'Corretor Parceiro'} 
                    disabled
                    className="w-full bg-gray-100 border-none rounded-2xl py-4 pl-12 pr-4 text-gray-500 font-medium cursor-not-allowed"
                  />
                </div>
              </div>
            </div>

            <div className="mt-8 flex justify-end">
              <button className="bg-blue-600 text-white px-8 py-4 rounded-2xl font-bold flex items-center gap-2 hover:bg-blue-700 transition-colors shadow-lg shadow-blue-600/20">
                <Save size={20} />
                Salvar Alterações
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-8">
          <div className="bg-[#0f172a] p-8 rounded-[2.5rem] text-white shadow-xl relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-blue-600/20 rounded-full blur-3xl" />
            <div className="relative z-10">
              <div className="w-20 h-20 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-3xl flex items-center justify-center text-3xl font-black mb-6 shadow-xl">
                {profile?.nome ? profile.nome[0].toUpperCase() : '?'}
              </div>
              <h3 className="text-xl font-bold mb-1">{profile?.nome || 'Usuário'}</h3>
              <p className="text-blue-400 text-xs font-bold uppercase tracking-widest mb-6">
                {profile?.tipo_usuario === 'admin' ? 'Admin Orion' : 'Corretor Parceiro'}
              </p>
              
              <div className="space-y-4">
                <div className="flex items-center gap-3 text-gray-400 text-sm">
                  <MapPin size={16} />
                  <span>São Paulo, SP</span>
                </div>
                <div className="flex items-center gap-3 text-gray-400 text-sm">
                  <Mail size={16} />
                  <span>{profile?.email}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </InternalLayout>
  );
}
