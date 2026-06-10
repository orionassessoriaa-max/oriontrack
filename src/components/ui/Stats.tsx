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
  const colorClasses: Record<string, string> = {
    blue: 'text-blue-600 bg-blue-50',
    green: 'text-green-600 bg-green-50',
    yellow: 'text-yellow-600 bg-yellow-50',
    purple: 'text-purple-600 bg-purple-50',
    indigo: 'text-indigo-600 bg-indigo-50',
    orange: 'text-orange-600 bg-orange-50',
    red: 'text-red-600 bg-red-50',
    cyan: 'text-cyan-600 bg-cyan-50',
  };

  return (
    <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm transition-all hover:shadow-md relative overflow-hidden">
      <div className="flex items-center justify-between mb-4">
        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{title}</p>
        {Icon && (
          <div className={cn("p-2 rounded-lg", colorClasses[color])}>
            <Icon size={18} />
          </div>
        )}
      </div>
      {loading ? (
        <div className="h-8 w-16 bg-slate-100 animate-pulse rounded-lg" />
      ) : (
        <p className="text-2xl font-black text-gray-900">{value}</p>
      )}
    </div>
  );
}
