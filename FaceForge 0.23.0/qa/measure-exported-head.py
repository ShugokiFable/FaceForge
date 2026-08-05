"""Measures what RaceMenu's Export Head actually bakes into a FaceGeom NIF.

    python qa/measure-exported-head.py <exported.nif> <chargen.tri>

The question this answers: when a preset's shape lives entirely in sliders and the jslot carries no
sculpt data, does the exported head still contain that shape? A follower is built from the exported
mesh, so if Export Head only baked the vanilla 18 face sliders, everything an EFM or CME slider
contributed would be lost on the way out.

Method. Read the head's vertices out of the NIF, subtract the chargen base mesh, and ask how much of
the remaining displacement the base mesh's OWN morphs can account for. The vanilla morph set comes
in opposed pairs (NoseUp/NoseDown), so each pair is one bounded variable in [-1, 1] rather than two
free ones -- an unconstrained fit puts +6978 on CheeksUp and -6976 on CheeksDown and "explains"
anything. The numbered EyesType/NoseType/LipType shapes are separate variables in [0, 1].

Whatever the fit cannot reach is displacement that came from somewhere other than the base morphs.

Measured 2026-08-05 against High Poly Head (3832 vertices):

    Inoue.nif                        41.4% explained   (FaceForge preset, no sculpt in the jslot)
    Woo-Female-Imperial_Silvia.nif   42.1% explained   (hand-made in RaceMenu, 944 sculpt rows)

Both leave most of their shape outside the vanilla set, and they leave about the SAME amount, so
Export Head bakes extension morphs and sculpt alike into the vertices. The exported head is not
flat; the jslot beside it is.

Needs numpy and scipy. Not part of the build.
"""
import struct
import sys

import numpy as np
from scipy.optimize import lsq_linear

# The 18 opposed pairs of the vanilla chargen set. RaceMenu writes their values as
# morphs.default.morphs; the 19th slot is a FLT_MAX terminator, not a slider.
PAIRS = [
    ("BrowUp", "BrowDown"), ("BrowIn", "BrowOut"), ("BrowForward", "BrowBack"),
    ("CheeksUp", "CheeksDown"), ("CheeksIn", "CheeksOut"),
    ("ChinMoveUp", "ChinMoveDown"), ("ChinWide", "ChinThin"),
    ("EyesForward", "EyesBack"), ("EyesMoveUp", "EyesMoveDown"),
    ("EyesMoveIn", "EyesMoveOut"), ("JawUp", "JawDown"), ("JawForward", "JawBack"),
    ("JawWide", "JawNarrow"), ("LipMoveUp", "LipMoveDown"), ("LipMoveIn", "LipMoveOut"),
    ("NoseUp", "NoseDown"), ("NoseLong", "NoseShort"), ("Overbite", "Underbite"),
]


def read_tri(path):
    """FRTRI003: see FaceForge.Core/TriFile.cs for the verified layout."""
    data = open(path, "rb").read()
    if data[:8] != b"FRTRI003":
        raise ValueError(f"Not a FRTRI003 file: {path}")
    vertex_count, triangle_count = struct.unpack_from("<II", data, 8)
    uv_count = struct.unpack_from("<I", data, 28)[0]
    flags = struct.unpack_from("<I", data, 32)[0]
    morph_count = struct.unpack_from("<I", data, 36)[0]
    offset = 64
    verts = np.frombuffer(data, "<f4", vertex_count * 3, offset).reshape(-1, 3).astype(np.float64)
    offset += vertex_count * 12 + triangle_count * 12
    if flags & 1:
        offset += uv_count * 8 + triangle_count * 12
    morphs = {}
    for _ in range(morph_count):
        length = struct.unpack_from("<I", data, offset)[0]
        offset += 4
        # The length counts the trailing NUL; dropping it shifts every later delta into garbage.
        name = data[offset:offset + length].rstrip(b"\0").decode("ascii")
        offset += length
        multiplier = struct.unpack_from("<f", data, offset)[0]
        offset += 4
        deltas = np.frombuffer(data, "<i2", vertex_count * 3, offset).reshape(-1, 3)
        offset += vertex_count * 6
        morphs[name] = deltas.astype(np.float64) * multiplier
    if offset != len(data):
        raise ValueError(f"Parsed {offset} of {len(data)} bytes in {path}")
    return verts, morphs


