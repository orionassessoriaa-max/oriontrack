import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Presentation, PresentationFile } from '@oai/artifact-tool';

const workspaceDir = process.cwd();
const SKILL_DIR = 'C:/Users/PC-000/.codex/plugins/cache/openai-primary-runtime/presentations/26.909.11809/skills/presentations';
const RUNTIME_PYTHON = 'C:/Users/PC-000/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe';
const buildDir = path.join(workspaceDir, 'tmp', 'presentations', 'sandro-henrique-20260917');
const outputDir = path.join(workspaceDir, 'output', 'presentations');
const finalPath = path.join(outputDir, 'relatorio-atendimento-sandro-henrique-desde-inicio-2026.pptx');
const dataPath = path.join(workspaceDir, 'tmp', 'sandro-henrique-complete-analysis.json');

const {
  resolvePresentationFont,
  applyPresentationChartFont,
  makeNativeBulletParagraphs,
  finalizePresentation,
} = await import(pathToFileURL(path.join(SKILL_DIR, 'container_tools', 'artifact_tool_utils.mjs')).href);

await fs.mkdir(buildDir, { recursive: true });
await fs.mkdir(outputDir, { recursive: true });
const data = JSON.parse(await fs.readFile(dataPath, 'utf8'));
const S = data.sellers.Sandro;
const H = data.sellers.Henrique;
const FONT = resolvePresentationFont({ fontFamily: 'Arial' });

const C = {
  ink: '#112333', muted: '#5F6F7D', bg: '#F4F7FA', white: '#FFFFFF',
  navy: '#071827', sandro: '#2F6BFF', henrique: '#0FA58F', cyan: '#00A7C4',
  amber: '#E58A2B', red: '#D24D57', green: '#2E9B68', line: '#D9E1E8',
  paleBlue: '#EAF0FF', paleTeal: '#E5F6F3', paleAmber: '#FFF1DE', paleRed: '#FBEAEC',
};

const pct = (value, digits = 1) => value == null ? 'n/d' : `${(value * 100).toFixed(digits).replace('.', ',')}%`;
const num = (value) => new Intl.NumberFormat('pt-BR').format(value ?? 0);
const duration = (value) => {
  if (value == null) return 'n/d';
  if (value < 60) return `${Math.round(value)} min`;
  if (value < 1440) return `${Math.floor(value / 60)}h ${Math.round(value % 60)}min`;
  return `${(value / 1440).toFixed(1).replace('.', ',')} dias`;
};
const monthLabel = (key) => ({ '2026-06': 'Jun', '2026-07': 'Jul', '2026-08': 'Ago', '2026-09': 'Set*' }[key] || key);

const presentation = Presentation.create({ slideSize: { width: 1280, height: 720 } });

function addShape(slide, geometry, position, fill, line = { fill: 'none', width: 0 }) {
  return slide.shapes.add({ geometry, position, fill, line });
}

function addText(slide, text, position, options = {}) {
  const shape = slide.shapes.add({
    geometry: 'textbox', position,
    fill: options.fill || 'none', line: options.line || { fill: 'none', width: 0 },
  });
  shape.text = text;
  shape.text.style = {
    typeface: FONT,
    fontSize: options.fontSize ?? 22,
    bold: options.bold ?? false,
    color: options.color || C.ink,
    alignment: options.alignment || 'left',
    verticalAlignment: options.verticalAlignment || 'top',
    autoFit: options.autoFit || 'none',
    wrap: true,
  };
  if (options.margin != null) shape.text.margins = options.margin;
  return shape;
}

function addRichText(slide, runs, position, options = {}) {
  const shape = slide.shapes.add({ geometry: 'textbox', position, fill: 'none', line: { fill: 'none', width: 0 } });
  shape.text = { paragraphs: [{ runs: runs.map((run) => ({
    text: run.text,
    style: { typeface: FONT, fontSize: run.fontSize || options.fontSize || 22, bold: Boolean(run.bold), color: run.color || options.color || C.ink },
  })) }] };
  shape.text.style = { typeface: FONT, fontSize: options.fontSize || 22, color: options.color || C.ink, autoFit: 'none', wrap: true };
  return shape;
}

function addBullets(slide, items, position, options = {}) {
  const shape = slide.shapes.add({ geometry: 'textbox', position, fill: 'none', line: { fill: 'none', width: 0 } });
  shape.text = makeNativeBulletParagraphs(items, {
    marginLeftPoints: options.marginLeftPoints || 18,
    hangingPoints: options.hangingPoints || 9,
    spaceAfterPoints: options.spaceAfterPoints || 10,
  });
  shape.text.style = { typeface: FONT, fontSize: options.fontSize || 20, color: options.color || C.ink, autoFit: 'none', wrap: true };
  return shape;
}

function addFooter(slide, number) {
  addShape(slide, 'rect', { left: 48, top: 681, width: 1184, height: 1 }, C.line);
  addText(slide, 'ORION TRACK  /  OCTAVITA CORRETORA', { left: 54, top: 689, width: 420, height: 18 }, { fontSize: 10, bold: true, color: C.muted });
  addText(slide, String(number).padStart(2, '0'), { left: 1170, top: 687, width: 55, height: 20 }, { fontSize: 11, bold: true, color: C.muted, alignment: 'right' });
}

function baseSlide(title, subtitle = '') {
  const slide = presentation.slides.add();
  slide.background.fill = C.bg;
  addText(slide, title, { left: 54, top: 35, width: 1168, height: 52 }, { fontSize: 34, bold: true, color: C.ink });
  if (subtitle) addText(slide, subtitle, { left: 56, top: 91, width: 1160, height: 38 }, { fontSize: 16, color: C.muted });
  addFooter(slide, presentation.slides.items.length);
  return slide;
}

function addMetricRow(slide, items, top = 155) {
  const totalWidth = 1160;
  const width = totalWidth / items.length;
  items.forEach((item, index) => {
    const left = 58 + index * width;
    if (index) addShape(slide, 'rect', { left: left - 18, top: top + 4, width: 1, height: 92 }, C.line);
    addText(slide, item.value, { left, top, width: width - 32, height: 52 }, { fontSize: item.fontSize || 34, bold: true, color: item.color || C.ink });
    addText(slide, item.label, { left, top: top + 52, width: width - 30, height: 46 }, { fontSize: 15, color: C.muted });
  });
}

function addCallout(slide, heading, body, position, color = C.cyan, fill = C.white, bodyFontSize = 18) {
  addShape(slide, 'rect', position, fill, { fill: C.line, width: 1 });
  addShape(slide, 'rect', { left: position.left, top: position.top, width: 7, height: position.height }, color);
  addText(slide, heading.toUpperCase(), { left: position.left + 22, top: position.top + 15, width: position.width - 38, height: 22 }, { fontSize: 13, bold: true, color });
  addText(slide, body, { left: position.left + 22, top: position.top + 45, width: position.width - 40, height: position.height - 58 }, { fontSize: bodyFontSize, color: C.ink });
}

