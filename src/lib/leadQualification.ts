import { Lead, TipoCampanha } from '@/types';

export type LeadQualification = {
  label: string;
  tone: 'good' | 'warning' | 'neutral';
  description: string;
};

function hasCnpj(lead: Lead) {
  return (lead.possui_cnpj || '').trim().toLowerCase() === 'sim';
}

export function getLeadQualification(lead: Lead, tipoCampanha?: TipoCampanha | null): LeadQualification {
  if (tipoCampanha === 'pme') {
    return hasCnpj(lead)
      ? {
          label: 'Dentro do perfil',
          tone: 'good',
          description: 'Lead com CNPJ para campanha PME.',
        }
      : {
          label: 'Fora do perfil',
          tone: 'warning',
          description: 'Campanha PME pede CNPJ. Este lead precisa de atenção antes da abordagem.',
        };
  }

  if (tipoCampanha === 'adesao') {
    return {
      label: 'Perfil adesão',
      tone: 'good',
      description: 'Para adesão, CNPJ não é critério obrigatório.',
    };
  }

  return {
    label: 'Avaliar perfil',
    tone: hasCnpj(lead) ? 'good' : 'neutral',
    description: 'Campanha marcada como ambos. Use os dados do lead para decidir a abordagem.',
  };
}
