'use client';

import InternalLayout from '@/components/layout/InternalLayout';
import CorretorTeamManager from '@/components/corretor/CorretorTeamManager';
import { useAuth } from '@/components/providers/AuthProvider';

export default function CorretorTimePage() {
  const { profile } = useAuth();
  const corretorId = profile?.tipo_usuario === 'corretor' ? profile.corretor_id || undefined : undefined;

  return (
    <InternalLayout>
      <div className="mb-8">
        <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-blue-600">Corretor</p>
        <h1 className="text-3xl font-black tracking-tight text-gray-900">Meu time comercial</h1>
        <p className="mt-1 font-bold text-gray-500">
          Crie integrantes, gere acesso e deixe o Orion distribuir os leads automaticamente.
        </p>
      </div>
      <CorretorTeamManager corretorId={corretorId} />
    </InternalLayout>
  );
}
