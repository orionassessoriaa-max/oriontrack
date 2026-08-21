"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cadenceDayFromStage, isContactCadenceStage } from "@/lib/comercialCadencia";
import {
  CalendarClock,
  CalendarDays,
  CalendarPlus,
  AlertTriangle,
  CircleDollarSign,
  ChevronDown,
  ChevronUp,
  Download,
  FileCheck2,
  GripVertical,
  MessageSquare,
  Paperclip,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  Search,
  Check,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { useCommercial } from "@/components/commercial/CommercialShell";
import CommercialLeadModal from "@/components/commercial/CommercialLeadModal";
import CommercialLeadDetailsModal from "@/components/commercial/CommercialLeadDetailsModal";
import {
  canAssignCommercialResponsible,
  canManageCommercialStages,
  COMMERCIAL_STAGES,
  currency,
  type CommercialContactCadence,
  type CommercialLead,
  type CommercialStage,
} from "@/lib/comercial";
import { getCommercialMqlLevel } from "@/lib/commercialQualification";
import { supabase } from "@/lib/supabase/client";

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

type DatePreset =
  | "todos" | "hoje" | "ontem" | "7dias" | "30dias" | "mes" | "personalizado";

function localDateValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function localDateTimeValue(value: string | Date = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
function formatLeadEntry(value: string | null | undefined) {
  if (!value) return "Entrada não informada";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Entrada não informada";
  return `Entrou ${date.toLocaleDateString("pt-BR")} às ${date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
}
function formatStageCadence(value: string | null | undefined) {
  if (!value) return "Cadência não informada";
  const startedAt = new Date(value).getTime();
  if (Number.isNaN(startedAt)) return "Cadência não informada";
  const minutes = Math.max(0, Math.floor((Date.now() - startedAt) / 60000));
  if (minutes < 60) return `Na etapa há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Na etapa há ${hours}h`;
  const days = Math.floor(hours / 24);
  return `Na etapa há ${days} ${days === 1 ? "dia" : "dias"}`;
}

function formatDaniloEntry(value: string | null | undefined) {
  if (!value) return "Entrada não informada";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Entrada não informada";
  return `${date.toLocaleDateString("pt-BR")} às ${date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
}


function localSaoPauloDay(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function isCadenceStageOverdue(lead: CommercialLead) {
  if (!isContactCadenceStage(lead.status) || !lead.status_started_at) return false;
  const enteredDay = localSaoPauloDay(lead.status_started_at);
  return Boolean(enteredDay) && enteredDay < localSaoPauloDay(new Date());
}

function normalizeStageForCard(value: string | null | undefined) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function formatDaniloCnpj(lead: CommercialLead) {
  const cnpjLead = lead as CommercialLead & { possui_cnpj?: string | null };
  const value = String(cnpjLead.possui_cnpj || "")
    .trim()
    .toLowerCase();
  if (!value) return "CNPJ: não informado";
  if (value.includes("mei")) return "CNPJ: tenho MEI";
  if (value.includes("não") || value.includes("nao") || value.includes("cpf"))
    return "CNPJ: não";
  return "CNPJ: sim";
}

function getPresetRange(preset: DatePreset) {
  const today = new Date();
  const end = new Date(today);
  const start = new Date(today);
  if (preset === "ontem") {
    start.setDate(start.getDate() - 1);
    end.setDate(end.getDate() - 1);
  }
  if (preset === "7dias") start.setDate(start.getDate() - 6);
  if (preset === "30dias") start.setDate(start.getDate() - 29);
  if (preset === "mes") start.setDate(1);
  return preset === "todos"
    ? { start: "", end: "" }
    : { start: localDateValue(start), end: localDateValue(end) };
}

const STAGE_COLORS = ["#2563EB", "#0891B2", "#059669", "#D97706", "#E11D48", "#7C3AED"];

function stageColor(stage: CommercialStage, index: number) {
  return stage.color || STAGE_COLORS[index % STAGE_COLORS.length];
}

export default function CommercialKanbanPage() {
  const {
    api,
    members,
    role,
    currentProfileId,
    canViewCommercialFinancials,
    canEditCommercial,
    isDevOps,
  } = useCommercial();
  const router = useRouter();
  const [leads, setLeads] = useState<CommercialLead[]>([]);
  const [stages, setStages] = useState<CommercialStage[]>(COMMERCIAL_STAGES);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sdrFilter, setSdrFilter] = useState("todos");
  const [datePreset, setDatePreset] = useState<DatePreset>("todos");
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [initialStatus, setInitialStatus] = useState("Oportunidade");
  const [dragging, setDragging] = useState<string | null>(null);
  const draggingRef = useRef<string | null>(null);
  draggingRef.current = dragging;
  const [dropStage, setDropStage] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [stageDragging, setStageDragging] = useState<string | null>(null);
  const [newStageOpen, setNewStageOpen] = useState(false);
  const [newStageName, setNewStageName] = useState("");
  const [editingStage, setEditingStage] = useState<CommercialStage | null>(
    null,
  );
  const [editingStageName, setEditingStageName] = useState("");
  const [editingStageColor, setEditingStageColor] = useState("#2563EB");
  const [stageError, setStageError] = useState<string | null>(null);
  const [stageSaving, setStageSaving] = useState(false);
  const [expandedLeadId, setExpandedLeadId] = useState<string | null>(null);
  const [taskForm, setTaskForm] = useState({
    titulo: "",
    responsavel_id: "",
    vencimento: "",
    prioridade: "normal",
    descricao: "",
  });
  const [taskSaving, setTaskSaving] = useState<string | null>(null);
  const [interactionsByLead, setInteractionsByLead] = useState<
    Record<string, LeadInteraction[]>
  >({});
  const [interactionText, setInteractionText] = useState("");
  const [interactionFile, setInteractionFile] = useState<File | null>(null);
  const [interactionSaving, setInteractionSaving] = useState(false);
  const [interactionError, setInteractionError] = useState<string | null>(null);
  const [contactCadence, setContactCadence] =
    useState<CommercialContactCadence | null>(null);
  const [contactCadenceLoading, setContactCadenceLoading] = useState(false);
  const [contactCadenceSavingOrder, setContactCadenceSavingOrder] = useState<
    number | null
  >(null);
  const [contactCadenceError, setContactCadenceError] = useState<string | null>(
    null,
  );
  const [meetingMove, setMeetingMove] = useState<{
    leadId: string;
    status: string;
  } | null>(null);
  const [meetingAt, setMeetingAt] = useState("");
  const [meetingSaving, setMeetingSaving] = useState(false);
  const [negotiationMove, setNegotiationMove] = useState<{ leadId: string; status: string } | null>(null);
  const [negotiationValue, setNegotiationValue] = useState("");
  const [negotiationSaving, setNegotiationSaving] = useState(false);
  const [saleMove, setSaleMove] = useState<{ leadId: string; status: string } | null>(null);
  const [saleSellerId, setSaleSellerId] = useState("");
  const [saleMeetingLink, setSaleMeetingLink] = useState("");
  const [saleClosedAt, setSaleClosedAt] = useState(localDateTimeValue());
  const [saleAmountPaid, setSaleAmountPaid] = useState("");
  const [salePaymentModel, setSalePaymentModel] = useState<"" | "tcv" | "mrr" | "mesclado">("");
  const [saleBriefingLead, setSaleBriefingLead] = useState<CommercialLead | null>(null);
  const [saleSaving, setSaleSaving] = useState(false);
  const [briefingDownloading, setBriefingDownloading] = useState<string | null>(null);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [assignmentChoice, setAssignmentChoice] = useState<
    Record<string, string>
  >({});
  const realtimeRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const payload = await api("/api/comercial/leads");
      setLeads(payload.leads || []);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [api]);
  const loadStages = useCallback(async () => {
    try {
      const payload = await api("/api/comercial/stages");
      if (payload.stages?.length) setStages(payload.stages);
    } catch {
      /* fallback ate a migration ser aplicada */
    }
  }, [api]);
  useEffect(() => {
    // Initial data synchronization for this client-only Kanban.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    void loadStages();
  }, [load, loadStages]);

  useEffect(() => {
    const channel = supabase
      .channel(`commercial-kanban-${currentProfileId || "current"}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "comercial_leads" },
        () => {
          // Recarregar no meio de um arrasto faz o card voltar para a coluna
          // antiga na mao do usuario. Espera ele soltar.
          if (draggingRef.current) return;
          if (realtimeRefreshTimer.current) clearTimeout(realtimeRefreshTimer.current);
          realtimeRefreshTimer.current = setTimeout(() => {
            if (draggingRef.current) return;
            void load(true).catch(() => undefined);
          }, 250);
        },
      )
      .subscribe();
    return () => {
      if (realtimeRefreshTimer.current) clearTimeout(realtimeRefreshTimer.current);
      realtimeRefreshTimer.current = null;
      void supabase.removeChannel(channel);
    };
  }, [currentProfileId, load]);
  useEffect(() => {
    if (!expandedLeadId) {
      // Reset the modal-bound state when there is no selected lead.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setInteractionError(null);
      setContactCadence(null);
      setContactCadenceError(null);
      return;
    }
    const leadId = expandedLeadId;
    setInteractionError(null);
    void api(`/api/comercial/leads/${leadId}/interactions`)
      .then((payload) => {
        setInteractionsByLead((current) => ({
          ...current,
          [leadId]: payload.interactions || [],
        }));
      })
      .catch((error) => {
        setInteractionsByLead((current) => ({ ...current, [leadId]: [] }));
        setInteractionError(
          error instanceof Error
            ? error.message
            : "Nao foi possivel carregar os comentarios.",
        );
      });
    setContactCadenceLoading(true);
    setContactCadenceError(null);
    void api(`/api/comercial/leads/${leadId}/cadencia`)
      .then((payload) => setContactCadence(payload.cadence || null))
      .catch((error) => {
        setContactCadence(null);
        setContactCadenceError(
          error instanceof Error
            ? error.message
            : "Não foi possível carregar a cadência.",
        );
      })
      .finally(() => setContactCadenceLoading(false));
  }, [api, expandedLeadId]);

  async function updateContactCadence(
    order: number,
    result: "success" | "no_answer",
  ) {
    if (!expandedLeadId) return;
    setContactCadenceSavingOrder(order);
    setContactCadenceError(null);
    try {
      const payload = await api(
        `/api/comercial/leads/${expandedLeadId}/cadencia`,
        {
          method: "PATCH",
          body: JSON.stringify({ ordem: order, result }),
        },
      );
      setContactCadence(payload.cadence || null);
      const timeline = await api(
        `/api/comercial/leads/${expandedLeadId}/interactions`,
      );
      setInteractionsByLead((current) => ({
        ...current,
        [expandedLeadId]: timeline.interactions || [],
      }));
    } catch (error) {
      setContactCadenceError(
        error instanceof Error
          ? error.message
          : "Não foi possível registrar a tentativa.",
      );
    } finally {
      setContactCadenceSavingOrder(null);
    }
  }

  const memberMap = useMemo(
    () => new Map(members.map((member) => [member.profile_id, member])),
    [members],
  );
  const sdrMembers = useMemo(
    () => members.filter((member) => member.ativo && member.papel === "sdr"),
    [members],
  );
  const saleSellerMembers = useMemo(
    () => members.filter((member) => member.ativo && (member.papel === "closer" || member.profile_id === "a12b63f9-4c72-4a92-a99a-98c020723a06")),
    [members],
  );
  const canAssignSdr = isDevOps || canAssignCommercialResponsible(role, currentProfileId);
  const canManageStages = canManageCommercialStages(role, currentProfileId);
  const visible = useMemo(
    () =>
      leads.filter((lead) => {
        const matchesSearch = [lead.nome, lead.empresa, lead.telefone]
          .join(" ")
          .toLowerCase()
          .includes(search.toLowerCase());
        const date = new Date(lead.data_entrada).getTime();
        const matchesStart =
          !dateStart || date >= new Date(`${dateStart}T00:00:00`).getTime();
        const matchesEnd =
          !dateEnd || date <= new Date(`${dateEnd}T23:59:59`).getTime();
        const matchesSdr =
          sdrFilter === "todos" ||
          (sdrFilter === "sem_responsavel"
            ? !lead.sdr_id
            : lead.sdr_id === sdrFilter);
        return matchesSearch && matchesStart && matchesEnd && matchesSdr;
      }),
    [leads, search, dateStart, dateEnd, sdrFilter],
  );
  const grouped = useMemo(
    () =>
      Object.fromEntries(
        stages.map((stage) => [
          stage.id,
          visible.filter((lead) => lead.status === stage.id),
        ]),
      ),
    [stages, visible],
  );

  async function moveLead(id: string, status: string) {
    const normalizedStatus = status
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    if (normalizedStatus.trim() === "em negociacao") {
      const lead = leads.find((item) => item.id === id);
      setNegotiationMove({ leadId: id, status });
      setNegotiationValue(Number(lead?.valor_negociacao || 0) > 0 ? String(lead?.valor_negociacao) : "");
      setStageError(null);
      return;
    }
    if (normalizedStatus.trim() === "negocio fechado") {
      const lead = leads.find((item) => item.id === id);
      const currentUserCanSell = role === "closer" || currentProfileId === "a12b63f9-4c72-4a92-a99a-98c020723a06";
      const suggestedSeller = currentUserCanSell
        ? currentProfileId || ""
        : lead?.vendedor_id || lead?.closer_id || "";
      setSaleMove({ leadId: id, status });
      setSaleSellerId(saleSellerMembers.some((member) => member.profile_id === suggestedSeller) ? suggestedSeller : "");
      setSaleMeetingLink(lead?.reuniao_link || "");
      setSaleClosedAt(localDateTimeValue(lead?.fechado_at || new Date()));
      setSaleAmountPaid(String(lead?.valor_pago || lead?.valor_fechado || ""));
      setSalePaymentModel(lead?.modelo_pagamento || "");
      setSaleBriefingLead(null);
      return;
    }
    if (
      normalizedStatus.includes("reunio") &&
      normalizedStatus.includes("agend")
    ) {
      setMeetingMove({ leadId: id, status });
      setMeetingAt("");
      return;
    }
    setMovingId(id);
    setLeads((current) =>
      current.map((lead) =>
        lead.id === id
          ? { ...lead, status, status_started_at: new Date().toISOString() }
          : lead,
      ),
    );
    try {
      const payload = await api("/api/comercial/leads", {
        method: "PATCH",
        body: JSON.stringify({ id, status }),
      });
      if (payload.lead)
        setLeads((current) =>
          current.map((lead) => (lead.id === id ? payload.lead : lead)),
        );
      if (expandedLeadId === id) {
        const timeline = await api(`/api/comercial/leads/${id}/interactions`);
        setInteractionsByLead((current) => ({
          ...current,
          [id]: timeline.interactions || [],
        }));
        const cadence = await api(`/api/comercial/leads/${id}/cadencia`);
        setContactCadence(cadence.cadence || null);
      }
    } catch {
      await load();
    } finally {
      setMovingId(null);
    }
  }
  async function confirmNegotiationMove(event: React.FormEvent) {
    event.preventDefault();
    if (!negotiationMove) return;
    const value = Number(negotiationValue);
    if (!Number.isFinite(value) || value <= 0) {
      setStageError("Informe um valor de negociação maior que zero.");
      return;
    }
    setNegotiationSaving(true);
    setMovingId(negotiationMove.leadId);
    setStageError(null);
    try {
      const payload = await api("/api/comercial/leads", {
        method: "PATCH",
        body: JSON.stringify({
          id: negotiationMove.leadId,
          status: negotiationMove.status,
          valor_negociacao: value,
        }),
      });
      if (payload.lead) {
        setLeads((current) => current.map((lead) => lead.id === negotiationMove.leadId ? payload.lead : lead));
      }
      setNegotiationMove(null);
      setNegotiationValue("");
    } catch (error) {
      setStageError(error instanceof Error ? error.message : "Não foi possível mover o lead para negociação.");
    } finally {
      setNegotiationSaving(false);
      setMovingId(null);
    }
  }
  async function confirmSaleMove(event: React.FormEvent) {
    event.preventDefault();
    if (!saleMove || !saleSellerId || !saleMeetingLink.trim() || !saleClosedAt || !saleAmountPaid || !salePaymentModel) return;
    setSaleSaving(true);
    setMovingId(saleMove.leadId);
    setStageError(null);
    try {
      const payload = await api("/api/comercial/leads", {
        method: "PATCH",
        body: JSON.stringify({
          id: saleMove.leadId,
          status: saleMove.status,
          vendedor_id: saleSellerId,
          reuniao_link: saleMeetingLink.trim(),
          fechado_at: new Date(saleClosedAt).toISOString(),
          valor_pago: Number(saleAmountPaid),
          modelo_pagamento: salePaymentModel,
        }),
      });
      if (payload.lead) {
        setLeads((current) => current.map((lead) => lead.id === saleMove.leadId ? payload.lead : lead));
        setSaleBriefingLead(payload.lead);
      }
    } catch (error) {
      setStageError(error instanceof Error ? error.message : "Nao foi possivel contabilizar a venda.");
    } finally {
      setSaleSaving(false);
      setMovingId(null);
    }
  }
  async function downloadBriefingPdf(leadId: string) {
    setBriefingDownloading(leadId);
    setStageError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Sessão expirada. Entre novamente para baixar o PDF.");
      const query = currentProfileId ? `?view_profile_id=${encodeURIComponent(currentProfileId)}` : "";
      const response = await fetch(`/api/comercial/leads/${leadId}/briefing${query}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: "no-store",
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Não foi possível baixar o briefing.");
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `briefing-onboarding-${leadId}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (error) {
      setStageError(error instanceof Error ? error.message : "Não foi possível baixar o briefing.");
    } finally {
      setBriefingDownloading(null);
    }
  }
  async function startTrackedCall(lead: CommercialLead) {
    const digits = String(lead.telefone || "").replace(/\D/g, "");
    if (!digits) return;
    setStageError(null);
    try {
      await api("/api/comercial/calls", {
        method: "POST",
        body: JSON.stringify({ lead_id: lead.id, sdr_id: lead.sdr_id }),
      });
      window.location.href = `tel:${digits}`;
    } catch (callError) {
      setStageError(callError instanceof Error ? callError.message : "Não foi possível registrar a ligação.");
    }
  }
  async function confirmMeetingMove(event: React.FormEvent) {
    event.preventDefault();
    if (!meetingMove || !meetingAt) return;
    setMeetingSaving(true);
    setMovingId(meetingMove.leadId);
    try {
      const scheduledAt = new Date(meetingAt).toISOString();
      await api("/api/comercial/leads", {
        method: "PATCH",
        body: JSON.stringify({
          id: meetingMove.leadId,
          status: meetingMove.status,
          reuniao_agendada_at: scheduledAt,
        }),
      });
      setLeads((current) =>
        current.map((lead) =>
          lead.id === meetingMove.leadId
            ? {
                ...lead,
                status: meetingMove.status,
                reuniao_agendada_at: scheduledAt,
              }
            : lead,
        ),
      );
      setMeetingMove(null);
    } catch (error) {
      setStageError(
        error instanceof Error
          ? error.message
          : "Nao foi possivel agendar a reuniao.",
      );
    } finally {
      setMeetingSaving(false);
      setMovingId(null);
    }
  }
  async function saveStages(next: CommercialStage[]) {
    setStages(next);
    setStageSaving(true);
    setStageError(null);
    try {
      const payload = await api("/api/comercial/stages", {
        method: "PUT",
        body: JSON.stringify({ stages: next }),
      });
      setStages(payload.stages || next);
    } catch (error) {
      setStageError(
        error instanceof Error
          ? error.message
          : "Nao foi possivel salvar as etapas.",
      );
    } finally {
      setStageSaving(false);
    }
  }
  function reorderStages(targetId: string) {
    if (!stageDragging || stageDragging === targetId) return;
    const next = [...stages];
    const from = next.findIndex((stage) => stage.id === stageDragging);
    const to = next.findIndex((stage) => stage.id === targetId);
    if (from < 0 || to < 0) return;
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setStageDragging(null);
    void saveStages(next);
  }
  function addStage(event: React.FormEvent) {
    event.preventDefault();
    const label = newStageName.replace(/[<>]/g, "").replace(/\s+/g, " ").trim();
    if (
      !label ||
      stages.some((stage) => stage.label.toLowerCase() === label.toLowerCase())
    )
      return;
    setNewStageName("");
    setNewStageOpen(false);
    void saveStages([
      ...stages,
      { id: label, label, desc: "Etapa personalizada", protected: false },
    ]);
  }
  async function saveStageEdit(event: React.FormEvent) {
    event.preventDefault();
    if (!editingStage) return;
    const label = editingStageName
      .replace(/[<>]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!label) return;
    if (label === editingStage.label && editingStageColor === editingStage.color) {
      setEditingStage(null);
      return;
    }
    setStageSaving(true);
    setStageError(null);
    try {
      const payload = await api("/api/comercial/stages", {
        method: "PATCH",
        body: JSON.stringify({ old_id: editingStage.id, label, color: editingStageColor }),
      });
      setStages(payload.stages || stages);
      await load();
      setEditingStage(null);
    } catch (error) {
      setStageError(
        error instanceof Error
          ? error.message
          : "Nao foi possivel editar a etapa.",
      );
    } finally {
      setStageSaving(false);
    }
  }
  async function deleteStage(stage: CommercialStage) {
    if (stageSaving) return;
    const fallback = stages.find((item) => item.id !== stage.id);
    if (!fallback) {
      setStageError("O funil precisa ter pelo menos uma etapa.");
      return;
    }
    const leadCount = (grouped[stage.id] || []).length;
    const detail = leadCount
      ? ` Os ${leadCount} lead${leadCount === 1 ? "" : "s"} desta etapa serao movidos para ${fallback.label}.`
      : "";
    if (!window.confirm(`Excluir a etapa ${stage.label}?${detail}`)) return;
    setStageSaving(true);
    setStageError(null);
    try {
      const payload = await api("/api/comercial/stages", {
        method: "DELETE",
        body: JSON.stringify({ id: stage.id, fallback_id: fallback.id }),
      });
      setStages(payload.stages || stages.filter((item) => item.id !== stage.id));
      setEditingStage(null);
      await load();
    } catch (error) {
      setStageError(error instanceof Error ? error.message : "Nao foi possivel excluir a etapa.");
    } finally {
      setStageSaving(false);
    }
  }
  function openLeadInbox(event: React.MouseEvent, lead: CommercialLead) {
    event.stopPropagation();
    const params = new URLSearchParams({
      lead: lead.id,
      telefone: lead.telefone || "",
    });
    router.push(`/comercial/inbox?${params.toString()}`);
  }

  async function startLead(event: React.MouseEvent, lead: CommercialLead) {
    event.stopPropagation();
    const requestedSdrId = canAssignSdr
      ? lead.sdr_id ||
        assignmentChoice[lead.id] ||
        sdrMembers[0]?.profile_id ||
        ""
      : "";
    if (
      startingId ||
      lead.sdr_id ||
      (canAssignSdr && !requestedSdrId) ||
      (!canAssignSdr && role !== "sdr")
    )
      return;
    setStartingId(lead.id);
    try {
      const payload = await api("/api/comercial/leads/start", {
        method: "POST",
        body: JSON.stringify(
          canAssignSdr
            ? { id: lead.id, sdr_id: requestedSdrId }
            : { id: lead.id },
        ),
      });
      setLeads((current) =>
        current.map((item) =>
          item.id === lead.id
            ? { ...item, sdr_id: payload.sdr_id || currentProfileId }
            : item,
        ),
      );
    } catch (error) {
      setStageError(
        error instanceof Error
          ? error.message
          : "Nao foi possivel iniciar este lead.",
      );
      await load();
    } finally {
      setStartingId(null);
    }
  }

  async function changeLeadSdr(
    event: React.ChangeEvent<HTMLSelectElement>,
    lead: CommercialLead,
  ) {
    event.stopPropagation();
    if (!canAssignSdr || startingId) return;
    const sdrId = event.target.value || null;
    setAssignmentChoice((current) => ({ ...current, [lead.id]: sdrId || "" }));
    setStartingId(lead.id);
    try {
      const payload = await api("/api/comercial/leads/start", {
        method: "POST",
        body: JSON.stringify({ id: lead.id, sdr_id: sdrId }),
      });
      setLeads((current) =>
        current.map((item) =>
          item.id === lead.id
            ? { ...item, sdr_id: payload.sdr_id || null }
            : item,
        ),
      );
    } catch (error) {
      setStageError(
        error instanceof Error
          ? error.message
          : "Nao foi possivel alterar o responsavel.",
      );
      await load();
    } finally {
      setStartingId(null);
    }
  }

  function toggleLeadDetails(lead: CommercialLead) {
    const nextId = expandedLeadId === lead.id ? null : lead.id;
    setExpandedLeadId(nextId);
    setInteractionText("");
    setInteractionFile(null);
    setInteractionError(null);
    if (nextId) {
      setTaskForm({
        titulo: "",
        responsavel_id:
          lead.closer_id ||
          lead.sdr_id ||
          members.find((member) => member.ativo)?.profile_id ||
          "",
        vencimento: "",
        prioridade: "normal",
        descricao: "",
      });
    }
  }
  async function createLeadTask(event: React.FormEvent, lead: CommercialLead) {
    event.preventDefault();
    if (!taskForm.titulo.trim()) return;
    setTaskSaving(lead.id);
    try {
      const payload = await api("/api/comercial/tasks", {
        method: "POST",
        body: JSON.stringify({ ...taskForm, lead_id: lead.id }),
      });
      const scheduledAt =
        payload.task?.vencimento ||
        (taskForm.vencimento
          ? new Date(taskForm.vencimento).toISOString()
          : null);
      setLeads((current) =>
        current.map((item) =>
          item.id === lead.id
            ? {
                ...item,
                proximo_retorno_at: scheduledAt,
                proximo_retorno_titulo: payload.task?.titulo || taskForm.titulo,
              }
            : item,
        ),
      );
      setTaskForm((current) => ({
        ...current,
        titulo: "",
        vencimento: "",
        descricao: "",
      }));
    } finally {
      setTaskSaving(null);
    }
  }
  async function addInteraction(event: React.FormEvent, leadId: string) {
    event.preventDefault();
    if (!interactionText.trim() && !interactionFile) return;
    setInteractionSaving(true);
    setInteractionError(null);
    try {
      const form = new FormData();
      if (interactionText.trim())
        form.append("comentario", interactionText.trim());
      if (interactionFile) form.append("anexo", interactionFile);
      const payload = await api(`/api/comercial/leads/${leadId}/interactions`, {
        method: "POST",
        body: form,
      });
      setInteractionsByLead((current) => ({
        ...current,
        [leadId]: [
          {
            ...payload.interaction,
            autor_nome: payload.interaction.autor_nome || "Equipe comercial",
          },
          ...(current[leadId] || []),
        ],
      }));
      setInteractionText("");
      setInteractionFile(null);
      document
        .querySelectorAll<HTMLInputElement>(
          "#lead-attachment-inline, #lead-attachment-modal",
        )
        .forEach((input) => {
          input.value = "";
        });
    } catch (error) {
      setInteractionError(
        error instanceof Error
          ? error.message
          : "Nao foi possivel salvar o comentario.",
      );
    } finally {
      setInteractionSaving(false);
    }
  }

  function changeDatePreset(next: DatePreset) {
    setDatePreset(next);
    if (next !== "personalizado") {
      const range = getPresetRange(next);
      setDateStart(range.start);
      setDateEnd(range.end);
    }
  }

  return (
    <div
      className={`kh-kanban-page ${canViewCommercialFinancials ? "" : "kh-hide-commercial-financials"} ${canEditCommercial ? "" : "kh-read-only"}`}
    >
      <header className="kh-page-head">
        <div>
          <div className="kh-eyebrow">Pipeline de vendas</div>
          <h1>Kanban</h1>
          <p>
            Acompanhe a passagem do SDR para o closer e o avanco de cada
            negociacao.
          </p>
        </div>
        <div className="kh-actions">
          <div className="kh-search">
            <Search size={16} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar lead..."
            />
          </div>
          {role !== "sdr" && (
            <label className="kh-date-preset">
              <UserRound size={15} />
              <select
                value={sdrFilter}
                onChange={(event) => setSdrFilter(event.target.value)}
                aria-label="Filtrar por SDR"
              >
                <option value="todos">Todos os SDRs</option>
                <option value="sem_responsavel">Sem responsavel</option>
                {sdrMembers.map((member) => (
                  <option key={member.profile_id} value={member.profile_id}>
                    {member.nome}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="kh-date-preset">
            <CalendarDays size={15} />
            <select
              value={datePreset}
              onChange={(event) =>
                changeDatePreset(event.target.value as DatePreset)
              }
              aria-label="Período"
            >
              <option value="todos">Todo o período</option>
              <option value="hoje">Hoje</option>
              <option value="ontem">Ontem</option>
              <option value="7dias">Últimos 7 dias</option>
              <option value="30dias">Últimos 30 dias</option>
              <option value="mes">Este mês</option>
              <option value="personalizado">Personalizado</option>
            </select>
          </label>
          {datePreset === "personalizado" && (
            <>
              <input
                className="kh-input kh-date-filter"
                type="date"
                value={dateStart}
                onChange={(event) => setDateStart(event.target.value)}
                aria-label="Data inicial"
              />
              <input
                className="kh-input kh-date-filter"
                type="date"
                value={dateEnd}
                onChange={(event) => setDateEnd(event.target.value)}
                aria-label="Data final"
              />
            </>
          )}
          <button
            className="kh-icon-button"
            onClick={() => void load()}
            aria-label="Atualizar"
          >
            <RefreshCw size={17} className={loading ? "kh-spin" : ""} />
          </button>
          {canEditCommercial && <button
            className="kh-button primary"
            onClick={() => {
              setInitialStatus("Oportunidade");
              setModalOpen(true);
            }}
          >
            <Plus size={17} /> Novo lead
          </button>}
        </div>
      </header>
      {stageError && (
        <div className="kh-inline-error kh-stage-error" role="alert" aria-live="polite">
          {stageError}
          <button
            type="button"
            aria-label="Fechar aviso"
            onClick={() => setStageError(null)}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {canManageStages && (
        <div className="kh-kanban-toolbar">
          <span>Arraste uma coluna para reorganizar o funil.</span>
          <button
            type="button"
            className="kh-button"
            onClick={() => setNewStageOpen(true)}
            disabled={stageSaving}
          >
            {stageSaving ? (
              <RefreshCw size={16} className="kh-spin" />
            ) : (
              <Plus size={16} />
            )}{" "}
            {stageSaving ? "Salvando..." : "Adicionar etapa"}
          </button>
        </div>
      )}
      {canManageStages && newStageOpen && (
        <form className="kh-stage-add" onSubmit={addStage}>
          <input
            autoFocus
            className="kh-input"
            value={newStageName}
            onChange={(event) => setNewStageName(event.target.value)}
            placeholder="Nome da nova etapa"
            maxLength={60}
            required
          />
          <button className="kh-button primary">Criar etapa</button>
          <button
            type="button"
            className="kh-button"
            onClick={() => setNewStageOpen(false)}
          >
            Cancelar
          </button>
        </form>
      )}
      <div className="kh-kanban" aria-label="Pipeline comercial">
        {stages.map((stage, index) => {
          const statusLeads = grouped[stage.id] || [];
          const total = statusLeads.reduce(
            (sum, lead) => sum + Number(lead.valor_negociacao || 0),
            0,
          );
          return (
            <section
              key={stage.id}
              className={`kh-kanban-column ${dropStage === stage.id ? "drop-target" : ""} ${stageDragging === stage.id ? "stage-dragging" : ""}`}
              draggable={canEditCommercial && canManageStages && editingStage?.id !== stage.id}
              onDragStart={(event) => {
                event.stopPropagation();
                if (canManageStages) setStageDragging(stage.id);
              }}
              onDragEnd={() => setStageDragging(null)}
              onDragOver={(event) => {
                event.preventDefault();
                if (dragging) setDropStage(stage.id);
              }}
              onDragEnter={() => dragging && setDropStage(stage.id)}
              onDragLeave={() => setDropStage(null)}
              onDrop={(event) => {
                event.stopPropagation();
                if (stageDragging && canManageStages)
                  reorderStages(stage.id);
                else if (dragging) void moveLead(dragging, stage.id);
                setDragging(null);
                setStageDragging(null);
                setDropStage(null);
              }}
            >
              <header
                style={
                  {
                    "--stage-color": editingStage?.id === stage.id
                      ? editingStageColor
                      : stageColor(stage, index),
                  } as React.CSSProperties
                }
              >
                {editingStage?.id === stage.id ? (
                  <form
                    className="kh-stage-inline-editor"
                    onSubmit={saveStageEdit}
                    onClick={(event) => event.stopPropagation()}
                    onMouseDown={(event) => event.stopPropagation()}
                  >
                    <input
                      autoFocus
                      type="text"
                      value={editingStageName}
                      onChange={(event) => setEditingStageName(event.target.value)}
                      maxLength={60}
                      aria-label="Nome da etapa"
                      required
                    />
                    <label title="Cor da etapa">
                      <input
                        type="color"
                        value={editingStageColor}
                        onChange={(event) => setEditingStageColor(event.target.value.toUpperCase())}
                        aria-label="Cor da etapa"
                      />
                    </label>
                    <button type="submit" title="Salvar alterações" aria-label="Salvar alterações" disabled={stageSaving}>
                      <Check size={14} />
                    </button>
                    <button
                      type="button"
                      className="danger"
                      title="Excluir etapa"
                      aria-label={`Excluir ${stage.label}`}
                      disabled={stageSaving}
                      onClick={() => void deleteStage(stage)}
                    >
                      <Trash2 size={14} />
                    </button>
                    <button type="button" title="Cancelar" aria-label="Cancelar edição" onClick={() => setEditingStage(null)}>
                      <X size={14} />
                    </button>
                  </form>
                ) : <>
                  <div>
                    <GripVertical size={14} className="kh-stage-grip" />
                    <strong>{stage.label}</strong>
                    <b>{statusLeads.length}</b>
                  </div>
                  {canViewCommercialFinancials && (
                    <small>{currency(total)}</small>
                  )}
                </>}
                {canManageStages && editingStage?.id !== stage.id && (
                  <div className="kh-stage-actions">
                    <button
                      type="button"
                      title="Editar etapa"
                      aria-label={`Editar ${stage.label}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        setEditingStage(stage);
                        setEditingStageName(stage.label);
                        setEditingStageColor(stageColor(stage, index));
                      }}
                    >
                      <Pencil size={12} />
                    </button>
                  </div>
                )}
              </header>
              <div className="kh-kanban-cards">
                <div className="kh-kanban-list">
                  {statusLeads.map((lead) => {
                    const assignedSdr = lead.sdr_id
                      ? memberMap.get(lead.sdr_id)
                      : null;
                    const selectedSdr =
                      lead.sdr_id ||
                      assignmentChoice[lead.id] ||
                      sdrMembers[0]?.profile_id ||
                      "";
                    const mqlLevel = getCommercialMqlLevel(
                      lead.faturamento_mensal,
                      lead.investimento,
                    );
                    const cadenceDay = cadenceDayFromStage(lead.status);
                    const cadenceOverdue = isCadenceStageOverdue(lead);
                    return (
                      <article
                        key={lead.id}
                        draggable={canEditCommercial}
                        onDragStart={(event) => {
                          event.stopPropagation();
                          if (canEditCommercial) setDragging(lead.id);
                        }}
                        onDragEnd={() => {
                          setDragging(null);
                          setDropStage(null);
                        }}
                        onClick={() => toggleLeadDetails(lead)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            toggleLeadDetails(lead);
                          }
                        }}
                        tabIndex={0}
                        role="button"
                        className={`kh-danilo-card ${dragging === lead.id ? "dragging" : ""} ${cadenceOverdue ? "is-cadence-overdue" : ""}`}
                      >
                        <div className="kh-card-top">
                          <span
                            className={`kh-dot level-${mqlLevel.toLowerCase()}`}
                            aria-hidden="true"
                          />
                          <small>Lead</small>
                          <span className="kh-card-expand">
                            <ChevronDown size={14} />
                          </span>
                        </div>
                        <h3>{lead.nome}</h3>
                        <div className="kh-card-phone">
                          <Phone size={12} />
                          <span>
                            {lead.telefone || "Telefone nao informado"}
                          </span>
                        </div>
                        <span className="kh-card-cnpj">
                          {formatDaniloCnpj(lead)}
                        </span>
                        {(Number(lead.valor_negociacao || 0) > 0 || normalizeStageForCard(lead.status) === "em negociacao") && (
                          <div className="kh-card-negotiation-value">
                            <CircleDollarSign size={12} />
                            <span>{currency(Number(lead.valor_negociacao || 0))}</span>
                          </div>
                        )}
                        {isContactCadenceStage(lead.status) && (
                          <div className="kh-card-cadence">
                            Cadência: Dia {cadenceDay}
                          </div>
                        )}
                        {cadenceOverdue && (
                          <div className="kh-card-cadence-alert" role="status">
                            <AlertTriangle size={12} /> Mover para o próximo dia
                          </div>
                        )}
                        <div className="kh-card-entry">
                          <CalendarDays size={12} />
                          <span>{formatDaniloEntry(lead.data_entrada)}</span>
                        </div>
                        {lead.proximo_retorno_at && (
                          <div className="kh-card-return">
                            <CalendarClock size={12} />
                            <span>
                              Retorno{" "}
                              {new Date(lead.proximo_retorno_at).toLocaleString(
                                "pt-BR",
                                {
                                  day: "2-digit",
                                  month: "2-digit",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                },
                              )}
                            </span>
                          </div>
                        )}
                        {canEditCommercial && <div className="kh-card-actions">
                          <button
                            type="button"
                            className="kh-card-inbox"
                            onClick={(event) => openLeadInbox(event, lead)}
                          >
                            <MessageSquare size={13} /> Abrir no Inbox
                          </button>
                          {canAssignSdr && (
                            <select
                              aria-label={`Responsavel SDR de ${lead.nome}`}
                              className="kh-card-owner-select"
                              value={selectedSdr}
                              onClick={(event) => event.stopPropagation()}
                              onChange={(event) =>
                                void changeLeadSdr(event, lead)
                              }
                              disabled={startingId === lead.id}
                            >
                              <option value="">Sem responsavel</option>
                              {sdrMembers.map((member) => (
                                <option
                                  key={member.profile_id}
                                  value={member.profile_id}
                                >
                                  {member.nome.split(" ")[0]}
                                </option>
                              ))}
                            </select>
                          )}
                          {!assignedSdr && (role === "sdr" || canAssignSdr) && (
                            <button
                              type="button"
                              className="kh-card-start"
                              disabled={
                                startingId === lead.id ||
                                (canAssignSdr && !selectedSdr)
                              }
                              onClick={(event) => void startLead(event, lead)}
                            >
                              {startingId === lead.id
                                ? "Iniciando..."
                                : "Start"}
                            </button>
                          )}
                          {!canAssignSdr && role === "sdr" && assignedSdr && (
                            <span className="kh-card-owner">
                              SDR: {assignedSdr.nome.split(" ")[0]}
                            </span>
                          )}
                        </div>}
                      </article>
                    );
                  })}
                  {!statusLeads.length && (
                    <div className="kh-column-empty">
                      <img
                        src="/brand-logo.png"
                        alt="ORION TRACK"
                        className="kh-empty-logo"
                      />
                      <span>Sem leads</span>
                    </div>
                  )}
                </div>
                {canEditCommercial && <button
                  type="button"
                  className="kh-add-lead-column"
                  onClick={() => {
                    setInitialStatus(stage.id);
                    setModalOpen(true);
                  }}
                >
                  <Plus size={16} /> Adicionar lead
                </button>}
              </div>
            </section>
          );
        })}
      </div>
      {expandedLeadId &&
        (() => {
          const lead = leads.find((item) => item.id === expandedLeadId);
          if (!lead) return null;
          const ownerId = lead.closer_id || lead.sdr_id || "";
          return (
            <div
              className="kh-lead-overlay"
              style={{ display: "none" }}
              aria-hidden="true"
            >
              <section className="kh-lead-modal">
                <header>
                  <div>
                    <span className="kh-eyebrow">Lead comercial</span>
                    <h2>{lead.nome}</h2>
                    <p>
                      {lead.empresa || "Sem empresa informada"} ·{" "}
                      {memberMap.get(ownerId)?.nome || "Sem responsavel"}
                    </p>
                  </div>
                </header>
              </section>
            </div>
          );
        })()}
      {meetingMove && (
        <div
          className="kh-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="meeting-modal-title"
        >
          <button
            type="button"
            className="kh-modal-scrim"
            aria-label="Fechar"
            onClick={() => setMeetingMove(null)}
          />
          <form
            className="kh-modal-sheet kh-meeting-modal"
            onSubmit={(event) => void confirmMeetingMove(event)}
          >
            <header>
              <div>
                <span>Reunião agendada</span>
                <h2 id="meeting-modal-title">Informe data e horário</h2>
              </div>
              <button
                type="button"
                aria-label="Fechar"
                onClick={() => setMeetingMove(null)}
              >
                <X size={18} />
              </button>
            </header>
            <div className="kh-meeting-form">
              <p>
                Informe quando a reunião acontecerá. O lead só será movido para
                esta etapa depois que o agendamento for registrado.
              </p>
              <label>
                <span>Data e horário da reunião</span>
                <input
                  className="kh-input"
                  type="datetime-local"
                  value={meetingAt}
                  onChange={(event) => setMeetingAt(event.target.value)}
                  required
                  autoFocus
                />
              </label>
            </div>
            <footer>
              <button
                type="button"
                className="kh-button"
                onClick={() => setMeetingMove(null)}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="kh-button primary"
                disabled={meetingSaving}
              >
                {meetingSaving ? (
                  <RefreshCw size={15} className="kh-spin" />
                ) : (
                  <CalendarPlus size={15} />
                )}{" "}
                {meetingSaving ? "Salvando..." : "Confirmar agendamento"}
              </button>
            </footer>
          </form>
        </div>
      )}
      {saleMove && (
        <div className="kh-modal" role="dialog" aria-modal="true" aria-labelledby="sale-modal-title">
          <button type="button" className="kh-modal-scrim" aria-label="Fechar" onClick={() => setSaleMove(null)} />
          <form className="kh-modal-sheet kh-meeting-modal" onSubmit={(event) => void confirmSaleMove(event)}>
            <header>
              <div><span>Venda concluida</span><h2 id="sale-modal-title">Confirmar negocio fechado</h2></div>
              <button type="button" aria-label="Fechar" onClick={() => setSaleMove(null)}><X size={18} /></button>
            </header>
            <div className="kh-meeting-form">
              {saleBriefingLead ? (
                <div className="kh-briefing-ready">
                  <FileCheck2 size={30} />
                  <div><strong>Venda salva e briefing gerado</strong><p>O relatório operacional foi preparado com até 15 tópicos e já pode ser baixado em PDF.</p></div>
                  <ol>{String(saleBriefingLead.onboarding_briefing || "").split(/\r?\n/).filter(Boolean).slice(0, 15).map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}</ol>
                </div>
              ) : (
                <>
                  <p>Informe os dados do fechamento e o link da reunião. Ao salvar, o briefing operacional será gerado automaticamente.</p>
                  <label><span>Quem vendeu?</span><select className="kh-input" value={saleSellerId} onChange={(event) => setSaleSellerId(event.target.value)} required autoFocus><option value="">Selecione o closer ou Pedro</option>{saleSellerMembers.map((member) => <option key={member.profile_id} value={member.profile_id}>{member.nome}</option>)}</select></label>
                  <div className="kh-sale-grid">
                    <label><span>Quando o lead fechou?</span><input className="kh-input" type="datetime-local" value={saleClosedAt} onChange={(event) => setSaleClosedAt(event.target.value)} required /></label>
                    <label><span>Quanto pagou?</span><input className="kh-input" type="number" min="0.01" step="0.01" value={saleAmountPaid} onChange={(event) => setSaleAmountPaid(event.target.value)} placeholder="0,00" required /></label>
                  </div>
                  <label><span>Modelo de pagamento</span><select className="kh-input" value={salePaymentModel} onChange={(event) => setSalePaymentModel(event.target.value as typeof salePaymentModel)} required><option value="">Selecione</option><option value="tcv">TCV</option><option value="mrr">MRR</option><option value="mesclado">Mesclado</option></select></label>
                  <label><span>Link da reunião</span><input className="kh-input" type="url" value={saleMeetingLink} onChange={(event) => setSaleMeetingLink(event.target.value)} placeholder="https://meet.google.com/..." required /></label>
                </>
              )}
              {stageError && <div className="kh-inline-error" role="alert">{stageError}</div>}
            </div>
            <footer>
              <button type="button" className="kh-button" onClick={() => { setSaleMove(null); setSaleBriefingLead(null); }}>{saleBriefingLead ? "Concluir" : "Cancelar"}</button>
              {saleBriefingLead ? (
                <button type="button" className="kh-button primary" disabled={briefingDownloading === saleBriefingLead.id} onClick={() => void downloadBriefingPdf(saleBriefingLead.id)}><Download size={15} /> {briefingDownloading === saleBriefingLead.id ? "Baixando..." : "Baixar PDF agora"}</button>
              ) : (
                <button type="submit" className="kh-button primary" disabled={saleSaving || !saleSellerId || !saleMeetingLink.trim() || !saleClosedAt || !saleAmountPaid || !salePaymentModel}>{saleSaving ? <RefreshCw size={15} className="kh-spin" /> : <UserRound size={15} />} {saleSaving ? "Gerando briefing..." : "Salvar e gerar briefing"}</button>
              )}
            </footer>
          </form>
        </div>
      )}
      {negotiationMove && (
        <div className="kh-modal" role="dialog" aria-modal="true" aria-labelledby="negotiation-title">
          <button className="kh-modal-scrim" type="button" onClick={() => setNegotiationMove(null)} aria-label="Fechar" />
          <form className="kh-modal-sheet kh-meeting-modal" onSubmit={confirmNegotiationMove}>
            <header>
              <div><span>Etapa comercial</span><h2 id="negotiation-title">Informar valor da negociação</h2></div>
              <button type="button" aria-label="Fechar" onClick={() => setNegotiationMove(null)}><X size={18} /></button>
            </header>
            <div className="kh-meeting-form">
              <p>O lead só pode entrar em negociação depois que o valor estimado for registrado.</p>
              <label><span>Valor da negociação *</span><input className="kh-input" type="number" min="0.01" step="0.01" value={negotiationValue} onChange={(event) => setNegotiationValue(event.target.value)} placeholder="0,00" required autoFocus /></label>
              {stageError && <div className="kh-inline-error" role="alert">{stageError}</div>}
            </div>
            <footer>
              <button type="button" className="kh-button" onClick={() => setNegotiationMove(null)}>Cancelar</button>
              <button type="submit" className="kh-button primary" disabled={negotiationSaving || Number(negotiationValue) <= 0}>{negotiationSaving ? "Salvando..." : "Confirmar negociação"}</button>
            </footer>
          </form>
        </div>
      )}
      <CommercialLeadDetailsModal
        lead={
          expandedLeadId
            ? leads.find((lead) => lead.id === expandedLeadId) || null
            : null
        }
        members={members}
        canViewFinancials={canViewCommercialFinancials}
        readOnly={!canEditCommercial}
        canEditSale={role === "coordenador" || isDevOps}
        canEditEntryDate={role === "coordenador" || isDevOps}
        briefingDownloading={briefingDownloading === expandedLeadId}
        onDownloadBriefing={(leadId) => downloadBriefingPdf(leadId)}
        onStartCall={startTrackedCall}
        contactCadence={contactCadence}
        contactCadenceLoading={contactCadenceLoading}
        contactCadenceSavingOrder={contactCadenceSavingOrder}
        contactCadenceError={contactCadenceError}
        onUpdateContactCadence={updateContactCadence}
        stages={stages}
        onMoveStage={(status) => {
          if (expandedLeadId) void moveLead(expandedLeadId, status);
        }}
        interactions={
          expandedLeadId ? interactionsByLead[expandedLeadId] || [] : []
        }
        interactionText={interactionText}
        interactionFile={interactionFile}
        interactionSaving={interactionSaving}
        interactionError={interactionError}
        taskForm={taskForm}
        taskSaving={Boolean(taskSaving)}
        onTaskChange={(field, value) =>
          setTaskForm((current) => ({ ...current, [field]: value }))
        }
        onCreateTask={async (event) => {
          const lead = leads.find((item) => item.id === expandedLeadId);
          if (lead) await createLeadTask(event, lead);
        }}
        onInteractionTextChange={setInteractionText}
        onInteractionFileChange={setInteractionFile}
        onAddInteraction={(event) => {
          const lead = leads.find((item) => item.id === expandedLeadId);
          if (lead) void addInteraction(event, lead.id);
        }}
        onClose={() => setExpandedLeadId(null)}
        onSave={async (data) => {
          const payload = await api("/api/comercial/leads", {
            method: "PATCH",
            body: JSON.stringify(data),
          });
          if (payload.lead)
            setLeads((current) =>
              current.map((lead) =>
                lead.id === payload.lead.id ? payload.lead : lead,
              ),
            );
        }}
      />
      <CommercialLeadModal
        open={modalOpen}
        members={members}
        stages={stages}
        initialStatus={initialStatus}
        lead={null}
        canViewFinancials={canViewCommercialFinancials}
        onClose={() => setModalOpen(false)}
        onSave={async (data) => {
          await api("/api/comercial/leads", {
            method: "POST",
            body: JSON.stringify(data),
          });
          await load();
        }}
      />
    </div>
  );
}
