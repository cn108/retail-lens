"""CSV and PDF rendering for saved reports.

Both renderers consume the same report payload that the API returns, so an
export cannot use a different formula or filter from the page it was generated
from. Untrusted source labels are escaped for CSV (formula injection) and PDF
(XML markup), and the PDF uses the standard built-in fonts.
"""

import csv
import io
import re
from decimal import Decimal, InvalidOperation
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import LongTable, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

MARGIN = 18 * mm
CONTENT_WIDTH = A4[0] - 2 * MARGIN
FORMULA_PREFIXES = ("=", "+", "-", "@")
NUMBER = re.compile(r"^[+-]?\d+(\.\d+)?$")


def _as_decimal(value) -> Decimal | None:  # type: ignore[no-untyped-def]
    if value is None or value == "":
        return None
    try:
        amount = Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None
    return amount if amount.is_finite() else None


def _csv_cell(value) -> str:  # type: ignore[no-untyped-def]
    if value is None:
        return ""
    text = str(value)
    if text.startswith(FORMULA_PREFIXES) and not NUMBER.match(text):
        return f"'{text}"
    return text


def _display(value, fmt: str, currency: str) -> str:  # type: ignore[no-untyped-def]
    if value is None or value == "":
        return "-"
    amount = _as_decimal(value)
    if fmt == "money":
        if amount is None:
            return str(value)
        return f"{currency} {amount:,.2f}"
    if fmt == "percent":
        if amount is None:
            return str(value)
        return f"{amount:,.2f}%"
    if fmt == "number":
        if amount is None:
            return str(value)
        return f"{amount:,.0f}"
    return str(value)


def _plain(value) -> str:  # type: ignore[no-untyped-def]
    text = "" if value is None else str(value)
    return text.encode("cp1252", "replace").decode("cp1252")


def _pdf_text(value) -> str:  # type: ignore[no-untyped-def]
    """Escape XML and replace characters the built-in PDF fonts cannot show."""
    return escape(_plain(value))


def render_csv(payload: dict) -> bytes:
    output = io.StringIO()
    writer = csv.writer(output, lineterminator="\n")

    writer.writerow(["RetailLens report"])
    writer.writerow(["Name", _csv_cell(payload["name"])])
    writer.writerow(["Kind", payload["kind_label"]])
    writer.writerow(["Organisation", _csv_cell(payload["organisation_name"])])
    dataset_name = payload["dataset"]["name"] if payload["dataset"] else "All processed datasets"
    writer.writerow(["Dataset", _csv_cell(dataset_name)])
    writer.writerow(["Date from", payload["date_from"] or "All available data"])
    writer.writerow(["Date to", payload["date_to"] or "All available data"])
    period = payload["period"]
    writer.writerow(
        [
            "Resolved period",
            (
                f"{period['date_from']} to {period['date_to']}"
                if period["date_from"]
                else "No processed data"
            ),
        ]
    )
    writer.writerow(["Generated", payload["generated_at"]])
    writer.writerow([])

    writer.writerow(["Summary"])
    writer.writerow(["Metric", "Value", "Note"])
    for card in payload["summary"]:
        writer.writerow(
            [
                card["label"],
                _csv_cell(_display(card["value"], card["format"], payload["currency"])),
                card["note"],
            ]
        )

    for section in payload["sections"]:
        writer.writerow([])
        writer.writerow([section["title"]])
        if section["description"]:
            writer.writerow([section["description"]])
        writer.writerow([column["label"] for column in section["columns"]])
        for row in section["rows"]:
            writer.writerow([_csv_cell(row.get(column["key"])) for column in section["columns"]])
        if not section["rows"]:
            writer.writerow(["No rows for these filters."])

    writer.writerow([])
    writer.writerow(["Metric definitions"])
    writer.writerow(["Metric", "Definition", "Grain", "Exclusions"])
    for definition in payload["definitions"]:
        writer.writerow(
            [
                definition["metric"],
                definition["definition"],
                definition["grain"],
                definition["exclusions"],
            ]
        )

    # The BOM lets Excel open UTF-8 labels correctly without a manual import.
    return ("\ufeff" + output.getvalue()).encode("utf-8")


