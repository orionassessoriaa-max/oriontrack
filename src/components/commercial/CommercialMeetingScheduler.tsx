"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlignLeft,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ExternalLink,
  Loader2,
  Mail,
  MapPin,
  Menu,
  Users,
  UserRound,
  Video,
  X,
} from "lucide-react";
import { useCommercial } from "@/components/commercial/CommercialShell";
import type { CommercialLead } from "@/lib/comercial";

type CalendarEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  busy: boolean;
  colorId: string | null;
  description: string | null;
  location: string | null;
  attendees: Array<{ email: string; name: string | null; responseStatus: string | null }>;
  meetLink: string | null;
  calendarLink: string | null;
};

type Props = {
  lead: CommercialLead;
  email: string;
  selectedAt: string;
  error: string | null;
  saving: boolean;
  onEmailChange: (value: string) => void;
  onSelectedAtChange: (value: string) => void;
  onClose: () => void;
  onSubmit: (event: React.FormEvent) => void;
};

const START_HOUR = 7;
const END_HOUR = 20;
const SLOT_MINUTES = 15;
const HOUR_HEIGHT = 56;

function startOfWeek(value: Date) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - date.getDay());
  return date;
}

function addDays(value: Date, amount: number) {
  const date = new Date(value);
  date.setDate(date.getDate() + amount);
  return date;
}

function dateKey(value: Date) {
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, "0"),
    String(value.getDate()).padStart(2, "0"),
  ].join("-");
}

