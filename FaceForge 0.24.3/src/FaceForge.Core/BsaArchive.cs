using System.IO.Compression;
using System.Text;
using K4os.Compression.LZ4.Streams;

namespace FaceForge.Core;

/// <summary>
/// Extracts individual files from a Bethesda .bsa archive (v104/v105, Skyrim LE/SE), including the
/// zlib-compressed and embedded-name variants.
///
/// This exists because High Poly Head ships its whole EFM morph set -- the chin/jaw/cheek/brow
/// targets every RaceMenu slider moves -- inside <c>High Poly Head.bsa</c>, not as loose files. A
/// renderer that reads only loose morphs therefore cannot move any of those sliders on an HPH head,
/// which is most of the slider set. Pulling the morph .tri files straight out of the archive is what
/// makes the preview and the fit respond to those sliders the way the game does.
///
/// Only the tables near the head of the archive are parsed up front; file data is read on demand.
/// </summary>
public sealed class BsaArchive
{
    private const uint FlagIncludeDirNames = 0x1;
    private const uint FlagIncludeFileNames = 0x2;
    private const uint FlagCompressedByDefault = 0x4;
    private const uint FlagEmbedFileNames = 0x100;
    private const uint SizeCompressToggle = 0x40000000;
    private const uint SizeMask = 0x3FFFFFFF;

    private readonly string _path;
    private readonly bool _defaultCompressed;
    private readonly bool _embedNames;
    private readonly Dictionary<string, (long Offset, uint RawSize)> _files;

    private BsaArchive(string path, bool defaultCompressed, bool embedNames,
        Dictionary<string, (long, uint)> files)
    {
        _path = path;
        _defaultCompressed = defaultCompressed;
        _embedNames = embedNames;
        _files = files;
    }

    public IReadOnlyCollection<string> Files => _files.Keys;

    /// <summary>Parses the archive tables, or returns null if the file is not a supported BSA.</summary>
    public static BsaArchive? Open(string path)
    {
        try
        {
            using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
            using var reader = new BinaryReader(stream, Encoding.ASCII, leaveOpen: true);

            if (new string(reader.ReadChars(4)) != "BSA\0") return null;
            var version = reader.ReadUInt32();
            if (version is not (104 or 105)) return null;
            var headerLength = reader.ReadUInt32();
            var archiveFlags = reader.ReadUInt32();
            var folderCount = reader.ReadUInt32();
            var fileCount = reader.ReadUInt32();
            var totalFolderNameLength = reader.ReadUInt32();
            var totalFileNameLength = reader.ReadUInt32();
            reader.ReadUInt32(); // file/content flags

            if ((archiveFlags & FlagIncludeDirNames) == 0 ||
                (archiveFlags & FlagIncludeFileNames) == 0 ||
                folderCount == 0 || folderCount > 200_000 || fileCount > 5_000_000)
            {
                return null; // named-file lookup is impossible without both name tables
            }

            var defaultCompressed = (archiveFlags & FlagCompressedByDefault) != 0;
            var embedNames = (archiveFlags & FlagEmbedFileNames) != 0;
            _ = totalFolderNameLength;

            stream.Position = headerLength;
            var folderFileCounts = new uint[folderCount];
            for (var i = 0; i < folderCount; i++)
            {
                reader.ReadUInt64();                 // folder name hash
                folderFileCounts[i] = reader.ReadUInt32();
                if (version == 105) { reader.ReadUInt32(); reader.ReadUInt64(); } // padding + offset
                else reader.ReadUInt32();            // v104 offset
            }

            // File-record blocks follow, one per folder: an optional folder name then the file records.
            var folderNames = new string[folderCount];
            var fileRecords = new List<(ulong Hash, uint Size, uint Offset)>[folderCount];
            for (var i = 0; i < folderCount; i++)
            {
                var nameLength = reader.ReadByte();      // bzstring: length includes the trailing null
                var raw = reader.ReadBytes(nameLength);
                folderNames[i] = Encoding.ASCII.GetString(raw).TrimEnd('\0');
                var records = new List<(ulong, uint, uint)>((int)folderFileCounts[i]);
                for (var f = 0; f < folderFileCounts[i]; f++)
                {
                    var hash = reader.ReadUInt64();
                    var size = reader.ReadUInt32();
                    var offset = reader.ReadUInt32();
                    records.Add((hash, size, offset));
                }
                fileRecords[i] = records;
            }

            // The file-name block lists every file name, null-terminated, in folder-then-file order.
            var nameBlock = reader.ReadBytes((int)totalFileNameLength);
            var names = SplitNulls(nameBlock);

            var files = new Dictionary<string, (long, uint)>(StringComparer.OrdinalIgnoreCase);
            var nameIndex = 0;
            for (var i = 0; i < folderCount; i++)
            {
                foreach (var (_, size, offset) in fileRecords[i])
                {
                    if (nameIndex >= names.Count) break;
                    var fileName = names[nameIndex++];
                    var key = Normalize(folderNames[i] + "\\" + fileName);
                    files[key] = (offset, size);
                }
            }

            return new BsaArchive(path, defaultCompressed, embedNames, files);
        }
        catch
        {
            return null;
        }
    }

