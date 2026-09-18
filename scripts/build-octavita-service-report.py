from __future__ import annotations

import json
import math
import os
from datetime import datetime
from pathlib import Path

from reportlab.graphics.shapes import Drawing, Line, Rect, String, Circle, PolyLine
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate, Flowable, Frame, Image, KeepTogether, PageBreak, PageTemplate,
    Paragraph, Spacer, Table, TableStyle,
)

ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "tmp" / "pdfs" / "octavita-service-analysis.json"
OUTPUT = ROOT / "output" / "pdf" / "relatorio-atendimento-octavita-aline-sandro-henrique.pdf"
LOGO = ROOT / "public" / "brand-logo.png"

PAGE_W, PAGE_H = A4
NAVY = colors.HexColor("#07131F")
NAVY_2 = colors.HexColor("#0D2235")
INK = colors.HexColor("#102231")
MUTED = colors.HexColor("#5C6D7A")
LIGHT = colors.HexColor("#F2F6F8")
LINE_C = colors.HexColor("#D9E4EA")
CYAN = colors.HexColor("#00AEEF")
BLUE = colors.HexColor("#1976D2")
TEAL = colors.HexColor("#00A889")
GREEN = colors.HexColor("#21A675")
AMBER = colors.HexColor("#F5A623")
RED = colors.HexColor("#E45B63")
WHITE = colors.white


def register_fonts():
    regular = Path("C:/Windows/Fonts/arial.ttf")
    bold = Path("C:/Windows/Fonts/arialbd.ttf")
    if regular.exists() and bold.exists():
        pdfmetrics.registerFont(TTFont("OrionSans", str(regular)))
        pdfmetrics.registerFont(TTFont("OrionSans-Bold", str(bold)))
        return "OrionSans", "OrionSans-Bold"
    return "Helvetica", "Helvetica-Bold"


FONT, FONT_BOLD = register_fonts()


def pct(value, digits=1):
    if value is None:
        return "n/d"
    return f"{value * 100:.{digits}f}%".replace(".", ",")


def num(value, digits=0):
    if value is None:
        return "n/d"
    if digits == 0:
        return f"{value:,.0f}".replace(",", ".")
    return f"{value:,.{digits}f}".replace(",", "X").replace(".", ",").replace("X", ".")


def duration(minutes):
    if minutes is None:
        return "n/d"
    if minutes < 1:
        return f"{minutes * 60:.0f}s"
    if minutes < 60:
        return f"{minutes:.1f} min".replace(".", ",")
    if minutes < 1440:
        return f"{minutes / 60:.1f} h".replace(".", ",")
    return f"{minutes / 1440:.1f} dias".replace(".", ",")


MONTHS = {
    "01": "jan", "02": "fev", "03": "mar", "04": "abr", "05": "mai", "06": "jun",
    "07": "jul", "08": "ago", "09": "set", "10": "out", "11": "nov", "12": "dez",
}


def month_label(key):
    y, m = key.split("-")
    return f"{MONTHS[m]}/{y[2:]}"


styles = getSampleStyleSheet()
TITLE = ParagraphStyle("title", fontName=FONT_BOLD, fontSize=24, leading=28, textColor=INK, spaceAfter=8)
H2 = ParagraphStyle("h2", fontName=FONT_BOLD, fontSize=15, leading=18, textColor=INK, spaceAfter=6)
H3 = ParagraphStyle("h3", fontName=FONT_BOLD, fontSize=10.5, leading=13, textColor=INK, spaceAfter=4)
BODY = ParagraphStyle("body", fontName=FONT, fontSize=8.6, leading=12.2, textColor=INK)
SMALL = ParagraphStyle("small", fontName=FONT, fontSize=7.2, leading=9.5, textColor=MUTED)
SMALL_DARK = ParagraphStyle("small_dark", fontName=FONT, fontSize=7.2, leading=9.5, textColor=INK)
EYEBROW = ParagraphStyle("eyebrow", fontName=FONT_BOLD, fontSize=7.5, leading=9, textColor=CYAN, tracking=1.2, uppercase=True)
COVER_TITLE = ParagraphStyle("cover_title", fontName=FONT_BOLD, fontSize=28, leading=32, textColor=WHITE)
COVER_SUB = ParagraphStyle("cover_sub", fontName=FONT, fontSize=11, leading=16, textColor=colors.HexColor("#BBD0DF"))
WHITE_SMALL = ParagraphStyle("white_small", fontName=FONT, fontSize=7.5, leading=10, textColor=colors.HexColor("#D7E4EC"))
CALLOUT = ParagraphStyle("callout", fontName=FONT_BOLD, fontSize=12, leading=16, textColor=INK)


class HR(Flowable):
    def __init__(self, color=LINE_C, width=0.6, space=6):
        super().__init__()
        self.color = color
        self.width_line = width
        self.height = space
        self.draw_width = 0

    def wrap(self, avail_width, avail_height):
        self.draw_width = avail_width
        return avail_width, self.height

    def draw(self):
        self.canv.setStrokeColor(self.color)
        self.canv.setLineWidth(self.width_line)
        self.canv.line(0, self.height / 2, self.draw_width, self.height / 2)


class BarChart(Flowable):
    def __init__(self, rows, width=510, height=190, value_max=1.0, formatter=pct, color=CYAN):
        super().__init__()
        self.rows = rows
        self.width = width
        self.height = height
        self.value_max = value_max or 1
        self.formatter = formatter
        self.color = color

    def draw(self):
        c = self.canv
        label_w = 165
        value_w = 48
        bar_w = self.width - label_w - value_w - 8
        row_h = self.height / max(len(self.rows), 1)
        for i, (label, value, tone) in enumerate(self.rows):
            y = self.height - (i + 1) * row_h + row_h * 0.34
            c.setFont(FONT, 7.4)
            c.setFillColor(INK)
            c.drawString(0, y + 1, str(label)[:38])
            c.setFillColor(LIGHT)
            c.roundRect(label_w, y, bar_w, 8, 4, fill=1, stroke=0)
            ratio = max(0, min((value or 0) / self.value_max, 1))
            c.setFillColor(tone or self.color)
            c.roundRect(label_w, y, max(2, bar_w * ratio), 8, 4, fill=1, stroke=0)
            c.setFillColor(INK)
            c.setFont(FONT_BOLD, 7.5)
            c.drawRightString(self.width, y + 1, self.formatter(value))