def _column_widths(columns: list[dict]) -> list[float]:
    weights = []
    for column in columns:
        key = column["key"]
        if key in {"description", "definition"}:
            weights.append(2.4)
        elif key in {"dataset", "segment", "customer", "product", "note"}:
            weights.append(1.7)
        elif key in {"exclusions", "grain"}:
            weights.append(1.3)
        elif column["format"] in {"money", "percent", "number"}:
            weights.append(1.0)
        else:
            weights.append(1.2)
    total = sum(weights)
    return [CONTENT_WIDTH * weight / total for weight in weights]


def _cell(value, fmt: str, style: ParagraphStyle, number_style: ParagraphStyle) -> Paragraph:  # type: ignore[no-untyped-def]
    display = _display(value, fmt, "")
    if fmt in {"money", "percent", "number"} and value not in (None, ""):
        display = display.replace(" ", "")
        return Paragraph(_pdf_text(display), number_style)
    return Paragraph(_pdf_text(display), style)


def render_pdf(payload: dict) -> bytes:
    buffer = io.BytesIO()
    document = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=MARGIN,
        rightMargin=MARGIN,
        topMargin=16 * mm,
        bottomMargin=16 * mm,
        title=payload["name"],
        author="RetailLens",
    )
    styles = getSampleStyleSheet()
    brand = ParagraphStyle(
        "ReportBrand",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=8,
        leading=10,
        textColor=colors.HexColor("#0f766e"),
        spaceAfter=2,
    )
    title_style = ParagraphStyle(
        "ReportTitle",
        parent=styles["Title"],
        fontSize=18,
        leading=22,
        alignment=0,
        spaceAfter=2,
    )
    subtitle = ParagraphStyle(
        "ReportSubtitle",
        parent=styles["Normal"],
        fontSize=9,
        leading=12,
        textColor=colors.HexColor("#475569"),
        spaceAfter=8,
    )
    section_style = ParagraphStyle(
        "ReportSection",
        parent=styles["Heading2"],
        fontSize=11,
        leading=14,
        spaceBefore=10,
        spaceAfter=4,
    )
    body = ParagraphStyle(
        "ReportCell",
        parent=styles["Normal"],
        fontSize=7.2,
        leading=9,
        textColor=colors.HexColor("#1e293b"),
    )
    body_right = ParagraphStyle(
        "ReportCellRight",
        parent=body,
        alignment=2,
    )
    header = ParagraphStyle(
        "ReportHeader",
        parent=body,
        fontName="Helvetica-Bold",
        textColor=colors.white,
    )
    small = ParagraphStyle(
        "ReportSmall",
        parent=body,
        fontSize=6.8,
        leading=8.2,
        textColor=colors.HexColor("#64748b"),
    )

    currency = payload["currency"]
    story = [
        Paragraph("RETAILLENS REPORT", brand),
        Paragraph(_pdf_text(payload["name"]), title_style),
        Paragraph(
            _pdf_text(
                f"{payload['organisation_name']} - {payload['kind_label']} - "
                f"generated {payload['generated_at']}"
            ),
            subtitle,
        ),
    ]

    meta_rows = [
        ("Dataset", payload["dataset"]["name"] if payload["dataset"] else "All processed datasets"),
        (
            "Requested period",
            f"{payload['date_from'] or 'All available data'} to "
            f"{payload['date_to'] or 'All available data'}",
        ),
        (
            "Resolved period",
            f"{payload['period']['date_from'] or '-'} to {payload['period']['date_to'] or '-'}"
            if payload["period"]["date_from"]
            else "No processed data",
        ),
    ]
    meta = Table(
        [
            [
                Paragraph(_pdf_text(label), small),
                Paragraph(_pdf_text(value), body),
            ]
            for label, value in meta_rows
        ],
        colWidths=[CONTENT_WIDTH * 0.22, CONTENT_WIDTH * 0.78],
    )
    meta.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
                ("TOPPADDING", (0, 0), (-1, -1), 2),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ]
        )
    )
    story.append(meta)

    story.append(Paragraph("Summary", section_style))
    summary_rows = [
        [
            Paragraph("Metric", header),
            Paragraph("Value", header),
            Paragraph("Note", header),
        ]
    ]
    for card in payload["summary"]:
        summary_rows.append(
            [
                Paragraph(_pdf_text(card["label"]), body),
                Paragraph(
                    _pdf_text(_display(card["value"], card["format"], currency)),
                    body_right,
                ),
                Paragraph(_pdf_text(card["note"]), body),
            ]
        )
    summary_table = LongTable(
        summary_rows,
        colWidths=[CONTENT_WIDTH * 0.3, CONTENT_WIDTH * 0.22, CONTENT_WIDTH * 0.48],
        repeatRows=1,
    )
    summary_table.setStyle(_table_style())
    story.append(summary_table)

    for section in payload["sections"]:
        story.append(Paragraph(_pdf_text(section["title"]), section_style))
        if section["description"]:
            story.append(Paragraph(_pdf_text(section["description"]), small))
            story.append(Spacer(1, 3))
        rows = [[Paragraph(_pdf_text(column["label"]), header) for column in section["columns"]]]
        for row in section["rows"]:
            rows.append(
                [
                    _cell(row.get(column["key"]), column["format"], body, body_right)
                    for column in section["columns"]
                ]
            )
        if len(rows) == 1:
            rows.append(
                [
                    Paragraph(
                        _pdf_text("No rows for these filters."),
                        body,
                    )
                ]
                + ["" for _ in section["columns"][1:]]
            )
        widths = _column_widths(section["columns"])
        table = LongTable(rows, colWidths=widths, repeatRows=1)
        table.setStyle(_table_style())
        story.append(table)

    story.append(Paragraph("Metric definitions", section_style))
    definition_rows = [
        [
            Paragraph("Metric", header),
            Paragraph("Definition", header),
            Paragraph("Grain", header),
            Paragraph("Exclusions", header),
        ]
    ]
    for definition in payload["definitions"]:
        definition_rows.append(
            [
                Paragraph(_pdf_text(definition["metric"]), body),
                Paragraph(_pdf_text(definition["definition"]), body),
                Paragraph(_pdf_text(definition["grain"]), body),
                Paragraph(_pdf_text(definition["exclusions"]), body),
            ]
        )
    definitions = LongTable(
        definition_rows,
        colWidths=[
            CONTENT_WIDTH * 0.17,
            CONTENT_WIDTH * 0.43,
            CONTENT_WIDTH * 0.17,
            CONTENT_WIDTH * 0.23,
        ],
        repeatRows=1,
    )
    definitions.setStyle(_table_style())
    story.append(definitions)

    story.append(Spacer(1, 6))
    story.append(
        Paragraph(
            _pdf_text(
                "Figures are recomputed from the processed warehouse when this report is "
                "generated. They are not a snapshot of an earlier dashboard."
            ),
            small,
        )
    )

    footer_name = _plain(payload["name"])

    def footer(canvas, doc) -> None:  # type: ignore[no-untyped-def]
        canvas.saveState()
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(colors.HexColor("#64748b"))
        canvas.drawString(MARGIN, 10 * mm, f"RetailLens - {footer_name}")
        canvas.drawRightString(A4[0] - MARGIN, 10 * mm, f"Page {doc.page}")
        canvas.restoreState()

    document.build(story, onFirstPage=footer, onLaterPages=footer)
    return buffer.getvalue()


def _table_style() -> TableStyle:
    return TableStyle(
        [
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0f766e")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#cbd5e1")),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 3),
            ("RIGHTPADDING", (0, 0), (-1, -1), 3),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f8fafc")]),
        ]
    )
