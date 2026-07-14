#!/usr/bin/env python3
"""
Convert Markdown files to beautifully formatted PDFs using fpdf2.
Pure Python approach - no external system dependencies.
"""

import os
import sys
from pathlib import Path
from markdown_it import MarkdownIt
from fpdf import FPDF

# --- Font Configuration ---
FONT_REGULAR = r"C:\Windows\Fonts\msyh.ttc"
FONT_BOLD = r"C:\Windows\Fonts\msyhbd.ttc"
FONT_MONO = r"C:\Windows\Fonts\consola.ttf"

PAGE_W = 210
PAGE_H = 297
MARGIN = 20
CONTENT_W = PAGE_W - 2 * MARGIN


def extract_text(token) -> str:
    """Recursively extract plain text from a markdown-it token."""
    if token is None:
        return ""
    if token.type == "text":
        return token.content
    if token.type in ("code_inline",):
        return token.content
    if token.type in ("softbreak", "hardbreak"):
        return " "
    if token.type == "fence":
        return token.content
    text = ""
    if hasattr(token, "children") and token.children:
        for child in token.children:
            text += extract_text(child)
    if token.content and token.type != "fence":
        text += token.content
    return text


def contains_inline_markup(token) -> bool:
    """Check if inline token contains formatted children."""
    if token is None:
        return False
    if hasattr(token, "children") and token.children:
        for child in token.children:
            if child.type in ("strong_open", "em_open", "code_inline", "link_open"):
                return True
    return False


def render_inline(pdf: FPDF, token, font_size: int = 10):
    """Render inline token with full formatting support."""
    if token is None:
        return

    if token.type == "text":
        pdf.set_font("YaHei", "", font_size)
        pdf.set_text_color(51, 51, 51)
        pdf.write(font_size * 0.65, token.content)
        return

    if token.type == "code_inline":
        pdf.set_font("Consolas", "", font_size - 1.5)
        pdf.set_text_color(190, 24, 93)
        pdf.write(font_size * 0.65, token.content)
        return

    if token.type in ("softbreak",):
        pdf.write(font_size * 0.65, " ")
        return

    if token.type in ("hardbreak",):
        pdf.ln(font_size * 0.65)
        return

    # Process children for formatting tokens
    if hasattr(token, "children") and token.children:
        for child in token.children:
            if child.type == "text":
                pdf.set_font("YaHei", "", font_size)
                pdf.set_text_color(51, 51, 51)
                pdf.write(font_size * 0.65, child.content)
            elif child.type == "strong_open":
                pdf.set_font("YaHei", "B", font_size)
                pdf.set_text_color(26, 26, 46)
            elif child.type == "strong_close":
                pdf.set_font("YaHei", "", font_size)
                pdf.set_text_color(51, 51, 51)
            elif child.type == "em_open":
                pdf.set_font("YaHei", "", font_size)
                pdf.set_text_color(107, 114, 128)
            elif child.type == "em_close":
                pdf.set_font("YaHei", "", font_size)
                pdf.set_text_color(51, 51, 51)
            elif child.type == "code_inline":
                pdf.set_font("Consolas", "", font_size - 1.5)
                pdf.set_text_color(190, 24, 93)
                pdf.write(font_size * 0.65, child.content)
            elif child.type == "link_open":
                pdf.set_text_color(37, 99, 235)
                pdf.set_font("YaHei", "", font_size)
            elif child.type == "link_close":
                pdf.set_text_color(51, 51, 51)
            elif child.type == "softbreak":
                pdf.write(font_size * 0.65, " ")
            elif child.type == "hardbreak":
                pdf.ln(font_size * 0.65)
            elif child.type in ("s_open", "s_close"):
                pass
            elif child.type == "text":
                pdf.set_font("YaHei", "", font_size)
                pdf.set_text_color(51, 51, 51)
                pdf.write(font_size * 0.65, child.content)
            elif hasattr(child, "children") and child.children:
                render_inline(pdf, child, font_size)


def render_code_block(pdf: FPDF, content: str):
    """Render a fenced code block with dark background."""
    lines = content.rstrip().split("\n")
    n_lines = len(lines)
    block_h = n_lines * 4.2 + 8

    # Page break if needed
    if pdf.get_y() + block_h > PAGE_H - MARGIN - 10:
        pdf.add_page()

    y0 = pdf.get_y()

    # Dark background
    pdf.set_fill_color(30, 41, 59)
    pdf.rect(MARGIN, y0, CONTENT_W, block_h, "F")

    # Render lines
    pdf.set_font("Consolas", "", 7)
    pdf.set_text_color(226, 232, 240)
    y = y0 + 4
    for line in lines:
        display_line = line[:130]
        pdf.set_xy(MARGIN + 5, y)
        pdf.cell(CONTENT_W - 10, 4.2, display_line)
        y += 4.2

    pdf.set_y(y + 4)
    pdf.set_text_color(51, 51, 51)