class FunnelChart(Flowable):
    def __init__(self, stages, width=510, height=215):
        super().__init__()
        self.stages = stages
        self.width = width
        self.height = height

    def draw(self):
        c = self.canv
        max_reached = max((s[1] for s in self.stages), default=1)
        gap = 7
        row_h = (self.height - gap * (len(self.stages) - 1)) / max(len(self.stages), 1)
        for i, (label, reached, rate_value) in enumerate(self.stages):
            ratio = reached / max_reached
            w = 180 + (self.width - 180) * ratio
            x = (self.width - w) / 2
            y = self.height - (i + 1) * row_h - i * gap
            tone = colors.Color(CYAN.red, CYAN.green, CYAN.blue, alpha=max(0.34, 0.95 - i * 0.08))
            c.setFillColor(tone)
            c.roundRect(x, y, w, row_h, 6, fill=1, stroke=0)
            c.setFillColor(WHITE if i < 5 else INK)
            c.setFont(FONT_BOLD, 7.6)
            c.drawString(x + 8, y + row_h / 2 - 2, label)
            c.drawRightString(x + w - 8, y + row_h / 2 - 2, f"{reached} chegaram | {pct(rate_value)} responderam")


class LineChart(Flowable):
    def __init__(self, series, labels, width=510, height=205, y_max=1.0):
        super().__init__()
        self.series = series
        self.labels = labels
        self.width = width
        self.height = height
        self.y_max = y_max

    def draw(self):
        c = self.canv
        left, bottom, right, top = 34, 26, 8, 18
        plot_w = self.width - left - right
        plot_h = self.height - bottom - top
        for tick in [0, .25, .5, .75, 1.0]:
            y = bottom + plot_h * tick
            c.setStrokeColor(LINE_C)
            c.setLineWidth(.5)
            c.line(left, y, self.width - right, y)
            c.setFillColor(MUTED)
            c.setFont(FONT, 6.5)
            c.drawRightString(left - 5, y - 2, pct(tick, 0))
        n = max(len(self.labels), 2)
        xs = [left + plot_w * i / (n - 1) for i in range(len(self.labels))]
        for x, label in zip(xs, self.labels):
            c.setFillColor(MUTED)
            c.setFont(FONT, 6.8)
            c.drawCentredString(x, 7, label)
        for name, values, tone in self.series:
            points = []
            for x, value in zip(xs, values):
                y = bottom + plot_h * max(0, min((value or 0) / self.y_max, 1))
                points.extend([x, y])
            c.setStrokeColor(tone)
            c.setLineWidth(2)
            if len(points) >= 4:
                path = c.beginPath()
                path.moveTo(points[0], points[1])
                for x, y in zip(points[2::2], points[3::2]):
                    path.lineTo(x, y)
                c.drawPath(path, stroke=1, fill=0)
            for x, y in zip(points[::2], points[1::2]):
                c.setFillColor(WHITE)
                c.circle(x, y, 3.2, fill=1, stroke=0)
                c.setFillColor(tone)
                c.circle(x, y, 2.1, fill=1, stroke=0)
        legend_x = left
        for name, _, tone in self.series:
            c.setFillColor(tone)
            c.circle(legend_x + 3, self.height - 5, 2.5, fill=1, stroke=0)
            c.setFillColor(INK)
            c.setFont(FONT, 6.8)
            c.drawString(legend_x + 9, self.height - 7.5, name)
            legend_x += c.stringWidth(name, FONT, 6.8) + 30


def P(text, style=BODY):
    return Paragraph(text, style)


def kpi_cards(items, columns=4, dark=False):
    cell_style = ParagraphStyle(
        "kpi_dark" if dark else "kpi",
        fontName=FONT_BOLD, fontSize=18, leading=20,
        textColor=WHITE if dark else INK, alignment=TA_LEFT,
    )
    label_style = ParagraphStyle(
        "kpi_label_dark" if dark else "kpi_label",
        fontName=FONT, fontSize=7, leading=9,
        textColor=colors.HexColor("#BBD0DF") if dark else MUTED,
    )
    cells = []
    for value, label, accent in items:
        cells.append(Table([
            [P(value, cell_style)],
            [P(label, label_style)],
        ], colWidths=[(PAGE_W - 28 * mm) / columns - 8], style=[
            ("BACKGROUND", (0, 0), (-1, -1), colors.Color(accent.red, accent.green, accent.blue, alpha=.12) if not dark else NAVY_2),
            ("BOX", (0, 0), (-1, -1), .6, accent),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            ("TOPPADDING", (0, 0), (-1, 0), 7),
            ("BOTTOMPADDING", (0, 1), (-1, 1), 7),
        ]))
    rows = [cells[i:i + columns] for i in range(0, len(cells), columns)]
    while rows and len(rows[-1]) < columns:
        rows[-1].append(Spacer(1, 1))
    table = Table(rows, colWidths=[(PAGE_W - 28 * mm) / columns] * columns, hAlign="LEFT")
    table.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 6), ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 6)]))
    return table


def section_header(number, eyebrow, title, subtitle=None):
    result = [P(f"{number}  {eyebrow.upper()}", EYEBROW), P(title, TITLE)]
    if subtitle:
        result += [P(subtitle, BODY), Spacer(1, 5)]
    result.append(HR())
    return result


