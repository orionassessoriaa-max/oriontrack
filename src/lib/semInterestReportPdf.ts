import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export type SemInterestReportRow = {
  name: string;
  markedAt: string | null;
  reason: string | null;
  responsible: string | null;
};

const PAGE: [number, number] = [841.89, 595.28];
const MARGIN = 34;
const NAVY = rgb(0.02, 0.07, 0.12);
const BLUE = rgb(0.02, 0.45, 0.86);
const RED = rgb(0.88, 0.08, 0.2);
const TEXT = rgb(0.11, 0.15, 0.2);
const MUTED = rgb(0.38, 0.44, 0.5);
const GRID = rgb(0.84, 0.88, 0.91);

function formatDate(value: string | null) {
  if (!value || Number.isNaN(new Date(value).getTime())) return 'Nao informado';
  return new Date(value).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short',
  });
}

function wrap(text: string, font: Awaited<ReturnType<PDFDocument['embedFont']>>, size: number, width: number) {
  const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (!current || font.widthOfTextAtSize(candidate, size) <= width) current = candidate;
    else { lines.push(current); current = word; }
  }
  if (current) lines.push(current);
  return lines.length ? lines : ['Nao informado'];
}

function ellipsis(text: string, font: Awaited<ReturnType<PDFDocument['embedFont']>>, size: number, width: number) {
  if (font.widthOfTextAtSize(text, size) <= width) return text;
  let next = text;
  while (next.length > 1 && font.widthOfTextAtSize(`${next}...`, size) > width) next = next.slice(0, -1);
  return `${next.trim()}...`;
}

