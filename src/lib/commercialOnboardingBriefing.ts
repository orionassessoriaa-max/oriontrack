import { openaiFetch } from '@/lib/openaiUso';
import type { CommercialLead } from "@/lib/comercial";

const ALLOWED_MEETING_HOSTS = new Set([
  "meet.google.com",
  "drive.google.com",
  "docs.google.com",
  "loom.com",
  "www.loom.com",
  "fireflies.ai",
  "app.fireflies.ai",
  "tldv.io",
  "app.tldv.io",
  "fathom.video",
  "app.fathom.video",
]);

function cleanLine(value: unknown) {
  return String(value || "")
    .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeBriefingLines(value: unknown) {
  const source = Array.isArray(value) ? value : String(value || "").split(/\r?\n/);
  return source.map(cleanLine).filter(Boolean).slice(0, 15);
}

function googleDocsExportUrl(url: URL) {
  const match = url.pathname.match(/^\/document\/d\/([^/]+)/);
  return match ? `https://docs.google.com/document/d/${match[1]}/export?format=txt` : url.toString();
}

function htmlToText(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function publicMeetingText(rawUrl: string) {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== "https:" || !ALLOWED_MEETING_HOSTS.has(parsed.hostname.toLowerCase())) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(googleDocsExportUrl(parsed), {
      signal: controller.signal,
      headers: { "User-Agent": "OrionTrack-Onboarding-Briefing/1.0" },
      redirect: "follow",
      cache: "no-store",
    });
    if (!response.ok) return null;
    const finalUrl = new URL(response.url);
    if (!ALLOWED_MEETING_HOSTS.has(finalUrl.hostname.toLowerCase())) return null;
    const contentType = response.headers.get("content-type") || "";
    if (!/(text|json|html)/i.test(contentType)) return null;
    const text = (await response.text()).slice(0, 60_000);
    return htmlToText(text).slice(0, 30_000) || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function fallbackLines(lead: Partial<CommercialLead>, meetingWasRead: boolean) {
  const lines = [
    `Cliente: ${lead.nome || "Nome não informado"}${lead.empresa ? `, da empresa ${lead.empresa}` : ""}.`,
    lead.faturamento_mensal ? `Faturamento informado: ${lead.faturamento_mensal}.` : null,
    lead.investimento ? `Investimento informado: ${lead.investimento}.` : null,
    lead.prioridade ? `Prioridade comercial: ${lead.prioridade}.` : null,
    lead.vidas ? `Volume ou vidas informado: ${lead.vidas}.` : null,
    lead.negocio_etapa ? `Contexto do negócio: ${lead.negocio_etapa}.` : null,
    lead.origem || lead.campanha ? `Origem: ${[lead.origem, lead.campanha].filter(Boolean).join(" — ")}.` : null,
    lead.observacoes ? `Observações comerciais: ${lead.observacoes}.` : null,
    meetingWasRead
      ? "Conteúdo público da reunião considerado na preparação deste briefing."
      : "Conteúdo da reunião não estava público; validar escopo, entregáveis e prazos no onboarding.",
  ];
  return normalizeBriefingLines(lines.filter(Boolean));
}

type BriefingInput = {
  lead: Partial<CommercialLead>;
  meetingLink: string;
  sellerName?: string | null;
  interactions?: Array<{ comentario?: string | null; tipo?: string | null; created_at?: string | null }>;
};

export async function generateOnboardingBriefing(input: BriefingInput) {
  const meetingText = await publicMeetingText(input.meetingLink);
  const fallback = fallbackLines(input.lead, Boolean(meetingText));
  if (!process.env.OPENAI_API_KEY) return fallback;

  const interactionText = (input.interactions || [])
    .map((item) => cleanLine(item.comentario))
    .filter(Boolean)
    .slice(0, 30)
    .join("\n");
  const facts = {
    cliente: input.lead.nome,
    empresa: input.lead.empresa,
    vendedor: input.sellerName,
    telefone: input.lead.telefone,
    email: input.lead.email,
    origem: input.lead.origem,
    campanha: input.lead.campanha,
    faturamento: input.lead.faturamento_mensal,
    investimento: input.lead.investimento,
    prioridade: input.lead.prioridade,
    vidas: input.lead.vidas,
    negocio: input.lead.negocio_etapa,
    observacoes: input.lead.observacoes,
    modelo_pagamento: input.lead.modelo_pagamento,
    valor_pago: input.lead.valor_pago,
    fechado_at: input.lead.fechado_at,
  };

  try {
    const response = await openaiFetch('briefing_onboarding', "https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini",
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content: "Você cria briefings de onboarding operacional em português do Brasil. Retorne somente um JSON com a chave lines, contendo de 6 a 15 frases objetivas. Não invente fatos, números, escopo, prazos ou promessas. Priorize contexto, objetivos, restrições, entregáveis, orçamento, ferramentas e próximos passos. Cada item deve caber em no máximo duas linhas de um PDF A4.",
          },
          {
            role: "user",
            content: `DADOS DO CRM:\n${JSON.stringify(facts)}\n\nHISTÓRICO:\n${interactionText || "Sem comentários adicionais."}\n\nCONTEÚDO PÚBLICO DA REUNIÃO:\n${meetingText || "Não disponível publicamente. Sinalize que o escopo deve ser validado no onboarding."}`,
          },
        ],
        response_format: { type: "json_object" },
      }),
      cache: "no-store",
    });
    if (!response.ok) return fallback;
    const payload = await response.json();
    const parsed = JSON.parse(payload.choices?.[0]?.message?.content || "{}");
    const lines = normalizeBriefingLines(parsed.lines);
    return lines.length >= 3 ? lines : fallback;
  } catch {
    return fallback;
  }
}