def render_table(pdf: FPDF, rows: list, header: list):
    """Render a table with header styling."""
    if not header and not rows:
        return

    all_rows = ([header] if header else []) + rows
    col_count = max(len(r) for r in all_rows) if all_rows else 1
    col_w = CONTENT_W / col_count
    line_h = 7

    # Check page break
    est_h = len(all_rows) * line_h + 8
    if pdf.get_y() + est_h > PAGE_H - MARGIN - 10:
        pdf.add_page()

    pdf.ln(3)

    # Header
    if header:
        pdf.set_fill_color(37, 99, 235)
        pdf.set_text_color(255, 255, 255)
        pdf.set_font("YaHei", "B", 8.5)
        y = pdf.get_y()
        x = MARGIN
        for i, cell_text in enumerate(header):
            pdf.set_xy(x, y)
            pdf.cell(col_w, line_h, cell_text[:35], border=0, fill=True, align="L")
            x += col_w
        pdf.set_y(y + line_h)

    # Data rows
    pdf.set_font("YaHei", "", 8.5)
    pdf.set_text_color(51, 51, 51)
    pdf.set_draw_color(229, 231, 235)

    for r_idx, row in enumerate(rows):
        y = pdf.get_y()
        x = MARGIN
        if r_idx % 2 == 0:
            pdf.set_fill_color(248, 250, 252)
        else:
            pdf.set_fill_color(255, 255, 255)

        pdf.line(MARGIN, y, MARGIN + CONTENT_W, y)

        for i in range(col_count):
            cell_text = row[i][:35] if i < len(row) else ""
            pdf.set_xy(x, y)
            pdf.cell(col_w, line_h, cell_text, border=0, fill=True, align="L")
            x += col_w
        pdf.set_y(y + line_h)

    # Bottom line
    y_final = pdf.get_y()
    pdf.line(MARGIN, y_final, MARGIN + CONTENT_W, y_final)
    pdf.ln(4)


def render_blockquote(pdf: FPDF, text: str):
    """Render a blockquote with colored left border."""
    if not text.strip():
        return

    pdf.set_font("YaHei", "", 9.5)
    pdf.set_text_color(30, 58, 95)

    # Measure text
    lines = pdf.multi_cell(CONTENT_W - 16, 5.5, text, dry_run=True, output="LINES")
    block_h = len(lines) * 5.5 + 12

    if pdf.get_y() + block_h > PAGE_H - MARGIN - 5:
        pdf.add_page()

    y0 = pdf.get_y()

    # Left border
    pdf.set_fill_color(37, 99, 235)
    pdf.rect(MARGIN, y0, 3.5, block_h, "F")
    # Background
    pdf.set_fill_color(240, 244, 255)
    pdf.rect(MARGIN + 3.5, y0, CONTENT_W - 3.5, block_h, "F")

    # Text
    pdf.set_xy(MARGIN + 11, y0 + 6)
    pdf.multi_cell(CONTENT_W - 16, 5.5, text, align="L")
    pdf.ln(3)
    pdf.set_text_color(51, 51, 51)


