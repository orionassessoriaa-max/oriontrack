'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/components/providers/AuthProvider';
import InternalLayout from '@/components/layout/InternalLayout';
import { User, Mail, Shield, Smartphone, MapPin, Loader2, Save, Moon, Sun } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';

function roleLabel(role?: string) {
  if (role === 'admin') return 'Administrador';
  if (role === 'gestor_trafego') return 'Gestor de trafego';
  if (role === 'designer') return 'Designer';
  if (role === 'account_manager') return 'Account manager';
  return 'Corretor parceiro';
}

export default function ProfilePage() {
  const { profile, actualProfile, loading, refreshProfile } = useAuth();
  const [theme, setTheme] = useState<'claro' | 'noturno'>((profile?.tema_sistema as 'claro' | 'noturno') || 'claro');
  const [savingTheme, setSavingTheme] = useState(false);

  useEffect(() => {
    setTheme((profile?.tema_sistema as 'claro' | 'noturno') || 'claro');
  }, [profile?.tema_sistema]);

  const saveTheme = async () => {
    const targetProfileId = actualProfile?.id || profile?.id;
    if (!targetProfileId) return;
    setSavingTheme(true);
    window.localStorage.setItem('orion:tema_sistema', theme);
    window.dispatchEvent(new CustomEvent('orion-theme-change', { detail: theme }));
    const { error } = await supabase.from('profiles').update({ tema_sistema: theme }).eq('id', targetProfileId);
    setSavingTheme(false);
    if (error) {
      alert('Erro ao salvar tema: ' + error.message);
      return;
    }
    await refreshProfile();
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

  return (
    <InternalLayout>
      <div className="mb-10">
        <h1 className="text-3xl font-bold tracking-tight text-gray-900">Meu Perfil</h1>
        <p className="font-medium text-gray-500">Gerencie suas informacoes pessoais, acesso e tema visual.</p>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <div className="space-y-8 lg:col-span-2">
          <div className="border border-gray-100 bg-white p-8 shadow-sm">
            <h3 className="mb-6 text-lg font-bold text-gray-900">Dados pessoais</h3>
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <Field icon={User} label="Nome completo" value={profile?.nome || ''} />
              <Field icon={Mail} label="Email de acesso" value={profile?.email || ''} disabled />
              <Field icon={Smartphone} label="Telefone / WhatsApp" value="" placeholder="(00) 00000-0000" />
              <Field icon={Shield} label="Cargo / tipo" value={roleLabel(profile?.tipo_usuario)} disabled />
            </div>

            <div className="mt-8 flex justify-end">
              <button className="flex items-center gap-2 bg-blue-600 px-8 py-4 font-bold text-white shadow-lg shadow-blue-600/20 transition-colors hover:bg-blue-700">
                <Save size={20} />
                Salvar alteracoes
              </button>
            </div>
          </div>

          <div className="border border-gray-100 bg-white p-8 shadow-sm">
            <h3 className="mb-6 text-lg font-bold text-gray-900">Tema do sistema</h3>
            <div className="grid gap-3 md:grid-cols-2">
              <button
                type="button"
                onClick={() => setTheme('claro')}
                className={`flex items-center gap-3 border p-4 text-left font-black ${theme === 'claro' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white text-slate-600'}`}
              >
                <Sun size={20} /> Claro atual
              </button>
              <button
                type="button"
                onClick={() => setTheme('noturno')}
                className={`flex items-center gap-3 border p-4 text-left font-black ${theme === 'noturno' ? 'border-blue-500 bg-slate-950 text-white' : 'border-slate-200 bg-white text-slate-600'}`}
              >
                <Moon size={20} /> Noturno
              </button>
            </div>
            <button onClick={saveTheme} disabled={savingTheme} className="mt-5 flex items-center gap-2 bg-slate-950 px-5 py-3 text-sm font-black uppercase tracking-widest text-white disabled:opacity-50">
              {savingTheme ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />} Salvar tema
            </button>
          </div>
        </div>

        <div className="space-y-8">
          <div className="relative overflow-hidden bg-[#0f172a] p-8 text-white shadow-xl">
            <div className="absolute right-0 top-0 h-32 w-32 bg-blue-600/20 blur-3xl" />
            <div className="relative z-10">
              <div className="mb-6 flex h-20 w-20 items-center justify-center bg-gradient-to-br from-blue-500 to-indigo-600 text-3xl font-black shadow-xl">
                {profile?.nome ? profile.nome[0].toUpperCase() : '?'}
              </div>
              <h3 className="mb-1 text-xl font-bold">{profile?.nome || 'Usuario'}</h3>
              <p className="mb-6 text-xs font-bold uppercase tracking-widest text-blue-400">{roleLabel(profile?.tipo_usuario)}</p>

              <div className="space-y-4">
                <div className="flex items-center gap-3 text-sm text-gray-400">
                  <MapPin size={16} />
                  <span>Sao Paulo, SP</span>
                </div>
                <div className="flex items-center gap-3 text-sm text-gray-400">
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
          className={`w-full border-none py-4 pl-12 pr-4 font-medium transition-all focus:ring-2 focus:ring-blue-500 ${disabled ? 'cursor-not-allowed bg-gray-100 text-gray-500' : 'bg-gray-50'}`}
        />
      </div>
    </div>
  );
}
