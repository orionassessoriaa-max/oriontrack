import { normalizeLeadTextKey } from '@/lib/leadDuplicate';

type LeadSpamInput = {
  nome?: string | null;
  telefone?: string | null;
};

const BLOCKED_LEADS = [
  {
    name: 'joao silva',
    reason: 'known_fake_joao_silva',
  },
] as const;

export function getLeadSpamReason(lead: LeadSpamInput) {
  const name = normalizeLeadTextKey(lead.nome);
  const blocked = BLOCKED_LEADS.find((entry) => (
    name === entry.name
  ));

  return blocked?.reason || null;
}

export function isBlockedLeadSpam(lead: LeadSpamInput) {
  return Boolean(getLeadSpamReason(lead));
}