function addTable(slide, values, position, widths, options = {}) {
  const table = slide.tables.add({
    rows: values.length,
    columns: values[0].length,
    left: position.left,
    top: position.top,
    width: position.width,
    height: position.height,
    values,
    columnWidths: widths,
  });
  table.borders.assign({ style: 'solid', fill: C.line, width: 1 });
  for (let row = 0; row < values.length; row += 1) {
    for (let col = 0; col < values[0].length; col += 1) {
      const cell = table.getCell(row, col);
      cell.fill = row === 0 ? C.navy : row % 2 ? C.white : '#EEF3F7';
      cell.text.style = {
        typeface: FONT,
        fontSize: row === 0 ? (options.headerFontSize || 14) : (options.fontSize || 14),
        bold: row === 0 || (options.boldFirstColumn && col === 0),
        color: row === 0 ? C.white : C.ink,
        autoFit: 'shrinkText',
        verticalAlignment: 'middle',
      };
      cell.text.margins = { left: 8, right: 8, top: 5, bottom: 5 };
    }
  }
  return table;
}

function addChart(slide, type, config) {
  const chart = slide.charts.add(type, config);
  applyPresentationChartFont(chart, { fontFamily: FONT });
  return chart;
}

function notes(slide, text) {
  slide.speakerNotes.textFrame.setText(`Fonte interna: Orion Track / Supabase. Extração em ${data.generatedAt}. ${text}`);
}

// 1. Cover
{
  const slide = presentation.slides.add();
  slide.background.fill = C.navy;
  addText(slide, 'Atendimento comercial', { left: 72, top: 92, width: 620, height: 56 }, { fontSize: 22, bold: true, color: '#81D9E8' });
  addText(slide, 'Sandro e Henrique', { left: 72, top: 158, width: 1000, height: 90 }, { fontSize: 50, bold: true, color: C.white });
  addText(slide, 'Análise completa desde o início do projeto', { left: 74, top: 258, width: 920, height: 52 }, { fontSize: 26, color: '#D3DFE8' });
  addText(slide, '15 de junho a 17 de setembro de 2026', { left: 74, top: 330, width: 680, height: 40 }, { fontSize: 18, color: '#8FA4B4' });
  addShape(slide, 'rect', { left: 74, top: 412, width: 840, height: 2 }, '#2B536B');
  addText(slide, '558 conversas verificadas  /  25.110 mensagens  /  análise quantitativa e qualitativa', { left: 74, top: 438, width: 1030, height: 44 }, { fontSize: 18, bold: true, color: C.white });
  addText(slide, 'Relatório gerencial confidencial', { left: 74, top: 620, width: 420, height: 28 }, { fontSize: 14, color: '#8FA4B4' });
  addText(slide, 'ORION TRACK', { left: 1000, top: 620, width: 210, height: 28 }, { fontSize: 14, bold: true, color: '#81D9E8', alignment: 'right' });
  notes(slide, 'Capa. Período cobre todo o histórico disponível da corretora na base no momento da extração.');
}

// 2. Completeness
{
  const slide = baseSlide('A base foi conferida antes da análise', 'A contagem exata do banco fechou com a extração paginada; o campo de resumo da conversa não foi usado como fonte principal.');
  addMetricRow(slide, [
    { value: num(data.scope.conversations), label: 'conversas encontradas', color: C.cyan },
    { value: num(data.scope.operationalConversations), label: 'conversas operacionais', color: C.green },
    { value: num(data.scope.messagesFetched), label: 'mensagens extraídas', color: C.sandro },
    { value: '100%', label: 'coincidência com a contagem exata', color: C.henrique },
  ], 150);
  addTable(slide, [
    ['Teste de integridade', 'Resultado', 'Leitura'],
    ['Mensagens extraídas x contagem do banco', `${num(data.scope.messagesFetched)} = ${num(data.scope.messagesExactCount)}`, 'Fechou sem perda'],
    ['IDs de mensagem duplicados', String(data.completeness.duplicateMessageIds), 'Nenhum ID repetido'],
    ['Conversas sem mensagem', String(data.completeness.zeroMessageConversations), 'Excluídas das taxas'],
    ['Contatos de teste ou vazios excluídos', String(data.scope.testOrEmptyExcluded), 'Regra aplicada antes das métricas'],
    ['Remetentes sem classificação', String(data.completeness.allSellerMessagesClassified.length), 'Sandro e Henrique identificados integralmente'],
  ], { left: 58, top: 295, width: 1160, height: 270 }, [390, 220, 550], { fontSize: 15, boldFirstColumn: true });
  addCallout(slide, 'Campo “última mensagem”', '36 resumos estavam atrasados e 7 adiantados em até 12 segundos. A tabela de mensagens, cuja contagem fechou, foi usada como fonte oficial.', { left: 58, top: 570, width: 1160, height: 96 }, C.amber, C.paleAmber, 16);
  notes(slide, 'Validação de cobertura: paginação completa, contagem exata, IDs únicos, exclusão explícita de testes e comparação do timestamp-resumo com a tabela de mensagens.');
}

// 3. Executive summary
{
  const slide = baseSlide('Resumo executivo', 'As carteiras têm tamanho semelhante. A diferença principal aparece na continuidade do contato e na forma de abertura.');
  addCallout(slide, 'Henrique', `Obteve ${pct(H.replyRate)} de resposta após o primeiro contato e ${pct(H.replyWithin24h)} em até 24 horas. A abertura menciona o contexto da Aline em ${pct(H.contextRate)} das conversas.`, { left: 58, top: 150, width: 552, height: 154 }, C.henrique, C.paleTeal);
  addCallout(slide, 'Sandro', `Chegou a ${pct(S.monthly.at(-1).replyRate)} de resposta em setembro, seu melhor mês. Tem forte persistência e acompanha documentação, mas registra apenas ${pct(S.replyWithin24h)} de respostas em 24 horas.`, { left: 668, top: 150, width: 552, height: 154 }, C.sandro, C.paleBlue);
  addText(slide, 'O maior gargalo é compartilhado', { left: 58, top: 342, width: 560, height: 40 }, { fontSize: 26, bold: true });
  addBullets(slide, [
    `O handoff demora: mediana de ${duration(S.medianHandoffMinutes)} para Sandro e ${duration(H.medianHandoffMinutes)} para Henrique.`,
    `Somente ${pct(S.handoffWithin15m)} e ${pct(H.handoffWithin15m)} dos handoffs ocorrem em até 15 minutos.`,
    'Mensagens duplicadas indicam um problema técnico de integração e não devem ser tratadas como falha individual.',
    'A pressão por retorno e a cadência longa aparecem nos dois estilos, com risco de desgaste depois do interesse inicial.',
  ], { left: 58, top: 397, width: 1120, height: 230 }, { fontSize: 19, spaceAfterPoints: 12 });
  notes(slide, 'Síntese baseada em todas as conversas tocadas por cada vendedor. Setembro é parcial até a data de extração.');
}