function localDateTimeValue(value: Date) {
  return `${dateKey(value)}T${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
}

function minutesFromDayStart(value: Date) {
  return value.getHours() * 60 + value.getMinutes();
}

function eventColor(event: CalendarEvent) {
  if (event.colorId) return Number(event.colorId) % 5;
  return Array.from(event.title).reduce((total, character) => total + character.charCodeAt(0), 0) % 5;
}

function rangesOverlap(startA: number, endA: number, startB: number, endB: number) {
  return startA < endB && endA > startB;
}

export default function CommercialMeetingScheduler({
  lead,
  email,
  selectedAt,
  error,
  saving,
  onEmailChange,
  onSelectedAtChange,
  onClose,
  onSubmit,
}: Props) {
  const { api } = useCommercial();
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [openEvent, setOpenEvent] = useState<CalendarEvent | null>(null);
  const [now, setNow] = useState(() => new Date());
  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart]);
  const slots = useMemo(
    () => Array.from({ length: ((END_HOUR - START_HOUR) * 60) / SLOT_MINUTES }, (_, index) => index),
    [],
  );

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    function closeFloatingPanel(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (openEvent) setOpenEvent(null);
      else if (editorOpen) setEditorOpen(false);
    }
    window.addEventListener("keydown", closeFloatingPanel);
    return () => window.removeEventListener("keydown", closeFloatingPanel);
  }, [editorOpen, openEvent]);

  useEffect(() => {
    let cancelled = false;
    async function loadEvents() {
      setLoading(true);
      setLoadError(null);
      try {
        const end = addDays(weekStart, 7);
        const payload = await api(
          `/api/integrations/google-calendar/events?time_min=${encodeURIComponent(weekStart.toISOString())}&time_max=${encodeURIComponent(end.toISOString())}`,
        );
        if (cancelled) return;
        setEvents(payload.events || []);
        setDurationMinutes(Number(payload.duration_minutes || 60));
      } catch (requestError) {
        if (!cancelled) {
          setLoadError(requestError instanceof Error ? requestError.message : "Não foi possível carregar a agenda.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadEvents();
    return () => {
      cancelled = true;
    };
  }, [api, weekStart]);

  const selectedDate = selectedAt ? new Date(selectedAt) : null;
  const selectedEnd = selectedDate && !Number.isNaN(selectedDate.getTime())
    ? new Date(selectedDate.getTime() + durationMinutes * 60_000)
    : null;
  const weekTitle = `${days[0].toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })} a ${days[6].toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })}`;
  const totalGridHeight = (END_HOUR - START_HOUR) * HOUR_HEIGHT;

  function timedEventsForDay(day: Date) {
    return events.filter((event) => {
      if (event.allDay) return false;
      const start = new Date(event.start);
      return !Number.isNaN(start.getTime()) && dateKey(start) === dateKey(day);
    });
  }

  function allDayEventsForDay(day: Date) {
    const key = dateKey(day);
    return events.filter((event) => event.allDay && key >= event.start && key < event.end);
  }

  function isSlotUnavailable(slotStart: Date) {
    const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60_000);
    if (slotStart.getTime() < now.getTime()) return true;
    const dayLimit = new Date(slotStart);
    dayLimit.setHours(END_HOUR, 0, 0, 0);
    if (slotEnd > dayLimit) return true;
    return events.some((event) => {
      if (!event.busy) return false;
      if (event.allDay) {
        const key = dateKey(slotStart);
        return key >= event.start && key < event.end;
      }
      const eventStart = new Date(event.start).getTime();
      const eventEnd = new Date(event.end).getTime();
      return rangesOverlap(slotStart.getTime(), slotEnd.getTime(), eventStart, eventEnd);
    });
  }

  function showWeek(date: Date) {
    setEditorOpen(false);
    setOpenEvent(null);
    onSelectedAtChange("");
    setWeekStart(startOfWeek(date));
  }

  function selectFreeSlot(slotStart: Date) {
    onSelectedAtChange(localDateTimeValue(slotStart));
    setOpenEvent(null);
    setEditorOpen(true);
  }

  function showEventDetails(event: CalendarEvent) {
    setEditorOpen(false);
    setOpenEvent(event);
  }

  return (
    <div className="kh-scheduler" role="dialog" aria-modal="true" aria-labelledby="scheduler-title">
      <div className="kh-scheduler-scrim" onClick={onClose} aria-hidden="true" />
      <form className="kh-scheduler-shell" onSubmit={onSubmit}>
        <header className="kh-scheduler-toolbar">
          <div className="kh-scheduler-brand">
            <span><CalendarDays size={21} /></span>
            <div><small>Agenda comercial</small><h2 id="scheduler-title">Escolha um horário livre</h2></div>
          </div>
          <div className="kh-scheduler-navigation">
            <button type="button" onClick={() => showWeek(new Date())}>Hoje</button>
            <button type="button" aria-label="Semana anterior" onClick={() => showWeek(addDays(weekStart, -7))}><ChevronLeft size={18} /></button>
            <button type="button" aria-label="Próxima semana" onClick={() => showWeek(addDays(weekStart, 7))}><ChevronRight size={18} /></button>
            <strong>{weekTitle}</strong>
          </div>
          <button type="button" className="kh-scheduler-close" aria-label="Fechar agenda" onClick={onClose}><X size={20} /></button>
        </header>

        <div className="kh-scheduler-layout">
          <aside className="kh-scheduler-lead">
            <span className="kh-scheduler-kicker">Lead selecionado</span>
            <div className="kh-scheduler-lead-name"><UserRound size={17} /><div><strong>{lead.nome}</strong><small>{lead.empresa || "Empresa não informada"}</small></div></div>
            <p>Os horários ocupados vêm da agenda Google conectada. Selecione diretamente um espaço livre.</p>
            <div className="kh-scheduler-legend">
              <span><i className="is-selected" /> Nova reunião</span>
              <span><i className="is-busy" /> Horário ocupado</span>
              <span><i className="is-free" /> Horário livre</span>
            </div>
          </aside>

          <main className="kh-scheduler-calendar">
            {loadError && <div className="kh-scheduler-load-error">{loadError}<button type="button" onClick={() => setWeekStart((current) => new Date(current))}>Tentar novamente</button></div>}
            <div className="kh-scheduler-scroll">
              <div className="kh-scheduler-week" style={{ "--scheduler-grid-height": `${totalGridHeight}px` } as React.CSSProperties}>
                <div className="kh-scheduler-time-head">GMT-3</div>
                {days.map((day) => {
                  const allDay = allDayEventsForDay(day);
                  const today = dateKey(day) === dateKey(now);
                  return <div key={dateKey(day)} className={`kh-scheduler-day-head ${today ? "is-today" : ""}`}><span>{day.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "")}</span><strong>{day.getDate()}</strong>{allDay.slice(0, 2).map((event) => <button type="button" className="kh-scheduler-all-day" key={event.id} onClick={() => showEventDetails(event)}>{event.title}</button>)}</div>;
                })}
                <div className="kh-scheduler-time-axis" style={{ height: totalGridHeight }}>
                  {Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, index) => <span key={index} style={{ top: index * HOUR_HEIGHT }}>{String(START_HOUR + index).padStart(2, "0")}:00</span>)}
                </div>
                {days.map((day) => {
                  const dayEvents = timedEventsForDay(day);
                  const selectedOnDay = selectedDate && dateKey(selectedDate) === dateKey(day);
                  const today = dateKey(day) === dateKey(now);
                  const nowMinutes = minutesFromDayStart(now) - START_HOUR * 60;
                  return (
                    <div key={dateKey(day)} className={`kh-scheduler-day-column ${today ? "is-today" : ""}`} style={{ height: totalGridHeight }}>
                      <div className="kh-scheduler-hour-lines">{Array.from({ length: END_HOUR - START_HOUR }, (_, index) => <i key={index} style={{ top: index * HOUR_HEIGHT }} />)}</div>
                      <div className="kh-scheduler-slots">
                        {slots.map((slot) => {
                          const slotStart = new Date(day);
                          slotStart.setHours(START_HOUR, slot * SLOT_MINUTES, 0, 0);
                          const unavailable = isSlotUnavailable(slotStart);
                          const selected = selectedDate?.getTime() === slotStart.getTime();
                          return <button key={slot} type="button" disabled={unavailable} className={selected ? "is-selected" : ""} aria-label={`${unavailable ? "Ocupado" : "Criar evento em"} ${slotStart.toLocaleString("pt-BR")}`} onClick={() => selectFreeSlot(slotStart)} />;
                        })}
                      </div>
                      {dayEvents.map((event) => {
                        const start = new Date(event.start);
                        const end = new Date(event.end);
                        const startMinutes = Math.max(START_HOUR * 60, minutesFromDayStart(start));
                        const endMinutes = Math.min(END_HOUR * 60, dateKey(end) === dateKey(start) ? minutesFromDayStart(end) : END_HOUR * 60);
                        if (endMinutes <= START_HOUR * 60 || startMinutes >= END_HOUR * 60) return null;
                        const top = ((startMinutes - START_HOUR * 60) / 60) * HOUR_HEIGHT;
                        const height = Math.max(22, ((endMinutes - startMinutes) / 60) * HOUR_HEIGHT);
                        return <button type="button" key={event.id} className={`kh-scheduler-event color-${eventColor(event)}`} style={{ top, height }} title={`${event.title} · ${start.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`} aria-label={`Abrir ${event.title}`} onClick={() => showEventDetails(event)}><strong>{event.title}</strong><small>{start.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}–{end.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</small></button>;
                      })}
                      {selectedOnDay && selectedDate && selectedEnd && (
                        <div className="kh-scheduler-selection" style={{ top: ((minutesFromDayStart(selectedDate) - START_HOUR * 60) / 60) * HOUR_HEIGHT, height: Math.max(28, (durationMinutes / 60) * HOUR_HEIGHT) }}><Video size={13} /><strong>Nova reunião</strong><small>{selectedDate.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}–{selectedEnd.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</small></div>
                      )}
                      {today && nowMinutes >= 0 && nowMinutes <= (END_HOUR - START_HOUR) * 60 && <div className="kh-scheduler-now" style={{ top: (nowMinutes / 60) * HOUR_HEIGHT }}><i /></div>}
                    </div>
                  );
                })}
                {loading && <div className="kh-scheduler-loading"><Loader2 size={22} className="kh-spin" /> Sincronizando agenda Google...</div>}
              </div>
            </div>
          </main>

          <aside className="kh-scheduler-confirm">
            <span className="kh-scheduler-kicker">Novo evento</span>
            <h3>{selectedDate ? "Horário selecionado" : "Selecione na agenda"}</h3>
            <label><span><Mail size={13} /> E-mail do cliente</span><input type="email" value={email} onChange={(event) => onEmailChange(event.target.value)} placeholder="cliente@empresa.com.br" required /></label>
            <div className="kh-scheduler-summary">
              <div><CalendarDays size={15} /><span>Data<strong>{selectedDate ? selectedDate.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" }) : "Nenhuma"}</strong></span></div>
              <div><Clock3 size={15} /><span>Horário<strong>{selectedDate && selectedEnd ? `${selectedDate.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} às ${selectedEnd.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : `${durationMinutes} minutos`}</strong></span></div>
              <div><Video size={15} /><span>Videoconferência<strong>Google Meet automático</strong></span></div>
            </div>
            {(error || loadError) && <p className="kh-scheduler-error" role="alert">{error || loadError}</p>}
            <div className="kh-scheduler-actions"><button type="button" onClick={onClose}>Cancelar</button><button type="submit" disabled={saving || loading || Boolean(loadError) || !selectedAt || !email.trim()}>{saving ? <Loader2 size={15} className="kh-spin" /> : <CalendarDays size={15} />}{saving ? "Criando evento..." : "Criar evento"}</button></div>
          </aside>
        </div>

        {editorOpen && selectedDate && selectedEnd && (
          <div className="kh-scheduler-floating-layer">
            <button type="button" className="kh-scheduler-floating-scrim" aria-label="Fechar editor" onClick={() => setEditorOpen(false)} />
            <section className="kh-scheduler-event-editor" role="dialog" aria-modal="true" aria-labelledby="scheduler-editor-title">
              <header><Menu size={18} aria-hidden="true" /><button type="button" aria-label="Fechar" onClick={() => setEditorOpen(false)}><X size={20} /></button></header>
              <div className="kh-scheduler-editor-body">
                <input id="scheduler-editor-title" className="kh-scheduler-title-input" value={`Reunião com ${lead.nome}`} readOnly aria-label="Título do evento" />
                <div className="kh-scheduler-editor-tabs"><strong>Evento</strong><span>Agenda comercial</span></div>
                <div className="kh-scheduler-editor-row"><Clock3 size={20} /><div><strong>{selectedDate.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}</strong><span>{selectedDate.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} – {selectedEnd.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span><small>GMT-3 · Não se repete</small></div></div>
                <label className="kh-scheduler-editor-row"><Users size={20} /><div><span>Convidado</span><input type="email" value={email} onChange={(event) => onEmailChange(event.target.value)} placeholder="cliente@empresa.com.br" required autoFocus /></div></label>
                <div className="kh-scheduler-editor-row"><Video size={20} /><div><strong>Google Meet automático</strong><small>O link será criado e enviado ao convidado.</small></div></div>
                <div className="kh-scheduler-editor-row"><MapPin size={20} /><div><strong>Agenda Comercial Orion</strong><small>Evento ocupado · lembrete padrão da agenda</small></div></div>
                <div className="kh-scheduler-editor-row"><AlignLeft size={20} /><div><strong>Dados do lead incluídos</strong><small>Empresa, telefone, e-mail e data de entrada serão adicionados à descrição.</small></div></div>
                {error && <p className="kh-scheduler-error" role="alert">{error}</p>}
              </div>
              <footer><button type="button" onClick={() => setEditorOpen(false)}>Cancelar</button><button type="submit" disabled={saving || !email.trim()}>{saving ? <Loader2 size={15} className="kh-spin" /> : <CalendarDays size={15} />}{saving ? "Criando..." : "Criar evento"}</button></footer>
            </section>
          </div>
        )}

        {openEvent && (() => {
          const eventStart = new Date(openEvent.start);
          const eventEnd = new Date(openEvent.end);
          return (
            <div className="kh-scheduler-floating-layer">
              <button type="button" className="kh-scheduler-floating-scrim" aria-label="Fechar detalhes" onClick={() => setOpenEvent(null)} />
              <section className="kh-scheduler-event-details" role="dialog" aria-modal="true" aria-labelledby="scheduler-event-title">
                <header><span className={`kh-scheduler-event-dot color-${eventColor(openEvent)}`} /><div><small>Evento da agenda</small><h3 id="scheduler-event-title">{openEvent.title}</h3></div><button type="button" aria-label="Fechar" onClick={() => setOpenEvent(null)}><X size={20} /></button></header>
                <div className="kh-scheduler-event-details-body">
                  <div className="kh-scheduler-editor-row"><Clock3 size={20} /><div><strong>{eventStart.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}</strong><span>{openEvent.allDay ? "Dia inteiro" : `${eventStart.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} – ${eventEnd.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`}</span></div></div>
                  <div className="kh-scheduler-editor-row"><Users size={20} /><div><strong>Convidados</strong>{openEvent.attendees.length ? <ul>{openEvent.attendees.map((attendee) => <li key={attendee.email}><span>{attendee.name || attendee.email}</span><small>{attendee.name ? attendee.email : attendee.responseStatus || "Convidado"}</small></li>)}</ul> : <small>Nenhum convidado informado.</small>}</div></div>
                  {openEvent.meetLink && <div className="kh-scheduler-editor-row"><Video size={20} /><div><strong>Google Meet</strong><a href={openEvent.meetLink} target="_blank" rel="noreferrer">Entrar na videoconferência <ExternalLink size={13} /></a></div></div>}
                  {openEvent.location && <div className="kh-scheduler-editor-row"><MapPin size={20} /><div><strong>Local</strong><span>{openEvent.location}</span></div></div>}
                  {openEvent.description && <div className="kh-scheduler-editor-row"><AlignLeft size={20} /><div><strong>Descrição</strong><p>{openEvent.description}</p></div></div>}
                </div>
                <footer><button type="button" onClick={() => setOpenEvent(null)}>Fechar</button>{openEvent.calendarLink && <a href={openEvent.calendarLink} target="_blank" rel="noreferrer">Abrir no Google Calendar <ExternalLink size={14} /></a>}</footer>
              </section>
            </div>
          );
        })()}
      </form>
    </div>
  );
}
