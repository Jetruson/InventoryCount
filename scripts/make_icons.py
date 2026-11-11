import os
import zlib
import struct

def make_png(width, height, draw_fn, output_path):
    # RGBA raw data
    raw_data = bytearray()
    for y in range(height):
        raw_data.append(0) # Filter type 0 (None)
        for x in range(width):
            r, g, b, a = draw_fn(x, y, width, height)
            raw_data.extend([r, g, b, a])
    
    compressed = zlib.compress(bytes(raw_data), 9)
    
    def chunk(tag, data):
        length = struct.pack(">I", len(data))
        crc = struct.pack(">I", zlib.crc32(tag + data) & 0xffffffff)
        return length + tag + data + crc
    
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    
    png_bytes = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", compressed) + chunk(b"IEND", b"")
    
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "wb") as f:
        f.write(png_bytes)
    print(f"Generated {output_path} ({width}x{height})")

def icon_drawer(is_maskable=False):
    def draw(x, y, w, h):
        # Base background: deep slate #0f172a
        bg = (15, 23, 42, 255)
        
        # Center coordinates
        cx = w / 2.0
        cy = h / 2.0
        
        # Safe scale
        scale = 0.55 if is_maskable else 0.70
        sz = min(w, h) * scale
        
        left = cx - sz / 2.0
        right = cx + sz / 2.0
        top = cy - sz / 2.0
        bottom = cy + sz / 2.0
        
        # Rounded box / barcode area
        in_area = (left <= x <= right) and (top <= y <= bottom)
        
        if not in_area:
            return bg
        
        # Draw barcode vertical stripes + scanner beam
        norm_x = (x - left) / sz
        norm_y = (y - top) / sz
        
        # Green scanner line across middle
        if 0.46 <= norm_y <= 0.54:
            # Bright emerald glow #10b981
            return (16, 185, 129, 255)
        
        # Barcode vertical stripes (binary pattern)
        pattern = [1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 1, 1, 0, 0, 1, 0, 1]
        idx = int(norm_x * len(pattern))
        idx = max(0, min(len(pattern) - 1, idx))
        
        if pattern[idx] == 1:
            # White bar
            return (248, 250, 252, 255)
        else:
            # Dark slate space
            return (30, 41, 59, 255)

    return draw

make_png(192, 192, icon_drawer(False), "public/pwa-192x192.png")
make_png(512, 512, icon_drawer(False), "public/pwa-512x512.png")
make_png(512, 512, icon_drawer(True), "public/pwa-maskable-512x512.png")
make_png(180, 180, icon_drawer(False), "public/apple-touch-icon.png")
