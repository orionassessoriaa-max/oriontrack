import json
import math
from datetime import datetime
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.platypus import (
    BaseDocTemplate,
    Flowable,
    Frame,
    HRFlowable,
    KeepTogether,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / 'tmp' / 'danilo-ai-analysis.json'
OUTPUT_PATH = ROOT / 'output' / 'pdf' / 'analise-ia-aline-danilo.pdf'

NAVY = colors.HexColor('#071321')
INK = colors.HexColor('#102238')
BLUE = colors.HexColor('#1264d9')
CYAN = colors.HexColor('#09a9df')
TEAL = colors.HexColor('#00a88f')
MUTED = colors.HexColor('#60758e')
LIGHT = colors.HexColor('#f5f8fc')
LINE = colors.HexColor('#dce5ef')
RED = colors.HexColor('#d94b58')
AMBER = colors.HexColor('#d28b1f')


def fmt_pct(value):
    return 'N/A' if value is None else f'{value * 100:.1f}%'


def fmt_minutes(value):
    if value is None:
        return 'N/A'
    if value < 60:
        return f'{value:.1f} min'
    if value < 1440:
        return f'{value / 60:.1f} h'
    return f'{value / 1440:.1f} dias'


def fmt_date(value):
    if not value:
        return 'N/A'
    return datetime.fromisoformat(value.replace('Z', '+00:00')).strftime('%d/%m/%Y')


class MetricCards(Flowable):
    def __init__(self, cards, width=175 * mm, height=29 * mm):
        super().__init__()
        self.cards = cards
        self.width = width
        self.height = height

    def draw(self):
        card_width = (self.width - 3 * 4 * mm) / 4
        for index, (label, value, color) in enumerate(self.cards):
            x = index * (card_width + 4 * mm)
            self.canv.setFillColor(colors.white)
            self.canv.setStrokeColor(LINE)
            self.canv.roundRect(x, 0, card_width, self.height, 3 * mm, fill=1, stroke=1)
            self.canv.setFillColor(color)
            self.canv.roundRect(x, self.height - 2.2 * mm, card_width, 2.2 * mm, 1 * mm, fill=1, stroke=0)
            self.canv.setFillColor(MUTED)
            self.canv.setFont('Helvetica-Bold', 7.4)
            self.canv.drawString(x + 3 * mm, self.height - 8 * mm, label.upper())
            self.canv.setFillColor(INK)
            self.canv.setFont('Helvetica-Bold', 18)
            self.canv.drawString(x + 3 * mm, 7 * mm, value)


class BarChart(Flowable):
    def __init__(self, values, width=175 * mm, height=65 * mm):
        super().__init__()
        self.values = values
        self.width = width
        self.height = height

    def draw(self):
        if not self.values:
            return
        left, bottom = 18 * mm, 10 * mm
        chart_w, chart_h = self.width - left - 4 * mm, self.height - bottom - 8 * mm
        max_value = max(max(x['total'], x['responded']) for x in self.values) or 1
        self.canv.setStrokeColor(LINE)
        self.canv.setLineWidth(0.4)
        for step in range(0, 5):
            y = bottom + chart_h * step / 4
            self.canv.line(left, y, left + chart_w, y)
            self.canv.setFillColor(MUTED)
            self.canv.setFont('Helvetica', 6.5)
            self.canv.drawRightString(left - 2 * mm, y - 2, str(round(max_value * step / 4)))
        step_w = chart_w / max(len(self.values), 1)
        bar_w = min(4.3 * mm, step_w * 0.34)
        for i, item in enumerate(self.values):
            x = left + step_w * i + step_w * 0.23
            total_h = chart_h * item['total'] / max_value
            response_h = chart_h * item['responded'] / max_value
            self.canv.setFillColor(colors.HexColor('#b9c9dc'))
            self.canv.roundRect(x, bottom, bar_w, total_h, 1 * mm, fill=1, stroke=0)
            self.canv.setFillColor(CYAN)
            self.canv.roundRect(x + bar_w + 1 * mm, bottom, bar_w, response_h, 1 * mm, fill=1, stroke=0)
            if i % max(1, math.ceil(len(self.values) / 10)) == 0:
                self.canv.setFillColor(MUTED)
                self.canv.setFont('Helvetica', 6)
                self.canv.drawCentredString(x + bar_w, bottom - 4 * mm, fmt_date(item['date']))
        self.canv.setFillColor(colors.HexColor('#b9c9dc'))
        self.canv.rect(self.width - 32 * mm, self.height - 5 * mm, 3 * mm, 2 * mm, fill=1, stroke=0)
        self.canv.setFillColor(MUTED)
        self.canv.setFont('Helvetica', 7)
        self.canv.drawString(self.width - 28 * mm, self.height - 5.5 * mm, 'IA acionou')
        self.canv.setFillColor(CYAN)
        self.canv.rect(self.width - 32 * mm, self.height - 9 * mm, 3 * mm, 2 * mm, fill=1, stroke=0)
        self.canv.setFillColor(MUTED)
        self.canv.drawString(self.width - 28 * mm, self.height - 9.5 * mm, 'Lead respondeu')


def footer(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(NAVY)
    canvas.rect(0, 0, A4[0], 13 * mm, fill=1, stroke=0)
    canvas.setFillColor(colors.white)
    canvas.setFont('Helvetica-Bold', 8)
    canvas.drawString(18 * mm, 5 * mm, 'ORION TRACK  |  ANÁLISE DE ATENDIMENTO DA ALINE')
    canvas.setFont('Helvetica', 8)
    canvas.drawRightString(A4[0] - 18 * mm, 5 * mm, f'Página {doc.page}')
    canvas.restoreState()


def build():
    data = json.loads(DATA_PATH.read_text(encoding='utf-8'))
    h = data['headline']
    scope = data['scope']
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)

    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(name='TitleOrion', parent=styles['Title'], fontName='Helvetica-Bold', fontSize=27, leading=31, textColor=INK, spaceAfter=4))
    styles.add(ParagraphStyle(name='Subtitle', parent=styles['Normal'], fontSize=10.5, leading=15, textColor=MUTED, spaceAfter=5))
    styles.add(ParagraphStyle(name='H1Orion', parent=styles['Heading1'], fontName='Helvetica-Bold', fontSize=17, leading=22, textColor=INK, spaceBefore=8, spaceAfter=8))
    styles.add(ParagraphStyle(name='H2Orion', parent=styles['Heading2'], fontName='Helvetica-Bold', fontSize=11.5, leading=15, textColor=BLUE, spaceBefore=8, spaceAfter=5))
    styles.add(ParagraphStyle(name='BodyOrion', parent=styles['BodyText'], fontSize=9.2, leading=14, textColor=INK, spaceAfter=5))
    styles.add(ParagraphStyle(name='SmallOrion', parent=styles['BodyText'], fontSize=7.8, leading=11, textColor=MUTED, spaceAfter=3))
    styles.add(ParagraphStyle(name='Callout', parent=styles['BodyText'], fontName='Helvetica-Bold', fontSize=11, leading=16, textColor=INK, leftIndent=7, rightIndent=7, spaceBefore=3, spaceAfter=3))
    styles.add(ParagraphStyle(name='TableHead', parent=styles['BodyText'], fontName='Helvetica-Bold', fontSize=7.8, leading=10, textColor=colors.white))
    styles.add(ParagraphStyle(name='TableCell', parent=styles['BodyText'], fontSize=7.8, leading=10, textColor=INK))

    doc = BaseDocTemplate(str(OUTPUT_PATH), pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm, topMargin=17 * mm, bottomMargin=18 * mm, title='Análise da IA Aline - Danilo Iacovone', author='Orion Track')
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id='normal')
    doc.addPageTemplates([PageTemplate(id='main', frames=frame, onPage=footer)])
    story = []

    story += [Paragraph('Análise de Atendimento da IA', styles['TitleOrion']), Paragraph('Aline, SDR da Orion Assessoria', styles['Subtitle']), Paragraph(f'Operação analisada: <b>Danilo Iacovone</b> | Período observado: <b>{fmt_date(scope["firstConversation"])} a {fmt_date(scope["lastConversation"])}</b>', styles['BodyOrion']), HRFlowable(width='100%', thickness=1.2, color=CYAN, spaceBefore=2, spaceAfter=12)]
    story.append(Paragraph('Resumo executivo', styles['H1Orion']))
    story.append(Paragraph(f'Os dados indicam que a Aline está funcionando como primeira camada de atendimento e está conseguindo provocar resposta dos leads. Na coorte operacional, a IA iniciou <b>{h["aiInitiated"]} conversas</b> e <b>{h["leadsResponded"]} leads responderam</b>, resultando em uma taxa observada de <b>{fmt_pct(h["responseRate"])}</b>.', styles['BodyOrion']))
    story.append(KeepTogether([MetricCards([
        ('Conversas da IA', str(h['aiInitiated']), BLUE),
        ('Leads que responderam', str(h['leadsResponded']), TEAL),
        ('Taxa de resposta', fmt_pct(h['responseRate']), CYAN),
        ('Sem resposta', str(h['noResponse']), RED),
    ]), Spacer(1, 8 * mm)]))
    story.append(Paragraph('Leitura principal', styles['H2Orion']))
    story.append(Paragraph(f'<b>Sim, a IA está gerando resposta.</b> A mediana foi de <b>{fmt_minutes(h["medianResponseMinutes"])}</b> e {fmt_pct(h["responseWithin15Minutes"])} dos leads responderam em até 15 minutos. Isso é um sinal forte de que a primeira abordagem da Aline está abrindo a conversa.', styles['BodyOrion']))
    story.append(Paragraph('<b>Mas isso ainda não é uma prova causal de aumento.</b> A comparação disponível é observacional: a IA foi usada em uma seleção de leads diferente da abordagem humana. Para afirmar o ganho real, será necessário um teste A/B com leads equivalentes, mantendo origem, campanha, horário e mensagem de entrada comparáveis.', styles['BodyOrion']))

    story.append(PageBreak())
    story.append(Paragraph('Métricas de resposta', styles['H1Orion']))
    story.append(Paragraph('A taxa abaixo considera como “resposta” qualquer mensagem recebida depois da primeira mensagem enviada pela Aline na conversa.', styles['BodyOrion']))
    metrics_data = [
        [Paragraph('Indicador', styles['TableHead']), Paragraph('Resultado', styles['TableHead']), Paragraph('Interpretação', styles['TableHead'])],
        [Paragraph('Conversas operacionais', styles['TableCell']), Paragraph(str(scope['operationalConversations']), styles['TableCell']), Paragraph('Conversas com histórico e sem identificação de teste.', styles['TableCell'])],
        [Paragraph('Conversas iniciadas pela Aline', styles['TableCell']), Paragraph(f'{h["aiInitiated"]} ({fmt_pct(h["aiInitiatedRate"])})', styles['TableCell']), Paragraph('A IA foi a primeira atendente identificada no histórico.', styles['TableCell'])],
        [Paragraph('Leads que responderam', styles['TableCell']), Paragraph(f'{h["leadsResponded"]} ({fmt_pct(h["responseRate"])})', styles['TableCell']), Paragraph('Houve pelo menos uma resposta após a abordagem da IA.', styles['TableCell'])],
        [Paragraph('Resposta em até 15 minutos', styles['TableCell']), Paragraph(fmt_pct(h['responseWithin15Minutes']), styles['TableCell']), Paragraph('Indicador de reação imediata à abordagem.', styles['TableCell'])],
        [Paragraph('Resposta em até 60 minutos', styles['TableCell']), Paragraph(fmt_pct(h['responseWithin60Minutes']), styles['TableCell']), Paragraph('Mostra o engajamento ainda no mesmo ciclo de atendimento.', styles['TableCell'])],
        [Paragraph('Resposta em até 24 horas', styles['TableCell']), Paragraph(fmt_pct(h['responseWithin24Hours']), styles['TableCell']), Paragraph('Inclui respostas tardias, úteis para follow-up.', styles['TableCell'])],
        [Paragraph('Mediana do tempo de resposta', styles['TableCell']), Paragraph(fmt_minutes(h['medianResponseMinutes']), styles['TableCell']), Paragraph('Mais representativa que a média para este conjunto.', styles['TableCell'])],
        [Paragraph('Percentil 90 do tempo', styles['TableCell']), Paragraph(fmt_minutes(h['p90ResponseMinutes']), styles['TableCell']), Paragraph('90% dos leads responderam até este tempo.', styles['TableCell'])],
    ]
    table = Table(metrics_data, colWidths=[47 * mm, 32 * mm, 96 * mm], repeatRows=1)
    table.setStyle(TableStyle([('BACKGROUND', (0, 0), (-1, 0), NAVY), ('GRID', (0, 0), (-1, -1), 0.35, LINE), ('VALIGN', (0, 0), (-1, -1), 'TOP'), ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, LIGHT]), ('LEFTPADDING', (0, 0), (-1, -1), 6), ('RIGHTPADDING', (0, 0), (-1, -1), 6), ('TOPPADDING', (0, 0), (-1, -1), 5), ('BOTTOMPADDING', (0, 0), (-1, -1), 5)]))
    story.append(table)
    story.append(Spacer(1, 8 * mm))
    story.append(Paragraph('Evolução por dia', styles['H2Orion']))
    story.append(Paragraph('Barras cinzas representam as conversas iniciadas pela IA; barras azuis representam as que receberam resposta.', styles['SmallOrion']))
    story.append(BarChart(data['byDay']))

    story.append(PageBreak())
    story.append(Paragraph('Comparação e eficiência operacional', styles['H1Orion']))
    story.append(Paragraph(f'Como referência interna, as conversas iniciadas manualmente tiveram taxa observada de <b>{fmt_pct(h["humanResponseRate"])}</b> ({h["humanInitiated"]} conversas). A diferença observada para a coorte da Aline foi de <b>+{fmt_pct(h["observedDifferenceVsHuman"])}</b>.', styles['BodyOrion']))
    story.append(Paragraph('Essa diferença deve ser tratada como sinal de eficiência, não como atribuição definitiva. Leads podem ter origens, níveis de intenção e horários diferentes. O próximo passo recomendado é um experimento controlado.', styles['BodyOrion']))
    comparison = [
        [Paragraph('Coorte', styles['TableHead']), Paragraph('Conversas', styles['TableHead']), Paragraph('Responderam', styles['TableHead']), Paragraph('Taxa', styles['TableHead']), Paragraph('Tempo mediano', styles['TableHead'])],
        [Paragraph('Aline / IA', styles['TableCell']), Paragraph(str(h['aiInitiated']), styles['TableCell']), Paragraph(str(h['leadsResponded']), styles['TableCell']), Paragraph(fmt_pct(h['responseRate']), styles['TableCell']), Paragraph(fmt_minutes(h['medianResponseMinutes']), styles['TableCell'])],
        [Paragraph('Abordagem humana', styles['TableCell']), Paragraph(str(h['humanInitiated']), styles['TableCell']), Paragraph(str(round(h['humanInitiated'] * h['humanResponseRate'])), styles['TableCell']), Paragraph(fmt_pct(h['humanResponseRate']), styles['TableCell']), Paragraph('Não calculado', styles['TableCell'])],
    ]
    comp = Table(comparison, colWidths=[46 * mm, 28 * mm, 31 * mm, 27 * mm, 43 * mm], repeatRows=1)
    comp.setStyle(TableStyle([('BACKGROUND', (0, 0), (-1, 0), NAVY), ('GRID', (0, 0), (-1, -1), 0.35, LINE), ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, LIGHT]), ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'), ('LEFTPADDING', (0, 0), (-1, -1), 6), ('RIGHTPADDING', (0, 0), (-1, -1), 6), ('TOPPADDING', (0, 0), (-1, -1), 6), ('BOTTOMPADDING', (0, 0), (-1, -1), 6)]))
    story.append(comp)
    story.append(Spacer(1, 9 * mm))
    story.append(Paragraph('Sinais sobre a operação da Aline', styles['H2Orion']))
    bullets = [
        f'Aline enviou {h["aiMessages"]} mensagens no conjunto analisado, com média de {h["aiMessages"] / max(h["aiInitiated"], 1):.1f} mensagens de IA por conversa iniciada.',
        f'{h["handoffConversations"]} conversas tiveram continuidade ou transferência para um responsável depois da participação da IA. A Aline está funcionando como SDR, não apenas como disparo inicial.',
        f'{h["noResponse"]} leads não responderam à primeira abordagem identificada. Eles devem alimentar uma fila de follow-up, não ser considerados falha definitiva da IA.',
        'A média de resposta ficou inflada por respostas muito tardias; por isso, a mediana e as janelas de 15 minutos, 60 minutos e 24 horas são os indicadores mais úteis.',
    ]
    for bullet in bullets:
        story.append(Paragraph(f'• {bullet}', styles['BodyOrion']))
    story.append(Spacer(1, 3 * mm))
    story.append(Paragraph('Conclusão', styles['H2Orion']))
    story.append(Paragraph('Aline está funcionando e os dados atuais mostram alto potencial de aumentar o contato inicial: 95,5% dos leads que receberam a abordagem da IA responderam em algum momento, e 73,9% responderam nos primeiros 15 minutos. A recomendação é manter a IA ativa, corrigir os casos sem resposta com follow-up automático e iniciar um teste A/B para medir o ganho real com rigor.', styles['Callout']))

    story.append(PageBreak())
    story.append(Paragraph('Leads sem resposta após a Aline', styles['H1Orion']))
    story.append(Paragraph('Estes são os cinco casos da coorte operacional em que não foi encontrada mensagem inbound após a primeira abordagem da IA no histórico disponível.', styles['BodyOrion']))
    no_response = [row for row in data['aiCohort'] if not row['responded']]
    no_data = [[Paragraph('Lead', styles['TableHead']), Paragraph('Telefone', styles['TableHead']), Paragraph('Entrada', styles['TableHead']), Paragraph('Ação recomendada', styles['TableHead'])]]
    for row in no_response:
        no_data.append([Paragraph(row['name'], styles['TableCell']), Paragraph(row['phone'], styles['TableCell']), Paragraph(fmt_date(row['createdAt']), styles['TableCell']), Paragraph('Follow-up humano ou nova mensagem curta, sem repetir o texto inicial.', styles['TableCell'])])
    no_table = Table(no_data, colWidths=[46 * mm, 36 * mm, 27 * mm, 66 * mm], repeatRows=1)
    no_table.setStyle(TableStyle([('BACKGROUND', (0, 0), (-1, 0), NAVY), ('GRID', (0, 0), (-1, -1), 0.35, LINE), ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, LIGHT]), ('VALIGN', (0, 0), (-1, -1), 'TOP'), ('LEFTPADDING', (0, 0), (-1, -1), 6), ('RIGHTPADDING', (0, 0), (-1, -1), 6), ('TOPPADDING', (0, 0), (-1, -1), 6), ('BOTTOMPADDING', (0, 0), (-1, -1), 6)]))
    story.append(no_table)
    story.append(Spacer(1, 10 * mm))
    story.append(Paragraph('Plano de medição recomendado', styles['H2Orion']))
    plan = [
        ['1', 'Criar dois grupos equivalentes de leads da mesma origem e período.'],
        ['2', 'Grupo A recebe a abordagem da Aline; Grupo B recebe abordagem humana padronizada.'],
        ['3', 'Medir resposta em 15 minutos, 1 hora e 24 horas, além de reunião agendada e venda.'],
        ['4', 'Manter a mesma pergunta inicial e o mesmo horário de contato para reduzir viés.'],
        ['5', 'Revisar o resultado após pelo menos 50 leads por grupo antes de decidir mudanças no prompt.'],
    ]
    plan_table = Table([[Paragraph('<b>Etapa</b>', styles['TableCell']), Paragraph('<b>Procedimento</b>', styles['TableCell'])]] + [[Paragraph(a, styles['TableCell']), Paragraph(b, styles['TableCell'])] for a, b in plan], colWidths=[20 * mm, 155 * mm])
    plan_table.setStyle(TableStyle([('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#eaf2fb')), ('GRID', (0, 0), (-1, -1), 0.35, LINE), ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, LIGHT]), ('VALIGN', (0, 0), (-1, -1), 'TOP'), ('LEFTPADDING', (0, 0), (-1, -1), 7), ('RIGHTPADDING', (0, 0), (-1, -1), 7), ('TOPPADDING', (0, 0), (-1, -1), 6), ('BOTTOMPADDING', (0, 0), (-1, -1), 6)]))
    story.append(plan_table)
    story.append(Spacer(1, 10 * mm))
    story.append(Paragraph(f'Nota metodológica: análise gerada em {datetime.fromisoformat(data["generatedAt"].replace("Z", "+00:00")).strftime("%d/%m/%Y às %H:%M UTC")}. Foram consideradas as conversas do corretor Danilo Iacovone no banco do Orion Track, com exclusão de conversas sem mensagens e registros identificados como teste.', styles['SmallOrion']))

    doc.build(story)
    print(OUTPUT_PATH)


if __name__ == '__main__':
    build()
