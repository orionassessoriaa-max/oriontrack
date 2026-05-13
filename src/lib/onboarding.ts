import { Corretor } from '@/types';

export const OPERADORAS_ONBOARDING = [
  'Amil',
  'SulAmérica',
  'Porto',
  'MedSenior',
  'Hapvida',
  'Alice',
  'Bradesco'
];

export function getOnboardingStatus(corretor: Pick<Corretor, 'onboarding_status' | 'campanhas_ativas'>) {
  if (corretor.campanhas_ativas || corretor.onboarding_status === 'campanhas_ativas') {
    return {
      label: 'Campanhas ativas',
      className: 'bg-emerald-50 text-emerald-700 border-emerald-100',
      dot: 'bg-emerald-600'
    };
  }

  if (corretor.onboarding_status === 'dados_completos') {
    return {
      label: 'Dados completos',
      className: 'bg-orange-50 text-orange-700 border-orange-100',
      dot: 'bg-orange-500'
    };
  }

  return {
    label: 'Entrada pendente',
    className: 'bg-slate-50 text-slate-600 border-slate-200',
    dot: 'bg-slate-400'
  };
}
