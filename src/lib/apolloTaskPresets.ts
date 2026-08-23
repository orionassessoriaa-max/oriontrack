/**
 * Predefinicoes de tarefa do time Apollo.
 *
 * A demanda repetida sempre tem o mesmo roteiro: criar funil e sempre funil
 * respondido, planilha e n8n. Em vez de digitar isso toda vez, a pessoa escolhe
 * a predefinicao, da o nome e a tarefa nasce com o checklist pronto.
 */
export type ApolloTaskPreset = {
  chave: string;
  rotulo: string;
  /** O titulo final e este prefixo mais o nome digitado. */
  prefixoTitulo: string;
  rotuloCampo: string;
  exemplo: string;
  checklist: string[];
  /** Prazo sugerido, em horas a partir de agora. */
  prazoHoras: number;
};

export const APOLLO_TASK_PRESETS: ApolloTaskPreset[] = [
  {
    chave: 'criar_funil',
    rotulo: 'Criar funil',
    prefixoTitulo: 'Criar funil',
    rotuloCampo: 'Nome do funil',
    exemplo: 'Hapvida PME Brasilia',
    checklist: ['Funil respondido', 'Planilha', 'n8n'],
    prazoHoras: 24,
  },
  {
    chave: 'editar_video',
    rotulo: 'Edicao de video',
    prefixoTitulo: 'Editar video',
    rotuloCampo: 'Nome da demanda',
    exemplo: 'VSL Octavita agosto',
    checklist: ['Corte e roteiro', 'Legenda', 'Entrega do arquivo'],
    prazoHoras: 48,
  },
  {
    chave: 'ajuste_crm',
    rotulo: 'Ajuste CRM',
    prefixoTitulo: 'Ajuste CRM',
    rotuloCampo: 'Nome do ajuste',
    exemplo: 'Kanban nao atualiza sozinho',
    checklist: ['Reproduzir o problema', 'Ajuste feito', 'Testado em producao'],
    prazoHoras: 24,
  },
];

export function encontrarPreset(chave?: string | null) {
  return APOLLO_TASK_PRESETS.find((preset) => preset.chave === chave) || null;
}
