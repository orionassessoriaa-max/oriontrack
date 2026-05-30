'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/components/providers/AuthProvider';
import InternalLayout from '@/components/layout/InternalLayout';
import { User, Mail, Shield, Smartphone, MapPin, Loader2, Save, Moon, Sun } from 'lucide-react';
import { getProfileRoleLabel } from '@/lib/users';

export default function ProfilePage() {
  const { profile, loading } = useAuth();
  const [tema, setTema] = useState<string>('noturno');

  useEffect(() => {
    setTema(window.localStorage.getItem('orion:tema_sistema') || 'noturno');
  }, []);

  const handleThemeToggle = (newTheme: string) => {
    window.localStorage.setItem('orion:tema_sistema', newTheme);
    setTema(newTheme);
    window.dispatchEvent(new Event('orion:theme_changed'));
  };

  if (loading) {
    return (
      <InternalLayout>
        <div className="flex justify-center py-20">
          <Loader2 className="animate-spin text-blue-600" size={40} />
        </div>
      </InternalLayout>
    );
  }

  const isDark = tema === 'noturno';

  return (
    <InternalLayout>
      <div className="mb-10">
        <h1 className="text-3xl font-black tracking-tight text-gray-900">Meu Perfil</h1>
        <p className="font-medium text-slate-400">Gerencie suas informações pessoais e dados de acesso.</p>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <div className="space-y-8 lg:col-span-2">
          {/* Personal Data Card */}
          <div className="border border-gray-100 bg-white p-8 shadow-sm rounded-2xl">
            <h3 className="mb-6 text-lg font-bold text-gray-900">Dados pessoais</h3>
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <Field icon={User} label="Nome completo" value={profile?.nome || ''} />
              <Field icon={Mail} label="Email de acesso" value={profile?.email || ''} disabled />
              <Field icon={Smartphone} label="Telefone / WhatsApp" value="" placeholder="(00) 00000-0000" />
              <Field icon={Shield} label="Cargo / tipo" value={getProfileRoleLabel(profile)} disabled />
            </div>

            <div className="mt-8 flex justify-end">
              <button className="flex items-center gap-2 bg-blue-600 px-8 py-4 font-bold text-white shadow-lg shadow-blue-600/20 transition-colors hover:bg-blue-700 rounded-xl">
                <Save size={20} />
                Salvar alterações
              </button>
            </div>
          </div>

          {/* Theme Selection Card */}
          <div className="border border-gray-100 bg-white p-8 shadow-sm rounded-2xl">
            <h3 className="mb-2 text-lg font-bold text-gray-900">Aparência do sistema</h3>
            <p className="mb-6 text-sm text-gray-500 font-semibold">
              Selecione o tema visual de sua preferência para navegar na plataforma Orion Track.
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {/* Tema Noturno */}
              <button
                type="button"
                onClick={() => handleThemeToggle('noturno')}
                className={`flex flex-col items-start p-5 rounded-2xl border text-left transition-all duration-300 relative cursor-pointer outline-none w-full ${
                  isDark
                    ? 'border-cyan-500 bg-cyan-500/5 shadow-[0_0_20px_rgba(6,182,212,0.15)] ring-1 ring-cyan-500/30'
                    : 'border-white/5 bg-[#090e1a] opacity-70 hover:opacity-100'
                }`}
              >
                <div className="flex items-center justify-between w-full mb-3">
                  <div className="p-2 rounded-xl bg-cyan-500/10 text-cyan-400">
                    <Moon size={18} />
                  </div>
                  {isDark && (
                    <span className="text-[9px] font-black uppercase tracking-widest text-cyan-400 px-2 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 leading-none">
                      Ativo
                    </span>
                  )}
                </div>
                <h4 className="font-extrabold text-white text-base leading-tight">Tema Noturno</h4>
                <p className="text-xs text-slate-400 font-semibold mt-2.5 leading-relaxed">
                  Visual escuro premium com contrastes em cores neon e visual futurista.
                </p>
              </button>

              {/* Tema Claro */}
              <button
                type="button"
                onClick={() => handleThemeToggle('claro')}
                className={`flex flex-col items-start p-5 rounded-2xl border text-left transition-all duration-300 relative cursor-pointer outline-none w-full ${
                  !isDark
                    ? 'border-blue-500 bg-blue-500/5 shadow-[0_0_20px_rgba(37,99,235,0.12)] ring-1 ring-blue-500/30'
                    : 'border-slate-200 bg-slate-50 hover:bg-slate-100'
                }`}
              >
                <div className="flex items-center justify-between w-full mb-3">
                  <div className="p-2 rounded-xl bg-blue-600/10 text-blue-600">
                    <Sun size={18} />
                  </div>
                  {!isDark && (
                    <span className="text-[9px] font-black uppercase tracking-widest text-blue-600 px-2 py-0.5 rounded-full bg-blue-600/10 border border-blue-600/20 leading-none">
                      Ativo
                    </span>
                  )}
                </div>
                <h4 className={`font-extrabold text-base leading-tight ${isDark ? 'text-slate-900' : 'text-gray-900'}`}>
                  Tema Claro
                </h4>
                <p className={`text-xs font-semibold mt-2.5 leading-relaxed ${isDark ? 'text-slate-500' : 'text-gray-500'}`}>
                  Design clássico limpo com fundo claro, excelente legibilidade e tons azuis.
                </p>
              </button>
            </div>
          </div>
        </div>

        {/* Right Info Sidebar */}
        <div className="space-y-8">
          <div className="relative overflow-hidden bg-[#0f172a] p-8 text-white shadow-xl rounded-2xl">
            <div className="absolute right-0 top-0 h-32 w-32 bg-blue-600/20 blur-3xl animate-pulse" />
            <div className="relative z-10">
              <div className="mb-6 flex h-20 w-20 items-center justify-center bg-gradient-to-br from-blue-500 to-indigo-600 text-3xl font-black shadow-xl rounded-2xl">
                {profile?.nome ? profile.nome[0].toUpperCase() : '?'}
              </div>
              <h3 className="mb-1 text-xl font-bold">{profile?.nome || 'Usuário'}</h3>
              <p className="mb-6 text-xs font-bold uppercase tracking-widest text-blue-400">{getProfileRoleLabel(profile)}</p>

              <div className="space-y-4">
                <div className="flex items-center gap-3 text-sm text-gray-400">
                  <MapPin size={16} className="text-blue-400 shrink-0" />
                  <span>São Paulo, SP</span>
                </div>
                <div className="flex items-center gap-3 text-sm text-gray-400">
                  <Mail size={16} className="text-blue-400 shrink-0" />
                  <span className="truncate">{profile?.email}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </InternalLayout>
  );
}

function Field({ icon: Icon, label, value, disabled, placeholder }: { icon: any; label: string; value: string; disabled?: boolean; placeholder?: string }) {
  return (
    <div className="space-y-2">
      <label className="ml-1 text-xs font-bold uppercase tracking-widest text-gray-400">{label}</label>
      <div className="relative">
        <Icon className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
        <input
          type="text"
          defaultValue={value}
          disabled={disabled}
          placeholder={placeholder}
          className={`orion-profile-field w-full border-none py-4 pl-12 pr-4 font-medium transition-all focus:ring-2 focus:ring-blue-500 rounded-xl ${disabled ? 'cursor-not-allowed bg-gray-100 text-gray-500' : 'bg-gray-50 text-gray-900'}`}
        />
      </div>
    </div>
  );
}