// 4. Footprint
{
  const slide = baseSlide('Cobertura de atendimento', 'Os volumes de conversa são equivalentes; Henrique enviou 24% mais mensagens no período.');
  addMetricRow(slide, [
    { value: num(S.conversations), label: 'conversas tocadas por Sandro', color: C.sandro },
    { value: num(H.conversations), label: 'conversas tocadas por Henrique', color: C.henrique },
    { value: num(S.outboundMessages), label: 'mensagens de Sandro', color: C.sandro },
    { value: num(H.outboundMessages), label: 'mensagens de Henrique', color: C.henrique },
  ], 145);
  const chart = addChart(slide, 'bar', {
    position: { left: 88, top: 300, width: 720, height: 310 },
    categories: ['Conversas', 'Dias ativos', 'Mensagens ÷ 25'],
    series: [
      { name: 'Sandro', values: [S.conversations, S.activeDays, S.outboundMessages / 25], fill: C.sandro },
      { name: 'Henrique', values: [H.conversations, H.activeDays, H.outboundMessages / 25], fill: C.henrique },
    ],
    barOptions: { direction: 'bar', grouping: 'clustered', gapWidth: 55 },
    legend: { position: 'bottom', overlay: false, textStyle: { fill: C.muted, fontSize: 14 } },
    xAxis: { majorGridlines: { style: 'solid', fill: C.line, width: 1 }, textStyle: { fill: C.muted, fontSize: 12 } },
    yAxis: { textStyle: { fill: C.ink, fontSize: 14 } },
    dataLabels: { showValue: true, position: 'outEnd', textStyle: { fill: C.ink, fontSize: 13, bold: true } },
    chartFill: C.bg, plotAreaFill: C.bg, chartLine: { fill: 'none', width: 0 }, plotAreaLine: { fill: 'none', width: 0 },
  });
  addCallout(slide, 'Leitura correta do volume', 'Mais mensagens não significa, por si só, melhor atendimento. O volume precisa ser lido junto com resposta, avanço comercial, repetição técnica e duração da jornada.', { left: 850, top: 325, width: 330, height: 220 }, C.cyan, C.white);
  notes(slide, 'A escala “mensagens ÷ 25” serve apenas para colocar os três volumes no mesmo gráfico. Os valores absolutos aparecem acima.');
}

// 5. Reply performance
{
  const slide = baseSlide('Resposta após o primeiro contato humano', 'Henrique abre uma vantagem clara em resposta total e em até 24 horas; a resposta imediata é praticamente igual.');
  addChart(slide, 'bar', {
    position: { left: 80, top: 160, width: 760, height: 390 },
    categories: ['Respondeu', 'Respondeu em 24h', 'Respondeu em 15 min'],
    series: [
      { name: 'Sandro', values: [S.replyRate, S.replyWithin24h, S.replyWithin15m], fill: C.sandro, valuesFormatCode: '0%' },
      { name: 'Henrique', values: [H.replyRate, H.replyWithin24h, H.replyWithin15m], fill: C.henrique, valuesFormatCode: '0%' },
    ],
    barOptions: { direction: 'bar', grouping: 'clustered', gapWidth: 50 },
    legend: { position: 'bottom', overlay: false, textStyle: { fill: C.muted, fontSize: 14 } },
    xAxis: { numberFormatCode: '0%', min: 0, max: 1, majorUnit: 0.2, majorGridlines: { style: 'solid', fill: C.line, width: 1 }, textStyle: { fill: C.muted, fontSize: 12 } },
    yAxis: { textStyle: { fill: C.ink, fontSize: 14 } },
    dataLabels: { showValue: true, position: 'outEnd', textStyle: { fill: C.ink, fontSize: 13, bold: true } },
    chartFill: C.bg, plotAreaFill: C.bg, chartLine: { fill: 'none', width: 0 }, plotAreaLine: { fill: 'none', width: 0 },
  });
  addCallout(slide, 'Diferença mais relevante', `Henrique tem ${(H.replyWithin24h - S.replyWithin24h) * 100 > 0 ? '+' : ''}${((H.replyWithin24h - S.replyWithin24h) * 100).toFixed(1).replace('.', ',')} pontos percentuais em resposta dentro de 24 horas.`, { left: 875, top: 180, width: 300, height: 135 }, C.henrique, C.paleTeal);
  addCallout(slide, 'Velocidade quando há resposta', `Mediana de ${duration(S.medianReplyMinutes)} para Sandro e ${duration(H.medianReplyMinutes)} para Henrique. A diferença é pequena entre os leads que efetivamente respondem.`, { left: 875, top: 345, width: 300, height: 180 }, C.cyan, C.white);
  notes(slide, 'Resposta mede qualquer inbound após a primeira mensagem do vendedor. Não controla qualidade ou origem da carteira.');
}

// 6. Monthly evolution
{
  const slide = baseSlide('Evolução mensal da taxa de resposta', 'Sandro recuperou desempenho em setembro; Henrique manteve patamar superior em três dos quatro meses.');
  const months = ['2026-06', '2026-07', '2026-08', '2026-09'];
  const getMonth = (seller, month) => seller.monthly.find((row) => row.month === month)?.replyRate || 0;
  addChart(slide, 'line', {
    position: { left: 76, top: 160, width: 850, height: 390 },
    categories: months.map(monthLabel),
    series: [
      { name: 'Sandro', values: months.map((month) => getMonth(S, month)), line: { style: 'solid', fill: C.sandro, width: 4 }, marker: { symbol: 'circle', size: 9 } },
      { name: 'Henrique', values: months.map((month) => getMonth(H, month)), line: { style: 'solid', fill: C.henrique, width: 4 }, marker: { symbol: 'circle', size: 9 } },
    ],
    lineOptions: { smooth: false },
    legend: { position: 'bottom', overlay: false, textStyle: { fill: C.muted, fontSize: 14 } },
    xAxis: { textStyle: { fill: C.ink, fontSize: 14 }, line: { style: 'solid', fill: C.line, width: 1 } },
    yAxis: { numberFormatCode: '0%', min: 0.5, max: 0.9, majorUnit: 0.1, majorGridlines: { style: 'solid', fill: C.line, width: 1 }, textStyle: { fill: C.muted, fontSize: 12 } },
    dataLabels: { showValue: true, position: 'outEnd', textStyle: { fill: C.ink, fontSize: 12, bold: true } },
    chartFill: C.bg, plotAreaFill: C.bg, chartLine: { fill: 'none', width: 0 }, plotAreaLine: { fill: 'none', width: 0 },
  });
  addCallout(slide, 'Setembro é parcial', `Sandro: ${pct(S.monthly.at(-1).replyRate)}. Henrique: ${pct(H.monthly.at(-1).replyRate)}. A leitura deve ser atualizada no fechamento do mês.`, { left: 960, top: 196, width: 260, height: 170 }, C.amber, C.paleAmber);
  addCallout(slide, 'Sinal útil', 'A recuperação de Sandro sugere uma diferença parcialmente treinável. Comparar por semana ajudará a localizar quais mudanças sustentaram setembro.', { left: 960, top: 400, width: 260, height: 205 }, C.sandro, C.paleBlue, 17);
  notes(slide, 'Coortes pelo mês da primeira mensagem de cada vendedor. Setembro parcial.');
}

