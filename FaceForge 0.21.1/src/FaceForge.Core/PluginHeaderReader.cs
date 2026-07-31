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
}
