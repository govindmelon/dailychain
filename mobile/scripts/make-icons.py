"""Draws the Android launcher icons for Kept: the chain of squares (two done, one open) on near-black.
Run:  python3 mobile/scripts/make-icons.py   (needs Pillow). The PNGs it writes are committed, so
building the APK does not need Python."""
import os
from PIL import Image, ImageDraw

RES = os.path.join(os.path.dirname(__file__), '..', 'android', 'app', 'src', 'main', 'res')
INK, PAPER = (17, 17, 17, 255), (250, 250, 250, 255)
SS = 4  # draw at 4x, then shrink, for clean edges

def glyph(w):
    """The chain on a transparent canvas of width w (height is w * 0.27)."""
    h = round(w * 0.27)
    im = Image.new('RGBA', (w * SS, h * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    u = w * SS / 355.0                      # the drawing is 355 units wide
    box = 95 * u                            # square size
    top = (h * SS - box) / 2
    xs = [0, 129 * u, 260 * u]
    pad = (255, 255, 255, 255)
    for i, x in enumerate(xs):
        if i < 2:
            d.rectangle([x, top, x + box, top + box], fill=pad)
        else:
            t = 7 * u                       # outline thickness
            d.rectangle([x, top, x + box, top + box], fill=pad)
            d.rectangle([x + t, top + t, x + box - t, top + box - t], fill=(0, 0, 0, 0))
    mid = top + box / 2
    for x in (95 * u, 224 * u):             # connectors
        d.rectangle([x, mid - 5 * u, x + 34 * u, mid + 5 * u], fill=pad)
    return im.resize((w, h), Image.LANCZOS)

def tint(im, rgba):
    out = Image.new('RGBA', im.size, rgba[:3] + (0,))
    out.putalpha(im.getchannel('A'))
    return out

def foreground(px):
    """Adaptive-icon foreground: 108dp canvas, glyph kept well inside the 66dp safe circle."""
    canvas = Image.new('RGBA', (px, px), (0, 0, 0, 0))
    g = tint(glyph(round(px * 0.50)), PAPER)
    canvas.alpha_composite(g, ((px - g.width) // 2, (px - g.height) // 2))
    return canvas

def legacy(px, round_):
    """Pre-Android-8 icon: the foreground over the ink background, masked to a rounded square or circle."""
    big = px * SS
    base = Image.new('RGBA', (big, big), INK)
    base.alpha_composite(tint(glyph(round(big * 0.62)), PAPER), ((big - round(big * 0.62)) // 2, (big - round(big * 0.62 * 0.27)) // 2))
    mask = Image.new('L', (big, big), 0)
    d = ImageDraw.Draw(mask)
    if round_:
        d.ellipse([0, 0, big - 1, big - 1], fill=255)
    else:
        d.rounded_rectangle([0, 0, big - 1, big - 1], radius=big * 0.18, fill=255)
    base.putalpha(mask)
    return base.resize((px, px), Image.LANCZOS)

DENS = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}
for name, k in DENS.items():
    d = os.path.join(RES, 'mipmap-' + name)
    os.makedirs(d, exist_ok=True)
    foreground(round(108 * k)).save(os.path.join(d, 'ic_launcher_foreground.png'))
    legacy(round(48 * k), False).save(os.path.join(d, 'ic_launcher.png'))
    legacy(round(48 * k), True).save(os.path.join(d, 'ic_launcher_round.png'))
print('icons written')
