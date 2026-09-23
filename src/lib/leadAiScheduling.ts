function normalizeSchedulingText(text?: string | null) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function isSchedulePrompt(text?: string | null) {
  const normalized = normalizeSchedulingText(text);
  return (
    normalized.includes('ligacao rapida de 15 minutos') ||
    normalized.includes('ligacao de 15 minutos') ||
    normalized.includes('ligacao de 5 minutos') ||
    normalized.includes('ligacao rapida') ||
    normalized.includes('dia e horario') ||
    normalized.includes('dia e hora') ||
    normalized.includes('horario voce esta mais confortavel') ||
    normalized.includes('mais confortavel pra voce') ||
    normalized.includes('mais confortavel para voce') ||
    normalized.includes('disponibilidade para uma ligacao') ||
    normalized.includes('quando fica melhor') ||
    normalized.includes('qual melhor horario') ||
    normalized.includes('melhor horario')
  );
}

export function looksLikeScheduleAnswer(text?: string | null) {
  const normalized = normalizeSchedulingText(text);
  if (!normalized.trim()) return false;

  const hasDay =
    /\b(hoje|amanha|segunda|terca|quarta|quinta|sexta|sabado|domingo)\b/.test(normalized) ||
    /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/.test(normalized);
  const hasTime =
    /\b\d{1,2}\s*h(?:oras?)?\b/.test(normalized) ||
    /\b\d{1,2}:\d{2}\b/.test(normalized) ||
    /\b(?:as|a partir das|depois das|antes das)\s*\d{1,2}\b/.test(normalized) ||
    /\b(manha|tarde|noite)\b/.test(normalized);

  return hasDay && hasTime;
}

export function extractAgendadoValue(summary?: string | null): string | null {
  if (!summary) return null;
  const match = summary.match(/(?:\*?Agendado\*?:?\s*)([^\r\n]+)/i);
  if (!match?.[1]) return null;

  const value = match[1].trim();
  const normalized = normalizeSchedulingText(value);
  return value && !['false', 'nao', 'null', 'no'].includes(normalized) ? value : null;
}

function saoPauloDateParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  return {
    year: Number(parts.find((part) => part.type === 'year')?.value),
    month: Number(parts.find((part) => part.type === 'month')?.value),
    day: Number(parts.find((part) => part.type === 'day')?.value),
  };
}

function saoPauloDateAt(year: number, month: number, day: number, hour: number, minute: number) {
  return new Date(Date.UTC(year, month - 1, day, hour + 3, minute, 0, 0));
}

function addLocalDays(date: { year: number; month: number; day: number }, days: number) {
  const utcNoon = new Date(Date.UTC(date.year, date.month - 1, date.day + days, 12));
  return { year: utcNoon.getUTCFullYear(), month: utcNoon.getUTCMonth() + 1, day: utcNoon.getUTCDate() };
}

export function parseScheduledTextToDate(scheduledText: string, reference = new Date()) {
  const normalized = normalizeSchedulingText(scheduledText).trim();
  const timeMatch =
    normalized.match(/\b(?:as|a partir das|depois das|antes das)\s*(\d{1,2})(?::|h)?\s*(\d{2})?\b/) ||
    normalized.match(/\b(\d{1,2})(?::|h)\s*(\d{2})?\b/);
  if (!timeMatch) return null;

  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2] || '0');
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

  const today = saoPauloDateParts(reference);
  let target = today;
  const dateMatch = normalized.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (dateMatch) {
    const yearText = dateMatch[3];
    target = {
      year: yearText ? Number(yearText.length === 2 ? `20${yearText}` : yearText) : today.year,
      month: Number(dateMatch[2]),
      day: Number(dateMatch[1]),
    };
  } else if (/\bamanha\b/.test(normalized)) {
    target = addLocalDays(today, 1);
  } else if (!/\bhoje\b/.test(normalized)) {
    const weekDays: Record<string, number> = { domingo: 0, segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6 };
    const weekDayKey = Object.keys(weekDays).find((key) => new RegExp(`\\b${key}\\b`).test(normalized));
    if (weekDayKey) {
      const currentWeekDay = saoPauloDateAt(today.year, today.month, today.day, 12, 0).getUTCDay();
      let diff = weekDays[weekDayKey] - currentWeekDay;
      if (diff <= 0) diff += 7;
      target = addLocalDays(today, diff);
    }
  }

  return saoPauloDateAt(target.year, target.month, target.day, hour, minute);
}