// 7. Handoff
{
  const slide = baseSlide('Tempo entre Aline e vendedor', 'O lead frequentemente espera horas depois da coleta inicial; esse atraso reduz a chance de preservar o contexto e a intenção.');
  addMetricRow(slide, [
    { value: duration(S.medianHandoffMinutes), label: 'mediana até Sandro', color: C.sandro, fontSize: 30 },
    { value: duration(H.medianHandoffMinutes), label: 'mediana até Henrique', color: C.henrique, fontSize: 30 },
    { value: pct(S.handoffWithin15m), label: 'Sandro em até 15 minutos', color: C.sandro },
    { value: pct(H.handoffWithin15m), label: 'Henrique em até 15 minutos', color: C.henrique },
  ], 145);
  addTable(slide, [
    ['Mês', 'Sandro', 'Henrique', 'Leitura'],
    ...['2026-06', '2026-07', '2026-08', '2026-09'].map((month) => {
      const sm = S.monthly.find((row) => row.month === month);
      const hm = H.monthly.find((row) => row.month === month);
      return [monthLabel(month), duration(sm?.handoffMedianMinutes), duration(hm?.handoffMedianMinutes), month === '2026-09' ? 'Setembro parcial' : 'Mediana da coorte'];
    }),
  ], { left: 58, top: 298, width: 760, height: 250 }, [120, 180, 180, 280], { fontSize: 15, boldFirstColumn: true });
  addCallout(slide, 'Cuidado na interpretação', 'Parte do atraso ocorre fora do expediente. Mesmo assim, a taxa inferior a 7% em 15 minutos mostra ausência de SLA consistente para leads que acabaram de responder à Aline.', { left: 860, top: 300, width: 330, height: 248 }, C.amber, C.paleAmber);
  addCallout(slide, 'Meta operacional', 'Medir somente handoffs em horário comercial e buscar mediana inferior a 15 minutos, com alerta quando passar de 30 minutos.', { left: 58, top: 575, width: 1132, height: 82 }, C.cyan, C.white);
  notes(slide, 'Handoff mede a última mensagem anterior da Aline até a primeira mensagem do vendedor. Inclui noites e finais de semana.');
}

// 8. First message
{
  const slide = baseSlide('A primeira mensagem define a continuidade', 'Henrique usa uma abertura mais longa e contextual; Sandro alterna entre contexto completo e saudações muito curtas.');
  addMetricRow(slide, [
    { value: pct(S.contextRate), label: 'aberturas de Sandro com contexto', color: C.sandro },
    { value: pct(H.contextRate), label: 'aberturas de Henrique com contexto', color: C.henrique },
    { value: `${S.medianFirstMessageChars}`, label: 'caracteres na abertura mediana de Sandro', color: C.sandro },
    { value: `${H.medianFirstMessageChars}`, label: 'caracteres na abertura mediana de Henrique', color: C.henrique },
  ], 145);
  addTable(slide, [
    ['Estilo', 'Exemplo observado', 'Efeito provável'],
    ['Sandro contextual', '“Sou o Sandro... você falou com a minha assistente Aline...”', 'Continuidade clara quando o modelo é usado'],
    ['Sandro curto', '“Boa tarde, tudo bem!”', 'Depende do histórico visível para fazer sentido'],
    ['Henrique padrão', '“Sou o Henrique... você falou com nossa assistente Aline...”', 'Alta consistência, porém texto longo e genérico'],
    ['Modelo recomendado', 'Nome + contexto coletado + próximo passo em uma pergunta', 'Reconhecimento imediato e menor esforço para responder'],
  ], { left: 58, top: 300, width: 1160, height: 250 }, [190, 540, 430], { fontSize: 15, boldFirstColumn: true });
  addCallout(slide, 'Síntese', 'Contexto ajuda mais do que tamanho. O melhor padrão combina a consistência de Henrique com a objetividade de Sandro.', { left: 58, top: 565, width: 1160, height: 92 }, C.cyan, C.white, 17);
  notes(slide, 'Contexto foi identificado quando a primeira mensagem mencionou Aline, formulário, cotação, interesse ou continuidade do atendimento.');
}

// 9. Conversation mechanics
{
  const slide = baseSlide('Mecânica das conversas', 'Os dois estilos têm diferenças claras de canal, profundidade e condução.');
  addChart(slide, 'bar', {
    position: { left: 70, top: 150, width: 820, height: 420 },
    categories: ['Perguntas nas mensagens', 'Resposta por turno', 'Uso de agendamento', 'Envio ou discussão de proposta'],
    series: [
      { name: 'Sandro', values: [S.questionMessageRate, S.turnResponseRate, S.schedulingRate, S.proposalRate], fill: C.sandro, valuesFormatCode: '0%' },
      { name: 'Henrique', values: [H.questionMessageRate, H.turnResponseRate, H.schedulingRate, H.proposalRate], fill: C.henrique, valuesFormatCode: '0%' },
    ],
    barOptions: { direction: 'bar', grouping: 'clustered', gapWidth: 52 },
    legend: { position: 'bottom', overlay: false, textStyle: { fill: C.muted, fontSize: 14 } },
    xAxis: { numberFormatCode: '0%', min: 0, max: 1, majorUnit: 0.2, majorGridlines: { style: 'solid', fill: C.line, width: 1 }, textStyle: { fill: C.muted, fontSize: 12 } },
    yAxis: { textStyle: { fill: C.ink, fontSize: 13 } },
    dataLabels: { showValue: true, position: 'outEnd', textStyle: { fill: C.ink, fontSize: 12, bold: true } },
    chartFill: C.bg, plotAreaFill: C.bg, chartLine: { fill: 'none', width: 0 }, plotAreaLine: { fill: 'none', width: 0 },
  });
  addCallout(slide, 'Sandro', 'Usa mais agendamento. Isso cria compromisso quando aceito, mas gera atrito quando o horário é presumido.', { left: 930, top: 180, width: 260, height: 185 }, C.sandro, C.paleBlue, 17);
  addCallout(slide, 'Henrique', 'Faz mais perguntas e obtém maior resposta por turno. O risco está em explicar demais antes de receber microconfirmações.', { left: 930, top: 390, width: 260, height: 205 }, C.henrique, C.paleTeal, 17);
  notes(slide, 'Pergunta é presença de “?” em mensagens com texto. Proposta inclui cotação, plano, operadora, arquivo, PDF ou valor.');
}

