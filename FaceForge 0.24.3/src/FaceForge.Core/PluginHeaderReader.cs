using System.Text;

namespace FaceForge.Core;

public static class PluginHeaderReader
{
    public static IReadOnlyList<string> ReadMasters(string pluginPath)
    {
        using var stream = new FileStream(
            pluginPath,
            FileMode.Open,
            FileAccess.Read,
            FileShare.ReadWrite,
            4096,
            FileOptions.SequentialScan);
        Span<byte> header = stackalloc byte[24];
        if (stream.Read(header) != header.Length ||
            !header[..4].SequenceEqual("TES4"u8))
        {
            return [];
        }

        var recordSize = BitConverter.ToUInt32(header[4..8]);
        if (recordSize is 0 or > 4 * 1024 * 1024) return [];
        var body = new byte[recordSize];
        if (stream.Read(body, 0, body.Length) != body.Length) return [];

        var masters = new List<string>();
        var position = 0;
        while (position + 6 <= body.Length)
        {
            var signature = body.AsSpan(position, 4);
            var size = BitConverter.ToUInt16(body, position + 4);
            position += 6;
            if (position + size > body.Length) return [];
            if (signature.SequenceEqual("MAST"u8))
            {
                var value = Encoding.UTF8
                    .GetString(body, position, size)
                    .TrimEnd('\0')
                    .Trim();
                if (!string.IsNullOrWhiteSpace(value)) masters.Add(value);
            }
            position += size;
        }
        return masters.Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
    }

    /// <summary>
    /// Cheaply reports whether a plugin defines any Head Part (HDPT) records, by scanning only the
    /// top-level group table -- never the record bodies. This is what lets FaceForge decide to parse
    /// a plugin for head parts from the plugin's own content instead of from where its meshes happen
    /// to live on disk. A hair pack like KS Hairdos keeps its meshes in a custom <c>meshes\</c> folder
    /// (or inside a BSA), so a mesh-path heuristic misses it entirely, but the HDPT group is still
    /// right here in the plugin.
    /// </summary>
    public static bool ContainsTopGroup(string pluginPath, string signature)
    {
        if (signature.Length != 4) throw new ArgumentException("A group signature is four bytes.", nameof(signature));
        var wanted = System.Text.Encoding.ASCII.GetBytes(signature);
        try
        {
            using var stream = new FileStream(
                pluginPath,
                FileMode.Open,
                FileAccess.Read,
                FileShare.ReadWrite,
                4096,
                FileOptions.SequentialScan);
            var length = stream.Length;
            Span<byte> header = stackalloc byte[24];

            // TES4 header record: 4 sig + 4 dataSize + 16 = 24-byte header, then dataSize of fields.
            if (stream.Read(header) != header.Length || !header[..4].SequenceEqual("TES4"u8)) return false;
            var tes4DataSize = BitConverter.ToUInt32(header[4..8]);
            long position = 24L + tes4DataSize;

            // Top-level groups follow, each: 4 "GRUP" + 4 groupSize (incl. this 24-byte header)
            // + 4 label + 4 groupType(0 for top) + 8. For a top group the label is the record
            // signature it holds.
            while (position + 24 <= length)
            {
                stream.Position = position;
                if (stream.Read(header) != header.Length) break;
                if (!header[..4].SequenceEqual("GRUP"u8)) break;
                var groupSize = BitConverter.ToUInt32(header[4..8]);
                if (groupSize < 24) break;
                if (header.Slice(8, 4).SequenceEqual(wanted)) return true;
                position += groupSize;
            }
        }
        catch
        {
            // An unreadable or malformed plugin simply contributes no head parts.
        }
        return false;
    }

    /// <summary>Whether a plugin defines any HDPT (Head Part) records.</summary>
    public static bool ContainsHeadParts(string pluginPath) => ContainsTopGroup(pluginPath, "HDPT");
}
