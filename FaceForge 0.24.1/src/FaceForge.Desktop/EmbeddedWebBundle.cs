using System.IO.Compression;
using System.IO;
using System.Reflection;
using System.Security.Cryptography;

namespace FaceForge.Desktop;

internal static class EmbeddedWebBundle
{
    public static string EnsureExtracted()
    {
        var assembly = Assembly.GetExecutingAssembly();
        var resourceName = assembly.GetManifestResourceNames()
            .SingleOrDefault(name =>
                name.EndsWith("FaceForge.WebBundle.zip", StringComparison.Ordinal));
        if (resourceName is null)
            throw new InvalidDataException("The embedded FaceForge interface is missing.");

        using var resource = assembly.GetManifestResourceStream(resourceName)
            ?? throw new InvalidDataException("The embedded FaceForge interface could not be opened.");
        using var memory = new MemoryStream();
        resource.CopyTo(memory);
        var bytes = memory.ToArray();
        var hash = Convert.ToHexString(SHA256.HashData(bytes))[..16];
        var cacheParent = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "FaceForge",
            "Web",
            "0.24.1");
        var cacheRoot = Path.Combine(cacheParent, hash);
        var indexPath = Path.Combine(cacheRoot, "index.html");
        if (File.Exists(indexPath)) return cacheRoot;

        Directory.CreateDirectory(cacheParent);
        var temporaryRoot = Path.Combine(cacheParent, "." + hash + "-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(temporaryRoot);
        try
        {
            using var archiveStream = new MemoryStream(bytes, writable: false);
            using var archive = new ZipArchive(archiveStream, ZipArchiveMode.Read);
            var resolvedRoot = Path.GetFullPath(temporaryRoot) + Path.DirectorySeparatorChar;
            foreach (var entry in archive.Entries)
            {
                if (string.IsNullOrEmpty(entry.Name)) continue;
                var destination = Path.GetFullPath(
                    Path.Combine(temporaryRoot, entry.FullName.Replace('/', Path.DirectorySeparatorChar)));
                if (!destination.StartsWith(resolvedRoot, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidDataException("The embedded interface contained an unsafe path.");
                Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
                entry.ExtractToFile(destination, overwrite: false);
            }
            if (!File.Exists(Path.Combine(temporaryRoot, "index.html")))
                throw new InvalidDataException("The embedded interface did not contain index.html.");
            try
            {
                Directory.Move(temporaryRoot, cacheRoot);
            }
            catch (IOException) when (Directory.Exists(cacheRoot))
            {
                // Another FaceForge process completed the same atomic extraction first.
            }
        }
        finally
        {
            if (Directory.Exists(temporaryRoot))
                Directory.Delete(temporaryRoot, recursive: true);
        }
        if (!File.Exists(indexPath))
            throw new InvalidDataException("FaceForge could not prepare its embedded interface.");
        return cacheRoot;
    }
}
