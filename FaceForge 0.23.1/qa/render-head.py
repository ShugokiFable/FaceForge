"""Renders the neutral Skyrim head -- the CharGen .tri base vertices, before any morph is
applied -- to a front orthographic PNG, so the same detector and the same measurement code that
read a photograph can read the head FaceForge compares that photograph against.

One-off calibration tool, not part of the build. Needs Python with numpy and Pillow.

    python qa/render-head.py <out.png> <head.tri> [eyes.tri] [brows.tri]

Head parts matter more than they look. A bare head has no eyeballs, so the lid contours read as
closed eyes and the pipeline correctly fades every eye measurement toward neutral -- which would
have made those "baselines" circular, since the neutral it fades to IS the baseline. The eye and
brow meshes are the ones the head actually wears in game, so compositing them measures the head as
the player sees it.

Iris size is deliberately NOT calibrated from this render. The eyeball's frontmost cap is shaded
dark so the eye reads as open, but the real iris is drawn by the eye texture, which varies per eye
mod. Geometry cannot answer it.
"""
import json
import struct
import sys

import numpy as np
from PIL import Image

SKIN = np.array([0.85, 0.70, 0.62])
SCLERA = np.array([0.93, 0.92, 0.90])
IRIS = np.array([0.16, 0.13, 0.11])
SIZE = 1024


def read_tri(path, morphs=False):
    """FRTRI003: see FaceForge.Core/TriFile.cs for the verified layout."""
    data = open(path, "rb").read()
    if data[:8] != b"FRTRI003":
        raise ValueError(f"Not a FRTRI003 file: {path}")
    vertex_count, triangle_count = struct.unpack_from("<II", data, 8)
    uv_count, flags, morph_count = struct.unpack_from("<I", data, 28)[0], \
        struct.unpack_from("<I", data, 32)[0], struct.unpack_from("<I", data, 36)[0]
    offset = 64
    verts = np.frombuffer(data, "<f4", vertex_count * 3, offset).reshape(-1, 3)
    offset += vertex_count * 12
    tris = np.frombuffer(data, "<u4", triangle_count * 3, offset).reshape(-1, 3).astype(np.int64)
    if not morphs:
        return verts.copy(), tris

    offset += triangle_count * 12
    if flags & 1:
        offset += uv_count * 8 + triangle_count * 12
    named = {}
    for _ in range(morph_count):
        name_length = struct.unpack_from("<I", data, offset)[0]
        offset += 4
        # The length counts the trailing NUL; dropping that shifts every later delta into garbage.
        name = data[offset:offset + name_length].rstrip(b"\0").decode("ascii")
        offset += name_length
        multiplier = struct.unpack_from("<f", data, offset)[0]
        offset += 4
        deltas = np.frombuffer(data, "<i2", vertex_count * 3, offset).reshape(-1, 3)
        offset += vertex_count * 6
        named[name] = deltas.astype(np.float32) * multiplier
    if offset != len(data):
        raise ValueError(f"Parsed {offset} of {len(data)} bytes in {path}")
    return verts.copy(), tris, named


def part_colors(verts, tris, base):
    return np.tile(base, (len(tris), 1))


def pitch(verts, degrees):
    """Rotates the head about its left-right axis.

    A front orthographic render is not automatically a zero-nod face. The pipeline reads 5-13
    degrees of nod on these meshes and un-foreshortens heights by up to 2.5% to compensate -- a
    correction it would not apply to a photograph of someone facing the camera. Left uncorrected,
    that difference is baked into every height baseline. The pitch here is chosen per head so the
    pipeline reports roughly zero nod, which is what makes the two sides comparable.
    """
    angle = np.radians(degrees)
    cos, sin = np.cos(angle), np.sin(angle)
    rotated = verts.copy()
    rotated[:, 1] = verts[:, 1] * cos - verts[:, 2] * sin
    rotated[:, 2] = verts[:, 1] * sin + verts[:, 2] * cos
    return rotated


