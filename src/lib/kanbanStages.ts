import { LeadStatus } from '@/types';

export type KanbanStage = {
  id: LeadStatus;
  label: string;
  desc: string;
  saleEquivalent?: boolean;
};

export const DEFAULT_KANBAN_STAGES: KanbanStage[] = [
  { id: 'Aguardando atendimento', label: 'Oportunidade', desc: 'Entrou e precisa de primeiro contato' },
  { id: 'Inicio', label: 'Início', desc: 'Primeira abordagem realizada' },
  { id: 'Contato feito', label: 'Contato feito', desc: 'Em atendimento' },
  { id: 'Cotação enviada', label: 'Cotação enviada', desc: 'Proposta enviada ao lead' },
  { id: 'Em negociação', label: 'Em negociação', desc: 'Acompanhamento comercial ativo' },
  { id: 'Não tive retorno', label: 'Sem retorno', desc: 'Precisa de nova tentativa' },
  { id: 'Venda realizada', label: 'Venda realizada', desc: 'Conversão concluída', saleEquivalent: true },
  { id: 'Sem interesse', label: 'Sem interesse', desc: 'Descartado comercialmente' },
];

function clean(value: unknown, fallback = '') {
  const text = String(value || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
  return text.slice(0, 80) || fallback;
}

export function normalizeKanbanStages(raw: unknown): KanbanStage[] {
  const source = Array.isArray(raw) ? raw : [];

  // A lista configurada manda. Antes as oito etapas padrao eram sempre
  // reinseridas no fim, e por isso nenhuma concessionaria conseguia remover
  // uma delas: apagava na tela e o servidor devolvia. A tela sempre salva a
  // lista inteira, entao lista nao vazia significa configuracao completa.
  const base: unknown[] = source.length ? source : DEFAULT_KANBAN_STAGES;
  const byId = new Map<string, KanbanStage>();

  base.forEach((value) => {
    const item = value as Partial<KanbanStage>;
    const id = clean(item?.id || item?.label);
    if (!id || byId.has(id)) return;
    const defaultStage = DEFAULT_KANBAN_STAGES.find((stage) => stage.id === id);
    byId.set(id, {
      id,
      label: clean(item?.label, defaultStage?.label || id),
      desc: clean(item?.desc, defaultStage?.desc || 'Etapa personalizada do funil'),
      saleEquivalent: id === 'Venda realizada' || Boolean(item?.saleEquivalent),
    });
  });

  const stages = Array.from(byId.values());

  // Rede de seguranca: funil sem nenhuma etapa que conte como venda quebra
  // relatorio, meta e comissao. Se a configuracao nao tiver nenhuma, a etapa
  // padrao volta.
  if (!stages.some((stage) => stage.saleEquivalent)) {
    const padrao = DEFAULT_KANBAN_STAGES.find((stage) => stage.id === 'Venda realizada');
    if (padrao) stages.push({ ...padrao });
  }

  return stages;
}

export function getKanbanStage(stages: KanbanStage[], status?: string | null) {
  return stages.find((stage) => stage.id === status);
}

export function isSaleEquivalentStage(stages: KanbanStage[], status?: string | null) {
  return status === 'Venda realizada' || Boolean(getKanbanStage(stages, status)?.saleEquivalent);
}

export function getKanbanStageLabel(stages: KanbanStage[], status?: string | null) {
  return getKanbanStage(stages, status)?.label || String(status || 'Oportunidade');
}