export async function buildSemInterestReportPdf(rows: SemInterestReportRow[]) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const generatedAt = formatDate(new Date().toISOString());
  const withReason = rows.filter((row) => Boolean(row.reason)).length;
  const withResponsible = rows.filter((row) => Boolean(row.responsible)).length;
  const reasons = new Map<string, number>();
  for (const row of rows) reasons.set(row.reason || 'Motivo nao registrado', (reasons.get(row.reason || 'Motivo nao registrado') || 0) + 1);

  const addFooter = (page: ReturnType<PDFDocument['addPage']>, pageNumber: number) => {
    page.drawLine({ start: { x: MARGIN, y: 25 }, end: { x: PAGE[0] - MARGIN, y: 25 }, color: GRID, thickness: 0.6 });
    page.drawText(`Orion Track | Gerado em ${generatedAt}`, { x: MARGIN, y: 14, size: 7, font: regular, color: MUTED });
    page.drawText(`Pagina ${pageNumber}`, { x: PAGE[0] - MARGIN - 42, y: 14, size: 7, font: regular, color: MUTED });
  };

  const cover = pdf.addPage(PAGE);
  cover.drawRectangle({ x: 0, y: PAGE[1] - 116, width: PAGE[0], height: 116, color: NAVY });
  cover.drawRectangle({ x: MARGIN, y: PAGE[1] - 43, width: 54, height: 4, color: RED });
  cover.drawText('RELATORIO COMERCIAL', { x: MARGIN, y: PAGE[1] - 65, size: 12, font: bold, color: rgb(1, 1, 1) });
  cover.drawText('Leads sem interesse', { x: MARGIN, y: PAGE[1] - 90, size: 24, font: bold, color: rgb(1, 1, 1) });
  cover.drawText('Motivo registrado e responsavel pela movimentacao', { x: MARGIN, y: PAGE[1] - 106, size: 9, font: regular, color: rgb(0.76, 0.86, 0.96) });

  const cards = [['TOTAL', String(rows.length)], ['COM MOTIVO', String(withReason)], ['SEM MOTIVO', String(rows.length - withReason)], ['COM RESPONSAVEL', String(withResponsible)]];
  const cardWidth = (PAGE[0] - MARGIN * 2 - 24) / 4;
  cards.forEach(([label, value], index) => {
    const x = MARGIN + index * (cardWidth + 8);
    cover.drawRectangle({ x, y: 404, width: cardWidth, height: 67, color: rgb(0.95, 0.97, 0.99), borderColor: GRID, borderWidth: 0.6 });
    cover.drawText(label, { x: x + 12, y: 449, size: 7, font: bold, color: BLUE });
    cover.drawText(value, { x: x + 12, y: 420, size: 22, font: bold, color: NAVY });
  });
  cover.drawText('MOTIVOS MAIS REGISTRADOS', { x: MARGIN, y: 370, size: 10, font: bold, color: NAVY });
  let summaryY = 346;
  [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).forEach(([reason, count]) => {
    if (summaryY < 58) return;
    cover.drawCircle({ x: MARGIN + 4, y: summaryY + 2, size: 2.4, color: RED });
    cover.drawText(ellipsis(reason, regular, 9, 570), { x: MARGIN + 14, y: summaryY - 1, size: 9, font: regular, color: TEXT });
    cover.drawText(String(count), { x: 642, y: summaryY - 1, size: 9, font: bold, color: NAVY });
    summaryY -= 20;
  });
  addFooter(cover, 1);

  const columns = [
    { label: '#', x: MARGIN, width: 28 }, { label: 'LEAD', x: 67, width: 176 },
    { label: 'MARCADO EM', x: 252, width: 102 }, { label: 'MOTIVO', x: 363, width: 282 },
    { label: 'RESPONSAVEL', x: 654, width: 145 },
  ];
  let pageNumber = 1;
  let page: ReturnType<PDFDocument['addPage']>;
  let y = 0;
  const addDetailsPage = () => {
    pageNumber += 1;
    page = pdf.addPage(PAGE);
    page.drawRectangle({ x: 0, y: PAGE[1] - 55, width: PAGE[0], height: 55, color: NAVY });
    page.drawText('LEADS SEM INTERESSE - DETALHAMENTO', { x: MARGIN, y: PAGE[1] - 33, size: 12, font: bold, color: rgb(1, 1, 1) });
    page.drawRectangle({ x: MARGIN, y: PAGE[1] - 84, width: PAGE[0] - MARGIN * 2, height: 20, color: rgb(0.92, 0.95, 0.98) });
    columns.forEach((column) => page.drawText(column.label, { x: column.x + 4, y: PAGE[1] - 77, size: 6.7, font: bold, color: NAVY }));
    y = PAGE[1] - 94;
  };

  addDetailsPage();
  rows.forEach((row, index) => {
    const name = wrap(row.name || 'Lead sem nome', bold, 7.8, columns[1].width - 8).slice(0, 2);
    const date = wrap(formatDate(row.markedAt), regular, 7.1, columns[2].width - 8).slice(0, 2);
    const reason = wrap(row.reason || 'Motivo nao registrado', regular, 7.2, columns[3].width - 8).slice(0, 3);
    const responsible = wrap(row.responsible || 'Responsavel nao registrado', regular, 7.2, columns[4].width - 8).slice(0, 3);
    const rowHeight = Math.max(name.length, date.length, reason.length, responsible.length) * 10 + 10;
    if (y - rowHeight < 42) addDetailsPage();
    page.drawRectangle({ x: MARGIN, y: y - rowHeight, width: PAGE[0] - MARGIN * 2, height: rowHeight, color: index % 2 ? rgb(0.985, 0.99, 0.995) : rgb(1, 1, 1) });
    page.drawLine({ start: { x: MARGIN, y: y - rowHeight }, end: { x: PAGE[0] - MARGIN, y: y - rowHeight }, color: GRID, thickness: 0.4 });
    columns.slice(1).forEach((column) => page.drawLine({ start: { x: column.x - 5, y }, end: { x: column.x - 5, y: y - rowHeight }, color: GRID, thickness: 0.35 }));
    page.drawText(String(index + 1), { x: columns[0].x + 4, y: y - 11, size: 7.2, font: regular, color: MUTED });
    [name, date, reason, responsible].forEach((lines, textIndex) => lines.forEach((line, lineIndex) => page.drawText(line, {
      x: columns[textIndex + 1].x + 4, y: y - 11 - lineIndex * 10, size: textIndex === 0 ? 7.8 : 7.2,
      font: textIndex === 0 ? bold : regular, color: TEXT,
    })));
    y -= rowHeight;
  });
  for (let index = 0; index < pdf.getPageCount(); index += 1) addFooter(pdf.getPage(index), index + 1);
  return pdf.save();
}