// 10. Sandro strengths
{
  const slide = baseSlide('Sandro: pontos fortes', 'A persistência e a adaptação aparecem com clareza nas jornadas longas e nos casos que avançaram.');
  addTable(slide, [
    ['Força', 'Evidência na base', 'Valor para o atendimento'],
    ['Recuperação recente', `${pct(S.monthly.at(-1).replyRate)} de resposta em setembro`, 'Mostra capacidade de ajustar a abordagem'],
    ['Acompanhamento ativo', `${pct(S.schedulingRate)} das conversas citam agendamento ou ligação`, 'Mantém próximo passo visível'],
    ['Adaptação ao lead', 'Alterna ligação, texto, áudio, cotação e retomada', 'Reduz dependência de um único canal'],
    ['Persistência documental', 'Casos com semanas de acompanhamento chegaram a documentação', 'Evita perder propostas por inércia'],
    ['Boa resposta em jornadas engajadas', `${pct(S.turnResponseRate)} de resposta média por turno`, 'Consegue sustentar diálogo quando o lead entra na conversa'],
  ], { left: 58, top: 150, width: 1160, height: 340 }, [240, 410, 510], { fontSize: 15, boldFirstColumn: true });
  addCallout(slide, 'Caso S-f823db', 'Resposta em 5 minutos e avanço até primeiro pagamento. Sandro acompanhou dúvidas por um mês e manteve disponibilidade.', { left: 58, top: 515, width: 550, height: 142 }, C.sandro, C.paleBlue, 17);
  addCallout(slide, 'Caso S-539c95', 'Acompanhamento persistente da documentação, adaptação ao horário e reconhecimento de problemas familiares. O caso avançou.', { left: 668, top: 515, width: 550, height: 142 }, C.green, '#E9F6EF', 17);
  notes(slide, 'Casos anonimizados pelo código interno da conversa. Status refletem o CRM na data da extração.');
}

// 11. Sandro weaknesses
{
  const slide = baseSlide('Sandro: pontos de atenção', 'O principal risco é transformar persistência em pressão, especialmente quando o lead ainda não respondeu.');
  addTable(slide, [
    ['Risco', 'Sinal observado', 'Correção recomendada'],
    ['Abertura sem contexto', `${pct(1 - S.contextRate)} das primeiras mensagens não recuperam claramente o atendimento anterior`, 'Usar nome, dado coletado e próximo passo'],
    ['Horário presumido', 'Mensagens avisam que haverá nova ligação em horário definido pelo vendedor', 'Oferecer duas opções e pedir confirmação'],
    ['Pressão social ou medo', 'Referências a agenda cheia, SUS, exposição e necessidade de responder', 'Trocar por consequência objetiva e saída respeitosa'],
    ['Texto e revisão', 'Erros como “vou preencheu”, “fazerz”, abreviações e pontuação excessiva', 'Revisar modelos e reduzir improviso'],
    ['Cadência extensa sem resposta', 'Há jornadas com 12 a 15 mensagens sem inbound do lead', 'Limitar tentativas e encerrar com porta aberta'],
    ['Desfecho defensivo', 'No caso S-f823db, uma dúvida contratual terminou com sugestão de procurar outro corretor', 'Usar protocolo de recuperação e escalonamento'],
  ], { left: 58, top: 150, width: 1160, height: 405 }, [245, 445, 470], { fontSize: 14, boldFirstColumn: true });
  addCallout(slide, 'Impacto gerencial', `A resposta em 24 horas ficou em ${pct(S.replyWithin24h)}, ${((H.replyWithin24h - S.replyWithin24h) * 100).toFixed(1).replace('.', ',')} p.p. abaixo de Henrique. Os testes diretos são melhorar contexto e não presumir agenda.`, { left: 58, top: 570, width: 1160, height: 92 }, C.red, C.paleRed, 16);
  notes(slide, 'Os exemplos representam padrões encontrados na base e não uma avaliação de intenção pessoal.');
}

// 12. Henrique strengths
{
  const slide = baseSlide('Henrique: pontos fortes', 'A consistência da passagem e a explicação técnica sustentam melhor continuidade ao longo do período.');
  addTable(slide, [
    ['Força', 'Evidência na base', 'Valor para o atendimento'],
    ['Continuidade clara', `${pct(H.contextRate)} das aberturas recuperam o contexto anterior`, 'Reduz estranhamento na troca de atendente'],
    ['Resposta em 24 horas', `${pct(H.replyWithin24h)} das conversas recebem retorno do lead`, 'Mantém mais oportunidades ativas'],
    ['Diagnóstico consultivo', `${pct(H.questionMessageRate)} das mensagens textuais contêm pergunta`, 'Coleta detalhes antes de recomendar'],
    ['Explicação técnica', 'Diferencia coparticipação, rede, abrangência e documentação', 'Ajuda o lead a comparar opções'],
    ['Resolução de exceções', 'Aciona suporte jurídico e acompanha questões contratuais', 'Demonstra responsabilidade após a proposta'],
  ], { left: 58, top: 150, width: 1160, height: 340 }, [240, 410, 510], { fontSize: 15, boldFirstColumn: true });
  addCallout(slide, 'Caso H-b8aeba', 'Contexto claro, dúvidas de produto respondidas e avanço para documentação. O suporte continuou após a adesão.', { left: 58, top: 515, width: 550, height: 142 }, C.henrique, C.paleTeal, 17);
  addCallout(slide, 'Caso H-742dfa', 'Resposta em 5 minutos, perguntas técnicas e acompanhamento até documentação. Houve alto envolvimento dos dois lados.', { left: 668, top: 515, width: 550, height: 142 }, C.green, '#E9F6EF', 17);
  notes(slide, 'Casos anonimizados pelo código interno. Status refletem o CRM na extração.');
}

