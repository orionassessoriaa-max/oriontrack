import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

type BriefingPdfInput = {
  leadName: string;
  company?: string | null;
  closedAt?: string | null;
  amountPaid?: number | null;
  paymentModel?: string | null;
  sellerName?: string | null;
  briefing: string | string[];
  generatedAt?: string | null;
};

function briefingLines(value: string | string[]) {
  const source = Array.isArray(value) ? value : String(value || "").split(/\r?\n/);
  return source
    .map((line) => String(line).replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 15);
}

const formatMoney = (value?: number | null) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value || 0));
const formatDate = (value?: string | null) => value && !Number.isNaN(new Date(value).getTime())
  ? new Date(value).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })
  : "Não informado";

function wrapText(text: string, font: Awaited<ReturnType<PDFDocument["embedFont"]>>, size: number, maxWidth: number) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) current = candidate;
    else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function fitText(text: string, font: Awaited<ReturnType<PDFDocument["embedFont"]>>, size: number, maxWidth: number) {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let fitted = text;
  while (fitted.length > 1 && font.widthOfTextAtSize(`${fitted}...`, size) > maxWidth) fitted = fitted.slice(0, -1);
  return `${fitted.trim()}...`;
}

export async function buildCommercialBriefingPdf(input: BriefingPdfInput) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const navy = rgb(0.018, 0.075, 0.12);
  const cobalt = rgb(0.02, 0.45, 0.86);
  const muted = rgb(0.35, 0.42, 0.48);
  const margin = 48;
  const width = page.getWidth() - margin * 2;

  page.drawRectangle({ x: 0, y: 748, width: page.getWidth(), height: 94, color: navy });
  page.drawRectangle({ x: margin, y: 763, width: 44, height: 4, color: cobalt });
  page.drawText("ONBOARDING OPERACIONAL", { x: margin, y: 795, size: 15, font: bold, color: rgb(1, 1, 1) });
  const subtitle = `${input.leadName || "CLIENTE"} | ${input.company || "EMPRESA NÃO INFORMADA"}`.toUpperCase();
  page.drawText(fitText(subtitle, regular, 10.5, width), { x: margin, y: 773, size: 10.5, font: regular, color: rgb(0.78, 0.88, 0.96) });

  const cards = [
    ["FECHAMENTO", formatDate(input.closedAt)],
    ["VALOR PAGO", formatMoney(input.amountPaid)],
    ["MODELO", String(input.paymentModel || "Não informado").toUpperCase()],
    ["VENDEDOR", input.sellerName || "Não informado"],
  ];
  const cardWidth = (width - 18) / 4;
  cards.forEach(([label, value], index) => {
    const x = margin + index * (cardWidth + 6);
    page.drawRectangle({ x, y: 692, width: cardWidth, height: 42, color: rgb(0.95, 0.975, 0.99), borderColor: rgb(0.82, 0.89, 0.94), borderWidth: 0.7 });
    page.drawText(label, { x: x + 8, y: 718, size: 6.5, font: bold, color: cobalt });
    page.drawText(String(value).slice(0, 23), { x: x + 8, y: 702, size: 8, font: bold, color: navy });
  });

  page.drawText("BRIEFING DA REUNIÃO", { x: margin, y: 661, size: 11, font: bold, color: navy });
  let y = 638;
  const lines = briefingLines(input.briefing);
  for (const item of lines) {
    const wrapped = wrapText(item, regular, 9.4, width - 24).slice(0, 2);
    const itemHeight = wrapped.length * 13 + 8;
    if (y - itemHeight < 55) break;
    page.drawCircle({ x: margin + 4, y: y + 1, size: 2.4, color: cobalt });
    wrapped.forEach((line, index) => page.drawText(line, { x: margin + 16, y: y - index * 13, size: 9.4, font: regular, color: rgb(0.12, 0.16, 0.2) }));
    y -= itemHeight;
  }

  page.drawLine({ start: { x: margin, y: 38 }, end: { x: page.getWidth() - margin, y: 38 }, color: rgb(0.84, 0.88, 0.91), thickness: 0.7 });
  page.drawText(`Orion Track - briefing gerado em ${formatDate(input.generatedAt || new Date().toISOString())}`, { x: margin, y: 24, size: 7.5, font: regular, color: muted });
  return pdf.save();
}