    /// <summary>Extracts one file's bytes by its internal path, or null if absent/unreadable.</summary>
    public static bool Debug;

    public byte[]? Extract(string internalPath)
    {
        if (!_files.TryGetValue(Normalize(internalPath), out var entry))
        {
            if (Debug) Console.Error.WriteLine($"    [bsa] key not found: {Normalize(internalPath)}");
            return null;
        }
        try
        {
            using var stream = new FileStream(_path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
            stream.Position = entry.Offset;
            using var reader = new BinaryReader(stream, Encoding.ASCII, leaveOpen: true);

            var compressed = ((entry.RawSize & SizeCompressToggle) != 0) ? !_defaultCompressed : _defaultCompressed;
            var blockSize = (int)(entry.RawSize & SizeMask);
            if (Debug) Console.Error.WriteLine($"    [bsa] off={entry.Offset} raw={entry.RawSize} block={blockSize} compressed={compressed} embed={_embedNames}");

            if (_embedNames)
            {
                var nameLength = reader.ReadByte();
                reader.ReadBytes(nameLength);
                blockSize -= 1 + nameLength;
            }
            if (blockSize <= 0) return null;

            if (!compressed) return reader.ReadBytes(blockSize);

            var originalSize = reader.ReadUInt32();
            var payload = reader.ReadBytes(blockSize - 4);
            // The BSA prefixes compressed data with the original size, then either a zlib stream (the
            // usual case) or -- for some SSE archives like High Poly Head -- an LZ4 frame. Pick the
            // decoder by the payload's magic bytes.
            var isLz4 = payload.Length >= 4 && payload[0] == 0x04 && payload[1] == 0x22 &&
                        payload[2] == 0x4D && payload[3] == 0x18;
            using var input = new MemoryStream(payload);
            using Stream decoder = isLz4
                ? LZ4Stream.Decode(input)
                : new ZLibStream(input, CompressionMode.Decompress);
            var output = new byte[originalSize];
            var read = 0;
            while (read < output.Length)
            {
                var got = decoder.Read(output, read, output.Length - read);
                if (got <= 0) break;
                read += got;
            }
            if (Debug) Console.Error.WriteLine($"    [bsa] {(isLz4 ? "lz4" : "zlib")} decompressed {read}/{originalSize}");
            return read == output.Length ? output : output.AsSpan(0, read).ToArray();
        }
        catch
        {
            return null;
        }
    }

    private static List<string> SplitNulls(byte[] block)
    {
        var names = new List<string>();
        var start = 0;
        for (var i = 0; i < block.Length; i++)
        {
            if (block[i] != 0) continue;
            names.Add(Encoding.ASCII.GetString(block, start, i - start));
            start = i + 1;
        }
        return names;
    }

    private static string Normalize(string path) =>
        path.Replace('/', '\\').Trim().TrimStart('\\').ToLowerInvariant();
}