// 13. Henrique weaknesses
{
  const slide = baseSlide('Henrique: pontos de atenção', 'A abordagem consultiva perde eficiência quando a explicação vira um bloco longo ou quando a retomada usa culpa e medo.');
  addTable(slide, [
    ['Risco', 'Sinal observado', 'Correção recomendada'],
    ['Abertura longa e genérica', `Mediana de ${H.medianFirstMessageChars} caracteres`, 'Personalizar com um dado coletado e uma pergunta curta'],
    ['Excesso de explicação antes da resposta', 'Alguns leads recebem vários parágrafos seguidos', 'Entregar um ponto por vez e pedir confirmação'],
    ['Pressão por retorno', `${pct(H.pressureLanguageRate)} das conversas têm linguagem de definição ou cobrança`, 'Separar urgência real de cobrança emocional'],
    ['Medo como argumento', 'Referências a ficar “desprotegido” e a vendedor “chato”', 'Focar em cobertura, prazo e decisão informada'],
    ['Cadência prolongada', 'Há casos com várias retomadas após silêncio', 'Definir limite e motivo de encerramento'],
    ['Erros e duplicação visual', 'Pares idênticos aparecem em jornadas extensas', 'Corrigir integração e revisar modelos'],
  ], { left: 58, top: 150, width: 1160, height: 405 }, [245, 445, 470], { fontSize: 14, boldFirstColumn: true });
  addCallout(slide, 'Impacto gerencial', 'Henrique já tem continuidade mais forte. O ganho provável está em encurtar a abertura e manter o tom consultivo nas retomadas.', { left: 58, top: 570, width: 1160, height: 92 }, C.red, C.paleRed, 16);
  notes(slide, 'Pressão foi classificada por expressões de definição, resposta obrigatória, decisão ou cobrança de retorno. É uma aproximação textual.');
}

// 14. Sandro cases
{
  const slide = baseSlide('Sandro: duas jornadas que resumem o padrão', 'Os trechos foram abreviados e os leads foram identificados apenas pelo código da conversa.');
  addCallout(slide, 'S-f823db  /  avançou até 1º pagamento', 'Ponto forte: resposta rápida, acompanhamento longo e disposição para resolver dúvidas. Ponto crítico: diante de uma exigência contratual, a conversa terminou em cancelamento e “fique à vontade para procurar outro corretor”.', { left: 58, top: 150, width: 550, height: 190 }, C.sandro, C.paleBlue);
  addCallout(slide, 'S-e93484  /  sem resposta', 'Após a abertura, o lead recebeu mensagens repetidas, novos horários de ligação definidos unilateralmente e uma cobrança final citando agenda cheia e dependência do SUS. Não houve inbound.', { left: 668, top: 150, width: 550, height: 190 }, C.red, C.paleRed);
  addTable(slide, [
    ['Momento', 'O que funcionou', 'O que deve mudar'],
    ['Lead engajado', 'Presença, velocidade, adaptação e acompanhamento', 'Protocolo de recuperação antes de cancelar'],
    ['Lead silencioso', 'Persistência e oferta de WhatsApp', 'Menos tentativas, sem horário presumido ou culpa'],
    ['Padrão de escrita', 'Tom próximo e direto', 'Corrigir abreviações, concordância e pontuação'],
    ['Próximo teste', 'Manter contato consultivo', 'Mensagem curta com duas opções e encerramento após a 4ª tentativa'],
  ], { left: 58, top: 390, width: 1160, height: 225 }, [200, 470, 490], { fontSize: 15, boldFirstColumn: true });
  notes(slide, 'Trechos analisados nas conversas f823db4d-0288-4e33-80ba-428440148ded e e93484fb-784f-4e2c-8eee-827e007cbb06.');
}

// 15. Henrique cases
{
  const slide = baseSlide('Henrique: duas jornadas que resumem o padrão', 'Os casos mostram o contraste entre condução técnica e insistência depois do silêncio.');
  addCallout(slide, 'H-b8aeba  /  documentação', 'Abertura contextual, perguntas técnicas, explicação clara das modalidades e suporte após a proposta. A jornada registra alta reciprocidade e continuidade até setembro.', { left: 58, top: 150, width: 550, height: 190 }, C.henrique, C.paleTeal);
  addCallout(slide, 'H-734ad5  /  sem resposta', 'O lead recebeu perguntas úteis, mas a retomada final atribuiu o silêncio ao receio de vendedores e pediu “só 10 minutos”. A mensagem aumenta a pressão sem nova evidência de valor.', { left: 668, top: 150, width: 550, height: 190 }, C.red, C.paleRed);
  addTable(slide, [
    ['Momento', 'O que funcionou', 'O que deve mudar'],
    ['Lead engajado', 'Clareza técnica e continuidade', 'Quebrar textos longos em microdecisões'],
    ['Lead silencioso', 'Oferta de ligação ou WhatsApp', 'Evitar interpretar o motivo do silêncio'],
    ['Padrão de escrita', 'Modelo consistente e profissional', 'Personalizar além do nome e da origem'],
    ['Próximo teste', 'Manter contexto da Aline', 'Abrir com um dado específico e uma pergunta de baixa fricção'],
  ], { left: 58, top: 390, width: 1160, height: 225 }, [200, 470, 490], { fontSize: 15, boldFirstColumn: true });
  notes(slide, 'Trechos analisados nas conversas b8aeba91-7607-407a-8e59-437f6fec20d0 e 734ad5c1-74a7-41f5-adf2-080f24e62a3a.');
}

// 16. Commercial outcomes
{
  const slide = baseSlide('Resultado registrado no CRM', 'As carteiras são quase iguais em tamanho; Henrique tem mais vendas realizadas, enquanto Sandro tem mais leads em etapas avançadas.');
  addMetricRow(slide, [
    { value: num(S.assignedLeads), label: 'leads atribuídos a Sandro', color: C.sandro },
    { value: num(H.assignedLeads), label: 'leads atribuídos a Henrique', color: C.henrique },
    { value: '3 vs 5', label: 'vendas realizadas: Sandro vs Henrique', color: C.green },
    { value: '11 vs 10', label: 'documentação, pagamento ou venda', color: C.cyan },
  ], 145);
  addChart(slide, 'bar', {
    position: { left: 74, top: 295, width: 760, height: 300 },
    categories: ['Venda realizada', '1º pagamento', 'Documentação', 'Cotação enviada', 'Em negociação'],
    series: [
      { name: 'Sandro', values: [3, 2, 6, 16, 3], fill: C.sandro },
      { name: 'Henrique', values: [5, 2, 3, 15, 6], fill: C.henrique },
    ],
    barOptions: { direction: 'bar', grouping: 'clustered', gapWidth: 50 },
    legend: { position: 'bottom', overlay: false, textStyle: { fill: C.muted, fontSize: 14 } },
    xAxis: { majorGridlines: { style: 'solid', fill: C.line, width: 1 }, textStyle: { fill: C.muted, fontSize: 12 } },
    yAxis: { textStyle: { fill: C.ink, fontSize: 13 } },
    dataLabels: { showValue: true, position: 'outEnd', textStyle: { fill: C.ink, fontSize: 12, bold: true } },
    chartFill: C.bg, plotAreaFill: C.bg, chartLine: { fill: 'none', width: 0 }, plotAreaLine: { fill: 'none', width: 0 },
  });
  addCallout(slide, 'Limitação', 'Status do CRM depende de atualização humana e mistura coortes com maturidades diferentes. A comparação descreve o registro atual; não prova causalidade do estilo de atendimento.', { left: 875, top: 320, width: 315, height: 205 }, C.amber, C.paleAmber);
  notes(slide, 'Contagens obtidas da distribuição de status dos leads atribuídos. Documentação soma variações singular e plural.');
}