def draw_irises(image, mask, sx, sy, eye_range):
    """Paints an iris onto whatever of each eyeball is visible between the lids.

    In game the eyeball is a plain sphere and the iris is drawn by the eye texture, so geometry
    alone renders as a blank white slit that the detector reads as a closed eye -- and a closed eye
    makes the pipeline fade every eye measurement toward the very baseline being calibrated. The
    disc restores what the texture would draw. Its radius is a rendering choice, which is exactly
    why irisSize is not calibrated from these renders.
    """
    start, stop = eye_range
    xs, ys = sx[start:stop], sy[start:stop]
    middle = (xs.min() + xs.max()) / 2
    for side in (xs < middle, xs >= middle):
        if not side.any():
            continue
        cx, cy = xs[side].mean(), ys[side].mean()
        radius = (xs[side].max() - xs[side].min()) * 0.26
        yy, xx = np.mgrid[0:image.shape[0], 0:image.shape[1]]
        disc = ((xx - cx) ** 2 + (yy - cy) ** 2) <= radius ** 2
        image[disc & mask] = IRIS


def render(parts, out, eye_part=None, size=SIZE):
    offsets = np.cumsum([0] + [len(part[0]) for part in parts[:-1]])
    verts = np.concatenate([part[0] for part in parts])
    tris = np.concatenate([part[1] + offset for part, offset in zip(parts, offsets)])
    colors = np.concatenate([part[2] for part in parts])
    face_part = np.concatenate([np.full(len(part[1]), index) for index, part in enumerate(parts)])

    # The head alone sets the framing, so adding eyes or brows cannot change the scale and make
    # two renders incomparable.
    head = parts[0][0]
    low, high = head.min(0), head.max(0)
    center = (low + high) / 2
    scale = size * 0.8 / max(high[0] - low[0], high[2] - low[2])
    sx = (verts[:, 0] - center[0]) * scale + size / 2
    sy = -(verts[:, 2] - center[2]) * scale + size / 2
    depth = verts[:, 1]

    image = np.zeros((size, size, 3), np.float32)
    zbuffer = np.full((size, size), -1e9, np.float32)
    owner = np.full((size, size), -1, np.int32)

    corners = verts[tris]
    normals = np.cross(corners[:, 1] - corners[:, 0], corners[:, 2] - corners[:, 0])
    normals /= np.maximum(np.linalg.norm(normals, axis=1, keepdims=True), 1e-9)
    light = np.array([0.0, 1.0, 0.3])
    light /= np.linalg.norm(light)
    shade = np.clip(normals @ light, 0, 1) * 0.8 + 0.2

    # Back faces are culled rather than depth-tested away. An eyeball sits inside its socket, so
    # its rear hemisphere pokes through the lid slit as stray light-coloured quads that the
    # detector reads as part of the eye.
    facing = normals[:, 1] > 0

    for face, tri in enumerate(tris):
        if not facing[face]:
            continue
        xs, ys, ds = sx[tri], sy[tri], depth[tri]
        x0, x1 = int(max(0, np.floor(xs.min()))), int(min(size - 1, np.ceil(xs.max())))
        y0, y1 = int(max(0, np.floor(ys.min()))), int(min(size - 1, np.ceil(ys.max())))
        if x1 < x0 or y1 < y0:
            continue
        area = (ys[1] - ys[2]) * (xs[0] - xs[2]) + (xs[2] - xs[1]) * (ys[0] - ys[2])
        if abs(area) < 1e-9:
            continue
        yy, xx = np.mgrid[y0:y1 + 1, x0:x1 + 1]
        w0 = ((ys[1] - ys[2]) * (xx - xs[2]) + (xs[2] - xs[1]) * (yy - ys[2])) / area
        w1 = ((ys[2] - ys[0]) * (xx - xs[2]) + (xs[0] - xs[2]) * (yy - ys[2])) / area
        w2 = 1 - w0 - w1
        inside = (w0 >= 0) & (w1 >= 0) & (w2 >= 0)
        if not inside.any():
            continue
        z = w0 * ds[0] + w1 * ds[1] + w2 * ds[2]
        window = zbuffer[y0:y1 + 1, x0:x1 + 1]
        hit = inside & (z > window)
        window[hit] = z[hit]
        image[y0:y1 + 1, x0:x1 + 1][hit] = colors[face] * shade[face]
        owner[y0:y1 + 1, x0:x1 + 1][hit] = face_part[face]

    if eye_part is not None:
        start = int(offsets[eye_part])
        draw_irises(image, owner == eye_part, sx, sy, (start, start + len(parts[eye_part][0])))

    Image.fromarray((np.clip(image, 0, 1) * 255).astype(np.uint8)).save(out)


