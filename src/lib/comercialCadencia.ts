/**
 * Regra unica de leitura das etapas de cadencia.
 *
 * As etapas foram renomeadas para "DIA 1º", "Dia 2º" ... "DIA 10º", e o
 * reconhecimento anterior so aceitava "dia 1". Com o ordinal no fim nenhuma
 * etapa casava, entao a cadencia ficava inativa: sumiam o checklist, o rotulo
 * no card e o alerta de atraso, com 90 leads parados nessas etapas.
 *
 * Aceita as formas que aparecem na operacao e as que costumam aparecer quando
 * alguem renomeia: "dia 1", "dia 1o", "dia 1º", "dia 01", "1º dia", "1o dia".
 */
export function cadenceDayFromStage(value: unknown): number | null {
  const normalized = String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();

  const posfixado = normalized.match(/^dia\s*0?(10|[1-9])\s*[ºo°]?$/);
  if (posfixado) return Number(posfixado[1]);

  const prefixado = normalized.match(/^0?(10|[1-9])\s*[ºo°]?\s*dia$/);
  if (prefixado) return Number(prefixado[1]);

  return null;
}

export function isContactCadenceStage(value: unknown) {
  return cadenceDayFromStage(value) !== null;
}