// 17. Shared issues
{
  const slide = baseSlide('Problemas comuns aos dois atendimentos', 'Alguns riscos pertencem ao processo e à infraestrutura, não ao vendedor individual.');
  addTable(slide, [
    ['Tema', 'Sandro', 'Henrique', 'Interpretação'],
    ['Mensagens idênticas em até 2 min', pct(S.repeatedMessageRate), pct(H.repeatedMessageRate), 'Padrão compatível com duplicação técnica'],
    ['Conversas encerradas com outbound', pct(S.awaitingLeadRate), pct(H.awaitingLeadRate), 'Muitas jornadas aguardam resposta ou não foram encerradas'],
    ['Handoff em até 15 min', pct(S.handoffWithin15m), pct(H.handoffWithin15m), 'Ausência de SLA consistente'],
    ['Áudios, imagens e arquivos', 'Presentes', 'Presentes', 'Conteúdo semântico não transcrito nesta análise'],
    ['Status “Sem interesse”', `${num(S.statusDistribution.find((x) => x.status === 'Sem interesse')?.count || 0)} leads`, `${num(H.statusDistribution.find((x) => x.status === 'Sem interesse')?.count || 0)} leads`, 'Motivo de perda precisa ser estruturado'],
  ], { left: 58, top: 150, width: 1160, height: 315 }, [280, 190, 190, 500], { fontSize: 15, boldFirstColumn: true });
  addCallout(slide, 'Duplicação não deve virar avaliação pessoal', 'Foram observados pares exatamente iguais, separados por poucos segundos, em diversas conversas. A prioridade é identificar reenvio por integração, webhook ou múltiplas instâncias antes de atribuir o problema ao comportamento do corretor.', { left: 58, top: 505, width: 1160, height: 140 }, C.red, C.paleRed);
  notes(slide, 'A taxa de repetição usa textos idênticos do mesmo vendedor dentro de janela de dois minutos. A causa técnica exige investigação separada.');
}

// 18. Standard model
{
  const slide = baseSlide('Modelo recomendado de atendimento', 'Um padrão único preserva o melhor dos dois estilos: contexto, objetividade, escolha do canal e cadência limitada.');
  addTable(slide, [
    ['Momento', 'Mensagem ou ação esperada', 'Critério de qualidade'],
    ['Abertura', 'Nome + dado que a Aline coletou + uma pergunta simples', 'Até 180 caracteres'],
    ['Canal', 'Perguntar se prefere WhatsApp ou ligação', 'Nunca presumir horário'],
    ['Diagnóstico', 'Uma pergunta por mensagem, começando pelo impeditivo central', 'Resposta fácil e sequencial'],
    ['Proposta', 'Comparar no máximo 2 ou 3 opções e explicar a recomendação', 'Preço, rede e coparticipação visíveis'],
    ['Retomada', 'Adicionar informação nova ou esclarecer uma objeção', 'Sem culpa, medo ou cobrança pessoal'],
    ['Encerramento', 'Após a 4ª tentativa sem resposta, pausar e deixar porta aberta', 'Status e motivo registrados no CRM'],
  ], { left: 58, top: 145, width: 1160, height: 370 }, [180, 600, 380], { fontSize: 15, boldFirstColumn: true });
  addCallout(slide, 'Abertura sugerida', '“Olá, [nome]. Sou o [Sandro/Henrique]. A Aline me passou que você busca um plano para [vidas] e prioriza [hospital/região]. Posso seguir por aqui ou você prefere uma ligação curta?”', { left: 58, top: 550, width: 1160, height: 105 }, C.cyan, C.white);
  notes(slide, 'Modelo proposto a partir dos padrões com maior clareza e menor fricção encontrados na base.');
}

// 19. Cadence
{
  const slide = baseSlide('Cadência sugerida para leads sem resposta', 'A sequência deve adicionar valor e terminar de forma respeitosa.');
  addTable(slide, [
    ['Tentativa', 'Momento', 'Conteúdo', 'Regra'],
    ['1', 'Handoff', 'Contexto da Aline e pergunta simples', 'Canal escolhido pelo lead'],
    ['2', 'Após 2 horas úteis', 'Alternativa objetiva ou pedido de confirmação', 'Sem repetir o texto anterior'],
    ['3', 'Próximo dia útil', 'Uma recomendação concreta baseada nos dados coletados', 'Máximo de 3 parágrafos curtos'],
    ['4', 'Dois dias depois', 'Mensagem final com opção de pausar', 'Registrar sem retorno se continuar em silêncio'],
    ['Reativação', 'Após 30 dias', 'Somente com informação nova, campanha ou mudança de preço', 'Não reabrir apenas para cobrar resposta'],
  ], { left: 58, top: 155, width: 1160, height: 330 }, [125, 190, 555, 290], { fontSize: 15, boldFirstColumn: true });
  addCallout(slide, 'O que retirar dos modelos', 'Horários sem confirmação, agenda cheia, dependência do SUS, “desistiram?” e frases que transfiram ao lead a frustração do acompanhamento.', { left: 58, top: 505, width: 550, height: 150 }, C.red, C.paleRed, 17);
  addCallout(slide, 'O que manter', 'Disponibilidade, clareza técnica, resumo do que já foi coletado, diferenças entre planos e retorno com informação nova.', { left: 668, top: 505, width: 550, height: 150 }, C.green, '#E9F6EF', 17);
  notes(slide, 'Cadência proposta para teste controlado. Não representa regra já existente no sistema.');
}

// 20. Action plan
{
  const slide = baseSlide('Plano de melhoria para 30 dias', 'Ações mensuráveis, separando correção técnica de treinamento.');
  addTable(slide, [
    ['Prazo', 'Ação', 'Responsável', 'Indicador', 'Meta inicial'],
    ['Hoje', 'Investigar duplicação de mensagens', 'Tecnologia', 'Repetição em 2 min', '< 1%'],
    ['Hoje', 'Criar SLA de handoff em horário comercial', 'Gestão', 'Mediana até o vendedor', '< 15 min'],
    ['3 dias', 'Padronizar abertura contextual curta', 'Sandro e Henrique', 'Aberturas com contexto', '> 95%'],
    ['7 dias', 'Limitar cadência sem resposta a 4 tentativas', 'Gestão', 'Mensagens sem inbound', 'queda de 50%'],
    ['7 dias', 'Revisar ortografia e tom dos modelos', 'Qualidade', 'Amostra auditada', '> 90% aderência'],
    ['14 dias', 'Testar duas aberturas por vendedor', 'Operação', 'Resposta em 24h', '+8 p.p.'],
    ['30 dias', 'Reprocessar coortes e status do CRM', 'RevOps', 'Venda e motivo de perda', '> 95% preenchido'],
  ], { left: 58, top: 142, width: 1160, height: 415 }, [105, 365, 175, 295, 220], { fontSize: 14, headerFontSize: 13, boldFirstColumn: true });
  addCallout(slide, 'Meta central', `Elevar Sandro de ${pct(S.replyWithin24h)} para pelo menos 58% e manter Henrique acima de 62%, sem aumentar as tentativas.`, { left: 58, top: 570, width: 1160, height: 92 }, C.cyan, C.white, 16);
  notes(slide, 'Metas iniciais propostas para um ciclo de teste de 30 dias.');
}