def data_table(rows, widths, header=True, font_size=7.2, row_backgrounds=True):
    converted = []
    for r_i, row in enumerate(rows):
        converted.append([P(str(cell), ParagraphStyle(
            f"table_{r_i}", fontName=FONT_BOLD if header and r_i == 0 else FONT,
            fontSize=font_size, leading=font_size + 2,
            textColor=WHITE if header and r_i == 0 else INK,
            alignment=TA_LEFT,
        )) for cell in row])
    table = Table(converted, colWidths=widths, repeatRows=1 if header else 0, hAlign="LEFT")
    commands = [
        ("BACKGROUND", (0, 0), (-1, 0), NAVY_2 if header else WHITE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("GRID", (0, 0), (-1, -1), .35, LINE_C),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]
    if row_backgrounds:
        for i in range(1 if header else 0, len(rows)):
            if i % 2 == 0:
                commands.append(("BACKGROUND", (0, i), (-1, i), LIGHT))
    table.setStyle(TableStyle(commands))
    return table


def callout(title, text, tone=CYAN):
    box = Table([[P(title, H3), P(text, BODY)]], colWidths=[42 * mm, 126 * mm])
    box.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.Color(tone.red, tone.green, tone.blue, alpha=.08)),
        ("LINEBEFORE", (0, 0), (0, -1), 3, tone),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    return box


def page_header_footer(canvas, doc):
    page = canvas.getPageNumber()
    if page == 1:
        return
    canvas.saveState()
    canvas.setStrokeColor(LINE_C)
    canvas.setLineWidth(.5)
    canvas.line(14 * mm, PAGE_H - 12 * mm, PAGE_W - 14 * mm, PAGE_H - 12 * mm)
    canvas.setFillColor(MUTED)
    canvas.setFont(FONT_BOLD, 6.8)
    canvas.drawString(14 * mm, PAGE_H - 9 * mm, "ORION TRACK  •  OCTAVITA CORRETORA")
    canvas.setFont(FONT, 6.8)
    canvas.drawRightString(PAGE_W - 14 * mm, PAGE_H - 9 * mm, "RELATÓRIO DE EFETIVIDADE DO ATENDIMENTO")
    canvas.setStrokeColor(LINE_C)
    canvas.line(14 * mm, 12 * mm, PAGE_W - 14 * mm, 12 * mm)
    canvas.setFillColor(MUTED)
    canvas.setFont(FONT, 6.5)
    canvas.drawString(14 * mm, 8 * mm, "Dados do Orion Track • Uso interno • Gerado em 16/09/2026")
    canvas.drawRightString(PAGE_W - 14 * mm, 8 * mm, f"{page:02d}")
    canvas.restoreState()


