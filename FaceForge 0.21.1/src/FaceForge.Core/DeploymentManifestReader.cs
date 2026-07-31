using Newtonsoft.Json;

namespace FaceForge.Core;

public static class DeploymentManifestReader
{
    public const string FileName = "vortex.deployment.json";

    public static DeploymentHeader ReadHeader(string manifestPath)
    {
        using var reader = OpenReader(manifestPath);
        string? method = null;
        string? gameId = null;
        string? staging = null;
        string? target = null;
        long time = 0;

        while (reader.Read())
        {
            if (reader.TokenType != JsonToken.PropertyName) continue;
            switch ((string)reader.Value!)
            {
                case "deploymentMethod":
                    method = reader.ReadAsString();
                    break;
                case "gameId":
                    gameId = reader.ReadAsString();
                    break;
                case "stagingPath":
                    staging = reader.ReadAsString();
                    break;
                case "targetPath":
                    target = reader.ReadAsString();
                    break;
                case "deploymentTime":
                    time = (long)(reader.ReadAsDouble() ?? 0);
                    break;
                case "files":
                    return new DeploymentHeader(method, gameId, staging, target, time);
                default:
                    reader.Skip();
                    break;
            }
        }

        return new DeploymentHeader(method, gameId, staging, target, time);
    }

    public static IEnumerable<DeploymentEntry> ReadFiles(
        string manifestPath,
        CancellationToken cancellationToken = default)
    {
        using var reader = OpenReader(manifestPath);
        var foundFiles = false;

        while (reader.Read())
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (reader.TokenType != JsonToken.PropertyName ||
                !string.Equals((string)reader.Value!, "files", StringComparison.Ordinal))
            {
                continue;
            }

            if (!reader.Read() || reader.TokenType != JsonToken.StartArray)
                throw new InvalidDataException($"The files property is not an array in {manifestPath}.");
            foundFiles = true;
            break;
        }

        if (!foundFiles) yield break;

        long visited = 0;
        while (reader.Read())
        {
            if (++visited % 4096 == 0) cancellationToken.ThrowIfCancellationRequested();
            if (reader.TokenType == JsonToken.EndArray) yield break;
            if (reader.TokenType != JsonToken.StartObject) continue;

            string? relPath = null;
            string? source = null;
            long time = 0;
            while (reader.Read() && reader.TokenType != JsonToken.EndObject)
            {
                if (reader.TokenType != JsonToken.PropertyName) continue;
                switch ((string)reader.Value!)
                {
                    case "relPath":
                        relPath = reader.ReadAsString();
                        break;
                    case "source":
                        source = reader.ReadAsString();
                        break;
                    case "time":
                        time = (long)(reader.ReadAsDouble() ?? 0);
                        break;
                    default:
                        reader.Skip();
                        break;
                }
            }

            if (!string.IsNullOrWhiteSpace(relPath) && !string.IsNullOrWhiteSpace(source))
                yield return new DeploymentEntry(NormalizeRelPath(relPath), source, time);
        }
    }

    public static string NormalizeRelPath(string path) =>
        path.Replace('/', '\\').TrimStart('\\');

    private static JsonTextReader OpenReader(string manifestPath)
    {
        var stream = new FileStream(
            manifestPath,
            FileMode.Open,
            FileAccess.Read,
            FileShare.ReadWrite,
            1 << 16,
            FileOptions.SequentialScan);
        return new JsonTextReader(new StreamReader(stream)) { CloseInput = true };
    }
}
