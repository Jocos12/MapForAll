"""Render docs/MapForAll_Project_Structure.md tree into a printable PDF."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

MD = Path(__file__).with_name("MapForAll_Project_Structure.md")
OUT = Path(__file__).with_name("MapForAll_Project_Structure.pdf")
W, H = 1240, 1754
MARGIN_X = 42
MARGIN_BOTTOM = 50
LINE = 17
BG = (252, 249, 245)
INK = (26, 22, 20)
MUTED = (110, 95, 88)
ACCENT = (232, 103, 42)
GREEN = (15, 110, 86)
RULE = (230, 220, 210)


def font(size: int, mono: bool = False, bold: bool = False):
    if mono:
        for path in ("C:/Windows/Fonts/consola.ttf", "C:/Windows/Fonts/cour.ttf"):
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    candidates = [
        "C:/Windows/Fonts/segoeuib.ttf" if bold else "C:/Windows/Fonts/segoeui.ttf",
        "C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf",
    ]
    for path in candidates:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


F_TITLE = font(28, bold=True)
F_SUB = font(14)
F_MONO = font(13, mono=True)
F_SMALL = font(12)


def extract_tree(md: str) -> list[str]:
    inside = False
    out: list[str] = []
    for line in md.splitlines():
        if line.strip().startswith("```"):
            if not inside:
                inside = True
                continue
            break
        if inside:
            out.append(line.rstrip())
    return out


def color_for(text: str):
    stripped = text.strip()
    if stripped.startswith("MapForAll"):
        return ACCENT
    if stripped.startswith("("):
        return MUTED
    # Folder lines (contain a path ending with / before optional comment)
    core = stripped.lstrip("│├└─ ")
    token = core.split()[0] if core.split() else ""
    if token.endswith("/") or token.endswith("/…"):
        return GREEN
    if any(token.endswith(ext) for ext in (".tsx", ".ts", ".py", ".md", ".json", ".yaml", ".mjs", ".ino", ".h", ".css", ".sh", ".example")):
        return INK
    if "/" in token and not token.startswith("."):
        return GREEN
    return INK


def draw_page(chunk: list[str], index: int, total: int, intro: bool = False) -> Image.Image:
    img = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(img)
    draw.rectangle((0, 0, W, 8), fill=ACCENT)
    if intro:
        draw.text((MARGIN_X, 28), "MapForAll — Project structure", font=F_TITLE, fill=ACCENT)
        draw.text(
            (MARGIN_X, 64),
            "ConnectRwanda-style annotated tree  ·  node_modules / .venv / .next omitted",
            font=F_SUB,
            fill=MUTED,
        )
        y = 96
    else:
        draw.text((MARGIN_X, 28), "MapForAll — Project structure (continued)", font=F_TITLE, fill=INK)
        y = 70

    for raw in chunk:
        text = raw if raw.strip() else " "
        draw.text((MARGIN_X, y), text, font=F_MONO, fill=color_for(text))
        y += LINE

    draw.line((MARGIN_X, H - 42, W - MARGIN_X, H - 42), fill=RULE, width=1)
    draw.text((MARGIN_X, H - 34), "MapForAll / Hodari  ·  see also MapForAll_Project_Structure.md", font=F_SMALL, fill=MUTED)
    draw.text((W - MARGIN_X - 100, H - 34), f"Page {index}/{total}", font=F_SMALL, fill=MUTED)
    return img


def main() -> None:
    tree = extract_tree(MD.read_text(encoding="utf-8"))
    first_capacity = (H - 96 - MARGIN_BOTTOM) // LINE
    rest_capacity = (H - 70 - MARGIN_BOTTOM) // LINE
    pages_lines: list[list[str]] = [tree[:first_capacity]]
    rest = tree[first_capacity:]
    while rest:
        pages_lines.append(rest[:rest_capacity])
        rest = rest[rest_capacity:]

    images = [
        draw_page(chunk, i + 1, len(pages_lines), intro=(i == 0))
        for i, chunk in enumerate(pages_lines)
    ]
    first, *more = images
    try:
        first.save(OUT, "PDF", save_all=True, append_images=more, resolution=150.0)
        target = OUT
    except PermissionError:
        target = OUT.with_name("MapForAll_Project_Structure_v2.pdf")
        first.save(target, "PDF", save_all=True, append_images=more, resolution=150.0)
    print(target)
    print(f"pages={len(images)} lines={len(tree)}")


if __name__ == "__main__":
    main()
