using System.Buffers.Binary;
using System.Runtime.InteropServices;
using System.Text;

namespace FaceForge.Core;

/// <summary>
/// Reads a FaceGen <c>.tri</c> morph file (magic <c>FRTRI003</c>).
///
/// This is the file RaceMenu sculpt data indexes into. A sculpt entry is
/// <c>[vertexIndex, dx, dy, dz]</c> against the vertex array below, and the host path recorded in
/// a preset -- "KL\High Poly Head\FemaleHeadCharGen.tri" -- names this exact file. So the base
/// mesh a sculpt generator needs is inside the TRI; reading the head NIF is unnecessary.
///
/// The same format carries the slider morphs. Every EFM slider FaceForge writes exists here as a
/// named plus/minus pair of morph targets (EFM_Chin_Width is EFM_Chin_Wide / EFM_Chin_Thin), which
/// makes the geometric effect of an exported slider measurable instead of estimated.
///
/// Layout, verified byte-exactly against five installed files (see <see cref="TrailingBytes"/>):
///
///   64-byte header: magic[8], then uint32 numVerts, numTris, 0, 0, 0, numUV, flags, numMorphs,
///                   numModifiers, numModifierVerts, and four reserved zeros
///   vertices        numVerts * 3 float32
///   triangles       numTris  * 3 uint32
///   uvs             numUV    * 2 float32          (present when flags has bit 0)
///   triangle uvs    numTris  * 3 uint32           (present when flags has bit 0)
///   morphs          numMorphs * { uint32 nameLength; char name[nameLength]; float32 multiplier;
///                                 int16 delta[numVerts * 3] }
///
/// nameLength counts the trailing NUL. That is not cosmetic: assuming it does not costs 1 byte per
/// morph, which silently shifts every delta afterwards into garbage rather than failing.
/// </summary>
public sealed class TriFile
{
    public const int HeaderLength = 64;
    private static readonly byte[] Magic = "FRTRI003"u8.ToArray();

    private TriFile(
        string path,
        float[] vertices,
        int[] triangles,
        float[] uvs,
        int[] triangleUvs,
        IReadOnlyList<TriMorph> morphs,
        long trailingBytes)
    {
        Path = path;
        Vertices = vertices;
        Triangles = triangles;
        Uvs = uvs;
        TriangleUvs = triangleUvs;
        Morphs = morphs;
        TrailingBytes = trailingBytes;
    }

    public string Path { get; }

    /// <summary>Base positions, three floats per vertex, in the sculpt index space.</summary>
    public float[] Vertices { get; }

    public int VertexCount => Vertices.Length / 3;

    /// <summary>Triangle vertex indices, three per triangle, into <see cref="Vertices"/>.</summary>
    public int[] Triangles { get; }

    public int TriangleCount => Triangles.Length / 3;

    /// <summary>Texture coordinates, two floats per UV, or empty when the mesh carries none.</summary>
    public float[] Uvs { get; }

    /// <summary>Per-triangle UV indices, three per triangle, into <see cref="Uvs"/>.</summary>
    public int[] TriangleUvs { get; }

    public bool HasUvs => Uvs.Length > 0 && TriangleUvs.Length == Triangles.Length;

    public IReadOnlyList<TriMorph> Morphs { get; }

    /// <summary>
    /// Bytes left over after parsing. Zero on every file measured here, so a non-zero value means
    /// either an unhandled variant or a parser that has drifted -- worth surfacing, not swallowing.
    /// </summary>
    public long TrailingBytes { get; }

    public static TriFile Read(string path) => Read(File.ReadAllBytes(path), path);

    /// <summary>Parses a .tri from an in-memory buffer (e.g. one extracted from a BSA).</summary>
    public static TriFile Read(byte[] data, string path)
    {
        if (data.Length < HeaderLength || !data.AsSpan(0, Magic.Length).SequenceEqual(Magic))
        {
            throw new InvalidDataException($"Not a FRTRI003 file: {path}");
        }

        var vertexCount = ReadCount(data, 8, path, "vertex count");
        var triangleCount = ReadCount(data, 12, path, "triangle count");
        var uvCount = ReadCount(data, 28, path, "uv count");
        var flags = BinaryPrimitives.ReadUInt32LittleEndian(data.AsSpan(32));
        var morphCount = ReadCount(data, 36, path, "morph count");
        var hasUv = (flags & 1) != 0;

        var offset = HeaderLength;
        var vertices = ReadFloats(data, ref offset, vertexCount * 3, path);
        var triangles = ReadIndices(data, ref offset, triangleCount * 3, path);
        var uvs = Array.Empty<float>();
        var triangleUvs = Array.Empty<int>();
        if (hasUv)
        {
            uvs = ReadFloats(data, ref offset, uvCount * 2, path);
            triangleUvs = ReadIndices(data, ref offset, triangleCount * 3, path);
        }

        var morphs = new List<TriMorph>(morphCount);
        var deltaCount = vertexCount * 3;
        for (var index = 0; index < morphCount; index++)
        {
            var nameLength = ReadCount(data, offset, path, "morph name length");
            offset += sizeof(uint);
            Require(data, offset, nameLength, path, "morph name");
            var name = Encoding.ASCII.GetString(data, offset, nameLength).TrimEnd('\0');
            offset += nameLength;

            Require(data, offset, sizeof(float), path, "morph multiplier");
            var multiplier = BinaryPrimitives.ReadSingleLittleEndian(data.AsSpan(offset));
            offset += sizeof(float);

            Require(data, offset, deltaCount * sizeof(short), path, "morph deltas");
            var deltas = MemoryMarshal
                .Cast<byte, short>(data.AsSpan(offset, deltaCount * sizeof(short)))
                .ToArray();
            offset += deltaCount * sizeof(short);

            morphs.Add(new TriMorph(name, multiplier, deltas));
        }

        return new TriFile(path, vertices, triangles, uvs, triangleUvs, morphs, data.Length - offset);
    }