// 21. Metric glossary
{
  const slide = baseSlide('Definições das métricas', 'As regras abaixo tornam o relatório reproduzível e evitam interpretações diferentes do mesmo indicador.');
  addTable(slide, [
    ['Métrica', 'Definição operacional'],
    ['Conversa tocada', 'Ao menos uma mensagem outbound atribuída a Sandro ou Henrique pelo remetente ou metadados.'],
    ['Resposta ao primeiro contato', 'Primeira mensagem inbound depois da primeira mensagem do vendedor naquela conversa.'],
    ['Resposta em 15 min ou 24h', 'Diferença entre a primeira mensagem do vendedor e a primeira resposta posterior do lead.'],
    ['Handoff', 'Intervalo entre a última mensagem anterior da Aline e a primeira mensagem do vendedor.'],
    ['Resposta por turno', 'Bloco consecutivo de mensagens do vendedor seguido por uma mensagem inbound.'],
    ['Contexto na abertura', 'Menção a Aline, formulário, interesse, cotação, plano ou continuidade.'],
    ['Etapa avançada', 'Documentação, primeiro pagamento ou venda realizada no status atual do CRM.'],
    ['Duplicação textual', 'Texto idêntico do mesmo vendedor em intervalo de até dois minutos.'],
  ], { left: 58, top: 145, width: 1160, height: 465 }, [280, 880], { fontSize: 15, boldFirstColumn: true });
  notes(slide, 'Definições usadas pelo script scripts/analyze-sandro-henrique-complete.mjs.');
}

// 22. Methodology
{
  const slide = baseSlide('Metodologia e limites', 'O relatório cobre toda a base disponível, mas separa claramente o que foi medido do que exige interpretação humana.');
  addTable(slide, [
    ['Item', 'Tratamento adotado'],
    ['Período', 'Da primeira conversa disponível em 15/06/2026 até a última mensagem extraída em 17/09/2026.'],
    ['Cobertura', '558 conversas, 25.110 mensagens, paginação completa e contagem exata conferida.'],
    ['Exclusões', 'Conversas vazias e contatos identificados como teste não entram nas taxas operacionais.'],
    ['Qualitativo', 'Padrões textuais em toda a base e leitura aprofundada de jornadas fortes, frágeis e sem resposta.'],
    ['Áudio e anexos', 'Contados como eventos, mas sem transcrição ou leitura semântica do conteúdo.'],
    ['Causalidade', 'Diferenças podem refletir campanha, horário, qualidade do lead, carteira e maturidade da coorte.'],
    ['Privacidade', 'Nomes abreviados; casos apresentados por código interno da conversa.'],
    ['Atualização', 'Setembro está parcial. Reprocessar no fechamento do mês e após 30 dias de maturação.'],
  ], { left: 58, top: 145, width: 1160, height: 395 }, [240, 920], { fontSize: 14, boldFirstColumn: true });
  addCallout(slide, 'Conclusão', 'Henrique tem maior continuidade e melhor uso do contexto. Sandro mostra recuperação e acompanhamento forte, mas precisa reduzir pressão e padronizar a abertura. Para ambos, a prioridade é o SLA de handoff e a correção da duplicação técnica.', { left: 58, top: 555, width: 1160, height: 110 }, C.cyan, C.white, 16);
  notes(slide, 'Fechamento metodológico. Nenhuma conclusão deve ser usada isoladamente para remuneração ou punição sem controle de carteira e auditoria amostral adicional.');
}

const keepSlides = Number(process.env.KEEP_SLIDES || 0);
if (keepSlides > 0 && keepSlides < presentation.slides.items.length) {
  while (presentation.slides.items.length > keepSlides) presentation.slides.remove(presentation.slides.items.length - 1);
}
const candidatePath = path.join(buildDir, keepSlides ? `candidate-${keepSlides}.pptx` : 'candidate.pptx');
for (let index = 0; index < presentation.slides.items.length; index += 1) {
  const layout = await presentation.slides.items[index].export({ format: 'layout' });
  await fs.writeFile(path.join(buildDir, `slide-${String(index + 1).padStart(2, '0')}.layout.json`), await layout.text());
}
await (await PresentationFile.exportPptx(presentation)).save(candidatePath);
if (keepSlides > 0) {
  console.log(JSON.stringify({ candidatePath, slides: presentation.slides.items.length }));
  process.exit(0);
}

const requirements = {
  explicitTotalSlideCount: 22,
  requiredNativeTableOwnerSlides: [2, 7, 8, 10, 11, 12, 13, 14, 15, 17, 18, 19, 20, 21, 22],
  requiredNativeChartOwnerSlides: [4, 5, 6, 9, 16],
  materializeLiteralChartWorkbooks: true,
  nativeChartTargetApplication: 'powerpoint',
};
const stagingDir = path.join(buildDir, '.codex-finalizer');
await fs.mkdir(stagingDir, { recursive: true });
const result = await finalizePresentation({
  ...requirements,
  workspaceDir,
  candidatePath,
  finalPath,
  pythonExecutable: RUNTIME_PYTHON,
  integrityValidatorPath: path.join(SKILL_DIR, 'container_tools', 'inspect_presentation_package_integrity.py'),
  layoutValidatorPath: path.join(SKILL_DIR, 'container_tools', 'inspect_presentation_layout_geometry.py'),
  layoutArgs: [
    '--expected-slide-size-emu', '12192000,6858000',
    '--validate-bullet-geometry',
    '--validate-heading-fit',
    ...requirements.requiredNativeTableOwnerSlides.flatMap((number) => ['--require-native-table-slide', String(number)]),
  ],
  requiredNativeTableOwnerSlides: requirements.requiredNativeTableOwnerSlides,
  requiredNativeChartOwnerSlides: requirements.requiredNativeChartOwnerSlides,
  materializeLiteralChartWorkbooks: true,
  nativeChartTargetApplication: 'powerpoint',
  fontPolicy: { basis: 'design', families: [FONT] },
  verifyArtifactToolImport: true,
  receiptPath: path.join(stagingDir, 'relatorio-atendimento-sandro-henrique.validation.json'),
});

console.log(JSON.stringify({ finalPath, slides: presentation.slides.items.length, result }, null, 2));
