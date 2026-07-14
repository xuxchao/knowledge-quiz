#!/usr/bin/env python3
"""Convert novels to PDF - simplified version."""

import re
from pathlib import Path
from fpdf import FPDF

FONT_REGULAR = r"C:\Windows\Fonts\simsun.ttc"
FONT_BOLD = r"C:\Windows\Fonts\simhei.ttf"

class NovelPDF(FPDF):
    def __init__(self, title):
        super().__init__('P', 'mm', 'A4')
        self.title_text = title
        self.set_left_margin(20)
        self.set_right_margin(20)
        self.set_auto_page_break(True, 25)

    def header(self):
        if self.page_no() > 2:
            self.set_font("CJK", "", 9)
            self.set_text_color(128, 128, 128)
            self.cell(0, 8, self.title_text, align="C")
            self.ln(5)

    def footer(self):
        self.set_y(-20)
        self.set_font("CJK", "", 9)
        self.set_text_color(128, 128, 128)
        self.cell(0, 10, f"- {self.page_no()} -", align="C")

    def reset_pos(self):
        """Ensure x is at left margin."""
        self.set_x(self.l_margin)

    def add_title_page(self):
        self.add_page()
        self.reset_pos()
        self.ln(45)
        self.set_font("CJKBold", "", 26)
        self.set_text_color(40, 40, 40)
        self.cell(0, 15, self.title_text, align="C")
        self.ln(20)

        self.set_font("CJK", "", 12)
        self.set_text_color(100, 100, 100)
        self.cell(0, 10, "墨隐斋  原创虚构小说", align="C")
        self.ln(8)
        self.set_font("CJK", "", 10)
        self.cell(0, 10, "2026年7月", align="C")
        self.reset_pos()

    def write_text(self, text, size=11, bold=False, color=(40,40,40), indent=0):
        """Write text with proper wrapping using a reliable method."""
        self.reset_pos()
        self.set_font("CJKBold" if bold else "CJK", "", size)
        self.set_text_color(*color)
        if indent:
            self.cell(indent, 0, "")
        # Use cell-based writing with width
        w = self.w - self.l_margin - self.r_margin - indent
        self.multi_cell(w, size * 0.72, text, align="L")
        self.reset_pos()

    def add_content(self, md_path):
        content = Path(md_path).read_text(encoding="utf-8")
        lines = content.split("\n")

        in_meta = True
        in_code = False
        in_table = False
        table_rows = []

        for line in lines:
            s = line.strip()

            # Skip metadata
            if in_meta:
                if s.startswith("> ") or s.startswith("**题材**") or s.startswith("**简介**"):
                    continue
                if s == "---":
                    continue
                in_meta = False

            # Code blocks
            if s.startswith("```"):
                if in_code:
                    in_code = False
                    self.ln(4)
                else:
                    in_code = True
                continue

            if in_code:
                self.reset_pos()
                self.set_font("CJK", "", 8)
                self.set_text_color(60, 60, 60)
                self.cell(0, 5.5, "  " + s[:110])
                self.ln()
                continue

            # Empty line
            if not s:
                if in_table and table_rows:
                    self._flush_table(table_rows)
                    table_rows = []
                    in_table = False
                self.reset_pos()
                self.ln(3)
                continue

            # Table
            if s.startswith("|") and s.endswith("|"):
                if "---" in s:
                    continue
                row = [c.strip() for c in s.split("|")[1:-1]]
                table_rows.append(row)
                in_table = True
                continue
            elif in_table:
                self._flush_table(table_rows)
                table_rows = []
                in_table = False

            # Chapter heading
            cm = re.match(r"^##\s+(第.+章.*)", s)
            if cm:
                self.ln(8)
                self.reset_pos()
                self.set_font("CJKBold", "", 17)
                self.set_text_color(30, 30, 30)
                self.cell(0, 13, cm.group(1), align="C")
                self.ln(16)
                self.reset_pos()
                continue

            # Sub heading
            if s.startswith("### "):
                self.ln(4)
                self.reset_pos()
                self.set_font("CJKBold", "", 13)
                self.set_text_color(50, 50, 50)
                self.cell(0, 10, s[4:])
                self.ln(10)
                self.reset_pos()
                continue

            # Title
            if s.startswith("# "):
                continue

            # Separator
            if s.startswith("---") or s.startswith("***"):
                self.ln(2)
                self.set_draw_color(180, 180, 180)
                self.set_line_width(0.3)
                self.reset_pos()
                y = self.get_y()
                self.line(self.l_margin + 50, y, self.l_margin + 130, y)
                self.ln(5)
                self.reset_pos()
                continue

            # End marker
            if "全文完" in s and "墨隐斋" in s:
                self.ln(6)
                self.reset_pos()
                self.set_font("CJKBold", "", 12)
                self.set_text_color(80, 80, 80)
                self.cell(0, 10, "全文完", align="C")
                self.ln(14)
                self.reset_pos()
                continue

            # Clean text
            clean = s
            is_quote = False
            if clean.startswith("> "):
                clean = clean[2:]
                is_quote = True

            if clean:
                font_size = 10 if is_quote else 11
                text_color = (100, 100, 100) if is_quote else (40, 40, 40)
                self.write_text(clean, size=font_size, color=text_color)

        if table_rows:
            self._flush_table(table_rows)

    def _flush_table(self, rows):
        if not rows:
            return
        self.ln(2)
        self.reset_pos()
        ncols = max(len(r) for r in rows)
        if ncols == 0:
            return
        col_w = 170 / ncols

        for ri, row in enumerate(rows):
            self.reset_pos()
            if ri == 0:
                self.set_fill_color(230, 230, 240)
                self.set_font("CJKBold", "", 9)
            else:
                self.set_font("CJK", "", 9)
                bg = (250, 250, 255) if ri % 2 == 0 else (255, 255, 255)
                self.set_fill_color(*bg)
            while len(row) < ncols:
                row.append("")
            for cell_text in row:
                self.cell(col_w, 8, cell_text[:60], border=1, fill=True)
            self.ln()
        self.ln(4)
        self.reset_pos()


NOVELS_DIR = Path(r"D:\work\personal-projects\knowledge-quiz2\test-docs\novels")

for md_file, pdf_file in [("长安月下.md", "长安月下.pdf"), ("横刀问情.md", "横刀问情.pdf")]:
    md_path = NOVELS_DIR / md_file
    pdf_path = NOVELS_DIR / pdf_file
    if not md_path.exists():
        print(f"[SKIP] {md_file}")
        continue

    print(f"[Converting] {md_file} -> {pdf_file}")
    pdf = NovelPDF(md_file.replace(".md", ""))
    pdf.add_font("CJK", "", FONT_REGULAR)
    pdf.add_font("CJKBold", "", FONT_BOLD)
    pdf.add_title_page()
    pdf.add_content(md_path)
    pdf.output(str(pdf_path))
    print(f"  Done! {pdf_path.stat().st_size/1024:.1f} KB, {pdf.pages_count} pages")

print("\nDone!")
