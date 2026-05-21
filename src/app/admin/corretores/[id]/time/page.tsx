'use client';

import InternalLayout from '@/components/layout/InternalLayout';
import CorretorTeamManager from '@/components/corretor/CorretorTeamManager';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { use } from 'react';

export default function AdminCorretorTimePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  return (
    <InternalLayout>
      <div className="mb-8">
        <Link href="/admin/corretores" className="mb-4 inline-flex items-center gap-2 text-sm font-black text-slate-500 transition-colors hover:text-blue-600">
          <ArrowLeft size={16} /> Voltar para corretores
        </Link>
        <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-blue-600">Admin</p>
        <h1 className="text-3xl font-black tracking-tight text-gray-900">Time do corretor</h1>
        <p className="mt-1 font-bold text-gray-500">
          Gerencie os integrantes que recebem os leads desse corretor em rodizio automatico.
        </p>
      </div>
      <CorretorTeamManager corretorId={id} />
    </InternalLayout>
  );
}