def first_page(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(NAVY)
    canvas.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    canvas.setFillColor(colors.HexColor("#0A3652"))
    canvas.circle(PAGE_W + 10 * mm, PAGE_H - 20 * mm, 72 * mm, fill=1, stroke=0)
    canvas.setFillColor(colors.HexColor("#075D7D"))
    canvas.circle(PAGE_W + 18 * mm, PAGE_H - 12 * mm, 48 * mm, fill=1, stroke=0)
    canvas.setFillColor(CYAN)
    canvas.rect(0, 0, 8 * mm, PAGE_H, fill=1, stroke=0)
    canvas.restoreState()


def build_story(data):
    h = data["headline"]
    s = data["scope"]
    monthly = data["monthly"]
    sellers = {x["seller"]: x for x in data["sellers"]}
    qf = data["questionFunnel"]
    stages = data["stageFunnel"]
    story = []

    # 1. Cover
    story += [Spacer(1, 24 * mm)]
    if LOGO.exists():
        img = Image(str(LOGO), width=94 * mm, height=49 * mm, kind="proportional")
        img.hAlign = "LEFT"
        story += [img, Spacer(1, 13 * mm)]
    story += [
        P("INTELIGÊNCIA COMERCIAL • DIAGNÓSTICO 360°", ParagraphStyle("cover_eye", parent=EYEBROW, textColor=CYAN)),
        Spacer(1, 3 * mm),
        P("Efetividade do atendimento<br/>Aline, Sandro e Henrique", COVER_TITLE),
        Spacer(1, 5 * mm),
        P("OCTAVITA CORRETORA  |  Operação Danilo Iacovone", COVER_SUB),
        Spacer(1, 17 * mm),
        kpi_cards([
            (num(s["operationalConversations"]), "conversas operacionais", CYAN),
            (num(s["totalMessages"]), "mensagens analisadas", TEAL),
            (pct(h["firstResponseRate"]), "resposta após 1ª abordagem da Aline", GREEN),
            (pct(h["handoffResponseWithin24h"]), "resposta ao corretor em até 24h", AMBER),
        ], columns=4, dark=True),
        Spacer(1, 13 * mm),
        P("Período observado", ParagraphStyle("cover_label", parent=WHITE_SMALL, fontName=FONT_BOLD, textColor=CYAN)),
        P("15 de junho a 16 de setembro de 2026", COVER_SUB),
        Spacer(1, 6 * mm),
        P("Leitura executiva, funil por pergunta, abandono por etapa, passagem IA → corretor, desempenho mensal, análise individual dos vendedores e plano de melhoria.", WHITE_SMALL),
        Spacer(1, 21 * mm),
        P("Relatório interno • Dados reais do Orion Track • Nomes de leads abreviados", WHITE_SMALL),
        PageBreak(),
    ]

    # 2. Executive summary
    story += section_header("01", "Resumo executivo", "A IA funciona no início; o maior ganho está na transição para o humano", "A análise separa três eventos diferentes: resposta à primeira abordagem, avanço no roteiro da Aline e resposta depois que o corretor assume.")
    story += [Spacer(1, 3 * mm), kpi_cards([
        (pct(h["firstResponseRate"]), "responderam em algum momento após a 1ª mensagem da Aline", GREEN),
        (duration(h["medianFirstResponseMinutes"]), "mediana até a primeira resposta do lead", CYAN),
        (pct(h["handoffRate"]), "receberam contato humano após a Aline", BLUE),
        (pct(h["handoffResponseWithin24h"]), "responderam ao corretor em até 24 horas", AMBER),
        (pct(h["handoffResponseRate"]), "responderam ao corretor em algum momento", TEAL),
        (pct(h["reachedThreeAiTurnsRate"]), "chegaram ao 3º turno da Aline", CYAN),
        (pct(h["duplicateAiMessageRate"]), "mensagens duplicadas da Aline", GREEN),
        (num(h["noFirstResponse"]), "leads sem qualquer resposta após a abertura", RED),
    ], columns=4), Spacer(1, 4 * mm)]
    gap = h["firstResponseRate"] - h["handoffResponseWithin24h"]
    story += [
        callout("VEREDITO", f"A Aline é funcional como mecanismo de ativação: {pct(h['firstResponseRate'])} respondem à abertura e a mediana é {duration(h['medianFirstResponseMinutes'])}. O principal vazamento vem depois. A resposta ao corretor em até 24h cai para {pct(h['handoffResponseWithin24h'])}, uma perda de {pct(gap)} do universo inicial.", CYAN),
        Spacer(1, 4 * mm),
        data_table([
            ["Pergunta de negócio", "Resposta objetiva", "Evidência"],
            ["A IA faz o lead falar?", "Sim, com alta frequência", f"{h['firstResponses']} de {h['aiInitiated']} leads responderam após a abertura."],
            ["O lead percorre o roteiro?", "Parcialmente", f"{pct(h['reachedThreeAiTurnsRate'])} chegam ao 3º turno; a queda cresce nas etapas 7 a 10."],
            ["A passagem ao vendedor retém o lead?", "É o maior gargalo", f"{pct(h['handoffResponseWithin24h'])} respondem ao corretor em 24h; {pct(h['handoffResponseRate'])} em algum momento."],
            ["Há problema de duplicidade?", "Residual", f"{h['duplicateAiMessages']} duplicações em {h['aiMessages']} mensagens da Aline ({pct(h['duplicateAiMessageRate'])})."],
        ], [42 * mm, 43 * mm, 83 * mm], font_size=7.4),
        Spacer(1, 3 * mm),
        P("Leitura recomendada: manter a Aline como filtro e coleta inicial, mas redesenhar o fechamento e o SLA do corretor. O indicador de sucesso não deve ser só “respondeu a IA”; deve acompanhar resposta ao corretor em 24h e avanço real no CRM.", CALLOUT),
        PageBreak(),
    ]

    # 3. Funnel
    story += section_header("02", "Funil principal", "Do primeiro contato até a resposta ao corretor", "O funil usa coorte de 387 conversas iniciadas pela Aline. As barras mostram volume e taxa em relação à etapa imediatamente relevante.")
    funnel = [
        ("1. Aline iniciou o atendimento", h["aiInitiated"], 1.0),
        ("2. Lead respondeu em algum momento", h["firstResponses"], h["firstResponseRate"]),
        ("3. Chegou ao 3º turno da Aline", h["reachedThreeAiTurns"], h["reachedThreeAiTurnsRate"]),
        ("4. Corretor entrou após a Aline", h["handoffs"], h["handoffRate"]),
        ("5. Lead respondeu ao corretor", h["handoffResponses"], h["handoffResponseRate"]),
        ("6. Respondeu ao corretor em 24h", round(h["handoffs"] * h["handoffResponseWithin24h"]), h["handoffResponseWithin24h"]),
    ]
    story += [Spacer(1, 4 * mm), FunnelChart(funnel, height=205), Spacer(1, 5 * mm)]
    immediate_stage = stages[0]
    story += [
        callout("POR QUE 93,0% E 84,5% SÃO DIFERENTES?", f"{pct(h['firstResponseRate'])} mede qualquer resposta posterior à abertura. Já {pct(immediate_stage['responseRate'])} mede se o próximo turno, imediatamente após o primeiro bloco da Aline, foi do lead. A diferença captura retomadas posteriores e intervenções no meio do caminho.", BLUE),
        Spacer(1, 4 * mm),
        P("O número crítico não é o handoff técnico, que ocorre em quase toda a coorte. É o handoff comportamental: fazer o lead manter a conversa quando muda o atendente. O volume cai de 360 leads que falaram após a Aline para 215 que responderam ao humano em até 24 horas.", BODY),
        PageBreak(),
    ]

    # 4. Monthly
    story += section_header("03", "Evolução mensal", "Abertura forte, queda em agosto e recuperação parcial em setembro", "Setembro é parcial, com dados até o dia 16. Junho tem base muito pequena e deve ser lido apenas como início da operação.")
    labels = [month_label(x["month"]) for x in monthly]
    story += [LineChart([
        ("Resposta à Aline", [x["firstResponseRate"] for x in monthly], GREEN),
        ("Resposta ao corretor", [x["sellerResponseRate"] for x in monthly], BLUE),
        ("Resposta ao corretor em 24h", [x["sellerResponseWithin24h"] for x in monthly], AMBER),
    ], labels, height=210), Spacer(1, 4 * mm)]
    rows = [["Mês", "Aline iniciou", "Resp. Aline", "Mediana", "Handoffs", "Resp. corretor", "Em 24h", "Turnos IA"]]
    for m in monthly:
        rows.append([month_label(m["month"]), num(m["aiStarts"]), pct(m["firstResponseRate"]), duration(m["medianFirstResponseMinutes"]), num(m["handoffs"]), pct(m["sellerResponseRate"]), pct(m["sellerResponseWithin24h"]), num(m["avgAiTurns"], 1)])
    story += [data_table(rows, [20*mm, 20*mm, 22*mm, 22*mm, 19*mm, 25*mm, 21*mm, 19*mm], font_size=6.8), Spacer(1, 4 * mm)]
    if len(monthly) >= 4:
        jul, aug, sep = monthly[1], monthly[2], monthly[3]
        story += [callout("MUDANÇA MAIS RELEVANTE", f"De julho para agosto, a resposta à Aline caiu {pct(jul['firstResponseRate'] - aug['firstResponseRate'])} e a resposta ao corretor caiu {pct(jul['sellerResponseRate'] - aug['sellerResponseRate'])}. Em setembro parcial, os dois indicadores recuperaram para {pct(sep['firstResponseRate'])} e {pct(sep['sellerResponseRate'])}, respectivamente.", AMBER)]
    story += [PageBreak()]

    # 5. Question categories
    story += section_header("04", "Pergunta por pergunta", "Quais perguntas mantêm o lead e quais derrubam a conversa", "Cada linha representa turnos da Aline classificados por assunto. Uma resposta existe quando o próximo turno é do lead.")
    chart_rows = []
    for q in qf[:10]:
        tone = GREEN if q["responseRate"] >= .9 else AMBER if q["responseRate"] >= .75 else RED
        chart_rows.append((f"{q['label']}  (n={q['reached']})", q["responseRate"], tone))
    story += [BarChart(chart_rows, height=235), Spacer(1, 3 * mm)]
    q_rows = [["Tema", "Envios", "Respostas", "Taxa", "Abandonos", "Mediana"]]
    for q in qf[:10]:
        q_rows.append([q["label"], num(q["reached"]), num(q["responded"]), pct(q["responseRate"]), num(q["dropoffs"]), duration(q["medianResponseMinutes"])])
    story += [data_table(q_rows, [57*mm, 20*mm, 22*mm, 20*mm, 22*mm, 27*mm], font_size=6.8), Spacer(1, 3 * mm)]
    worst = min((q for q in qf if q["reached"] >= 20), key=lambda q: q["responseRate"])
    story += [callout("PONTO DE ATRITO", f"Entre os temas com pelo menos 20 ocorrências, “{worst['label']}” tem a menor taxa: {pct(worst['responseRate'])}. O agendamento também concentra volume de perda: {next(q for q in qf if q['key']=='agendamento')['dropoffs']} turnos sem resposta.", RED), PageBreak()]

    # 6. Exact templates
    story += section_header("05", "Mensagens reais", "Desempenho dos principais modelos de pergunta", "Textos foram agrupados por conteúdo normalizado. Números e dados pessoais foram removidos; o conteúdo é exibido apenas para diagnóstico do roteiro.")
    template_rows = [["Pergunta / mensagem da Aline", "Tema", "Envios", "Resp."]]
    for item in data["topQuestionTemplates"][:14]:
        template_rows.append([item["text"], item["category"], num(item["sent"]), pct(item["responseRate"])])
    story += [data_table(template_rows, [93*mm, 39*mm, 16*mm, 20*mm], font_size=6.3), Spacer(1, 4 * mm)]
    story += [callout("LEITURA DO ROTEIRO", "As confirmações objetivas de CNPJ/MEI e a pergunta de hospital têm taxas muito altas. A queda surge quando a conversa pede compromisso de agenda ou quando a mensagem anuncia a troca de atendente. O roteiro deve encerrar com uma ação simples e imediata, sem exigir uma decisão grande do lead.", TEAL), PageBreak()]

    # 7. Stage abandonment
    story += section_header("06", "Abandono por etapa", "Onde o lead para de responder ao longo do roteiro", "Aqui a unidade é a posição do turno da Aline. O volume “chegaram” diminui porque nem todas as conversas precisam percorrer o mesmo número de perguntas.")
    stage_rows = [(f"Turno {x['stage']}  (n={x['reached']})", x["responseRate"], GREEN if x["responseRate"] >= .9 else AMBER if x["responseRate"] >= .75 else RED) for x in stages[:11]]
    story += [BarChart(stage_rows, height=285), Spacer(1, 4 * mm)]
    story += [
        callout("PADRÃO OBSERVADO", f"A retenção é máxima entre os turnos 2 e 6, variando de {pct(min(x['responseRate'] for x in stages[1:6]))} a {pct(max(x['responseRate'] for x in stages[1:6]))}. A partir do turno 7 ela cai para {pct(stages[6]['responseRate'])} e chega a {pct(stages[9]['responseRate'])} no turno 10. Conversas longas aumentam fadiga e risco de abandono.", AMBER),
        Spacer(1, 4 * mm),
        P("Ação recomendada: limitar o roteiro padrão a 5 ou 6 turnos, aproveitar os dados do formulário e encaminhar cedo quando já houver idade, CNPJ/CPF, cidade, hospital/rede e intenção. Perguntas adicionais podem ser tratadas pelo corretor em contexto.", CALLOUT),
        PageBreak(),
    ]

    # 8. Handoff
    story += section_header("07", "Passagem Aline → corretor", "O gargalo não é encaminhar; é preservar o impulso da conversa", "Handoff técnico significa que algum humano enviou mensagem após a Aline. Resposta em 24 horas mede retenção comercial imediata.")
    handoff_rows = [
        ("Lead respondeu após abertura da Aline", h["firstResponseRate"], GREEN),
        ("Corretor enviou mensagem após Aline", h["handoffRate"], BLUE),
        ("Lead respondeu ao corretor em algum momento", h["handoffResponseRate"], TEAL),
        ("Lead respondeu ao corretor em até 24h", h["handoffResponseWithin24h"], AMBER),
    ]
    story += [BarChart(handoff_rows, height=150), Spacer(1, 5 * mm), kpi_cards([
        (num(h["handoffs"]), "conversas com contato humano após a Aline", BLUE),
        (num(h["handoffResponses"]), "leads que responderam ao humano", TEAL),
        (duration(h["medianHandoffResponseMinutes"]), "mediana entre contato humano e resposta", AMBER),
        (num(round(h["handoffs"] * (1 - h["handoffResponseWithin24h"]))), "handoffs sem resposta em até 24h", RED),
    ], columns=4), Spacer(1, 5 * mm)]
    story += [
        P("Hipóteses operacionais mais prováveis", H2),
        data_table([
            ["Hipótese", "Sinal nos dados", "Teste sugerido"],
            ["Mudança de número quebra contexto", "Queda imediata entre IA e corretor", "Mensagem de ponte com nome do corretor e contato em até 5 minutos."],
            ["Lead recebe uma nova abordagem genérica", "Alta abertura, resposta menor após handoff", "Primeira mensagem humana citar 2 dados já coletados pela Aline."],
            ["Atraso esfria o interesse", f"Só {pct(h['handoffResponseWithin24h'])} respondem em 24h", "SLA de 5, 15 e 60 minutos com alerta no painel."],
            ["Roteiro longo antes da passagem", "Retenção cai depois do 7º turno", "Handoff antecipado ao atingir conjunto mínimo de dados."],
        ], [48*mm, 53*mm, 67*mm], font_size=7),
        PageBreak(),
    ]

    # 9. Sellers
    sandro = sellers["Sandro"]
    henrique = sellers["Henrique"]
    story += section_header("08", "Sandro e Henrique", "Comparativo individual de atendimento humano", "As taxas abaixo medem conversas registradas e não controlam diferenças de origem, qualidade dos leads ou distribuição de carteira.")
    seller_table = [
        ["Indicador", "Sandro", "Henrique", "Diferença"],
        ["Conversas tocadas", num(sandro["conversationsTouched"]), num(henrique["conversationsTouched"]), num(henrique["conversationsTouched"] - sandro["conversationsTouched"])],
        ["Resposta ao 1º contato humano", pct(sandro["firstContactResponseRate"]), pct(henrique["firstContactResponseRate"]), pct(henrique["firstContactResponseRate"] - sandro["firstContactResponseRate"])],
        ["Resposta após Aline", pct(sandro["afterAiResponseRate"]), pct(henrique["afterAiResponseRate"]), pct(henrique["afterAiResponseRate"] - sandro["afterAiResponseRate"])],
        ["Resposta pós-Aline em 24h", pct(sandro["afterAiResponseWithin24h"]), pct(henrique["afterAiResponseWithin24h"]), pct(henrique["afterAiResponseWithin24h"] - sandro["afterAiResponseWithin24h"])],
        ["Mediana para resposta do lead", duration(sandro["medianResponseMinutes"]), duration(henrique["medianResponseMinutes"]), "próximas"],
        ["Leads atribuídos", num(sandro["assignedLeads"]), num(henrique["assignedLeads"]), num(henrique["assignedLeads"] - sandro["assignedLeads"])],
        ["Conversão registrada no CRM", pct(sandro["assignedSaleRate"]), pct(henrique["assignedSaleRate"]), pct(henrique["assignedSaleRate"] - sandro["assignedSaleRate"])],
    ]
    story += [data_table(seller_table, [72*mm, 30*mm, 30*mm, 36*mm], font_size=7.4), Spacer(1, 5 * mm)]
    story += [BarChart([
        ("Sandro • resposta pós-Aline", sandro["afterAiResponseRate"], BLUE),
        ("Henrique • resposta pós-Aline", henrique["afterAiResponseRate"], TEAL),
        ("Sandro • resposta em 24h", sandro["afterAiResponseWithin24h"], AMBER),
        ("Henrique • resposta em 24h", henrique["afterAiResponseWithin24h"], GREEN),
    ], height=145), Spacer(1, 4 * mm)]
    story += [
        callout("DESTAQUE", f"Henrique apresenta {pct(henrique['afterAiResponseRate'] - sandro['afterAiResponseRate'])} a mais de resposta após a Aline e {pct(henrique['afterAiResponseWithin24h'] - sandro['afterAiResponseWithin24h'])} a mais em 24h. Isso é um sinal para auditoria de abordagem e SLA, não prova causal de desempenho individual.", TEAL),
        Spacer(1, 3 * mm),
        P("Melhor uso do dado: comparar amostras de mensagens iniciais dos dois vendedores, padronizar uma mensagem de ponte e repetir a medição por 30 dias com distribuição equilibrada de leads.", BODY),
        PageBreak(),
    ]

    # 10. Pipeline
    story += section_header("09", "Resultado comercial", "O CRM mostra grande concentração em “Sem interesse”", "A IA mede engajamento; o CRM mede avanço comercial. Os dois precisam ser lidos juntos para avaliar valor real.")
    lead_status = data["leadStatus"]
    total_leads = s["totalLeads"]
    status_rows = [(f"{x['status']}  (n={x['count']})", x["count"] / total_leads, RED if x["status"] == "Sem interesse" else TEAL) for x in lead_status[:10]]
    story += [BarChart(status_rows, height=235), Spacer(1, 3 * mm)]
    sale_count = sum(x["count"] for x in lead_status if x["status"].lower() in ["documentação", "1º pagamento", "venda realizada"])
    story += [kpi_cards([
        (num(total_leads), "leads na base", CYAN),
        (num(next((x['count'] for x in lead_status if x['status'] == 'Sem interesse'), 0)), "marcados como sem interesse", RED),
        (num(sale_count), "em etapas equivalentes a venda", GREEN),
        (pct(sale_count / total_leads if total_leads else 0), "conversão registrada na base", GREEN),
    ], columns=4), Spacer(1, 4 * mm)]
    story += [
        callout("LIMITAÇÃO IMPORTANTE", "A taxa comercial depende da disciplina de atualização do CRM. Conversas podem ter resultado sem mudança de etapa, e a coorte mensal de venda pode maturar semanas depois. Por isso, a conversão deve ser reprocessada por coorte em 30, 60 e 90 dias.", AMBER),
        Spacer(1, 4 * mm),
        P("Leitura gerencial: a IA é eficiente para provocar a primeira resposta, mas isso ainda não se transforma proporcionalmente em estágio comercial. O relatório recomenda ligar cada handoff a um SLA e a um desfecho obrigatório: respondeu, sem resposta, cotação, negociação, perda com motivo ou venda.", CALLOUT),
        PageBreak(),
    ]

    # 11. Strengths and weaknesses
    story += section_header("10", "Diagnóstico", "Pontos fortes, pontos fracos e o que já melhorou", "As conclusões abaixo são diretamente ancoradas nos indicadores do período.")
    strong_rows = [
        ["Ponto forte", "Evidência", "Valor para a operação"],
        ["Alta ativação", f"{pct(h['firstResponseRate'])} respondem após a abertura", "A IA reduz o silêncio inicial e cria conversa."],
        ["Velocidade", f"Mediana de {duration(h['medianFirstResponseMinutes'])}", "A intenção está quente nos primeiros minutos."],
        ["Perguntas objetivas funcionam", "CNPJ/CPF e hospital superam 95%", "Dados estruturados podem ser coletados antes do vendedor."],
        ["Baixa duplicidade", f"{pct(h['duplicateAiMessageRate'])} das mensagens", "O problema visual observado é raro na série completa."],
        ["Recuperação em setembro", f"Resposta à Aline em {pct(monthly[-1]['firstResponseRate'])}", "Reverte parte da queda registrada em agosto."],
    ]
    weak_rows = [
        ["Ponto fraco", "Evidência", "Impacto"],
        ["Handoff perde impulso", f"Só {pct(h['handoffResponseWithin24h'])} respondem em 24h", "Leads aquecidos esfriam antes do humano."],
        ["Agendamento derruba resposta", f"{next(q for q in qf if q['key']=='agendamento')['dropoffs']} abandonos em turnos classificados", "A pergunta exige compromisso cedo demais."],
        ["Fadiga após o 7º turno", f"Retenção cai para {pct(stages[6]['responseRate'])}", "Roteiro longo aumenta abandono."],
        ["Status comercial concentrado", f"{pct(next(x['count'] for x in lead_status if x['status']=='Sem interesse') / total_leads)} em “Sem interesse”", "Pouca transformação do engajamento em avanço de pipeline."],
        ["Sessões com erro", f"{next((x['count'] for x in data['sessionStatus'] if x['status']=='error'), 0)} sessões", "Requer auditoria técnica e regra de contingência."],
    ]
    story += [P("Pontos fortes", H2), data_table(strong_rows, [48*mm, 55*mm, 65*mm], font_size=7.1), Spacer(1, 5 * mm), P("Pontos fracos", H2), data_table(weak_rows, [48*mm, 55*mm, 65*mm], font_size=7.1), Spacer(1, 4 * mm)]
    story += [callout("SÍNTESE", "A Aline já resolve bem o topo do funil. O próximo salto não depende de fazer mais perguntas; depende de reduzir o roteiro, acelerar a passagem e tornar a primeira mensagem humana contextual e contínua.", CYAN), PageBreak()]

    # 12. Roadmap
    story += section_header("11", "Plano de melhoria", "O que mudar primeiro e como provar o resultado", "Roadmap proposto para 30 dias. Cada ação tem hipótese, indicador e critério de sucesso.")
    roadmap = [
        ["Prioridade", "Ação", "Indicador", "Meta inicial"],
        ["P0 • Hoje", "SLA automático: corretor em até 5 min após handoff", "Tempo até 1º contato humano", "mediana < 5 min"],
        ["P0 • Hoje", "Mensagem ponte: “Sou Sandro/Henrique, a Aline me passou X e Y”", "Resposta ao corretor em 24h", "+10 p.p."],
        ["P1 • 7 dias", "Encerrar roteiro padrão até o 6º turno", "Chegada ao handoff + resposta", "+8 p.p."],
        ["P1 • 7 dias", "Trocar pedido de agenda por escolha binária", "Resposta no tema agendamento", "> 82%"],
        ["P1 • 14 dias", "Cadência de retomada em 15 min, 2h e D+1", "Recuperação pós-handoff", "+12 p.p."],
        ["P2 • 14 dias", "Alertar sessões em erro e cair para fluxo seguro", "Sessões com erro", "< 1%"],
        ["P2 • 30 dias", "Obrigar desfecho e motivo de perda no CRM", "Cobertura de status", "> 95%"],
        ["P2 • 30 dias", "Teste A/B da primeira mensagem humana", "Resposta em 24h por variante", "vencedor ≥ +8 p.p."],
    ]
    story += [data_table(roadmap, [25*mm, 77*mm, 42*mm, 24*mm], font_size=7.2), Spacer(1, 5 * mm)]
    story += [P("Mensagem de ponte sugerida", H2), callout("MODELO", "Olá, [nome]. Sou <b>Sandro/Henrique</b>, especialista da Octavita. A <b>Aline</b> me passou que você busca [objetivo] para [número de vidas] e prefere [hospital/rede]. Já consigo seguir daqui. Você quer que eu te envie duas opções por aqui ainda hoje?", TEAL), Spacer(1, 4 * mm)]
    story += [P("Painel mínimo de acompanhamento semanal", H2), data_table([
        ["Indicador", "Por quê", "Segmentar por"],
        ["Resposta à 1ª mensagem da Aline", "Saúde do topo do funil", "mês, campanha, vendedor"],
        ["Resposta por pergunta", "Localiza atrito do roteiro", "tema, variante, posição"],
        ["Tempo até contato humano", "Mede SLA real", "vendedor, dia, hora"],
        ["Resposta ao corretor em 24h", "Mede continuidade", "vendedor, tempo de handoff"],
        ["Avanço para cotação/negociação", "Conecta conversa a receita", "coorte 30/60/90 dias"],
    ], [51*mm, 62*mm, 55*mm], font_size=7), PageBreak()]

    # 13. Lead examples
    story += section_header("12", "Leads e padrões", "Exemplos de jornadas fortes e frágeis", "Nomes foram abreviados. A seleção serve para auditoria qualitativa e não substitui amostragem aleatória de conversas.")
    strong = data["strongLeadExamples"][:8]
    weak = data["weakLeadExamples"][:8]
    strong_rows = [["Lead", "Mês", "Resp.", "Turnos", "Handoff", "Status"]]
    for x in strong:
        strong_rows.append([x["lead"], month_label(x["month"]), duration(x["firstResponseMinutes"]), num(x["aiTurns"]), x["handoffSeller"] or "n/d", x["status"]])
    weak_rows = [["Lead", "Mês", "Turnos", "Ponto de parada", "Corretor", "Status"]]
    for x in weak:
        weak_rows.append([x["lead"], month_label(x["month"]), num(x["aiTurns"]), x["dropout"] or "sem resposta ao vendedor", x["handoffSeller"] or "n/d", x["status"]])
    story += [P("Jornadas com maior engajamento", H2), data_table(strong_rows, [34*mm, 18*mm, 25*mm, 18*mm, 25*mm, 48*mm], font_size=6.8), Spacer(1, 5 * mm), P("Jornadas frágeis para auditoria", H2), data_table(weak_rows, [31*mm, 18*mm, 17*mm, 51*mm, 22*mm, 29*mm], font_size=6.7), Spacer(1, 4 * mm)]
    story += [callout("COMO USAR ESTA LISTA", "Abra uma amostra equilibrada de jornadas fortes e frágeis, compare tempo de handoff, contexto da primeira mensagem humana e número de perguntas. Registre padrões em uma rubrica única para Sandro e Henrique.", BLUE), PageBreak()]

    # 14. Methodology
    story += section_header("13", "Metodologia", "Definições, escopo e limites da leitura", "O objetivo é tornar o relatório auditável e evitar interpretações infladas.")
    method_rows = [["Métrica", "Definição operacional"]]
    for key, value in data["methodology"].items():
        labels_method = {
            "firstAiResponse": "Resposta à primeira abordagem",
            "questionResponse": "Resposta por pergunta",
            "handoff": "Handoff",
            "sellerResponse": "Resposta ao corretor",
            "monthCohort": "Coorte mensal",
            "privacy": "Privacidade",
        }
        method_rows.append([labels_method.get(key, key), value])
    story += [data_table(method_rows, [48*mm, 120*mm], font_size=7.3), Spacer(1, 5 * mm)]
    story += [P("Base analisada", H2), kpi_cards([
        (num(s["totalConversations"]), "conversas totais encontradas", CYAN),
        (num(s["operationalConversations"]), "conversas operacionais", TEAL),
        (num(s["totalMessages"]), "mensagens", BLUE),
        (num(s["aiSessions"]), "sessões de IA", AMBER),
    ], columns=4), Spacer(1, 4 * mm)]
    story += [
        P("Limitações", H2),
        data_table([
            ["Limite", "Implicação"],
            ["Estudo observacional", "Diferenças entre vendedores podem refletir carteira, campanha, horário ou mix de leads."],
            ["Resposta não é venda", "Um lead pode responder e não avançar; o CRM deve fechar o ciclo de receita."],
            ["Setembro parcial", "Comparações com meses completos precisam ser reavaliadas no fechamento do mês."],
            ["Status do CRM", "A conversão depende da atualização correta das etapas e motivos de perda."],
            ["Áudios e anexos", "Foram contados como mensagens, mas o conteúdo não foi transcrito para análise semântica."],
        ], [48*mm, 120*mm], font_size=7.2),
        Spacer(1, 4 * mm),
        callout("CONCLUSÃO FINAL", "A Aline demonstra forte utilidade para iniciar e estruturar conversas. O maior potencial de ganho está em transformar essa atenção em continuidade humana: contato rápido, contextual, com menos fricção e medição disciplinada até o desfecho comercial.", CYAN),
        Spacer(1, 7 * mm),
        P("ORION TRACK  •  OCTAVITA CORRETORA", ParagraphStyle("end", parent=EYEBROW, alignment=TA_CENTER)),
    ]
    return story


def main():
    if not DATA_PATH.exists():
        raise FileNotFoundError(f"Dados não encontrados: {DATA_PATH}")
    data = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)

    doc = BaseDocTemplate(
        str(OUTPUT), pagesize=A4,
        leftMargin=14 * mm, rightMargin=14 * mm,
        topMargin=17 * mm, bottomMargin=16 * mm,
        title="Relatório de Atendimento Octavita | Aline, Sandro e Henrique",
        author="Orion Track",
        subject="Análise de efetividade da IA e atendimento comercial",
    )
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="main", leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    template = PageTemplate(id="all", frames=[frame], onPage=lambda c, d: (first_page(c, d) if c.getPageNumber() == 1 else page_header_footer(c, d)))
    doc.addPageTemplates([template])
    doc.build(build_story(data))
    print(json.dumps({"output": str(OUTPUT), "bytes": OUTPUT.stat().st_size}, ensure_ascii=False))


if __name__ == "__main__":
    main()
