import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { LeadStatus } from '@/types';
import { Loader2 } from 'lucide-react';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface StatusBadgeProps {
  status: LeadStatus;
}

const statusMap: Record<string, { label: string, className: string }> = {
  'Aguardando atendimento': { label: 'Aguardando atendimento', className: 'bg-blue-100 text-blue-700 border-blue-200' },
  'Inicio': { label: 'Inicio', className: 'bg-cyan-100 text-cyan-700 border-cyan-200' },
  'Contato feito': { label: 'Contato feito', className: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
  'Cotação enviada': { label: 'Cotação enviada', className: 'bg-purple-100 text-purple-700 border-purple-200' },
  'Em negociação': { label: 'Em negociação', className: 'bg-orange-100 text-orange-700 border-orange-200' },
  'Venda realizada': { label: 'Venda realizada', className: 'bg-green-100 text-green-700 border-green-200' },
  'Sem interesse': { label: 'Sem interesse', className: 'bg-gray-100 text-gray-700 border-gray-200' },
};

export function StatusBadge({ status }: StatusBadgeProps) {
  const config = statusMap[status] || { label: status, className: 'bg-gray-100 text-gray-700 border-gray-200' };
  return (
    <span className={cn("px-2.5 py-0.5 rounded-full text-[10px] font-semibold border uppercase tracking-wider", config.className)}>
      {config.label}
    </span>
  );
}

interface StatCardProps {
  title: string;
  value: string | number;
  icon?: React.ElementType;
  color?: string;
  loading?: boolean;
}

export function StatCard({ title, value, icon: Icon, color = 'blue', loading = false }: StatCardProps) {
  // Chip solido: fundo cheio na cor e icone branco. Escolha do dono em
  // 30/09/2026, comparando com fundo palido e com cinza. O tom palido anterior
  // (bg-blue-50 com icone azul) era o que ele chamava de neon.
  const chipClasses: Record<string, string> = {
    blue: 'bg-[#1d4ed8]',
    green: 'bg-[#059669]',
    yellow: 'bg-[#b45309]',
    purple: 'bg-[#6d28d9]',
    indigo: 'bg-[#4338ca]',
    orange: 'bg-[#ea580c]',
    red: 'bg-[#b91c1c]',
    cyan: 'bg-[#0e7490]',
  };

  // Empilhado, e nao lado a lado. Com a coluna do menu ocupando 248px, oito
  // cartoes numa linha ficam com pouco mais de 100px: no layout antigo o rotulo
  // quebrava em tres linhas e o icone montava por cima dele.
  return (
    <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm relative overflow-hidden">
      {Icon && (
        <span className={cn('mb-3 inline-flex h-9 w-9 items-center justify-center rounded-xl text-white', chipClasses[color] || chipClasses.blue)}>
          <Icon size={17} strokeWidth={2} />
        </span>
      )}
      <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider leading-snug">{title}</p>
      {loading ? (
        <div className="mt-1 h-7 w-14 bg-slate-100 rounded-lg" />
      ) : (
        <p className="mt-1 text-2xl font-bold text-gray-900 leading-none">{value}</p>
      )}
    </div>
  );
}