def dynamic_shapes(path):
    """Yields (vertex count, positions) for every BSDynamicTriShape in an SSE NIF.

    Only the header is parsed properly. Each block's byte range comes from the header's block-size
    table, and BSDynamicTriShape puts its Vector4 vertex array last, so the array can be lifted off
    the tail without walking the skinning and shader fields in between. The uint32 immediately
    before the array is its byte size, which is what confirms the tail was found rather than guessed.
    """
    data = open(path, "rb").read()
    offset = data.index(b"\n") + 1
    offset += 4 + 1 + 4                                     # version, endianness, user version
    block_count = struct.unpack_from("<I", data, offset)[0]
    offset += 4 + 4                                         # block count, BS version
    for _ in range(3):                                      # author, process script, export script
        offset += 1 + data[offset]
    type_count = struct.unpack_from("<H", data, offset)[0]
    offset += 2
    types = []
    for _ in range(type_count):
        length = struct.unpack_from("<I", data, offset)[0]
        offset += 4
        types.append(data[offset:offset + length].decode("latin1"))
        offset += length
    type_index = np.frombuffer(data, "<u2", block_count, offset)
    offset += block_count * 2
    sizes = np.frombuffer(data, "<u4", block_count, offset)
    offset += block_count * 4
    string_count, _ = struct.unpack_from("<II", data, offset)
    offset += 8
    for _ in range(string_count):
        length = struct.unpack_from("<I", data, offset)[0]
        offset += 4 + length
    group_count = struct.unpack_from("<I", data, offset)[0]
    offset += 4 + group_count * 4

    for index in range(block_count):
        size = int(sizes[index])
        block = data[offset:offset + size]
        offset += size
        if types[type_index[index]] != "BSDynamicTriShape":
            continue
        for count in range(1, (len(block) - 4) // 16 + 1):
            start = len(block) - count * 16 - 4
            if struct.unpack_from("<I", block, start)[0] != count * 16:
                continue
            array = np.frombuffer(block, "<f4", count * 4, start + 4).reshape(-1, 4)
            yield count, array[:, :3].astype(np.float64)
            break


def main(nif_path, tri_path):
    base, morphs = read_tri(tri_path)
    head = next((verts for count, verts in dynamic_shapes(nif_path) if count == len(base)), None)
    if head is None:
        raise SystemExit(
            f"{nif_path} has no dynamic shape with {len(base)} vertices -- wrong chargen .tri?")

    # The exported head sits at its skeleton position; the .tri sits at the origin. Only the shape
    # difference is of interest, so remove the rigid offset first.
    delta = head - base - (head - base).mean(0)
    target = delta.reshape(-1)

    types = sorted(name for name in morphs if "Type" in name)
    columns = [(morphs[a].reshape(-1) - morphs[b].reshape(-1)) / 2 for a, b in PAIRS]
    columns += [morphs[name].reshape(-1) for name in types]
    matrix = np.stack(columns, 1)
    lower = np.array([-1.0] * len(PAIRS) + [0.0] * len(types))
    upper = np.ones(len(PAIRS) + len(types))

    fit = lsq_linear(matrix, target, bounds=(lower, upper), max_iter=200)
    before = np.sqrt((target ** 2).mean())
    after = np.sqrt(((target - matrix @ fit.x) ** 2).mean())
    moved = (np.linalg.norm(delta, axis=1) > 1e-4).mean() * 100

    print(f"{nif_path}")
    print(f"  vertices           {len(base)}")
    print(f"  moved from base    {moved:.1f}%   mean {np.linalg.norm(delta, axis=1).mean():.4f}")
    print(f"  rms displacement   {before:.4f} -> {after:.4f} after fitting the base morph set")
    print(f"  explained by base  {100 * (1 - after / before):.1f}%")
    print(f"  unexplained        {100 * after / before:.1f}%  <- extension morphs and sculpt")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    main(sys.argv[1], sys.argv[2])
