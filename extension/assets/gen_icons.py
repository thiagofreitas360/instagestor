#!/usr/bin/env python3
"""
Gera ícones PNG para a extensão InstaZip usando apenas Python puro (sem PIL).
Paleta: gradiente vermelho (#ff000e) → roxo (#6D28D9) — identidade do Auto Insta SaaS.
"""
import struct, zlib, math, os

def make_png(size):
    w, h = size, size
    # Pixel data (RGBA) — construir gradiente diagonal + ícone de download simplificado
    pixels = []
    cx, cy = w / 2, h / 2
    r1 = (0xff, 0x00, 0x0e)  # vermelho primário
    r2 = (0x6D, 0x28, 0xD9)  # roxo secundário

    for y in range(h):
        row = []
        for x in range(w):
            # Gradiente diagonal 0→1
            t = (x / (w - 1) + y / (h - 1)) / 2

            # Interpolar cor
            cr = int(r1[0] + (r2[0] - r1[0]) * t)
            cg = int(r1[1] + (r2[1] - r1[1]) * t)
            cb = int(r1[2] + (r2[2] - r1[2]) * t)

            # Fundo: gradiente sólido dentro de círculo arredondado
            rx = x - cx
            ry = y - cy
            corner_r = w * 0.22  # border-radius proporcional
            # Arredondar cantos
            ax = max(abs(rx) - (w / 2 - corner_r), 0)
            ay = max(abs(ry) - (h / 2 - corner_r), 0)
            dist_corner = math.sqrt(ax * ax + ay * ay)
            in_bg = dist_corner <= corner_r

            if not in_bg:
                row += [0, 0, 0, 0]  # transparente
                continue

            # Anti-alias suave na borda
            aa = max(0, min(1, corner_r - dist_corner))
            alpha_bg = int(255 * min(1, aa * 4))

            # Ícone de seta para baixo no centro
            # Linha vertical
            lw = max(1, w // 10)
            line_x = (cx - lw / 2) <= x <= (cx + lw / 2)
            line_y = (cy - h * 0.25) <= y <= (cy + h * 0.05)
            # Ponta da seta (V)
            tip_y = cy + h * 0.22
            half_arrow = w * 0.28
            # linha diagonal esquerda
            slope_l = (tip_y - (cy + h * 0.05)) / (cx - (cx - half_arrow))
            # linha diagonal direita
            slope_r = (tip_y - (cy + h * 0.05)) / ((cx + half_arrow) - cx)
            in_arrow_left  = (x <= cx) and (y >= (cy + h * 0.05)) and (y <= tip_y) and \
                             abs(y - (cy + h * 0.05 + slope_l * (cx - x))) < lw * 1.5
            in_arrow_right = (x >= cx) and (y >= (cy + h * 0.05)) and (y <= tip_y) and \
                             abs(y - (cy + h * 0.05 + slope_r * (x - cx))) < lw * 1.5
            # Linha horizontal (base da seta)
            base_y = tip_y + lw * 1.4
            in_base = abs(y - base_y) < lw and (cx - half_arrow) <= x <= (cx + half_arrow)

            in_icon = (line_x and line_y) or in_arrow_left or in_arrow_right or in_base

            if in_icon:
                row += [255, 255, 255, alpha_bg]
            else:
                row += [cr, cg, cb, alpha_bg]
        pixels.append(row)

    # Construir dados PNG raw
    raw = b''
    for row in pixels:
        raw += b'\x00'  # filter type none
        for i in range(0, len(row), 4):
            raw += bytes(row[i:i+4])

    # Comprimir
    compressed = zlib.compress(raw, 9)

    def chunk(name, data):
        c = name + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)

    sig   = b'\x89PNG\r\n\x1a\n'
    ihdr  = chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2 | 4, 0, 0, 0))  # bit depth 8, RGBA=6
    # color type 6 = RGBA
    ihdr  = chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
    idat  = chunk(b'IDAT', compressed)
    iend  = chunk(b'IEND', b'')

    return sig + ihdr + idat + iend

out_dir = os.path.dirname(os.path.abspath(__file__))

for size in [16, 48, 128]:
    data = make_png(size)
    path = os.path.join(out_dir, f'icon{size}.png')
    with open(path, 'wb') as f:
        f.write(data)
    print(f'Gerado: {path} ({len(data)} bytes)')

print('Ícones gerados com sucesso.')
