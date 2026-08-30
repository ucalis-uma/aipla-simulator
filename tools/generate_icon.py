#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""アイプラ シミュレータ用のシンプルなアイコン（.ico / .png）を生成する。

Tauri の Windows ビルドに必要な icons/icon.ico を、外部依存なしで生成する
（32x32・単一イメージの BMP 形式 ICO。紫基調のグラデーション+「♪」風マークの代わりに
単純なビートノート風ドットを描く）。
"""
import struct
from pathlib import Path

SIZE = 64

def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))

def pixel(x, y):
    """(r, g, b) を返す。紫→青のグラデーション + 中央にノート風の白い円。"""
    c1, c2 = (59, 79, 158), (122, 95, 184)  # ヘッダーのグラデ色
    base = lerp(c1, c2, (x + y) / (2 * SIZE - 2))
    cx, cy = SIZE / 2, SIZE / 2
    d2 = (x - cx) ** 2 + (y - cy) ** 2
    if d2 < (SIZE * 0.30) ** 2:
        return (255, 255, 255)
    if d2 < (SIZE * 0.36) ** 2:
        return (240, 244, 255)
    return base

def build_bmp_rows():
    rows = []
    for y in range(SIZE - 1, -1, -1):  # BMP は下端から
        row = bytearray()
        for x in range(SIZE):
            r, g, b = pixel(x, y)
            row += bytes((b, g, r, 0xFF))  # BGRA
        rows.append(bytes(row))
    return b"".join(rows)

def build_ico(path):
    bmp_info_header = struct.pack(
        "<IiiHHIIiiII",
        40,           # biSize
        SIZE,         # biWidth
        SIZE * 2,     # biHeight（XOR+AND マスク込みで2倍）
        1,            # biPlanes
        32,           # biBitCount
        0,            # biCompression (BI_RGB)
        0,            # biSizeImage
        0, 0,         # biXPelsPerMeter, biYPelsPerMeter
        0,            # biClrUsed
        0,            # biClrImportant
    )
    xor = build_bmp_rows()
    and_mask_row = b"\x00\x00\x00\x00\x00\x00\x00\x00"  # 64bit = 8 bytes（不透明固定）
    and_mask = and_mask_row * SIZE
    image = bmp_info_header + xor + and_mask

    header = struct.pack(
        "<HHH", 0, 1, 1
    )  # ICONDIR: reserved=0, type=1(icon), count=1
    entry = struct.pack(
        "<BBBBHHII",
        SIZE % 256,   # width
        SIZE % 256,   # height
        0,            # color count
        0,            # reserved
        1,            # planes
        32,           # bit count
        len(image),   # bytes in resource
        6 + 16,       # offset（ICONDIR 6 + ICONDIRENTRY 16）
    )
    Path(path).write_bytes(header + entry + image)
    print(f"written: {path} ({6 + 16 + len(image)} bytes)")

def build_png(path):
    """無圧縮近辺の最小 PNG（zlib store）を自前生成する（UI 用ファビコン代替）。"""
    import zlib
    raw = bytearray()
    for y in range(SIZE):
        raw.append(0)  # filter none
        for x in range(SIZE):
            r, g, b = pixel(x, y)
            raw += bytes((r, g, b))
    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c))
    ihdr = struct.pack(">IIBBBBB", SIZE, SIZE, 8, 2, 0, 0, 0)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )
    Path(path).write_bytes(png)
    print(f"written: {path} ({len(png)} bytes)")

if __name__ == "__main__":
    out = Path(__file__).resolve().parent.parent / "src-tauri" / "icons"
    out.mkdir(parents=True, exist_ok=True)
    build_ico(out / "icon.ico")
    build_png(out / "icon.png")
