"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CalendarDays, ChevronDown } from "lucide-react";

export type CommercialDatePreset =
  | "todos"
  | "hoje"
  | "ontem"
  | "7dias"
  | "30dias"
  | "mes"
  | "mes_passado"
  | "personalizado";

export type CommercialDateRange = {
  start: string;
  end: string;
};

type Props = {
  preset: CommercialDatePreset;
  start: string;
  end: string;
  allTimeStart?: string;
  allTimeEnd?: string;
  onApply: (preset: CommercialDatePreset, range: CommercialDateRange) => void;
};

const QUICK_RANGES: Array<[CommercialDatePreset, string]> = [
  ["todos", "Todo o período"],
  ["hoje", "Hoje"],
  ["ontem", "Ontem"],
  ["7dias", "Últimos 7 dias"],
  ["30dias", "Últimos 30 dias"],
  ["mes", "Este mês"],
  ["mes_passado", "Mês passado"],
];

function localDateValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getCommercialPresetRange(
  preset: CommercialDatePreset,
): CommercialDateRange {
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
      start: localDateValue(
        new Date(today.getFullYear(), today.getMonth() - 1, 1),
      ),
      end: localDateValue(new Date(today.getFullYear(), today.getMonth(), 0)),
    };
  }

  return preset === "todos"
    ? { start: "", end: "" }
    : { start: localDateValue(start), end: localDateValue(end) };
}

function shortDate(value: string) {
  if (!value) return "";
  return new Date(`${value}T12:00:00`).toLocaleDateString("pt-BR");
}

export default function CommercialDateRangeFilter({
  preset,
  start,
  end,
  allTimeStart = "",
  allTimeEnd = "",
  onApply,
}: Props) {
  const [open, setOpen] = useState(false);
  const [draftPreset, setDraftPreset] =
    useState<CommercialDatePreset>(preset);
  const [draftStart, setDraftStart] = useState(start);
  const [draftEnd, setDraftEnd] = useState(end);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverId = useId();

  useEffect(() => {
    if (!open) return;
    function closeOnOutside(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    }
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  function toggle() {
    if (!open) {
      setDraftPreset(preset);
      setDraftStart(start);
      setDraftEnd(end);
    }
    setOpen((current) => !current);
  }

  function choosePreset(next: CommercialDatePreset) {
    const range = getCommercialPresetRange(next);
    setDraftPreset(next);
    setDraftStart(range.start);
    setDraftEnd(range.end);
    onApply(next, range);
    setOpen(false);
  }

  function applyCustomRange() {
    if (!draftStart || !draftEnd || draftStart > draftEnd) return;
    onApply("personalizado", { start: draftStart, end: draftEnd });
    setOpen(false);
  }

  const selectedLabel =
    QUICK_RANGES.find(([value]) => value === preset)?.[1] ||
    "Período personalizado";
  const displayStart = preset === "todos" ? allTimeStart : start;
  const displayEnd = preset === "todos" ? allTimeEnd : end;
  const periodText =
    displayStart && displayEnd
      ? `${selectedLabel} (${shortDate(displayStart)} a ${shortDate(displayEnd)})`
      : selectedLabel;
  const invalidRange =
    !draftStart || !draftEnd || Boolean(draftStart && draftEnd && draftStart > draftEnd);

  return (
    <div className="kh-period-control" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="kh-period-trigger"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={popoverId}
        aria-haspopup="dialog"
      >
        <CalendarDays size={15} />
        <strong>{periodText}</strong>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div
          className="kh-period-popover"
          id={popoverId}
          role="dialog"
          aria-label="Filtrar por período"
        >
          <div className="kh-period-quick">
            <span>Atalhos rápidos</span>
            {QUICK_RANGES.map(([value, label]) => (
              <button
                type="button"
                key={value}
                className={draftPreset === value ? "active" : ""}
                onClick={() => choosePreset(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="kh-period-custom">
            <span>Período personalizado</span>
            <label>
              Data de início
              <input
                type="date"
                value={draftStart}
                onChange={(event) => {
                  setDraftPreset("personalizado");
                  setDraftStart(event.target.value);
                }}
              />
            </label>
            <label>
              Data de fim
              <input
                type="date"
                value={draftEnd}
                onChange={(event) => {
                  setDraftPreset("personalizado");
                  setDraftEnd(event.target.value);
                }}
              />
            </label>
            {draftStart && draftEnd && draftStart > draftEnd && (
              <span className="kh-period-error">
                A data final deve ser igual ou posterior à inicial.
              </span>
            )}
            <div className="kh-period-footer">
              <button type="button" onClick={() => setOpen(false)}>
                Cancelar
              </button>
              <button
                type="button"
                className="primary"
                disabled={invalidRange}
                onClick={applyCustomRange}
              >
                Aplicar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
