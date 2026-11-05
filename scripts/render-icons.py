"""Render the SVG master. Requires Python 3 and CairoSVG (pip install cairosvg)."""
from pathlib import Path
import cairosvg

public = Path(__file__).resolve().parent.parent / "public"
source = (public / "icon.svg").read_text()
for size in (180, 192, 512):
    cairosvg.svg2png(bytestring=source.encode(), write_to=str(public / f"icon-{size}.png"),
                    output_width=size, output_height=size)

# OS launchers supply their own mask; give them a full-bleed background.
maskable = source.replace('rx="112" fill="url(#surface)"', 'rx="0" fill="url(#surface)"')
maskable = "\n".join(line for line in maskable.splitlines() if 'stroke="url(#edge)"' not in line)
cairosvg.svg2png(bytestring=maskable.encode(), write_to=str(public / "icon-maskable-512.png"),
                output_width=512, output_height=512)