def convert_md_to_pdf(md_path: Path, pdf_path: Path) -> bool:
    """Convert a Markdown file to a well-formatted PDF."""
    try:
        content = md_path.read_text(encoding="utf-8")

        # Parse markdown
        md = MarkdownIt("commonmark", {"breaks": True, "html": True})
        md.enable(["table", "strikethrough"])
        tokens = md.parse(content)

        # Create PDF
        pdf = FPDF("P", "mm", "A4")
        pdf.set_auto_page_break(True, MARGIN)
        pdf.set_margins(MARGIN, MARGIN, MARGIN)

        # Register fonts
        pdf.add_font("YaHei", "", FONT_REGULAR, uni=True)
        pdf.add_font("YaHei", "B", FONT_BOLD, uni=True)
        pdf.add_font("Consolas", "", FONT_MONO, uni=True)

        pdf.add_page()

        # Process tokens
        i = 0
        total = len(tokens)

        while i < total:
            token = tokens[i]

            # --- HEADING ---
            if token.type == "heading_open":
                level = int(token.tag[1])
                # Find inline content
                inline = None
                for j in range(i + 1, min(i + 5, total)):
                    if tokens[j].type == "inline":
                        inline = tokens[j]
                        break
                heading_text = extract_text(inline) if inline else ""

                if level == 1:
                    pdf.ln(3)
                    pdf.set_fill_color(37, 99, 235)
                    pdf.rect(MARGIN, pdf.get_y(), CONTENT_W, 0.5, "F")
                    pdf.set_font("YaHei", "B", 20)
                    pdf.set_text_color(26, 26, 46)
                    pdf.ln(3)
                    pdf.multi_cell(CONTENT_W, 10, heading_text, align="L")
                    pdf.ln(2)
                elif level == 2:
                    pdf.ln(4)
                    pdf.set_font("YaHei", "B", 14)
                    pdf.set_text_color(37, 99, 235)
                    pdf.cell(CONTENT_W, 9, heading_text)
                    pdf.ln(11)
                    pdf.set_draw_color(229, 231, 235)
                    pdf.line(MARGIN, pdf.get_y(), MARGIN + CONTENT_W, pdf.get_y())
                    pdf.ln(3)
                elif level == 3:
                    pdf.ln(3)
                    pdf.set_font("YaHei", "B", 12)
                    pdf.set_text_color(55, 65, 81)
                    pdf.multi_cell(CONTENT_W, 7, heading_text, align="L")
                    pdf.ln(1)
                elif level == 4:
                    pdf.ln(2)
                    pdf.set_font("YaHei", "B", 10.5)
                    pdf.set_text_color(75, 85, 99)
                    pdf.multi_cell(CONTENT_W, 6.5, heading_text, align="L")
                    pdf.ln(1)
                else:
                    pdf.ln(1)
                    pdf.set_font("YaHei", "B", 10)
                    pdf.set_text_color(51, 51, 51)
                    pdf.multi_cell(CONTENT_W, 6, heading_text, align="L")

                pdf.set_text_color(51, 51, 51)
                # Skip to heading_close
                while i < total and tokens[i].type != "heading_close":
                    i += 1
                i += 1
                continue

            # --- FENCED CODE BLOCK ---
            if token.type == "fence":
                render_code_block(pdf, token.content)
                i += 1
                continue

            # --- HORIZONTAL RULE ---
            if token.type == "hr":
                pdf.ln(3)
                pdf.set_draw_color(229, 231, 235)
                pdf.line(MARGIN, pdf.get_y(), MARGIN + CONTENT_W, pdf.get_y())
                pdf.ln(3)
                i += 1
                continue

            # --- TABLE ---
            if token.type == "table_open":
                rows = []
                header = []
                is_header = False
                i += 1
                while i < total and tokens[i].type != "table_close":
                    t = tokens[i]
                    if t.type == "thead_open":
                        is_header = True
                    elif t.type == "tbody_open":
                        is_header = False
                    elif t.type == "tr_open":
                        row = []
                        i += 1
                        while i < total and tokens[i].type != "tr_close":
                            if tokens[i].type in ("th_open", "td_open"):
                                # Find inline
                                inline = None
                                for j in range(i + 1, min(i + 5, total)):
                                    if tokens[j].type == "inline":
                                        inline = tokens[j]
                                        break
                                row.append(extract_text(inline))
                                # Skip to close
                                while i < total and tokens[i].type not in ("th_close", "td_close"):
                                    i += 1
                            i += 1
                        if row:
                            if is_header:
                                header = row
                            else:
                                rows.append(row)
                    i += 1
                # If no explicit header, first row becomes header
                if not header and rows:
                    header = rows.pop(0)

                render_table(pdf, rows, header)
                i += 1
                continue

            # --- BLOCKQUOTE ---
            if token.type == "blockquote_open":
                texts = []
                i += 1
                depth = 1
                while i < total and depth > 0:
                    t = tokens[i]
                    if t.type == "blockquote_open":
                        depth += 1
                    elif t.type == "blockquote_close":
                        depth -= 1
                    elif t.type == "inline":
                        texts.append(extract_text(t))
                    elif t.type == "paragraph_open":
                        # Find inline after paragraph_open
                        for j in range(i + 1, min(i + 5, total)):
                            if tokens[j].type == "inline":
                                texts.append(extract_text(tokens[j]))
                                break
                    i += 1
                render_blockquote(pdf, "\n".join(texts))
                continue

            # --- PARAGRAPH ---
            if token.type == "paragraph_open":
                inline = None
                for j in range(i + 1, min(i + 5, total)):
                    if tokens[j].type == "inline":
                        inline = tokens[j]
                        break

                if inline:
                    para_text = extract_text(inline)
                    # Check if it's a blockquote-style paragraph
                    if para_text.strip().startswith("> ") or any(
                        para_text.strip().startswith(p) for p in ["📌", "💡", "⚠️", "✅", ">"]
                    ):
                        clean = para_text.strip()
                        if clean.startswith("> "):
                            clean = clean[2:]
                        render_blockquote(pdf, clean)
                    else:
                        pdf.ln(1)
                        pdf.set_font("YaHei", "", 10)
                        pdf.set_text_color(51, 51, 51)

                        if contains_inline_markup(inline):
                            render_inline(pdf, inline)
                        else:
                            pdf.multi_cell(CONTENT_W, 6.5, para_text, align="L")
                        pdf.ln(1)

                # Skip to paragraph_close
                while i < total and tokens[i].type != "paragraph_close":
                    i += 1
                i += 1
                continue

            # --- BULLET LIST ---
            if token.type == "bullet_list_open":
                pdf.ln(1)
                item_idx = 0
                i += 1
                while i < total and tokens[i].type != "bullet_list_close":
                    t = tokens[i]
                    if t.type == "list_item_open":
                        inline = None
                        for j in range(i + 1, min(i + 8, total)):
                            if tokens[j].type == "inline":
                                inline = tokens[j]
                                break
                            if tokens[j].type == "paragraph_open":
                                for k in range(j + 1, min(j + 5, total)):
                                    if tokens[k].type == "inline":
                                        inline = tokens[k]
                                        break
                                break

                        if inline:
                            item_text = extract_text(inline)
                            pdf.set_font("YaHei", "", 10)
                            # Indent and bullet
                            pdf.set_x(MARGIN + 5)
                            pdf.cell(7, 6.5, "•", align="C")
                            pdf.set_x(MARGIN + 14)
                            pdf.multi_cell(CONTENT_W - 14, 6.5, item_text, align="L")

                        # Skip to list_item_close
                        while i < total and tokens[i].type != "list_item_close":
                            i += 1
                    i += 1
                pdf.ln(2)
                continue

            # --- ORDERED LIST ---
            if token.type == "ordered_list_open":
                pdf.ln(1)
                item_idx = 0
                i += 1
                while i < total and tokens[i].type != "ordered_list_close":
                    t = tokens[i]
                    if t.type == "list_item_open":
                        item_idx += 1
                        inline = None
                        for j in range(i + 1, min(i + 8, total)):
                            if tokens[j].type == "inline":
                                inline = tokens[j]
                                break
                            if tokens[j].type == "paragraph_open":
                                for k in range(j + 1, min(j + 5, total)):
                                    if tokens[k].type == "inline":
                                        inline = tokens[k]
                                        break
                                break

                        if inline:
                            item_text = extract_text(inline)
                            pdf.set_font("YaHei", "", 10)
                            pdf.set_x(MARGIN + 5)
                            pdf.cell(9, 6.5, f"{item_idx}.", align="R")
                            pdf.set_x(MARGIN + 16)
                            pdf.multi_cell(CONTENT_W - 16, 6.5, item_text, align="L")

                        while i < total and tokens[i].type != "list_item_close":
                            i += 1
                    i += 1
                pdf.ln(2)
                continue

            # Default: just advance
            i += 1

        # Output PDF
        pdf.output(str(pdf_path))
        return True

    except Exception as e:
        import traceback
        print(f"\n  ERROR: {e}")
        traceback.print_exc()
        return False


def main():
    base_dir = Path(__file__).parent
    all_md = sorted(base_dir.glob("*/*.md"))

    main_docs = [f for f in all_md if f.name != "qa.md"]
    qa_docs = [f for f in all_md if f.name == "qa.md"]

    total = len(main_docs) + len(qa_docs)
    print(f"Found {len(main_docs)} main documents + {len(qa_docs)} Q&A files = {total} total")
    print("=" * 60)

    success = 0
    failed = 0

    for md_file in main_docs + qa_docs:
        pdf_file = md_file.with_suffix(".pdf")
        rel = md_file.relative_to(base_dir)
        print(f"  {rel} ... ", end="", flush=True)

        if convert_md_to_pdf(md_file, pdf_file):
            kb = pdf_file.stat().st_size / 1024
            print(f"OK ({kb:.0f} KB)")
            success += 1
        else:
            print("FAILED")
            failed += 1

    print("=" * 60)
    print(f"Done! {success} succeeded, {failed} failed.")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
