"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import {
  BadgeCheck,
  CalendarClock,
  ChevronDown,
  CircleX,
  Clock3,
  Download,
  FileText,
  MessageSquarePlus,
  Paperclip,
  Pencil,
  Phone,
  PhoneCall,
  RefreshCw,
  Save,
  X,
} from "lucide-react";
import type {
  CommercialLead,
  CommercialMember,
  CommercialStage,
} from "@/lib/comercial";
import {
  getCommercialMqlLevel,
  type CommercialMqlLevel,
} from "@/lib/commercialQualification";

type LeadInteraction = {
  id: string;
  comentario: string | null;
  anexo_url: string | null;
  anexo_nome: string | null;
  autor_nome: string;
  tipo?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
};

type TaskForm = {
  titulo: string;
  responsavel_id: string;
  vencimento: string;
  prioridade: string;
  descricao: string;
};

type Props = {
  lead: CommercialLead | null;
  members: CommercialMember[];
  canViewFinancials: boolean;
  canViewQualification?: boolean;
  readOnly?: boolean;
  canEditSale?: boolean;
  stages: CommercialStage[];
  onMoveStage: (status: string) => void;
  interactions: LeadInteraction[];
  interactionText: string;
  interactionFile: File | null;
  interactionSaving: boolean;
  interactionError: string | null;
  taskForm: TaskForm;
  taskSaving: boolean;
  onTaskChange: (field: keyof TaskForm, value: string) => void;
  onCreateTask: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
  onInteractionTextChange: (value: string) => void;
  onInteractionFileChange: (file: File | null) => void;
  onAddInteraction: (event: React.FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
  onSave: (data: Record<string, unknown>) => Promise<void>;
  onDownloadBriefing?: (leadId: string) => Promise<void>;
  briefingDownloading?: boolean;
  onStartCall?: (lead: CommercialLead) => Promise<void>;
};

type EditableLead = {
  nome: string;
  telefone: string;
  email: string;
  empresa: string;
  estado: string;
  origem: string;
  campanha: string;
  ja_investiu_trafego: string;
  faturamento_mensal: string;
  prioridade: string;
  investimento: string;
  vidas: string;
  negocio_etapa: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_term: string;
  utm_content: string;
  sdr_id: string;
  closer_id: string;
  vendedor_id: string;
  reuniao_link: string;
  fechado_at: string;
  valor_pago: string;
  modelo_pagamento: string;
  valor_negociacao: string;
  observacoes: string;
  decisor: string;
};

const mqlCopy: Record<CommercialMqlLevel, { title: string; detail: string }> = {
  S: { title: "MQL S", detail: "Pica das galáxias" },
  A: { title: "MQL A", detail: "R$ 10 mil a R$ 20 mil" },
  B: { title: "MQL B", detail: "Abaixo de R$ 10 mil, com investimento" },
  C: { title: "MQL C", detail: "Fora do MQL" },
};

function dateTime(value: string | null | undefined) {
  return value
    ? new Date(value).toLocaleString("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
      })
    : "Não informado";
}

function dateTimeInput(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function money(value: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value || 0));
}

function displayValue(value: unknown) {
  return value === null || value === undefined || String(value).trim() === ""
    ? "Não informado"
    : String(value);
}

function elapsedLabel(value: string | null) {
  if (!value) return "Sem contato registrado";
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  const days = Math.floor(elapsed / 86_400_000);
  if (days === 0) return "Contato hoje";
  return `${days} ${days === 1 ? "dia" : "dias"} sem contato`;
}

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "LD"
  );
}

function noteKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const structuredNoteLabels = new Set([
  "nome",
  "telefone",
  "email",
  "empresa",
  "estado",
  "origem",
  "campanha",
  "status",
  "etapa",
  "data entrada",
  "ja investiu trafego",
  "ja investiu em trafego",
  "faturamento mensal",
  "faturamento",
  "prioridade",
  "investimento",
  "vidas",
  "quantidade de vidas",
  "negocio etapa",
  "utm source",
  "utm medium",
  "utm campaign",
  "utm term",
  "utm content",
  "decisor",
  "e o decisor",
  "tomador de decisao",
]);

