# Diagram 2: the bass eye patch at four stepovers, photo-real AND exact.
# Base = Gemini's maple photograph of the smooth (8%) simulated surface.
# Ridges = the simulation's own light map per stepover (draw_surface.mjs),
# multiplied in, so every ridge shown is a simulated one and nothing is
# invented. Labels drawn here, never generated.
import numpy as np
from PIL import Image, ImageDraw, ImageFont
D = r'D:/000 DIGITAL CHISEL WEBSITE/.mockups/blog-cnc-relief-stepover-guide/'
base = np.asarray(Image.open(D + 'ph8.jpg').convert('RGB').resize((1024, 1024), Image.LANCZOS)).astype(np.float32)
# the base photo already shows the 8% surface; take its own faint ridges out
# by dividing by the 8% map, then apply each stepover's map
m8 = np.asarray(Image.open(D + 'ridgemap_8.png').convert('L')).astype(np.float32) / 128.0
smooth = base / np.clip(m8, 0.4, 2.5)[..., None]
ROWS = [(8, '0.24 mm', '0.005 mm', '6.9 h'), (15, '0.45 mm', '0.017 mm', '3.7 h'), (25, '0.75 mm', '0.048 mm', '2.2 h'), (40, '1.20 mm', '0.125 mm', '1.4 h')]
T, G, TOP = 700, 40, 118
W = 2 * T + 3 * G
H = 150 + 2 * (T + TOP + G) - 10 + 120   # tiles end, then room for two footer lines
canvas = Image.new('RGB', (W, H), (250, 246, 239))
d = ImageDraw.Draw(canvas)
def font(name, size):
    for f in (name, 'arial.ttf'):
        try: return ImageFont.truetype(f, size)
        except OSError: pass
    return ImageFont.load_default()
serif, sans, sansb = font('georgia.ttf', 44), font('arial.ttf', 26), font('arialbd.ttf', 26)
d.text((G, 22), 'The same 3 mm finish at four stepovers', font=font('georgia.ttf', 54), fill=(46, 29, 16))
d.text((G, 92), 'The eye and gill of the leaping bass, 46 mm across, straight off the machine before any sanding.', font=sans, fill=(109, 85, 64))
for i, (pct, s, h, t) in enumerate(ROWS):
    m = np.asarray(Image.open(D + f'ridgemap_{pct}.png').convert('L')).astype(np.float32) / 128.0
    img = np.clip(smooth * m[..., None], 0, 255).astype(np.uint8)
    tile = Image.fromarray(img).resize((T, T), Image.LANCZOS)
    x, y = G + (i % 2) * (T + G), 150 + (i // 2) * (T + TOP + G)
    d.text((x, y + 6), f'{pct}% stepover', font=serif, fill=(46, 29, 16))
    d.text((x, y + 62), f'passes {s} apart  ·  ridges {h}  ·  finish {t}', font=sansb, fill=(10, 139, 176))
    canvas.paste(tile, (x, y + TOP - 10))
d.text((G, H - 86), 'Ridges simulated from the real STL (3 mm ball, 300 mm panel); photographic material from a Gemini render of the same surface.', font=font('arial.ttf', 22), fill=(138, 117, 96))
d.text((G, H - 50), 'Finishing times: mid-size hobby CNC. 220 grit removes about 0.05 mm, so it takes 8% to 25% off; 40% leaves real work.', font=font('arial.ttf', 22), fill=(138, 117, 96))
canvas.save(D + 'surfaces.jpg', quality=90)
print('wrote surfaces.jpg', canvas.size)
