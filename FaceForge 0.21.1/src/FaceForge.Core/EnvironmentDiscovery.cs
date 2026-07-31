using System.Text.RegularExpressions;
using System.Runtime.Versioning;
using Microsoft.Win32;

namespace FaceForge.Core;

public sealed record EnvironmentLocation(string GameDataPath, string DetectionMethod);

public static partial class EnvironmentDiscovery
{
    private const string SkyrimAppId = "489830";

    public static EnvironmentLocation? TryDiscover()
    {
        foreach (var candidate in CandidateLocations())
        {
            if (TryNormalizeDataPath(candidate.Path, out var dataPath))
                return new EnvironmentLocation(dataPath, candidate.Method);
        }
        return null;
    }

    public static bool TryNormalizeDataPath(string? selectedPath, out string dataPath)
    {
        dataPath = "";
        if (string.IsNullOrWhiteSpace(selectedPath)) return false;

        var selected = Path.GetFullPath(selectedPath.Trim().Trim('"'));
        var candidates = new List<string>();
        if (File.Exists(selected) &&
            Path.GetFileName(selected).Equals(
                DeploymentManifestReader.FileName,
                StringComparison.OrdinalIgnoreCase))
        {
            candidates.Add(Path.GetDirectoryName(selected)!);
        }
        else
        {
            candidates.Add(selected);
            candidates.Add(Path.Combine(selected, "Data"));

            var cursor = new DirectoryInfo(selected);
            for (var depth = 0; cursor is not null && depth < 5; depth++, cursor = cursor.Parent)
            {
                if (cursor.Name.Equals("Data", StringComparison.OrdinalIgnoreCase))
                    candidates.Add(cursor.FullName);
            }
        }

        foreach (var candidate in candidates.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            if (!Directory.Exists(candidate)) continue;
            if (!File.Exists(Path.Combine(candidate, "Skyrim.esm"))) continue;
            dataPath = Path.GetFullPath(candidate);
            return true;
        }
        return false;
    }

    private static IEnumerable<(string Path, string Method)> CandidateLocations()
    {
        var overridePath = Environment.GetEnvironmentVariable("FACEFORGE_SKYRIM_DATA");
        if (!string.IsNullOrWhiteSpace(overridePath))
            yield return (overridePath, "FACEFORGE_SKYRIM_DATA override");

        if (OperatingSystem.IsWindows())
        {
            foreach (var path in RegistryInstallLocations())
                yield return (path, "Windows registry");
        }

        foreach (var steamRoot in SteamRoots())
        {
            foreach (var library in SteamLibraries(steamRoot))
            {
                var manifest = Path.Combine(
                    library,
                    "steamapps",
                    $"appmanifest_{SkyrimAppId}.acf");
                if (!File.Exists(manifest)) continue;
                yield return (
                    Path.Combine(
                        library,
                        "steamapps",
                        "common",
                        "Skyrim Special Edition",
                        "Data"),
                    "Steam library");
            }
        }

        var programFilesX86 = Environment.GetFolderPath(
            Environment.SpecialFolder.ProgramFilesX86);
        if (!string.IsNullOrWhiteSpace(programFilesX86))
        {
            yield return (
                Path.Combine(
                    programFilesX86,
                    "Steam",
                    "steamapps",
                    "common",
                    "Skyrim Special Edition",
                    "Data"),
                "default Steam location");
        }
    }

    [SupportedOSPlatform("windows")]
    private static IEnumerable<string> RegistryInstallLocations()
    {
        var keys = new[]
        {
            @"HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Steam App 489830",
            @"HKEY_LOCAL_MACHINE\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Steam App 489830",
            @"HKEY_LOCAL_MACHINE\SOFTWARE\Bethesda Softworks\Skyrim Special Edition",
            @"HKEY_LOCAL_MACHINE\SOFTWARE\WOW6432Node\Bethesda Softworks\Skyrim Special Edition"
        };
        foreach (var key in keys)
        {
            foreach (var valueName in new[] { "InstallLocation", "Installed Path" })
            {
                if (Registry.GetValue(key, valueName, null) is not string value ||
                    string.IsNullOrWhiteSpace(value))
                {
                    continue;
                }
                yield return Path.Combine(value, "Data");
            }
        }
    }

    private static IEnumerable<string> SteamRoots()
    {
        var roots = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (OperatingSystem.IsWindows())
        {
            foreach (var key in new[]
                     {
                         @"HKEY_CURRENT_USER\Software\Valve\Steam",
                         @"HKEY_LOCAL_MACHINE\SOFTWARE\WOW6432Node\Valve\Steam"
                     })
            {
                foreach (var valueName in new[] { "SteamPath", "InstallPath" })
                {
                    if (Registry.GetValue(key, valueName, null) is string value &&
                        Directory.Exists(value))
                    {
                        roots.Add(Path.GetFullPath(value));
                    }
                }
            }
        }

        var programFilesX86 = Environment.GetFolderPath(
            Environment.SpecialFolder.ProgramFilesX86);
        var defaultRoot = Path.Combine(programFilesX86, "Steam");
        if (Directory.Exists(defaultRoot)) roots.Add(defaultRoot);
        return roots;
    }

    private static IEnumerable<string> SteamLibraries(string steamRoot)
    {
        var libraries = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            Path.GetFullPath(steamRoot)
        };
        var file = Path.Combine(steamRoot, "steamapps", "libraryfolders.vdf");
        if (!File.Exists(file)) return libraries;

        foreach (Match match in SteamLibraryPathRegex().Matches(File.ReadAllText(file)))
        {
            var value = match.Groups["path"].Value.Replace(@"\\", @"\");
            if (Directory.Exists(value)) libraries.Add(Path.GetFullPath(value));
        }
        return libraries;
    }

    [GeneratedRegex(
        "\"path\"\\s+\"(?<path>[^\"]+)\"",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex SteamLibraryPathRegex();
}
