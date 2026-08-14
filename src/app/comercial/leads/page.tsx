"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  CheckSquare2,
  ChevronLeft,
  ChevronRight,
  Download,
  Edit3,
  Plus,
  PhoneCall,
  RefreshCw,
  Search,
  Square,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useCommercial } from "@/components/commercial/CommercialShell";
import CommercialLeadModal from "@/components/commercial/CommercialLeadModal";
import { COMMERCIAL_STATUSES, type CommercialLead } from "@/lib/comercial";

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

type DatePreset =
  | "todos" | "hoje" | "ontem" | "7dias" | "30dias" | "mes" | "personalizado";

function localDateValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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

export default function CommercialLeadsPage() {
  const {
    api,
    members,
    canViewCommercialFinancials,
    canViewCommercialLeadQualification,
    canEditCommercial,
  } = useCommercial();
  const [leads, setLeads] = useState<CommercialLead[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("todos");
  const [datePreset, setDatePreset] = useState<DatePreset>("todos");
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<CommercialLead | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [sheetLink, setSheetLink] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const sheetRef = useRef<HTMLElement | null>(null);
  const sheetGuideRef = useRef<HTMLDivElement | null>(null);
  const [sheetContentWidth, setSheetContentWidth] = useState(0);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  async function startCall(lead: CommercialLead) {
    const digits = String(lead.telefone || "").replace(/\D/g, "");
    if (!digits) return;
    setNotice(null);
    try {
      await api("/api/comercial/calls", {
        method: "POST",
        body: JSON.stringify({ lead_id: lead.id, sdr_id: lead.sdr_id }),
      });
      window.location.href = `tel:${digits}`;
    } catch (callError) {
      setNotice(callError instanceof Error ? callError.message : "Não foi possível registrar a ligação.");
    }
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await api("/api/comercial/leads");
      setLeads(payload.leads || []);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const visible = useMemo(
    () =>
      leads.filter((lead) => {
        const values = [
          lead.nome,
          lead.telefone,
          lead.email,
          lead.ja_investiu_trafego,
          lead.faturamento_mensal,
          lead.prioridade,
          lead.investimento,
          lead.vidas,
          lead.status,
          lead.utm_source,
          lead.utm_medium,
          lead.utm_campaign,
          lead.utm_term,
          lead.utm_content,
        ];
        const haystack = values
          .map((value) => String(value || ""))
          .join(" ")
          .toLowerCase();
        const date = new Date(lead.data_entrada).getTime();
        const matchesStart =
          !dateStart || date >= new Date(`${dateStart}T00:00:00`).getTime();
        const matchesEnd =
          !dateEnd || date <= new Date(`${dateEnd}T23:59:59`).getTime();
        return (
          (!search || haystack.includes(search.toLowerCase())) &&
          (status === "todos" || lead.status === status) &&
          matchesStart &&
          matchesEnd
        );
      }),
    [leads, search, status, dateStart, dateEnd],
  );

  const updateScrollControls = useCallback(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    setSheetContentWidth(sheet.scrollWidth);
    setCanScrollLeft(sheet.scrollLeft > 2);
    setCanScrollRight(sheet.scrollLeft + sheet.clientWidth < sheet.scrollWidth - 2);
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(updateScrollControls);
    const sheet = sheetRef.current;
    const table = sheet?.querySelector("table");
    const observer = new ResizeObserver(updateScrollControls);
    if (sheet) observer.observe(sheet);
    if (table) observer.observe(table);
    window.addEventListener("resize", updateScrollControls);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", updateScrollControls);
    };
  }, [updateScrollControls, visible.length, canViewCommercialLeadQualification]);

  function syncGuideFromSheet() {
    const sheet = sheetRef.current;
    const guide = sheetGuideRef.current;
    if (sheet && guide && Math.abs(guide.scrollLeft - sheet.scrollLeft) > 1) {
      guide.scrollLeft = sheet.scrollLeft;
    }
    updateScrollControls();
  }

  function syncSheetFromGuide() {
    const sheet = sheetRef.current;
    const guide = sheetGuideRef.current;
    if (sheet && guide && Math.abs(sheet.scrollLeft - guide.scrollLeft) > 1) {
      sheet.scrollLeft = guide.scrollLeft;
    }
    updateScrollControls();
  }

  function scrollSheet(direction: -1 | 1) {
    const sheet = sheetRef.current;
    if (!sheet) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    sheet.scrollBy({
      left: direction * Math.max(320, Math.round(sheet.clientWidth * 0.72)),
      behavior: reduceMotion ? "auto" : "smooth",
    });
  }

  const columnCount =
    (canViewCommercialLeadQualification ? 16 : 13) -
    (canEditCommercial ? 0 : 1);
  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected((current) =>
      current.size === visible.length
        ? new Set()
        : new Set(visible.map((lead) => lead.id)),
    );
  }
  function editSelected() {
    if (selected.size !== 1) return;
    const lead = leads.find((item) => selected.has(item.id));
    if (!lead) return;
    setEditing(lead);
    setModalOpen(true);
  }

  async function updateLead(id: string, changes: Record<string, unknown>) {
    setLeads((current) =>
      current.map((lead) => (lead.id === id ? { ...lead, ...changes } : lead)),
    );
    try {
      await api("/api/comercial/leads", {
        method: "PATCH",
        body: JSON.stringify({ id, ...changes }),
      });
    } catch (error) {
      await load();
      throw error;
    }
  }

  async function bulkStatus(nextStatus: string) {
    await Promise.all(
      Array.from(selected).map((id) => updateLead(id, { status: nextStatus })),
    );
    setSelected(new Set());
  }

  async function deleteSelected() {
    if (
      !selected.size ||
      !window.confirm(
        `Excluir ${selected.size} lead${selected.size > 1 ? "s" : ""}? Esta acao nao pode ser desfeita.`,
      )
    )
      return;
    setActionLoading(true);
    setNotice(null);
    try {
      const payload = await api("/api/comercial/leads", {
        method: "DELETE",
        body: JSON.stringify({ ids: Array.from(selected) }),
      });
      setSelected(new Set());
      setNotice(
        `${payload.deleted || selected.size} lead${Number(payload.deleted || selected.size) === 1 ? "" : "s"} excluido${Number(payload.deleted || selected.size) === 1 ? "" : "s"}.`,
      );
      await load();
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Nao foi possivel excluir os leads.",
      );
    } finally {
      setActionLoading(false);
    }
  }

  async function importSheet() {
    if (!sheetLink.trim()) return;
    setActionLoading(true);
    setNotice(null);
    try {
      const payload = await api("/api/comercial/leads/import-sheets", {
        method: "POST",
        body: JSON.stringify({ link: sheetLink.trim() }),
      });
      setImportOpen(false);
      setSheetLink("");
      setNotice(
        `Importacao concluida: ${payload.created || 0} novos e ${payload.enriched || 0} atualizados.`,
      );
      await load();
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Nao foi possivel importar a planilha.",
      );
    } finally {
      setActionLoading(false);
    }
  }

  function exportCsv() {
    const headers = [
      "DATA",
      "NOME",
      "TELEFONE",
      "EMAIL",
      ...(canViewCommercialLeadQualification
        ? ["JA INVESTIU EM TRAFEGO?", "FATURAMENTO MENSAL"]
        : []),
      "PRIORIDADE",
      ...(canViewCommercialLeadQualification ? ["INVESTIMENTO"] : []),
      "VIDAS",
      "UTM SOURCE",
      "UTM MEDIUM",
      "UTM CAMPAIGN",
      "UTM TERM",
      "UTM CONTENT",
    ];
    const rows = visible.map((lead) => [
      formatDate(lead.data_entrada),
      lead.nome,
      lead.telefone || "",
      lead.email || "",
      ...(canViewCommercialLeadQualification
        ? [lead.ja_investiu_trafego || "", lead.faturamento_mensal || ""]
        : []),
      lead.prioridade || "",
      ...(canViewCommercialLeadQualification ? [lead.investimento || ""] : []),
      lead.vidas || "",
      lead.utm_source || "",
      lead.utm_medium || "",
      lead.utm_campaign || "",
      lead.utm_term || "",
      lead.utm_content || "",
    ]);
    const csv = [headers, ...rows]
      .map((row) =>
        row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(";"),
      )
      .join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(
      new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" }),
    );
    link.download = `leads-comercial-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
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
    <div className={`kh-commercial-leads-page${canEditCommercial ? "" : " kh-read-only"}`}>
      <header className="kh-page-head">
        <div>
          <div className="kh-eyebrow">Central de leads</div>
          <h1>Leads</h1>
          <p>
            Planilha comercial com os dados de qualificacao, origem e
            acompanhamento.
          </p>
        </div>
        <div className="kh-actions">
          <button className="kh-button" onClick={exportCsv}>
            <Download size={16} /> Exportar
          </button>
          {canEditCommercial && (
            <button className="kh-button" onClick={() => setImportOpen(true)}>
              <Upload size={16} /> Importar planilha
            </button>
          )}
          <button
            className="kh-icon-button"
            onClick={() => void load()}
            aria-label="Atualizar"
          >
            <RefreshCw size={17} className={loading ? "kh-spin" : ""} />
          </button>
          {canEditCommercial && (
            <button
              className="kh-button primary"
              onClick={() => {
                setEditing(null);
                setModalOpen(true);
              }}
            >
              <Plus size={17} /> Adicionar lead
            </button>
          )}
        </div>
      </header>
      {notice && (
        <div className="kh-inline-notice" role="status">
          {notice}
          <button onClick={() => setNotice(null)} aria-label="Fechar aviso">
            <X size={14} />
          </button>
        </div>
      )}
      <section className="kh-sheet-filters">
        <div className="kh-search">
          <Search size={16} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar nome, telefone ou e-mail..."
          />
        </div>
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
        <select
          className="kh-select"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="todos">Todos os status</option>
          {COMMERCIAL_STATUSES.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
        <span>
          {visible.length} de {leads.length} leads
        </span>
      </section>
      <nav className="kh-sheet-scroll-guide" aria-label="Navegação horizontal da planilha">
        <div className="kh-sheet-scroll-guide-head">
          <span>Arraste a barra para ver mais colunas</span>
          <div>
            <button
              type="button"
              onClick={() => scrollSheet(-1)}
              disabled={!canScrollLeft}
              aria-label="Mover planilha para a esquerda"
            >
              <ChevronLeft size={17} />
              Esquerda
            </button>
            <button
              type="button"
              onClick={() => scrollSheet(1)}
              disabled={!canScrollRight}
              aria-label="Mover planilha para a direita"
            >
              Direita
              <ChevronRight size={17} />
            </button>
          </div>
        </div>
        <div
          ref={sheetGuideRef}
          className="kh-sheet-scrollbar"
          onScroll={syncSheetFromGuide}
          role="region"
          aria-label="Barra de rolagem horizontal da planilha"
          tabIndex={0}
        >
          <div style={{ width: Math.max(sheetContentWidth, 1) }} />
        </div>
      </nav>
      <section
        ref={sheetRef}
        className={`kh-sheet-wrap${canScrollLeft ? " is-scrolled" : ""}`}
        onScroll={syncGuideFromSheet}
      >
        <table className="kh-sheet-table">
          <thead>
            <tr>
            {canEditCommercial && <th className="select">
                <button onClick={toggleAll} aria-label="Selecionar todos">
                  {selected.size === visible.length && visible.length ? (
                    <CheckSquare2 size={16} />
                  ) : (
                    <Square size={16} />
                  )}
                </button>
            </th>}
              <th className="index">#</th>
              <th className="date">DATA</th>
              <th className="name">NOME</th>
              <th className="phone">TELEFONE</th>
              <th className="email">EMAIL</th>
              {canViewCommercialLeadQualification && (
                <>
                  <th className="qualification">JA INVESTIU EM TRAFEGO?</th>
                  <th className="revenue">FATURAMENTO MENSAL</th>
                </>
              )}
              <th className="priority">PRIORIDADE</th>
              {canViewCommercialLeadQualification && <th className="investment">INVESTIMENTO</th>}
              <th className="lives">VIDAS</th>
              <th className="utm">UTM SOURCE</th>
              <th className="utm">UTM MEDIUM</th>
              <th className="utm campaign">UTM CAMPAIGN</th>
              <th className="utm">UTM TERM</th>
              <th className="utm">UTM CONTENT</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((lead, index) => (
              <tr
                key={lead.id}
                className={selected.has(lead.id) ? "selected" : ""}
              >
                {canEditCommercial && <td className="select" data-label="Selecionar">
                  <button
                    onClick={() => toggle(lead.id)}
                    aria-label={`Selecionar ${lead.nome}`}
                  >
                    {selected.has(lead.id) ? (
                      <CheckSquare2 size={15} />
                    ) : (
                      <Square size={15} />
                    )}
                  </button>
                </td>}
                <td className="index" data-label="#">{index + 1}</td>
                <td className="date" data-label="Data">{formatDate(lead.data_entrada)}</td>
                <td className="name" data-label="Nome">{lead.nome}</td>
                <td className="phone" data-label="Telefone">{lead.telefone ? (canEditCommercial ? <button type="button" className="kh-table-phone" onClick={() => void startCall(lead)} title="Ligar e registrar no CRM"><PhoneCall size={14} />{lead.telefone}</button> : lead.telefone) : "-"}</td>
                <td className="email" data-label="E-mail">{lead.email || "-"}</td>
                {canViewCommercialLeadQualification && (
                  <>
                    <td className="qualification" data-label="Já investiu em tráfego?">{lead.ja_investiu_trafego || "-"}</td>
                    <td className="revenue" data-label="Faturamento mensal">{lead.faturamento_mensal || "-"}</td>
                  </>
                )}
                <td className="priority" data-label="Prioridade">{lead.prioridade || "-"}</td>
                {canViewCommercialLeadQualification && (
                  <td className="investment" data-label="Investimento">{lead.investimento || "-"}</td>
                )}
                <td className="lives" data-label="Vidas">{lead.vidas || "-"}</td>
                <td className="utm" data-label="UTM source">{lead.utm_source || "-"}</td>
                <td className="utm" data-label="UTM medium">{lead.utm_medium || "-"}</td>
                <td className="utm campaign" data-label="UTM campaign">{lead.utm_campaign || "-"}</td>
                <td className="utm" data-label="UTM term">{lead.utm_term || "-"}</td>
                <td className="utm" data-label="UTM content">{lead.utm_content || "-"}</td>
              </tr>
            ))}
            {!visible.length && (
              <tr>
                <td colSpan={columnCount} className="kh-table-empty">
                  {loading
                    ? "Carregando leads..."
                    : "Nenhum lead encontrado com esses filtros."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
      {canEditCommercial && selected.size > 0 && (
        <div className="kh-bulk-bar">
          <strong>
            {selected.size} selecionado{selected.size > 1 ? "s" : ""}
          </strong>
          <select
            className="kh-select"
            defaultValue=""
            onChange={(event) => {
              if (event.target.value) void bulkStatus(event.target.value);
            }}
          >
            <option value="" disabled>
              Mover para status...
            </option>
            {COMMERCIAL_STATUSES.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
          <button
            type="button"
            className="kh-bulk-edit"
            disabled={selected.size !== 1}
            title={
              selected.size === 1
                ? "Editar lead selecionado"
                : "Selecione apenas um lead para editar"
            }
            onClick={editSelected}
          >
            <Edit3 size={15} /> Editar lead
          </button>
          <button
            type="button"
            className="danger"
            disabled={actionLoading}
            onClick={() => void deleteSelected()}
          >
            <Trash2 size={15} /> Excluir lead{selected.size > 1 ? "s" : ""}
          </button>
          <button
            type="button"
            aria-label="Limpar selecao"
            onClick={() => setSelected(new Set())}
          >
            <X size={17} />
          </button>
        </div>
      )}
      {importOpen && (
        <div className="kh-modal-backdrop" role="presentation">
          <div
            className="kh-modal kh-import-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="import-leads-title"
          >
            <button
              className="kh-modal-close"
              onClick={() => setImportOpen(false)}
              aria-label="Fechar"
            >
              <X size={18} />
            </button>
            <div className="kh-eyebrow">Importacao</div>
            <h2 id="import-leads-title">Importar planilha</h2>
            <p>
              Use um link do Google Sheets publicado ou compartilhado para
              leitura.
            </p>
            <input
              className="kh-input"
              value={sheetLink}
              onChange={(event) => setSheetLink(event.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/..."
            />
            <div className="kh-modal-actions">
              <button
                className="kh-button"
                onClick={() => setImportOpen(false)}
              >
                Cancelar
              </button>
              <button
                className="kh-button primary"
                disabled={actionLoading || !sheetLink.trim()}
                onClick={() => void importSheet()}
              >
                <Upload size={16} />{" "}
                {actionLoading ? "Importando..." : "Importar leads"}
              </button>
            </div>
          </div>
        </div>
      )}
      <CommercialLeadModal
        open={modalOpen}
        members={members}
        canViewFinancials={canViewCommercialFinancials}
        canViewQualification={canViewCommercialLeadQualification}
        lead={editing}
        onClose={() => {
          setModalOpen(false);
          setEditing(null);
        }}
        onSave={async (data) => {
          if (editing) await updateLead(editing.id, data);
          else
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