def render_head(out, head_path, eye_path=None, degrees=0.0):
    head_v, head_t = read_tri(head_path)
    parts = [(pitch(head_v, degrees), head_t, part_colors(head_v, head_t, SKIN))]
    eye_part = None
    if eye_path:
        eye_v, eye_t = read_tri(eye_path)
        eye_part = len(parts)
        parts.append((pitch(eye_v, degrees), eye_t, part_colors(eye_v, eye_t, SCLERA)))
    render(parts, out, eye_part=eye_part)
    print(f"{out}: {sum(len(part[0]) for part in parts)} verts, pitch {degrees:+.1f}")


# The four heads FaceForge calibrates against, and the pitch each one needs so the pipeline reads
# it as facing the camera. The pitch values were found by rendering, measuring, and repeating until
# the reported nod fell under a degree; they are properties of these meshes, not free parameters.
CANONICAL = [
    ("vanilla_female.png", "actors/character/character assets/FemaleHeadChargen.tri",
     "actors/character/character assets/EyesFemaleChargen.tri", 10.3),
    ("hph_female.png", "KL/High Poly Head/femaleheadchargen.tri",
     "actors/character/character assets/EyesFemaleChargen.tri", 8.3),
    ("vanilla_male.png", "actors/character/character assets/MaleHeadCustomizations.tri",
     "actors/character/character assets/EyesMaleChargen.tri", 4.2),
    ("hph_male.png", "KL/High Poly Head/maleheadcustomizations.tri",
     "actors/character/character assets/EyesMaleChargen.tri", 4.6)
]

# Skyrim's playable races share one head mesh. What makes a Nord head a Nord head is a named morph
# in <sex>HeadRaces.tri -- BretonRace, NordRace, RedguardRace and the rest -- applied on top of the
# same base vertices the CharGen sliders move. So a race's real starting head can be rendered and
# measured exactly like the neutral one, instead of being estimated from prose.
RACES = [
    "BretonRace", "DarkElfRace", "ElderRace", "HighElfRace", "ImperialRace",
    "NordRace", "OrcRace", "RedguardRace", "WoodElfRace"
]

SEXES = {
    # sex: (head tri, race-morph tri, eye tri, pitch that reads as zero nod)
    "female": ("FemaleHeadChargen.tri", "FemaleHeadRaces.tri", "EyesFemaleChargen.tri", 10.3),
    "male": ("MaleHeadCustomizations.tri", "MaleHeadRaces.tri", "EyesMaleChargen.tri", 4.2)
}


def render_races(meshes, out_dir):
    assets = f"{meshes}/actors/character/character assets"
    manifest = []
    for sex, (head_file, races_file, eye_file, degrees) in SEXES.items():
        head_v, head_t = read_tri(f"{assets}/{head_file}")
        _, _, race_morphs = read_tri(f"{assets}/{races_file}", morphs=True)
        eye_v, eye_t = read_tri(f"{assets}/{eye_file}")
        for race in ["Neutral"] + RACES:
            if race != "Neutral" and race not in race_morphs:
                print(f"  skipped {race}: no morph in {races_file}")
                continue
            shaped = head_v if race == "Neutral" else head_v + race_morphs[race]
            parts = [
                (pitch(shaped, degrees), head_t, part_colors(shaped, head_t, SKIN)),
                (pitch(eye_v, degrees), eye_t, part_colors(eye_v, eye_t, SCLERA))
            ]
            name = f"race_{sex}_{race}.png"
            render(parts, f"{out_dir}/{name}", eye_part=1)
            manifest.append({"id": f"{sex}:{race}", "sex": sex, "race": race, "file": name})
            print(f"  {name}")
    with open(f"{out_dir}/races.json", "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, indent=2)


if __name__ == "__main__":
    if sys.argv[1] == "--races":
        render_races(sys.argv[2], sys.argv[3])
        raise SystemExit(0)
    if sys.argv[1] == "--all":
        meshes, out_dir = sys.argv[2], sys.argv[3]
        offset = float(sys.argv[4]) if len(sys.argv) > 4 else 0.0
        for name, head, eyes, degrees in CANONICAL:
            render_head(f"{out_dir}/{name}", f"{meshes}/{head}", f"{meshes}/{eyes}", degrees + offset)
    else:
        render_head(
            sys.argv[1],
            sys.argv[2],
            sys.argv[3] if len(sys.argv) > 3 else None,
            float(sys.argv[4]) if len(sys.argv) > 4 else 0.0
        )