    public TriMorph? FindMorph(string name) =>
        Morphs.FirstOrDefault(morph => string.Equals(morph.Name, name, StringComparison.OrdinalIgnoreCase));

    /// <summary>
    /// Base mesh plus the given morphs at the given weights. Names are matched case-insensitively
    /// because the shipped EFM morph names are not internally consistent about it -- the same file
    /// carries EFM_Brow_Angle_UP beside EFM_Brow_Angle_Down, and EFM_Eyeball_small beside
    /// EFM_Eyeball_Large. Unknown names are ignored; the caller decides whether that is an error.
    /// </summary>
    public float[] ApplyMorphs(IEnumerable<KeyValuePair<string, float>> weights)
    {
        var result = (float[])Vertices.Clone();
        foreach (var (name, weight) in weights)
        {
            if (weight == 0f) continue;
            var morph = FindMorph(name);
            if (morph is null) continue;
            var scale = morph.Multiplier * weight;
            for (var index = 0; index < result.Length; index++)
            {
                result[index] += morph.Deltas[index] * scale;
            }
        }
        return result;
    }

    private static int ReadCount(byte[] data, int offset, string path, string what)
    {
        Require(data, offset, sizeof(uint), path, what);
        var value = BinaryPrimitives.ReadUInt32LittleEndian(data.AsSpan(offset));
        if (value > int.MaxValue) throw new InvalidDataException($"Implausible {what} in {path}.");
        return (int)value;
    }

    private static float[] ReadFloats(byte[] data, ref int offset, int count, string path)
    {
        Require(data, offset, count * sizeof(float), path, "vertex block");
        var values = MemoryMarshal
            .Cast<byte, float>(data.AsSpan(offset, count * sizeof(float)))
            .ToArray();
        offset += count * sizeof(float);
        return values;
    }

    private static int[] ReadIndices(byte[] data, ref int offset, int count, string path)
    {
        Require(data, offset, (long)count * sizeof(uint), path, "triangle block");
        var values = new int[count];
        var source = MemoryMarshal.Cast<byte, uint>(data.AsSpan(offset, count * sizeof(uint)));
        for (var index = 0; index < count; index++) values[index] = (int)source[index];
        offset += count * sizeof(uint);
        return values;
    }

    private static int Advance(int count, int stride, string path)
    {
        var total = (long)count * stride;
        if (total > int.MaxValue) throw new InvalidDataException($"Implausible block size in {path}.");
        return (int)total;
    }

    private static void Require(byte[] data, int offset, long length, string path, string what)
    {
        if (offset < 0 || offset + length > data.Length)
        {
            throw new InvalidDataException($"Truncated {what} in {path}.");
        }
    }
}

/// <summary>
/// One named morph target. The stored deltas are quantised to int16; the displacement applied at
/// full weight is <c>delta * multiplier</c>.
/// </summary>
public sealed class TriMorph
{
    internal TriMorph(string name, float multiplier, short[] deltas)
    {
        Name = name;
        Multiplier = multiplier;
        Deltas = deltas;
    }

    public string Name { get; }

    public float Multiplier { get; }

    /// <summary>Three quantised components per vertex, in the same order as the vertex array.</summary>
    public short[] Deltas { get; }

    /// <summary>Largest single-vertex displacement at weight 1, in mesh units.</summary>
    public float MaxDisplacement()
    {
        var largest = 0f;
        for (var index = 0; index + 2 < Deltas.Length; index += 3)
        {
            var x = Deltas[index] * Multiplier;
            var y = Deltas[index + 1] * Multiplier;
            var z = Deltas[index + 2] * Multiplier;
            var length = MathF.Sqrt((x * x) + (y * y) + (z * z));
            if (length > largest) largest = length;
        }
        return largest;
    }
}
