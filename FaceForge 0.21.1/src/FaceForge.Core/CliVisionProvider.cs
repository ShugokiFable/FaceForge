using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace FaceForge.Core;

public enum CliVisionProviderKind
{
    Codex,
    Claude,
    Gemini
}

public sealed record CliProviderStatus(
    string Id,
    string DisplayName,
    bool Installed,
    string? ExecutablePath,
    string AccountLabel,
    string DocumentationUrl);

public sealed class CliVisionProvider
{
    private static readonly Regex ImageDataUrl = new(
        @"^data:image/(?<format>jpeg|png|webp);base64,(?<data>[A-Za-z0-9+/=]+)$",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    /// <summary>
    /// Built from the same context as the OpenRouter prompt so both paths ask for the same thing:
    /// small corrections when a local estimate exists, a full interpretation when it does not.
    /// </summary>
    internal static string BuildPrompt(OpenRouterVision.VisionContext context)
    {
        var limit = context.Limit.ToString(
            "0.##",
            System.Globalization.CultureInfo.InvariantCulture);
        return
            OpenRouterVision.BuildSystemPrompt(context) + " " +
            "The image is portrait.jpg in the working directory. " +
            "Return raw JSON only with confidence from 0 to 1, up to 8 short observations, and slider_deltas. " +
            $"slider_deltas must contain every key in response-schema.json, each from -{limit} to {limit}. " +
            "Use zero when uncertain. Do not modify any files.";
    }

    public static IReadOnlyList<CliProviderStatus> GetStatuses() =>
    [
        CreateStatus(
            CliVisionProviderKind.Codex,
            "ChatGPT via Codex",
            "codex",
            "ChatGPT account; usage limits vary by plan",
            "https://github.com/openai/codex"),
        CreateStatus(
            CliVisionProviderKind.Claude,
            "Claude via Claude Code",
            "claude",
            "Claude Pro or Max plan",
            "https://docs.anthropic.com/en/docs/claude-code/getting-started"),
        CreateStatus(
            CliVisionProviderKind.Gemini,
            "Gemini via Gemini CLI",
            "gemini",
            "Google account, including Google AI Pro or Ultra",
            "https://github.com/google-gemini/gemini-cli/blob/main/docs/get-started/authentication.mdx")
    ];

    public static CliProviderStatus GetStatus(CliVisionProviderKind provider) =>
        GetStatuses().Single(item =>
            item.Id.Equals(provider.ToString(), StringComparison.OrdinalIgnoreCase));

    public async Task<VisionResult> AnalyzeAsync(
        CliVisionProviderKind provider,
        string imageDataUrl,
        OpenRouterVision.VisionContext? context = null,
        CancellationToken cancellationToken = default)
    {
        var visionContext = context ?? OpenRouterVision.VisionContext.Refinement;
        var status = GetStatus(provider);
        if (!status.Installed || string.IsNullOrWhiteSpace(status.ExecutablePath))
            throw new FileNotFoundException(
                $"{status.DisplayName} is not installed. Open Settings for the official install and sign-in link.");

        var match = ImageDataUrl.Match(imageDataUrl);
        if (!match.Success || imageDataUrl.Length > 8_000_000)
            throw new ArgumentException("The analysis image must be a JPEG, PNG, or WebP data URL under 8 MB.");

        var workRoot = Path.Combine(
            Path.GetTempPath(),
            "FaceForge",
            "Vision",
            Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(workRoot);
        try
        {
            var extension = match.Groups["format"].Value == "jpeg"
                ? "jpg"
                : match.Groups["format"].Value;
            var originalPath = Path.Combine(workRoot, "portrait." + extension);
            await File.WriteAllBytesAsync(
                originalPath,
                Convert.FromBase64String(match.Groups["data"].Value),
                cancellationToken);
            var portraitPath = Path.Combine(workRoot, "portrait.jpg");
            if (!originalPath.Equals(portraitPath, StringComparison.OrdinalIgnoreCase))
                File.Move(originalPath, portraitPath);

            var schemaPath = Path.Combine(workRoot, "response-schema.json");
            await File.WriteAllTextAsync(
                schemaPath,
                OpenRouterVision.BuildResultSchemaJson(visionContext),
                Encoding.UTF8,
                cancellationToken);
            var resultPath = Path.Combine(workRoot, "result.json");
            var invocation = BuildInvocation(
                provider,
                portraitPath,
                schemaPath,
                resultPath,
                visionContext);
            var processResult = await RunAsync(
                status.ExecutablePath,
                invocation.Arguments,
                workRoot,
                invocation.StandardInput,
                cancellationToken);
            if (processResult.ExitCode != 0)
                throw new InvalidOperationException(
                    $"{status.DisplayName} exited with code {processResult.ExitCode}. " +
                    "Open Settings, connect the account, and try again. " +
                    TrimError(processResult.StandardError));

            var responseText = provider == CliVisionProviderKind.Codex
                ? await ReadCodexResultAsync(resultPath, processResult.StandardOutput, cancellationToken)
                : UnwrapProviderResponse(provider, processResult.StandardOutput);
            return OpenRouterVision.ParseStructuredResult(
                status.DisplayName,
                ExtractJson(responseText),
                visionContext);
        }
        finally
        {
            if (Directory.Exists(workRoot))
                Directory.Delete(workRoot, recursive: true);
        }
    }

    public static (IReadOnlyList<string> Arguments, string? StandardInput) BuildInvocation(
        CliVisionProviderKind provider,
        string portraitPath,
        string schemaPath,
        string resultPath,
        OpenRouterVision.VisionContext? context = null)
    {
        var prompt = BuildPrompt(context ?? OpenRouterVision.VisionContext.Refinement);
        return provider switch
        {
            CliVisionProviderKind.Codex => (
                [
                    "exec",
                    "--skip-git-repo-check",
                    "--ephemeral",
                    "--sandbox", "read-only",
                    "--image", portraitPath,
                    "--output-schema", schemaPath,
                    "--output-last-message", resultPath,
                    "-"
                ],
                prompt),
            CliVisionProviderKind.Claude => (
                [
                    "-p",
                    "--output-format", "json",
                    "--max-turns", "3",
                    "--allowedTools", "Read",
                    "--disallowedTools", "Bash", "Edit", "Write", "NotebookEdit",
                    prompt
                ],
                null),
            CliVisionProviderKind.Gemini => (
                [
                    "-p",
                    "@{portrait.jpg} @{response-schema.json} " + prompt,
                    "--output-format", "json"
                ],
                null),
            _ => throw new ArgumentOutOfRangeException(nameof(provider))
        };
    }

    public static string UnwrapProviderResponse(
        CliVisionProviderKind provider,
        string responseJson)
    {
        using var document = JsonDocument.Parse(responseJson);
        var property = provider switch
        {
            CliVisionProviderKind.Claude => "result",
            CliVisionProviderKind.Gemini => "response",
            _ => throw new ArgumentException("This provider does not use a wrapped response.", nameof(provider))
        };
        if (!document.RootElement.TryGetProperty(property, out var value) ||
            value.ValueKind != JsonValueKind.String ||
            string.IsNullOrWhiteSpace(value.GetString()))
            throw new InvalidDataException($"The {provider} CLI returned no usable response.");
        return value.GetString()!;
    }

    public static string ExtractJson(string value)
    {
        var trimmed = value.Trim();
        if (trimmed.StartsWith("```", StringComparison.Ordinal))
        {
            var firstLine = trimmed.IndexOf('\n');
            var lastFence = trimmed.LastIndexOf("```", StringComparison.Ordinal);
            if (firstLine >= 0 && lastFence > firstLine)
                trimmed = trimmed[(firstLine + 1)..lastFence].Trim();
        }
        var start = trimmed.IndexOf('{');
        var end = trimmed.LastIndexOf('}');
        if (start < 0 || end <= start)
            throw new InvalidDataException("The vision CLI did not return a JSON object.");
        return trimmed[start..(end + 1)];
    }

    private static CliProviderStatus CreateStatus(
        CliVisionProviderKind kind,
        string displayName,
        string command,
        string accountLabel,
        string documentationUrl)
    {
        var path = FindExecutable(command);
        return new CliProviderStatus(
            kind.ToString().ToLowerInvariant(),
            displayName,
            path is not null,
            path,
            accountLabel,
            documentationUrl);
    }

    private static string? FindExecutable(string command)
    {
        var pathValue = Environment.GetEnvironmentVariable("PATH") ?? "";
        var extensions = OperatingSystem.IsWindows()
            ? (Environment.GetEnvironmentVariable("PATHEXT") ?? ".EXE;.CMD;.BAT")
                .Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            : [""];
        foreach (var directory in pathValue.Split(
                     Path.PathSeparator,
                     StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            foreach (var extension in extensions.Prepend(""))
            {
                var candidate = Path.Combine(directory.Trim('"'), command + extension.ToLowerInvariant());
                if (File.Exists(candidate)) return Path.GetFullPath(candidate);
                candidate = Path.Combine(directory.Trim('"'), command + extension.ToUpperInvariant());
                if (File.Exists(candidate)) return Path.GetFullPath(candidate);
            }
        }
        return null;
    }

    private static async Task<ProcessResult> RunAsync(
        string executable,
        IReadOnlyList<string> arguments,
        string workingDirectory,
        string? standardInput,
        CancellationToken cancellationToken)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromMinutes(3));
        var startInfo = CreateCaptureStartInfo(executable, arguments, workingDirectory);
        using var process = new Process { StartInfo = startInfo };
        if (!process.Start())
            throw new InvalidOperationException("The vision CLI could not be started.");

        if (standardInput is not null)
        {
            await process.StandardInput.WriteAsync(standardInput.AsMemory(), timeout.Token);
            process.StandardInput.Close();
        }
        var outputTask = process.StandardOutput.ReadToEndAsync(timeout.Token);
        var errorTask = process.StandardError.ReadToEndAsync(timeout.Token);
        try
        {
            await process.WaitForExitAsync(timeout.Token);
        }
        catch (OperationCanceledException)
        {
            if (!process.HasExited) process.Kill(entireProcessTree: true);
            throw new TaskCanceledException("The vision CLI exceeded the three-minute limit.");
        }
        var output = await outputTask;
        var error = await errorTask;
        if (output.Length > 2_000_000 || error.Length > 200_000)
            throw new InvalidDataException("The vision CLI returned an unexpectedly large response.");
        return new ProcessResult(process.ExitCode, output, error);
    }

    private static ProcessStartInfo CreateCaptureStartInfo(
        string executable,
        IReadOnlyList<string> arguments,
        string workingDirectory)
    {
        var isBatch = executable.EndsWith(".cmd", StringComparison.OrdinalIgnoreCase) ||
                      executable.EndsWith(".bat", StringComparison.OrdinalIgnoreCase);
        var startInfo = new ProcessStartInfo
        {
            FileName = isBatch ? Environment.GetEnvironmentVariable("ComSpec") ?? "cmd.exe" : executable,
            WorkingDirectory = workingDirectory,
            UseShellExecute = false,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true
        };
        if (isBatch)
        {
            startInfo.ArgumentList.Add("/d");
            startInfo.ArgumentList.Add("/s");
            startInfo.ArgumentList.Add("/c");
            startInfo.ArgumentList.Add(
                QuoteForCmd(executable) + " " +
                string.Join(" ", arguments.Select(QuoteForCmd)));
        }
        else
        {
            foreach (var argument in arguments) startInfo.ArgumentList.Add(argument);
        }
        return startInfo;
    }

    private static string QuoteForCmd(string value)
    {
        if (value.IndexOfAny(['\r', '\n', '&', '|', '<', '>', '^', '%', '!']) >= 0)
            throw new InvalidOperationException("A vision CLI argument contained an unsafe shell character.");
        return "\"" + value.Replace("\"", "\"\"") + "\"";
    }

    private static async Task<string> ReadCodexResultAsync(
        string resultPath,
        string standardOutput,
        CancellationToken cancellationToken)
    {
        if (File.Exists(resultPath))
            return await File.ReadAllTextAsync(resultPath, cancellationToken);
        if (!string.IsNullOrWhiteSpace(standardOutput)) return standardOutput;
        throw new InvalidDataException("Codex returned no final response.");
    }

    private static string TrimError(string value)
    {
        var clean = value.Replace('\r', ' ').Replace('\n', ' ').Trim();
        return clean.Length switch
        {
            0 => "",
            <= 240 => clean,
            _ => clean[..240]
        };
    }

    private sealed record ProcessResult(int ExitCode, string StandardOutput, string StandardError);
}
