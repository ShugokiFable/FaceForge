using System.Text;

namespace FaceForge.Core;

/// <summary>
/// Lists the folder names inside Bethesda .bsa archives, without extracting anything.
///
/// This exists for one reason: to know when FaceForge is looking at an incomplete picture. The
/// morph registry reads facegenmorphs inis off disk, but a mod can ship those inis inside its
/// archive instead -- High Poly Head does exactly that, registering its whole KL-topology morph
/// set (CME, ECE, EFM, RANs, NUSKA, EXTRA, EXPR, RACE) from
/// <c>meshes\actors\character\facegenmorphs\high poly head.esm\morphs.ini</c> packed inside
/// High Poly Head.bsa. A loose-file scan sees none of it and concludes those sliders are dead.
///
/// Only the folder table is parsed. Folder names live uncompressed near the head of the archive,
/// so this costs a few kilobytes per archive and never touches file data or decompression.
/// </summary>
public static class BsaIndex
{
    private const string MorphsFolder = @"meshes\actors\character\facegenmorphs";

    /// <summary>
    /// Archive filenames that declare a facegenmorphs folder. Non-empty means the loose-file morph
    /// registry is incomplete and cannot prove any slider dead.
    /// </summary>
    public static IReadOnlyList<string> ArchivesWithMorphRegistrations(string gameDataPath)
    {
        var results = new List<string>();
        if (!Directory.Exists(gameDataPath)) return results;

        foreach (var archive in Directory.EnumerateFiles(gameDataPath, "*.bsa", SearchOption.TopDirectoryOnly))
        {
            try
            {
                if (ReadFolderNames(archive).Any(name =>
                        name.StartsWith(MorphsFolder, StringComparison.OrdinalIgnoreCase)))
                {
                    results.Add(Path.GetFileName(archive));
                }
            }
            catch
            {
                // A malformed or unknown-format archive is not evidence of anything. Skipping it is
                // the conservative choice: the caller only uses this list to *withhold* a claim.
            }
        }

        results.Sort(StringComparer.OrdinalIgnoreCase);
        return results;
    }

    /// <summary>
    /// BSA v104 (Skyrim LE) and v105 (SE/AE) share this layout. Folder records carry an offset into
    /// the file-record block that is biased by the total file-name length -- a quirk of the format,
    /// not a mistake here. The folder's own name is length-prefixed at that position.
    /// </summary>
    public static IReadOnlyList<string> ReadFolderNames(string archivePath)
    {
        using var stream = File.OpenRead(archivePath);
        using var reader = new BinaryReader(stream, Encoding.ASCII);

        if (new string(reader.ReadChars(4)) != "BSA\0") return [];
        var version = reader.ReadUInt32();
        if (version is not (104 or 105)) return [];
        var headerLength = reader.ReadUInt32();
        var flags = reader.ReadUInt32();
        var folderCount = reader.ReadUInt32();
        reader.ReadUInt32();                       // file count
        reader.ReadUInt32();                       // total folder name length
        var fileNameLength = reader.ReadUInt32();

        // Bit 0 is "include directory names". Without it there are no names to read.
        if ((flags & 0x1) == 0 || folderCount == 0 || folderCount > 100_000) return [];

        stream.Position = headerLength;
        var offsets = new long[folderCount];
        for (var index = 0; index < folderCount; index++)
        {
            reader.ReadUInt64();                   // name hash
            reader.ReadUInt32();                   // file count
            if (version == 105)
            {
                reader.ReadUInt32();               // padding
                offsets[index] = (long)reader.ReadUInt64();
            }
            else
            {
                offsets[index] = reader.ReadUInt32();
            }
        }

        var names = new List<string>((int)folderCount);
        foreach (var offset in offsets)
        {
            var position = offset - fileNameLength;
            if (position < 0 || position >= stream.Length) continue;
            stream.Position = position;
            var length = reader.ReadByte();
            if (length == 0) continue;
            var raw = reader.ReadBytes(length);
            names.Add(Encoding.ASCII.GetString(raw).TrimEnd('\0'));
        }
        return names;
    }
}
