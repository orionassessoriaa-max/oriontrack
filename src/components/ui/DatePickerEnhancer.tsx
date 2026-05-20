'use client';

import { useEffect } from 'react';

const DATE_INPUT_TYPES = new Set(['date', 'datetime-local', 'month', 'time', 'week']);

function openPicker(target: EventTarget | null) {
  if (!(target instanceof HTMLInputElement)) return;
  if (!DATE_INPUT_TYPES.has(target.type)) return;
  if (target.disabled || target.readOnly) return;

  try {
    target.showPicker?.();
  } catch {
    // Some browsers only allow showPicker during direct user interaction.
  }
}

export default function DatePickerEnhancer() {
  useEffect(() => {
    const handleOpenPicker = (event: Event) => openPicker(event.target);

    document.addEventListener('click', handleOpenPicker, true);
    document.addEventListener('focusin', handleOpenPicker, true);

    return () => {
      document.removeEventListener('click', handleOpenPicker, true);
      document.removeEventListener('focusin', handleOpenPicker, true);
    };
  }, []);

  return null;
}
