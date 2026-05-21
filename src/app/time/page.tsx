'use client';

import InternalLayout from '@/components/layout/InternalLayout';
import CorretorTeamManager from '@/components/corretor/CorretorTeamManager';

export default function CorretorTimePage() {
  return (
    <InternalLayout>
      <div className="mb-8">
        <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-blue-600">Corretor</p>
        <h1 className="text-3xl font-black tracking-tight text-gray-900">Meu time comercial</h1>
        <p className="mt-1 font-bold text-gray-500">
          Crie integrantes, gere acesso e deixe o Orion distribuir os leads automaticamente.
        </p>
      </div>
      <CorretorTeamManager />
    </InternalLayout>
  );
}
