export type CommercialDatePreset =
  | "todos"
  | "hoje"
  | "ontem"
  | "7dias"
  | "30dias"
  | "mes"
  | "mes_passado"
  | "personalizado";

export function localDateValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function commercialPresetRange(preset: CommercialDatePreset) {
  const today = new Date();
  const start = new Date(today);
  const end = new Date(today);

  if (preset === "ontem") {
    start.setDate(start.getDate() - 1);
    end.setDate(end.getDate() - 1);
  }
  if (preset === "7dias") start.setDate(start.getDate() - 6);
  if (preset === "30dias") start.setDate(start.getDate() - 29);
  if (preset === "mes") start.setDate(1);
  if (preset === "mes_passado") {
    return {
      start: localDateValue(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
      end: localDateValue(new Date(today.getFullYear(), today.getMonth(), 0)),
    };
  }

  return preset === "todos"
    ? { start: "", end: "" }
    : { start: localDateValue(start), end: localDateValue(end) };
}

export const COMMERCIAL_DATE_PRESET_LABELS: Record<CommercialDatePreset, string> = {
  todos: "Todo o período",
  hoje: "Hoje",
  ontem: "Ontem",
  "7dias": "Últimos 7 dias",
  "30dias": "Últimos 30 dias",
  mes: "Este mês",
  mes_passado: "Mês passado",
  personalizado: "Período personalizado",
};

export function shortCommercialDate(value: string) {
  return value
    ? new Date(`${value}T12:00:00`).toLocaleDateString("pt-BR")
    : "";
}
