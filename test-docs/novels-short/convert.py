import os, re
from fpdf import FPDF

FONT_DIR = "C:/Windows/Fonts"

class NovelPDF(FPDF):
    def __init__(self):
        super().__init__()
        self.add_font("zh", "", os.path.join(FONT_DIR, "msyh.ttc"))
        self.add_font("zh", "B", os.path.join(FONT_DIR, "msyhbd.ttc"))
        self.set_auto_page_break(True, 22)

    def title_page(self, title, subtitle):
        self.add_page()
        self.ln(30)
        self.set_font("zh", "B", 26)
        self.cell(0, 14, title, align="C", new_x="LMARGIN", new_y="NEXT")
        self.ln(8)
        self.set_font("zh", "", 12)
        self.set_text_color(120, 120, 120)
        self.cell(0, 8, subtitle, align="C", new_x="LMARGIN", new_y="NEXT")
        self.set_text_color(0, 0, 0)
        self.ln(10)

    def chapter_title(self, text):
        self.add_page()
        self.set_font("zh", "B", 16)
        self.cell(0, 10, text, align="C", new_x="LMARGIN", new_y="NEXT")
        self.ln(6)

    def body(self, text):
        self.set_font("zh", "", 11)
        for para in text.strip().split("\n"):
            para = para.strip()
            if not para:
                self.ln(3)
                continue
            # Handle role table lines
            if para.startswith("|") and para.endswith("|"):
                continue
            self.multi_cell(0, 7.5, para, align="J")
            self.ln(1)

    def divider(self):
        y = self.get_y()
        self.set_draw_color(180, 180, 180)
        self.line(self.l_margin + 20, y, self.w - self.r_margin - 20, y)
        self.ln(5)

    def ending(self):
        self.ln(4)
        self.set_font("zh", "", 10)
        self.set_text_color(140, 140, 140)
        self.cell(0, 8, "—— 全文完 ——", align="C")
        self.set_text_color(0, 0, 0)


def has_table(lines):
    return any("|" in l and l.strip().startswith("|") for l in lines)


def convert(md_path, pdf_path):
    with open(md_path, "r", encoding="utf-8") as f:
        lines = f.readlines()

    pdf = NovelPDF()
    title = ""
    subtitle = ""
    chapters = []
    current_chapter = {"title": "", "lines": []}
    in_role_table = False

    for line in lines:
        stripped = line.rstrip()

        # Title
        if stripped.startswith("# ") and not title:
            title = stripped[2:].strip()
            continue
        # Subtitle (blockquote right after title)
        if stripped.startswith("> ") and not subtitle:
            subtitle = stripped[2:].strip()
            continue
        # Chapter headings
        if stripped.startswith("## ") and "角色" not in stripped:
            if current_chapter["title"]:
                chapters.append(current_chapter)
            current_chapter = {"title": stripped[3:].strip(), "lines": []}
            continue
        if stripped.startswith("## ") and "角色" in stripped:
            # Skip role table header
            in_role_table = True
            continue

        # Role table lines
        if in_role_table:
            if stripped.startswith("|---"):
                continue
            if stripped.startswith("|"):
                parts = [p.strip() for p in stripped.split("|") if p.strip()]
                if parts and parts[0] not in ["角色", "**角色**"]:
                    current_chapter["lines"].append(f"　　{parts[0]}：{parts[2] if len(parts) > 2 else ''}")
                continue
            else:
                in_role_table = False

        if stripped.startswith("---") or stripped == "---":
            continue
        if stripped == "*全文完*" or stripped == "> 全文完":
            continue

        # Append non-empty non-skip lines (skip role section lines that are table rows)
        if not in_role_table:
            # Remove markdown bold/italic for PDF
            clean = re.sub(r'\*\*([^*]+)\*\*', r'\1', stripped)
            clean = re.sub(r'\*([^*]+)\*', r'\1', clean)
            clean = re.sub(r'`([^`]+)`', r'\1', clean)
            current_chapter["lines"].append(clean)

    if current_chapter["title"]:
        chapters.append(current_chapter)

    # Write PDF
    pdf.title_page(title, subtitle)

    for i, ch in enumerate(chapters):
        pdf.chapter_title(ch["title"])
        content = "\n".join(ch["lines"])
        pdf.body(content)
        if i < len(chapters) - 1:
            pdf.divider()

    pdf.ending()
    pdf.output(pdf_path)
    print(f"OK ({len(chapters)} chapters): {os.path.basename(pdf_path)}")


base = os.path.dirname(os.path.abspath(__file__))

for name in ["长安月下", "横刀问情"]:
    md_path = os.path.join(base, f"{name}.md")
    pdf_path = os.path.join(base, f"{name}.pdf")
    convert(md_path, pdf_path)

print("All done!")
