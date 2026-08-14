"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, Phone, MessageCircle, Mic, PhoneCall } from "lucide-react";
import { useCommercial } from "@/components/commercial/CommercialShell";
import { COMMERCIAL_CADENCE_POINTS, type CommercialCadencePointStatus } from "@/lib/commercialCadence";

type CadencePoint = {
  id: string;
  dia: number;
  ponto: number;
  canal: string;
  status: CommercialCadencePointStatus;
  registrado_at: string | null;
};

type CadencePayload = {
  active: boolean;
  return_active: boolean;
  return_at: string | null;
  day: number | null;
  points: CadencePoint[];
};

type Props = {
  leadId: string;
  readOnly?: boolean;
  cadenceActive?: boolean;
  returnActive?: boolean;
  onTimelineChanged?: () => void;
};

const statusLabels: Record<CommercialCadencePointStatus, string> = {
  pendente: "Pendente",
  nao_atendeu: "Não atendeu",
  sem_resposta: "Sem resposta",
  atendeu: "Atendeu",
  respondeu: "Respondeu",
  nao_necessario: "Não necessário",
};

function PointIcon({ channel }: { channel: string }) {
  if (channel === "mensagem_whatsapp") return <MessageCircle size={14} />;
  if (channel === "audio_whatsapp") return <Mic size={14} />;
  if (channel === "ligacao_whatsapp") return <PhoneCall size={14} />;
  return <Phone size={14} />;
}

export default function CommercialCadenceWidget({ leadId, readOnly = false, cadenceActive, returnActive, onTimelineChanged }: Props) {
  const { api } = useCommercial();
  const [data, setData] = useState<CadencePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [savingPoint, setSavingPoint] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!cadenceActive || returnActive) {
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setData(await api(`/api/comercial/leads/${leadId}/cadence`));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar a cadência.");
    } finally {
      setLoading(false);
    }
  }, [api, cadenceActive, leadId, returnActive]);

  useEffect(() => { void load(); }, [load]);

  async function register(point: number, result: CommercialCadencePointStatus) {
    if (result === "pendente" || result === "nao_necessario") return;
    setSavingPoint(point);
    setError(null);
    try {
      const payload = await api(`/api/comercial/leads/${leadId}/cadence`, {
        method: "POST",
        body: JSON.stringify({ point, result }),
      });
      setData(payload);
      onTimelineChanged?.();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Não foi possível registrar o contato.");
    } finally {
      setSavingPoint(null);
    }
  }

  if (!cadenceActive || returnActive) return null;
  if (loading && !data) return <section className="kh-cadence-widget is-loading"><Loader2 className="kh-spin" size={18} /> Carregando cadência...</section>;
  if (!data?.active) return error ? <div className="kh-inline-error" role="alert">{error}</div> : null;

  const attemptedPoints = data.points.filter((point) => !["pendente", "nao_necessario"].includes(point.status)).length;

  return (
    <section className="kh-cadence-widget" aria-labelledby="kh-cadence-title">
      <header>
        <h3 id="kh-cadence-title">Cadência — Dia {data.day}</h3>
        <span>{attemptedPoints}/8 tentativas</span>
      </header>
      <div className="kh-cadence-points">
        {COMMERCIAL_CADENCE_POINTS.map((definition) => {
          const point = data.points.find((item) => item.ponto === definition.point);
          const status = point?.status || "pendente";
          const done = status !== "pendente";
          const positive = status === "atendeu" || status === "respondeu";
          return (
            <div key={definition.point} className={`kh-cadence-point ${done ? "is-done" : ""} ${positive ? "is-positive" : ""}`}>
              <span className="kh-cadence-check" aria-hidden="true">{done ? <Check size={12} /> : null}</span>
              <PointIcon channel={definition.channel} />
              <strong>{definition.label}</strong>
              {readOnly || status !== "pendente" ? (
                <span className="kh-cadence-result">{statusLabels[status]}</span>
              ) : (
                <select
                  aria-label={`Registrar resultado de ${definition.label}`}
                  value=""
                  disabled={savingPoint !== null}
                  onChange={(event) => void register(definition.point, event.target.value as CommercialCadencePointStatus)}
                >
                  <option value="">Registrar resultado</option>
                  {definition.channel.startsWith("ligacao") ? <option value="nao_atendeu">Não atendeu</option> : <option value="sem_resposta">Sem resposta</option>}
                  {definition.channel.startsWith("ligacao") ? <option value="atendeu">Atendeu</option> : <option value="respondeu">Respondeu</option>}
                </select>
              )}
              {savingPoint === definition.point && <Loader2 className="kh-spin" size={13} />}
            </div>
          );
        })}
      </div>
      {error && <div className="kh-inline-error" role="alert">{error}</div>}
    </section>
  );
}
