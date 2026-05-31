'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/components/providers/AuthProvider';
import InternalLayout from '@/components/layout/InternalLayout';
import { supabase } from '@/lib/supabase/client';
import { User, Mail, Shield, Smartphone, MapPin, Loader2, Save, Moon, Sun, CheckCircle2, AlertCircle } from 'lucide-react';
import { getProfileRoleLabel } from '@/lib/users';

const formatarTelefone = (value: string) => {
  if (!value) return '';
  const apenasDigitos = value.replace(/\D/g, '');
  const digitosLimitados = apenasDigitos.slice(0, 11);
  
  if (digitosLimitados.length <= 2) {
    return digitosLimitados.length > 0 ? `(${digitosLimitados}` : '';
  }
  if (digitosLimitados.length <= 7) {
    return `(${digitosLimitados.slice(0, 2)})${digitosLimitados.slice(2)}`;
  }
  return `(${digitosLimitados.slice(0, 2)})${digitosLimitados.slice(2, 7)}-${digitosLimitados.slice(7)}`;
};

export default function ProfilePage() {
  const { profile, loading, refreshProfile } = useAuth();
  const [tema, setTema] = useState<string>('noturno');
  
  // Estados para dados editáveis
  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  
  // Estados de controle
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    setTema(window.localStorage.getItem('orion:tema_sistema') || 'noturno');
  }, []);

  // Preencher estados editáveis quando o perfil carregar
  useEffect(() => {
    if (profile) {
      setNome(profile.nome || '');
      setTelefone(formatarTelefone(profile.telefone || ''));
    }
  }, [profile]);

  const handleThemeToggle = (newTheme: string) => {
    window.localStorage.setItem('orion:tema_sistema', newTheme);
    setTema(newTheme);
    window.dispatchEvent(new Event('orion:theme_changed'));
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile?.id) return;

    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          nome: nome.trim(),
          telefone: telefone.trim()
        })
        .eq('id', profile.id);

      if (updateError) throw updateError;

      // Recarrega o perfil no AuthProvider
      if (refreshProfile) {
        await refreshProfile();
      }

      setSuccess(true);
      setTimeout(() => setSuccess(false), 4000);
    } catch (err: any) {
      console.error('Erro ao atualizar perfil:', err);
      setError(err.message || 'Ocorreu um erro ao salvar as alterações do seu perfil.');
    } finally {
      setSaving(false);
    }
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
          {/* Card de Dados Pessoais */}
          <form onSubmit={handleSaveProfile} className="border border-gray-100 bg-white p-8 shadow-sm rounded-2xl space-y-6">
            <h3 className="text-lg font-bold text-gray-900 border-b border-gray-100 pb-4">Dados pessoais</h3>
            
            {error && (
              <div className="p-4 bg-red-50 border border-red-100 rounded-2xl flex items-center gap-3 text-red-600 text-xs font-bold animate-in fade-in">
                <AlertCircle size={16} className="shrink-0" />
                <p>{error}</p>
              </div>
            )}

            {success && (
              <div className="p-4 bg-green-50 border border-green-100 rounded-2xl flex items-center gap-3 text-green-700 text-xs font-black animate-in fade-in">
                <CheckCircle2 size={16} className="shrink-0" />
                <p>Perfil atualizado com sucesso!</p>
              </div>
            )}

            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              {/* Nome */}
              <div className="space-y-2">
                <label className="ml-1 text-xs font-bold uppercase tracking-widest text-gray-400">Nome completo</label>
                <div className="relative">
                  <User className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                  <input
                    type="text"
                    required
                    value={nome}
                    onChange={(e) => setNome(e.target.value)}
                    placeholder="Seu nome completo"
                    className="w-full border-none py-4 pl-12 pr-4 font-medium transition-all focus:ring-2 focus:ring-blue-500 rounded-xl bg-gray-50 text-gray-900"
                  />
                </div>
              </div>

              {/* Email */}
              <div className="space-y-2 opacity-80">
                <label className="ml-1 text-xs font-bold uppercase tracking-widest text-gray-400">Email de acesso</label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                  <input
                    type="email"
                    disabled
                    value={profile?.email || ''}
                    className="w-full border-none py-4 pl-12 pr-4 font-medium rounded-xl cursor-not-allowed bg-gray-100 text-gray-500"
                  />
                </div>
              </div>

              {/* WhatsApp */}
              <div className="space-y-2">
                <label className="ml-1 text-xs font-bold uppercase tracking-widest text-gray-400">Telefone / WhatsApp</label>
                <div className="relative">
                  <Smartphone className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                  <input
                    type="text"
                    required
                    value={telefone}
                    onChange={(e) => setTelefone(formatarTelefone(e.target.value))}
                    placeholder="(99)99999-9999"
                    maxLength={14}
                    pattern="\(\d{2}\)\d{5}-\d{4}"
                    title="Formato correto: (99)99999-9999"
                    className="w-full border-none py-4 pl-12 pr-4 font-medium transition-all focus:ring-2 focus:ring-blue-500 rounded-xl bg-gray-50 text-gray-900"
                  />
                </div>
              </div>

              {/* Cargo / Tipo de Acesso */}
              <div className="space-y-2 opacity-80">
                <label className="ml-1 text-xs font-bold uppercase tracking-widest text-gray-400">Cargo / Tipo</label>
                <div className="relative">
                  <Shield className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                  <input
                    type="text"
                    disabled
                    value={getProfileRoleLabel(profile)}
                    className="w-full border-none py-4 pl-12 pr-4 font-medium rounded-xl cursor-not-allowed bg-gray-100 text-gray-500"
                  />
                </div>
              </div>
            </div>

            <div className="mt-8 flex justify-end">
              <button
                type="submit"
                disabled={saving}
                className="flex items-center gap-2 bg-blue-600 px-8 py-4 font-bold text-white shadow-lg shadow-blue-600/20 transition-all hover:bg-blue-700 rounded-xl disabled:opacity-50"
              >
                {saving ? (
                  <Loader2 className="animate-spin" size={20} />
                ) : (
                  <>
                    <Save size={20} />
                    <span>Salvar alterações</span>
                  </>
                )}
              </button>
            </div>
          </form>

          {/* Tema Selection Card */}
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

        {/* Info Sidebar Direita */}
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
                {profile?.telefone && (
                  <div className="flex items-center gap-3 text-sm text-gray-400">
                    <Smartphone size={16} className="text-blue-400 shrink-0" />
                    <span>{formatarTelefone(profile.telefone)}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </InternalLayout>
  );
}