function noteParts(notes: string | null) {
  return String(notes || "")
    .split(/\s*\|\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function noteField(notes: string | null, aliases: string[]) {
  const wanted = new Set(aliases.map(noteKey));
  for (const part of noteParts(notes)) {
    const separator = part.indexOf(":");
    if (separator < 0 || !wanted.has(noteKey(part.slice(0, separator))))
      continue;
    const content = part.slice(separator + 1).trim();
    if (content) return content;
  }
  return null;
}

function freeNotes(notes: string | null) {
  return noteParts(notes)
    .filter((part) => {
      const separator = part.indexOf(":");
      return (
        separator < 0 ||
        !structuredNoteLabels.has(noteKey(part.slice(0, separator)))
      );
    })
    .join(" | ");
}

function withStructuredNote(notes: string, label: string, value: string) {
  const target = noteKey(label);
  const remaining = noteParts(notes).filter((part) => {
    const separator = part.indexOf(":");
    return separator < 0 || noteKey(part.slice(0, separator)) !== target;
  });
  if (value.trim()) remaining.push(`${label}: ${value.trim()}`);
  return remaining.join(" | ");
}

function editableLead(lead: CommercialLead): EditableLead {
  return {
    nome: lead.nome || "",
    telefone: lead.telefone || "",
    email: lead.email || "",
    empresa: lead.empresa || "",
    estado: lead.estado || "",
    origem: lead.origem || "",
    campanha: lead.campanha || "",
    ja_investiu_trafego: lead.ja_investiu_trafego || "",
    faturamento_mensal: lead.faturamento_mensal || "",
    prioridade: lead.prioridade || "",
    investimento: lead.investimento || "",
    vidas: lead.vidas || "",
    negocio_etapa: lead.negocio_etapa || "",
    utm_source: lead.utm_source || "",
    utm_medium: lead.utm_medium || "",
    utm_campaign: lead.utm_campaign || "",
    utm_term: lead.utm_term || "",
    utm_content: lead.utm_content || "",
    sdr_id: lead.sdr_id || "",
    closer_id: lead.closer_id || "",
    vendedor_id: lead.vendedor_id || lead.closer_id || "",
    reuniao_link: lead.reuniao_link || "",
    fechado_at: dateTimeInput(lead.fechado_at),
    valor_pago: String(lead.valor_pago || lead.valor_fechado || ""),
    modelo_pagamento: lead.modelo_pagamento || "",
    valor_negociacao: String(lead.valor_negociacao || ""),
    observacoes: lead.observacoes || "",
    decisor:
      noteField(lead.observacoes, [
        "decisor",
        "é o decisor",
        "tomador de decisão",
      ]) || "",
  };
}

export default function CommercialLeadDetailsModal({
  lead,
  members,
  canViewFinancials,
  canViewQualification = true,
  readOnly = false,
  canEditSale = false,
  stages,
  onMoveStage,
  interactions,
  interactionText,
  interactionFile,
  interactionSaving,
  interactionError,
  taskForm,
  taskSaving,
  onTaskChange,
  onCreateTask,
  onInteractionTextChange,
  onInteractionFileChange,
  onAddInteraction,
  onClose,
  onSave,
  onDownloadBriefing,
  briefingDownloading = false,
  onStartCall,
}: Props) {
  const [attachmentPreview, setAttachmentPreview] = useState<string | null>(
    null,
  );
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<EditableLead | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const interactionRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!interactionFile) return;
    const objectUrl = URL.createObjectURL(interactionFile);
    const updateId = window.setTimeout(
      () => setAttachmentPreview(objectUrl),
      0,
    );
    return () => {
      window.clearTimeout(updateId);
      URL.revokeObjectURL(objectUrl);
    };
  }, [interactionFile]);

  useEffect(() => {
    if (!lead) return;
    setEditForm(editableLead(lead));
    setEditing(false);
    setEditError(null);
  }, [lead?.id]);

  if (!lead) return null;

  const currentLead = lead;
  const effective = editForm || editableLead(lead);
  const memberName = (id: string | null, fallback: string) =>
    members.find((member) => member.profile_id === id)?.nome || fallback;
  const leadName = editing ? effective.nome : lead.nome;
  const sdrName = memberName(
    editing ? effective.sdr_id || null : lead.sdr_id,
    "Sem SDR",
  );
  const closerName = memberName(
    editing ? effective.closer_id || null : lead.closer_id,
    "Sem closer",
  );
  const sellerName = memberName(lead.vendedor_id || lead.closer_id, "Nao informado");
  const lastActivity =
    lead.ultimo_contato_at || interactions[0]?.created_at || lead.data_entrada;
  const internalNotes = freeNotes(lead.observacoes);
  const decisionMaker = noteField(lead.observacoes, [
    "decisor",
    "é o decisor",
    "tomador de decisão",
  ]);
  const mqlLevel = getCommercialMqlLevel(
    editing ? effective.faturamento_mensal : lead.faturamento_mensal,
    editing ? effective.investimento : lead.investimento,
  );
  function focusInteraction() {
    interactionRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
    window.setTimeout(() => interactionRef.current?.focus(), 250);
  }

  function openSchedule() {
    if (!taskForm.titulo.trim())
      onTaskChange("titulo", `Retorno com ${leadName}`);
    setScheduleOpen(true);
  }

  function setEdit(field: keyof EditableLead, value: string) {
    setEditForm((current) =>
      current ? { ...current, [field]: value } : current,
    );
  }

  function inlineInput(
    field: keyof EditableLead,
    label: string,
    type = "text",
  ) {
    return (
      <input
        className="kh-inline-edit"
        aria-label={label}
        type={type}
        value={effective[field]}
        onChange={(event) => setEdit(field, event.target.value)}
      />
    );
  }

  function memberSelect(
    field: "sdr_id" | "closer_id",
    role: "sdr" | "closer",
    label: string,
  ) {
    return (
      <select
        className="kh-inline-edit"
        aria-label={label}
        value={effective[field]}
        onChange={(event) => setEdit(field, event.target.value)}
      >
        <option value="">Sem {role}</option>
        {members
          .filter((member) => member.papel === role && member.ativo)
          .map((member) => (
            <option key={member.profile_id} value={member.profile_id}>
              {member.nome}
            </option>
          ))}
      </select>
    );
  }

  function sellerSelect() {
    return (
      <select className="kh-inline-edit" aria-label="Quem vendeu" value={effective.vendedor_id} onChange={(event) => setEdit("vendedor_id", event.target.value)}>
        <option value="">Selecione o vendedor</option>
        {members
          .filter((member) => member.ativo && (member.papel === "closer" || member.profile_id === "a12b63f9-4c72-4a92-a99a-98c020723a06"))
          .map((member) => <option key={member.profile_id} value={member.profile_id}>{member.nome}</option>)}
      </select>
    );
  }

  function cancelEditing() {
    setEditForm(editableLead(currentLead));
    setEditing(false);
    setEditError(null);
  }

  async function saveEditing() {
    if (!effective.nome.trim() || editSaving) return;
    setEditSaving(true);
    setEditError(null);
    try {
      const { decisor, vendedor_id, reuniao_link, fechado_at, valor_pago, modelo_pagamento, ...leadFields } = effective;
      await onSave({
        ...leadFields,
        ...(canEditSale ? {
          vendedor_id,
          reuniao_link,
          fechado_at: fechado_at ? new Date(fechado_at).toISOString() : null,
          valor_pago: Number(valor_pago || 0),
          modelo_pagamento,
        } : {}),
        observacoes: withStructuredNote(
          effective.observacoes,
          "É o decisor?",
          decisor,
        ),
        id: currentLead.id,
        valor_negociacao: Number(effective.valor_negociacao || 0),
      });
      setEditing(false);
    } catch (error) {
      setEditError(
        error instanceof Error
          ? error.message
          : "Não foi possível salvar as alterações.",
      );
    } finally {
      setEditSaving(false);
    }
  }

  const qualificationRows: Array<[string, React.ReactNode]> = [
    [
      "Vidas",
      editing ? inlineInput("vidas", "Vidas") : displayValue(lead.vidas),
    ],
    [
      "Prioridade",
      editing
        ? inlineInput("prioridade", "Prioridade")
        : displayValue(lead.prioridade),
    ],
    ...(canViewQualification
      ? [
          [
            "Faturamento",
            editing
              ? inlineInput("faturamento_mensal", "Faturamento mensal")
              : displayValue(lead.faturamento_mensal),
          ] as [string, React.ReactNode],
        ]
      : []),
    [
      "É o decisor?",
      editing
        ? inlineInput("decisor", "É o decisor?")
        : displayValue(decisionMaker),
    ],
    ...(canViewQualification
      ? [
          [
            "Já investiu em tráfego?",
            editing
              ? inlineInput(
                  "ja_investiu_trafego",
                  "Investimento anterior em tráfego",
                )
              : displayValue(lead.ja_investiu_trafego),
          ] as [string, React.ReactNode],
        ]
      : []),
  ];
  const contactRows: Array<[string, React.ReactNode]> = [
    ["Nome", editing ? inlineInput("nome", "Nome") : displayValue(lead.nome)],
    [
      "WhatsApp",
      editing
        ? inlineInput("telefone", "WhatsApp", "tel")
        : displayValue(lead.telefone),
    ],
    [
      "E-mail",
      editing
        ? inlineInput("email", "E-mail", "email")
        : displayValue(lead.email),
    ],
    [
      "Empresa",
      editing ? inlineInput("empresa", "Empresa") : displayValue(lead.empresa),
    ],
    [
      "Estado",
      editing ? inlineInput("estado", "Estado") : displayValue(lead.estado),
    ],
    ["SDR", editing ? memberSelect("sdr_id", "sdr", "SDR") : sdrName],
    [
      "Closer",
      editing ? memberSelect("closer_id", "closer", "Closer") : closerName,
    ],
  ];
  const sourceRows: Array<[string, React.ReactNode]> = [
    [
      "Origem",
      editing ? inlineInput("origem", "Origem") : displayValue(lead.origem),
    ],
    [
      "Campanha",
      editing
        ? inlineInput("campanha", "Campanha")
        : displayValue(lead.campanha),
    ],
    [
      "UTM source",
      editing
        ? inlineInput("utm_source", "UTM source")
        : displayValue(lead.utm_source),
    ],
    [
      "UTM medium",
      editing
        ? inlineInput("utm_medium", "UTM medium")
        : displayValue(lead.utm_medium),
    ],
    [
      "UTM campaign",
      editing
        ? inlineInput("utm_campaign", "UTM campaign")
        : displayValue(lead.utm_campaign),
    ],
    [
      "UTM term",
      editing
        ? inlineInput("utm_term", "UTM term")
        : displayValue(lead.utm_term),
    ],
    [
      "UTM content",
      editing
        ? inlineInput("utm_content", "UTM content")
        : displayValue(lead.utm_content),
    ],
  ];
  const controlRows: Array<[string, React.ReactNode]> = [
    ["Entrada", dateTime(lead.data_entrada)],
    ["Último contato", dateTime(lead.ultimo_contato_at)],
    ["Reunião agendada", dateTime(lead.reuniao_agendada_at)],
    ["Reunião realizada", dateTime(lead.reuniao_realizada_at)],
    ["Quem vendeu", editing && canEditSale ? sellerSelect() : sellerName],
    [
      "Fechado em",
      editing && canEditSale
        ? inlineInput("fechado_at", "Data do fechamento", "datetime-local")
        : dateTime(lead.fechado_at),
    ],
    ...(canViewFinancials ? [[
      "Valor pago",
      editing && canEditSale
        ? inlineInput("valor_pago", "Valor pago", "number")
        : money(lead.valor_pago ?? lead.valor_fechado),
    ] as [string, React.ReactNode], [
      "Modelo de pagamento",
      editing && canEditSale
        ? <select className="kh-inline-edit" aria-label="Modelo de pagamento" value={effective.modelo_pagamento} onChange={(event) => setEdit("modelo_pagamento", event.target.value)}><option value="">Selecione</option><option value="tcv">TCV</option><option value="mrr">MRR</option><option value="mesclado">Mesclado</option></select>
        : displayValue(lead.modelo_pagamento?.toUpperCase()),
    ] as [string, React.ReactNode]] : []),
    [
      "Link da reunião",
      editing && canEditSale
        ? inlineInput("reuniao_link", "Link da reunião", "url")
        : lead.reuniao_link
          ? <a href={lead.reuniao_link} target="_blank" rel="noreferrer">Abrir reunião</a>
          : "Não informado",
    ],
    [
      "Negócio / etapa",
      editing
        ? inlineInput("negocio_etapa", "Negócio ou etapa")
        : displayValue(lead.negocio_etapa),
    ],
    ["No-shows", String(Number(lead.no_show_count || 0))],
    ...(lead.onboarding_briefing && onDownloadBriefing ? [[
      "Briefing operacional",
      <button key="download-briefing" type="button" className="kh-inline-download" disabled={briefingDownloading} onClick={() => void onDownloadBriefing(lead.id)}><Download size={14} /> {briefingDownloading ? "Baixando..." : "Baixar PDF"}</button>,
    ] as [string, React.ReactNode]] : []),
  ];

  return (
    <div
      className="kh-lead-details-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="kh-lead-details-title"
    >
      <section
        className={`kh-lead-details-modal kh-lead-reference ${editing ? "is-editing" : ""}`}
      >
        <header className="kh-lead-reference-head">
          <div className="kh-lead-identity">
            <span className="kh-lead-avatar" aria-hidden="true">
              {initials(leadName)}
            </span>
            <div>
              <h2 id="kh-lead-details-title">{leadName || "Lead sem nome"}</h2>
              <p>
                <Phone size={13} />{" "}
                {effective.telefone || "WhatsApp não informado"} <span>•</span>{" "}
                SDR {sdrName} <span>•</span> Closer {closerName}
              </p>
            </div>
          </div>
          <div className="kh-lead-head-status">
            {canViewQualification && (
              <span className={`kh-mql-level level-${mqlLevel.toLowerCase()}`}>
                <b>{mqlCopy[mqlLevel].title}</b>
                <small>{mqlCopy[mqlLevel].detail}</small>
              </span>
            )}
            <span className="stage">{lead.status}</span>
            <span className="elapsed">
              <Clock3 size={13} /> {elapsedLabel(lastActivity)}
            </span>
            {editing ? (
              <>
                <button
                  type="button"
                  className="kh-edit-save"
                  aria-label="Salvar alterações"
                  onClick={() => void saveEditing()}
                  disabled={editSaving || !effective.nome.trim()}
                >
                  <Save size={17} />{" "}
                  <span>{editSaving ? "Salvando..." : "Salvar"}</span>
                </button>
                <button
                  type="button"
                  className="kh-icon-button"
                  aria-label="Cancelar edição"
                  onClick={cancelEditing}
                  disabled={editSaving}
                >
                  <X size={18} />
                </button>
              </>
            ) : (
              !readOnly && (
                <button
                  type="button"
                  className="kh-icon-button"
                  aria-label="Editar lead"
                  onClick={() => setEditing(true)}
                >
                  <Pencil size={17} />
                </button>
              )
            )}
            <button
              type="button"
              className="kh-icon-button"
              aria-label="Fechar detalhes"
              onClick={onClose}
            >
              <X size={19} />
            </button>
          </div>
        </header>

        {editError && (
          <div className="kh-inline-error kh-lead-edit-error" role="alert">
            {editError}
          </div>
        )}

        {!readOnly && (
          <div className="kh-lead-quick-actions" aria-label="Ações do lead">
            {lead.telefone && onStartCall && <button type="button" onClick={() => void onStartCall(lead)}><PhoneCall size={16} /> Ligar e registrar</button>}
            <button type="button" onClick={focusInteraction}>
              <MessageSquarePlus size={16} /> Registrar interação
            </button>
            <button type="button" onClick={openSchedule}>
              <CalendarClock size={16} /> Agendar retorno
            </button>
            <label>
              <RefreshCw size={15} />
              <span>Mudar etapa</span>
              <select
                value={lead.status}
                onChange={(event) => onMoveStage(event.target.value)}
                aria-label="Mudar etapa do lead"
              >
                {stages.map((stage) => (
                  <option key={stage.id} value={stage.id}>
                    {stage.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="danger"
              onClick={() => onMoveStage("Perdido")}
              disabled={lead.status === "Perdido"}
            >
              <CircleX size={16} /> Marcar perdido
            </button>
          </div>
        )}

        {readOnly && (
          <div className="kh-inline-notice" role="status">
            Visualização de gestor: este card está em modo somente leitura.
          </div>
        )}

        {lead.proximo_retorno_at && (
          <div className="kh-lead-next-return">
            <CalendarClock size={16} />
            <div>
              <span>Próximo retorno agendado</span>
              <strong>{dateTime(lead.proximo_retorno_at)}</strong>
              {lead.proximo_retorno_titulo && (
                <small>{lead.proximo_retorno_titulo}</small>
              )}
            </div>
          </div>
        )}

        {scheduleOpen && (
          <form
            className="kh-lead-return-form"
            onSubmit={(event) => {
              void onCreateTask(event)
                .then(() => setScheduleOpen(false))
                .catch(() => undefined);
            }}
          >
            <label>
              <span>Próximo retorno</span>
              <input
                className="kh-input"
                type="datetime-local"
                value={taskForm.vencimento}
                onChange={(event) =>
                  onTaskChange("vencimento", event.target.value)
                }
                required
                autoFocus
              />
            </label>
            <label className="grow">
              <span>Título</span>
              <input
                className="kh-input"
                value={taskForm.titulo}
                onChange={(event) => onTaskChange("titulo", event.target.value)}
                required
              />
            </label>
            <button
              type="submit"
              className="kh-button primary"
              disabled={taskSaving}
            >
              {taskSaving ? "Salvando..." : "Agendar"}
            </button>
            <button
              type="button"
              className="kh-icon-button"
              aria-label="Cancelar agendamento"
              onClick={() => setScheduleOpen(false)}
            >
              <X size={17} />
            </button>
          </form>
        )}

        <div className="kh-lead-reference-body">
          <section className="kh-lead-history">
            <div className="kh-section-title">
              <div>
                <FileText size={16} />
                <h3>Histórico</h3>
              </div>
              <span>{interactions.length} registros</span>
            </div>
            {!readOnly && (
              <form
                className="kh-interaction-form kh-history-compose"
                onSubmit={onAddInteraction}
              >
                <textarea
                  ref={interactionRef}
                  className="kh-textarea"
                  value={interactionText}
                  onChange={(event) =>
                    onInteractionTextChange(event.target.value)
                  }
                  onPaste={(event) => {
                    const image = Array.from(event.clipboardData.files).find(
                      (file) => file.type.startsWith("image/"),
                    );
                    if (image) {
                      event.preventDefault();
                      onInteractionFileChange(image);
                    }
                  }}
                  placeholder="Escrever nota rápida..."
                />
                {interactionFile && attachmentPreview && (
                  <div className="kh-attachment-preview">
                    <Image
                      src={attachmentPreview}
                      alt="Prévia do print anexado"
                      width={220}
                      height={130}
                      unoptimized
                    />
                    <button
                      type="button"
                      onClick={() => onInteractionFileChange(null)}
                    >
                      Remover print
                    </button>
                  </div>
                )}
                {interactionError && (
                  <div className="kh-inline-error" role="alert">
                    {interactionError}
                  </div>
                )}
                <div>
                  <label
                    className="kh-file-button"
                    htmlFor="lead-attachment-modal"
                  >
                    <Paperclip size={14} />{" "}
                    {interactionFile ? interactionFile.name : "Anexar"}
                  </label>
                  <input
                    id="lead-attachment-modal"
                    type="file"
                    accept="image/*"
                    onChange={(event) =>
                      onInteractionFileChange(event.target.files?.[0] || null)
                    }
                  />
                  <button
                    className="kh-button primary"
                    disabled={interactionSaving}
                  >
                    {interactionSaving ? "Salvando..." : "Registrar"}
                  </button>
                </div>
              </form>
            )}
            {editing ? (
              <article className="kh-lead-internal-note">
                <strong>Observações internas</strong>
                <textarea
                  className="kh-inline-edit kh-inline-notes"
                  aria-label="Observações internas"
                  value={effective.observacoes}
                  onChange={(event) =>
                    setEdit("observacoes", event.target.value)
                  }
                />
              </article>
            ) : (
              internalNotes && (
                <article className="kh-lead-internal-note">
                  <strong>Observação interna</strong>
                  <p>{internalNotes}</p>
                </article>
              )
            )}
            <div className="kh-interaction-list kh-history-list">
              {interactions.map((item) => (
                <article
                  key={item.id}
                  className={
                    item.tipo && item.tipo !== "comentario"
                      ? "system-event"
                      : ""
                  }
                >
                  <div>
                    <strong>
                      {item.tipo && item.tipo !== "comentario"
                        ? "Evento do CRM"
                        : item.autor_nome}
                    </strong>
                    <small>{dateTime(item.created_at)}</small>
                  </div>
                  {item.tipo && item.tipo !== "comentario" && (
                    <em>{item.autor_nome}</em>
                  )}
                  {item.comentario && <p>{item.comentario}</p>}
                  {item.anexo_url && (
                    <a href={item.anexo_url} target="_blank" rel="noreferrer">
                      <Image
                        src={item.anexo_url}
                        alt={item.anexo_nome || "Print anexado"}
                        width={220}
                        height={150}
                        unoptimized
                      />
                    </a>
                  )}
                </article>
              ))}
              {!interactions.length && (
                <span>Nenhuma interação registrada.</span>
              )}
            </div>
          </section>

          <aside className="kh-lead-data-stack">
            <section className="kh-lead-qualification">
              <div className="kh-section-title">
                <div>
                  <BadgeCheck size={16} />
                  <h3>Qualificação</h3>
                </div>
                {canViewQualification && (
                  <span
                    className={`kh-mql-level compact level-${mqlLevel.toLowerCase()}`}
                  >
                    <b>{mqlCopy[mqlLevel].title}</b>
                    <small>{mqlCopy[mqlLevel].detail}</small>
                  </span>
                )}
              </div>
              <dl>
                {qualificationRows.map(([label, content]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{content}</dd>
                  </div>
                ))}
              </dl>
            </section>
            <details className="kh-lead-accordion" open>
              <summary>
                <span>Contato e empresa</span>
                <ChevronDown size={16} />
              </summary>
              <dl>
                {contactRows.map(([label, content]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{content}</dd>
                  </div>
                ))}
              </dl>
            </details>
            <details className="kh-lead-accordion">
              <summary>
                <span>
                  Origem e mídia <small>({sourceRows.length} campos)</small>
                </span>
                <ChevronDown size={16} />
              </summary>
              <dl>
                {sourceRows.map(([label, content]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{content}</dd>
                  </div>
                ))}
              </dl>
            </details>
            <details className="kh-lead-accordion">
              <summary>
                <span>Datas e controle</span>
                <ChevronDown size={16} />
              </summary>
              <dl>
                {controlRows.map(([label, content]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{content}</dd>
                  </div>
                ))}
              </dl>
            </details>
            {canViewQualification && (
              <details className="kh-lead-accordion">
                <summary>
                  <span>Valores comerciais</span>
                  <ChevronDown size={16} />
                </summary>
                <dl>
                  <div>
                    <dt>Investimento</dt>
                    <dd>
                      {editing
                        ? inlineInput("investimento", "Investimento")
                        : displayValue(lead.investimento)}
                    </dd>
                  </div>
                  {canViewFinancials && (
                    <div>
                      <dt>Valor em negociação</dt>
                      <dd>
                        {editing
                          ? inlineInput(
                              "valor_negociacao",
                              "Valor em negociação",
                              "number",
                            )
                          : `R$ ${Number(lead.valor_negociacao || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`}
                      </dd>
                    </div>
                  )}
                </dl>
              </details>
            )}
          </aside>
        </div>
      </section>
    </div>
  );
}
