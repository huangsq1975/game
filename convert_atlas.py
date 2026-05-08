#!/usr/bin/env python3
"""Convert LibGDX .atlas format to Free Texture Packer JSON (JSON Hash)."""

import json, sys, re
from pathlib import Path

def parse_atlas(text):
    lines = text.splitlines()
    i = 0

    # Skip leading blank lines
    while i < len(lines) and lines[i].strip() == '':
        i += 1

    # Header
    image_file = lines[i].strip(); i += 1
    meta_kv = {}
    while i < len(lines) and lines[i].strip() != '':
        m = re.match(r'^(\w+):\s*(.+)', lines[i].strip())
        if m:
            meta_kv[m.group(1)] = m.group(2)
            i += 1
        else:
            break  # reached first sprite name, stop reading meta

    size_match = re.match(r'(\d+),\s*(\d+)', meta_kv.get('size', '0,0'))
    atlas_w, atlas_h = (int(size_match.group(1)), int(size_match.group(2))) if size_match else (0, 0)

    frames = {}

    while i < len(lines):
        # Sprite name: non-empty, no leading space
        while i < len(lines) and lines[i].strip() == '':
            i += 1
        if i >= len(lines):
            break

        # If line has no leading whitespace it's a new page header — skip it
        if not lines[i].startswith(' ') and not lines[i].startswith('\t'):
            # Could be a second image page header
            name_line = lines[i].strip()
            # Peek: if next non-empty line is "size:" it's a page header
            j = i + 1
            while j < len(lines) and lines[j].strip() == '':
                j += 1
            if j < len(lines) and lines[j].strip().startswith('size:'):
                # Skip page header block
                i = j
                while i < len(lines) and (lines[i].strip() == '' or
                      re.match(r'^(size|format|filter|repeat):', lines[i].strip())):
                    i += 1
                continue
            # Otherwise it's a sprite name
            sprite_name = name_line
            i += 1
        else:
            i += 1
            continue

        # Read indented key-value pairs for this sprite
        kv = {}
        while i < len(lines) and (lines[i].startswith(' ') or lines[i].startswith('\t')):
            m = re.match(r'^\s+(\w+):\s*(.+)', lines[i])
            if m:
                kv[m.group(1)] = m.group(2)
            i += 1

        if not kv:
            continue

        rotated = kv.get('rotate', 'false').strip().lower() == 'true'

        xy_m = re.match(r'(\d+),\s*(\d+)', kv.get('xy', '0,0'))
        x, y = (int(xy_m.group(1)), int(xy_m.group(2))) if xy_m else (0, 0)

        sz_m = re.match(r'(\d+),\s*(\d+)', kv.get('size', '0,0'))
        sw, sh = (int(sz_m.group(1)), int(sz_m.group(2))) if sz_m else (0, 0)

        or_m = re.match(r'(\d+),\s*(\d+)', kv.get('orig', f'{sw},{sh}'))
        ow, oh = (int(or_m.group(1)), int(or_m.group(2))) if or_m else (sw, sh)

        of_m = re.match(r'(\d+),\s*(\d+)', kv.get('offset', '0,0'))
        # LibGDX offset is bottom-left; convert to top-left
        off_x_raw = int(of_m.group(1)) if of_m else 0
        off_y_raw = int(of_m.group(2)) if of_m else 0
        # top-left offset: ox = off_x_raw, oy = oh - sh - off_y_raw  (when not rotated)
        if rotated:
            off_x = off_x_raw
            off_y = oh - sw - off_y_raw
            frame_w, frame_h = sh, sw   # swapped in atlas
        else:
            off_x = off_x_raw
            off_y = oh - sh - off_y_raw
            frame_w, frame_h = sw, sh

        trimmed = (ow != sw or oh != sh)

        # Deduplicate: if name already seen, append suffix
        key = sprite_name
        if key in frames:
            suffix = 2
            while f'{key}_{suffix}' in frames:
                suffix += 1
            key = f'{key}_{suffix}'

        frames[key] = {
            "frame":           {"x": x,     "y": y,     "w": frame_w, "h": frame_h},
            "rotated":         rotated,
            "trimmed":         trimmed,
            "spriteSourceSize":{"x": off_x, "y": off_y, "w": sw,      "h": sh},
            "sourceSize":      {"w": ow,    "h": oh},
        }

    return image_file, atlas_w, atlas_h, meta_kv.get('format', 'RGBA8888'), frames


def main():
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('config/Tilesets.atlas')
    dst = Path(sys.argv[2]) if len(sys.argv) > 2 else src.with_suffix('.json')

    text = src.read_text(encoding='utf-8')
    image_file, atlas_w, atlas_h, fmt, frames = parse_atlas(text)

    out = {
        "meta": {
            "app":     "Free Texture Packer",
            "version": "0.6.7",
            "image":   image_file,
            "format":  fmt,
            "size":    {"w": atlas_w, "h": atlas_h},
            "scale":   1,
        },
        "frames": frames,
    }

    dst.write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding='utf-8')
    print(f"Converted {len(frames)} sprites → {dst}")


if __name__ == '__main__':
    main()
