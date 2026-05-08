#!/usr/bin/env python3
"""
Split UITexture/Tilesets.png into individual images
based on config/Tilesets.atlas, preserving directory structure.

LibGDX atlas rotate:true means the sprite was rotated 90° clockwise
before packing; we rotate it back 90° counter-clockwise when exporting.
"""

import re
from pathlib import Path
from PIL import Image

ATLAS_PATH = Path('config/Tilesets.atlas')
IMAGE_PATH = Path('UITexture/Tilesets.png')
OUT_DIR    = Path('UITexture/Tilesets')


def parse_atlas(text):
    """Yield (name, x, y, w, h, rotated, orig_w, orig_h, off_x, off_y) per sprite."""
    lines = text.splitlines()
    i = 0

    # Skip blank lines before header
    while i < len(lines) and lines[i].strip() == '':
        i += 1

    # Skip page header (image filename + meta key:value lines)
    i += 1  # image filename
    while i < len(lines) and lines[i].strip() != '':
        if not re.match(r'^\w+:', lines[i].strip()):
            break  # reached first sprite name
        i += 1

    while i < len(lines):
        # Skip blank lines
        while i < len(lines) and lines[i].strip() == '':
            i += 1
        if i >= len(lines):
            break

        line = lines[i]

        # Non-indented line → sprite name or new page header
        if not (line.startswith(' ') or line.startswith('\t')):
            name = line.strip()
            # Peek: if next non-blank is a page meta line, skip the page header
            j = i + 1
            while j < len(lines) and lines[j].strip() == '':
                j += 1
            if j < len(lines) and re.match(r'^(size|format|filter|repeat):', lines[j].strip()):
                i = j
                while i < len(lines) and (lines[i].strip() == '' or
                      re.match(r'^(size|format|filter|repeat):', lines[i].strip())):
                    i += 1
                continue
            i += 1
        else:
            i += 1
            continue

        # Read indented attributes
        kv = {}
        while i < len(lines) and (lines[i].startswith(' ') or lines[i].startswith('\t')):
            m = re.match(r'^\s+(\w+):\s*(.+)', lines[i])
            if m:
                kv[m.group(1)] = m.group(2).strip()
            i += 1

        if not kv:
            continue

        rotated = kv.get('rotate', 'false').lower() == 'true'

        xy   = re.match(r'(\d+),\s*(\d+)', kv.get('xy',   '0,0'))
        sz   = re.match(r'(\d+),\s*(\d+)', kv.get('size', '0,0'))
        orig = re.match(r'(\d+),\s*(\d+)', kv.get('orig', '0,0'))
        off  = re.match(r'(\d+),\s*(\d+)', kv.get('offset', '0,0'))

        x,  y  = (int(xy.group(1)),   int(xy.group(2)))   if xy   else (0, 0)
        sw, sh = (int(sz.group(1)),   int(sz.group(2)))   if sz   else (0, 0)
        ow, oh = (int(orig.group(1)), int(orig.group(2))) if orig else (sw, sh)
        ox, oy = (int(off.group(1)),  int(off.group(2)))  if off  else (0,  0)

        yield name, x, y, sw, sh, rotated, ow, oh, ox, oy


def main():
    print(f'Loading {IMAGE_PATH} …')
    src = Image.open(IMAGE_PATH)

    atlas_text = ATLAS_PATH.read_text(encoding='utf-8')
    sprites = list(parse_atlas(atlas_text))
    print(f'Parsed {len(sprites)} sprites from atlas')

    seen = {}   # name → count, for dedup
    saved = 0
    skipped = 0

    for name, x, y, sw, sh, rotated, ow, oh, ox, oy in sprites:
        # Deduplicate: same name may appear for multiple tilesets pointing to same region
        if name in seen:
            seen[name] += 1
            out_name = f'{name}_{seen[name]}'
        else:
            seen[name] = 1
            out_name = name

        # Output path: sprite name "/" → subdirectory
        out_path = OUT_DIR / (out_name + '.png')
        out_path.parent.mkdir(parents=True, exist_ok=True)

        # Crop from atlas (sw×sh is the packed size)
        crop = src.crop((x, y, x + sw, y + sh))

        # Undo rotation: LibGDX rotates 90° CW to pack → rotate 90° CCW to restore
        if rotated:
            crop = crop.rotate(90, expand=True)
            # After CCW rotation, sw/sh are swapped back to original sh×sw
            # (orig dimensions are ow×oh before trimming)

        # If trimmed, paste into full original canvas
        if ow != crop.width or oh != crop.height:
            # oy in LibGDX is from bottom-left → convert to top-left
            top = oh - crop.height - oy
            canvas = Image.new('RGBA', (ow, oh), (0, 0, 0, 0))
            canvas.paste(crop, (ox, top))
            crop = canvas

        crop.save(out_path, 'PNG')
        saved += 1

    print(f'Done: {saved} images saved to {OUT_DIR}/')
    print(f'      {skipped} skipped')


if __name__ == '__main__':
    main()
