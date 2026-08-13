"use client";

import { useState } from "react";
import { CalendarDays, ChevronDown, Funnel } from "lucide-react";
import {
  COMMERCIAL_DATE_PRESET_LABELS,
  commercialPresetRange,
  shortCommercialDate,
  type CommercialDatePreset,
} from "@/lib/commercialPeriod";

type Props = {
  preset: CommercialDatePreset;
  start: string;
  end: string;
  onApply: (value: { preset: CommercialDatePreset; start: string; end: string }) => void;
  compact?: boolean;
};

const QUICK_PRESETS: CommercialDatePreset[] = [
  "todos",
  "hoje",
  "ontem",
  "7dias",
  "30dias",
  "mes",
  "mes_passado",
];

export default function CohortPeriodFilter({ preset, start, end, onApply, compact = false }: Props) {
  const [open, setOpen] = useState(false);
  const [draftPreset, setDraftPreset] = useState(preset);
  const [draftStart, setDraftStart] = useState(start);
  const [draftEnd, setDraftEnd] = useState(end);

  function toggle() {
    if (!open) {
      setDraftPreset(preset);
      setDraftStart(start);
      setDraftEnd(end);
    }
    setOpen((current) => !current);
  }

  function choosePreset(next: CommercialDatePreset) {
    setDraftPreset(next);
    if (next !== "personalizado") {
      const range = commercialPresetRange(next);
      setDraftStart(range.start);
      setDraftEnd(range.end);
    }
  }

  const periodText = preset === "todos"
    ? COMMERCIAL_DATE_PRESET_LABELS[preset]
    : `${COMMERCIAL_DATE_PRESET_LABELS[preset]} (${shortCommercialDate(start)} a ${shortCommercialDate(end)})`;
  const invalidRange = Boolean(draftStart && draftEnd && draftStart > draftEnd);

  return (
    <div className={`kh-period-control kh-cohort-filter${compact ? " compact" : ""}`}>
      <button
        type="button"
        className="kh-period-trigger"
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <Funnel size={15} />
        <span><small>Safra por data de entrada</small><strong>{periodText}</strong></span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="kh-period-popover" role="dialog" aria-label="Filtrar safra por data de entrada">
          <div className="kh-period-quick">
            <span>Períodos rápidos</span>
            {QUICK_PRESETS.map((value) => (
              <button
                type="button"
                key={value}
                className={draftPreset === value ? "active" : ""}
                onClick={() => choosePreset(value)}
              >
                {COMMERCIAL_DATE_PRESET_LABELS[value]}
              </button>
            ))}
          </div>
          <div className="kh-period-custom">
            <span><CalendarDays size={13} /> Período personalizado</span>
            <label>
              Data inicial do lead
              <input type="date" value={draftStart} onChange={(event) => { setDraftPreset("personalizado"); setDraftStart(event.target.value); }} />
            </label>
            <label>
              Data final do lead
              <input type="date" value={draftEnd} onChange={(event) => { setDraftPreset("personalizado"); setDraftEnd(event.target.value); }} />
            </label>
            {invalidRange && <small className="kh-period-error">A data final deve ser igual ou posterior à inicial.</small>}
            <div className="kh-period-footer">
              <button type="button" onClick={() => setOpen(false)}>Cancelar</button>
              <button
                type="button"
                className="primary"
                disabled={invalidRange}
                onClick={() => { onApply({ preset: draftPreset, start: draftStart, end: draftEnd }); setOpen(false); }}
              >
                Aplicar safra
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
