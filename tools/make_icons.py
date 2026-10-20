"""Draw the extension's toolbar icons (the same mark as shared/ui.js)."""
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "extension" / "icons"
AMBER, INK, WHITE = (245, 165, 36, 255), (29, 20, 0, 255), (255, 255, 255, 255)


def draw(size):
    s = 8  # supersample, then shrink for smooth edges
    big = size * s
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    u = big / 24  # the SVG's 24-unit grid

    def rect(x, y, w, h, r, fill):
        d.rounded_rectangle([x * u, y * u, (x + w) * u, (y + h) * u], radius=r * u, fill=fill)

    rect(1, 1, 22, 22, 6, AMBER)
    rect(4.5, 6, 9, 3, 1.5, INK)
    rect(9, 10.5, 10.5, 3, 1.5, INK[:3] + (191,))
    rect(4.5, 15, 6, 3, 1.5, INK[:3] + (128,))
    rect(11.4, 3.5, 1.6, 17, 0.8, WHITE)
    return img.resize((size, size), Image.LANCZOS)


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for size in (16, 32, 48, 128):
        draw(size).save(OUT / f"icon{size}.png")
    print("wrote", sorted(p.name for p in OUT.glob("*.png")))
