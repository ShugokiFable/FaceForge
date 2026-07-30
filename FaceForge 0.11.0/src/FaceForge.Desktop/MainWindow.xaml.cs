using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows;
using System.Windows.Interop;
using FaceForge.Core;
using Microsoft.Web.WebView2.Core;
using Microsoft.Win32;

namespace FaceForge.Desktop;

public partial class MainWindow : Window
{
    private const string VirtualHost = "app.faceforge";
    private const int WmNcLButtonDown = 0x00A1;
    private const int HtCaption = 0x0002;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    private EnvironmentCatalog? _catalog;
    private IndexedPreset? _selectedPreset;
    private bool _autoIndexAttempted;
    private readonly OpenRouterVision _openRouterVision = new();
    private readonly CliVisionProvider _cliVision = new();

    [DllImport("user32.dll")]
    private static extern bool ReleaseCapture();

    [DllImport("user32.dll")]
    private static extern IntPtr SendMessage(
        IntPtr window,
        int message,
        IntPtr wParam,
        IntPtr lParam);

    public MainWindow()
    {
        InitializeComponent();
        Loaded += OnLoaded;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        try
        {
            var webRoot = EmbeddedWebBundle.EnsureExtracted();
            var index = Path.Combine(webRoot, "index.html");
            if (!File.Exists(index))
            {
                MessageBox.Show(
                    $"The FaceForge web bundle is missing:\n{index}",
                    "FaceForge could not start",
                    MessageBoxButton.OK,
                    MessageBoxImage.Error);
                Close();
                return;
            }

            var userData = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "FaceForge",
                "WebView2");
            var environment = await CoreWebView2Environment.CreateAsync(userDataFolder: userData);
            await Browser.EnsureCoreWebView2Async(environment);

            Browser.CoreWebView2.SetVirtualHostNameToFolderMapping(
                VirtualHost,
                webRoot,
                CoreWebView2HostResourceAccessKind.Allow);
            Browser.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
            Browser.CoreWebView2.Settings.AreDevToolsEnabled =
                string.Equals(
                    Environment.GetEnvironmentVariable("FACEFORGE_DEVTOOLS"),
                    "1",
                    StringComparison.Ordinal);
            Browser.CoreWebView2.Settings.IsStatusBarEnabled = false;
            Browser.CoreWebView2.Settings.IsZoomControlEnabled = true;
            Browser.CoreWebView2.WebMessageReceived += OnWebMessageReceived;
            Browser.CoreWebView2.DownloadStarting += OnDownloadStarting;
            Browser.CoreWebView2.NavigationCompleted += OnNavigationCompleted;
            Browser.Source = new Uri($"https://{VirtualHost}/index.html");
        }
        catch (Exception exception)
        {
            MessageBox.Show(
                exception.Message,
                "FaceForge could not initialize WebView2",
                MessageBoxButton.OK,
                MessageBoxImage.Error);
            Close();
        }
    }

    private async void OnNavigationCompleted(
        object? sender,
        CoreWebView2NavigationCompletedEventArgs e)
    {
        if (_autoIndexAttempted || !e.IsSuccess) return;
        _autoIndexAttempted = true;
        await AutoIndexEnvironmentAsync();
    }

    private async void OnWebMessageReceived(
        object? sender,
        CoreWebView2WebMessageReceivedEventArgs e)
    {
        try
        {
            using var message = JsonDocument.Parse(e.WebMessageAsJson);
            var root = message.RootElement;
            if (!root.TryGetProperty("type", out var typeElement)) return;
            switch (typeElement.GetString())
            {
                case "minimize":
                    WindowState = WindowState.Minimized;
                    break;
                case "maximize":
                    WindowState = WindowState == WindowState.Maximized
                        ? WindowState.Normal
                        : WindowState.Maximized;
                    break;
                case "close":
                    Close();
                    break;
                case "drag":
                    ReleaseCapture();
                    SendMessage(
                        new WindowInteropHelper(this).Handle,
                        WmNcLButtonDown,
                        new IntPtr(HtCaption),
                        IntPtr.Zero);
                    break;
                case "index-environment":
                    await IndexEnvironmentAsync();
                    break;
                case "choose-template":
                    ChooseTemplate();
                    break;
                case "use-fresh-foundation":
                    _selectedPreset = null;
                    break;
                case "load-indexed-template":
                    LoadIndexedTemplate(root.GetProperty("id").GetString());
                    break;
                case "find-baked-head":
                    FindBakedHead(root.GetProperty("name").GetString());
                    break;
                case "inspect-preset":
                    InspectPreset();
                    break;
                case "resolve-dependencies":
                    ResolveDependencies(ReadStringArray(root, "dependencies"));
                    break;
                case "vision-provider-status":
                    Post("vision-provider-status", CliVisionProvider.GetStatuses());
                    break;
                case "connect-vision-provider":
                    ConnectVisionProvider(root.GetProperty("provider").GetString());
                    break;
                case "open-vision-provider-docs":
                    OpenVisionProviderDocs(root.GetProperty("provider").GetString());
                    break;
                case "vision-analyze":
                    await RunVisionAsync(root);
                    break;
                case "export-package":
                    ExportPackage(root);
                    break;
            }
        }
        catch (Exception exception)
        {
            Post("native-error", new { message = SafeError(exception) });
        }
    }

    private async Task IndexEnvironmentAsync()
    {
        var dialog = new OpenFolderDialog
        {
            Title = "Choose Skyrim Special Edition or its Data folder",
            Multiselect = false
        };
        if (dialog.ShowDialog(this) != true)
        {
            Post("index-cancelled", new { });
            return;
        }

        Post("index-started", new { });
        var chosen = dialog.FolderName;
        if (!EnvironmentDiscovery.TryNormalizeDataPath(chosen, out var dataPath))
            throw new DirectoryNotFoundException(
                "That folder is not Skyrim Special Edition or its Data folder.");
        _catalog = await Task.Run(() =>
            EnvironmentCatalog.Build(dataPath, "manual selection", autoDetected: false));
        Post("environment-indexed", _catalog.Summary);
    }

    private async Task AutoIndexEnvironmentAsync()
    {
        await Task.Delay(250);
        Post("environment-detection-started", new { });
        try
        {
            var location = await Task.Run(EnvironmentDiscovery.TryDiscover);
            if (location is null)
            {
                Post("environment-not-detected", new { });
                return;
            }

            Post("index-started", new
            {
                automatic = true,
                location.GameDataPath,
                location.DetectionMethod
            });
            _catalog = await Task.Run(() =>
                EnvironmentCatalog.Build(
                    location.GameDataPath,
                    location.DetectionMethod,
                    autoDetected: true));
            Post("environment-indexed", _catalog.Summary);
        }
        catch (Exception exception)
        {
            Post("environment-detection-failed", new { message = SafeError(exception) });
        }
    }

    private void ChooseTemplate()
    {
        var dialog = new OpenFileDialog
        {
            Title = "Choose a RaceMenu format-3 template",
            Filter = "RaceMenu preset (*.jslot)|*.jslot",
            CheckFileExists = true,
            Multiselect = false
        };
        if (dialog.ShowDialog(this) != true) return;
        _selectedPreset = CharGenCatalog.InspectTemplate(dialog.FileName);
        Post("template-loaded", CharGenCatalog.Load(_selectedPreset));
    }

    private void LoadIndexedTemplate(string? id)
    {
        if (_catalog is null || string.IsNullOrWhiteSpace(id) ||
            !_catalog.PresetsById.TryGetValue(id, out var preset))
        {
            throw new InvalidOperationException("The indexed preset is unavailable. Rebuild the environment index.");
        }
        _selectedPreset = preset;
        Post("template-loaded", CharGenCatalog.Load(preset));
    }

    /// <summary>
    /// Closes the RaceMenu round trip: once Skyrim has written the CharGen NIF/DDS pair for this
    /// name, adopt that baked head as the export source so a Follower Forge kit can be built.
    /// </summary>
    private void FindBakedHead(string? name)
    {
        if (_catalog is null)
            throw new InvalidOperationException(
                "Index Skyrim first so FaceForge knows which Data folder to check.");
        if (string.IsNullOrWhiteSpace(name))
            throw new InvalidOperationException("Give the preset a name before checking for its baked head.");

        var data = _catalog.Summary.GameDataPath;
        var baked = CharGenCatalog.FindBakedHead(data, name);
        if (baked is null)
        {
            Post("baked-head-missing", new
            {
                name,
                expectedNif = Path.Combine(data, "SKSE", "Plugins", "CharGen", name + ".nif")
            });
            return;
        }

        _selectedPreset = baked;
        Post("baked-head-found", CharGenCatalog.Load(baked));
    }

    /// <summary>
    /// Re-reads a finished preset and recomputes what it needs. A preset changes after FaceForge
    /// writes it -- picking different eyes, hair or a head mesh in RaceMenu rewrites the head-part
    /// list -- so the dependency report from export time no longer describes the file.
    /// </summary>
    private void InspectPreset()
    {
        var dialog = new OpenFileDialog
        {
            Title = "Choose a finished RaceMenu preset to inspect",
            Filter = "RaceMenu preset (*.jslot)|*.jslot",
            CheckFileExists = true,
            Multiselect = false,
            InitialDirectory = _catalog is null
                ? null
                : Path.Combine(_catalog.Summary.GameDataPath, "SKSE", "Plugins", "CharGen", "Presets")
        };
        if (dialog.ShowDialog(this) != true) return;

        var report = PresetInspector.Inspect(dialog.FileName, _catalog);
        // Adopt it as the export source too, so the share package carries the recomputed
        // requirements rather than the ones FaceForge guessed when it first wrote the file.
        _selectedPreset = CharGenCatalog.InspectTemplate(dialog.FileName);
        Post("preset-inspected", report);
        Post("template-loaded", CharGenCatalog.Load(_selectedPreset));
    }

    private void ResolveDependencies(IReadOnlyList<string> dependencies)
    {
        if (_catalog is null)
        {
            Post("dependencies-resolved", new
            {
                indexed = false,
                dependencies = dependencies.Select(name =>
                    new PluginProvider(name, null, false, false, 0, 0))
            });
            return;
        }
        Post("dependencies-resolved", new
        {
            indexed = true,
            dependencies = _catalog.ResolveDependencies(dependencies)
        });
    }

    private async Task RunVisionAsync(JsonElement root)
    {
        if (!root.GetProperty("consent").GetBoolean())
            throw new InvalidOperationException("Photo upload consent is required for vision refinement.");
        var provider = root.GetProperty("provider").GetString() ?? "";
        var image = root.GetProperty("imageDataUrl").GetString() ?? "";
        // The frontend already knows whether local landmarks succeeded and whether the source is
        // stylized. Both change what the model should be asked for and how far it may move a
        // value, so they must reach the request rather than being dropped here.
        var context = new OpenRouterVision.VisionContext(
            root.TryGetProperty("hasLocalAnalysis", out var localElement) &&
            localElement.ValueKind is JsonValueKind.True,
            root.TryGetProperty("sourceKind", out var kindElement) &&
            string.Equals(kindElement.GetString(), "stylized", StringComparison.OrdinalIgnoreCase));

        if (provider.Equals("openrouter", StringComparison.OrdinalIgnoreCase))
        {
            var apiKey = root.GetProperty("apiKey").GetString() ?? "";
            var model = root.GetProperty("model").GetString() ?? "";
            Post("vision-started", new { model });
            var openRouterResult = await _openRouterVision.AnalyzeAsync(apiKey, model, image, context);
            Post("vision-complete", openRouterResult);
            return;
        }
        if (!Enum.TryParse<CliVisionProviderKind>(provider, ignoreCase: true, out var kind))
            throw new InvalidOperationException("Choose a supported vision provider.");
        var status = CliVisionProvider.GetStatus(kind);
        Post("vision-started", new { model = status.DisplayName });
        var result = await _cliVision.AnalyzeAsync(kind, image, context);
        Post("vision-complete", result);
    }

    private void ConnectVisionProvider(string? provider)
    {
        if (!Enum.TryParse<CliVisionProviderKind>(provider, ignoreCase: true, out var kind))
            throw new InvalidOperationException("Choose ChatGPT, Claude, or Gemini first.");
        var status = CliVisionProvider.GetStatus(kind);
        if (!status.Installed || string.IsNullOrWhiteSpace(status.ExecutablePath))
        {
            OpenUrl(status.DocumentationUrl);
            Post("vision-connect-started", new
            {
                provider = status.Id,
                installed = false,
                message = $"{status.DisplayName} is not installed. The official setup page was opened."
            });
            return;
        }
        Process.Start(new ProcessStartInfo
        {
            FileName = status.ExecutablePath,
            WorkingDirectory = Path.GetTempPath(),
            UseShellExecute = true
        });
        Post("vision-connect-started", new
        {
            provider = status.Id,
            installed = true,
            message = $"Finish the official {status.DisplayName} sign-in in the terminal window, then close it."
        });
    }

    private static void OpenVisionProviderDocs(string? provider)
    {
        if (!Enum.TryParse<CliVisionProviderKind>(provider, ignoreCase: true, out var kind))
            throw new InvalidOperationException("Choose ChatGPT, Claude, or Gemini first.");
        OpenUrl(CliVisionProvider.GetStatus(kind).DocumentationUrl);
    }

    private static void OpenUrl(string url)
    {
        Process.Start(new ProcessStartInfo
        {
            FileName = url,
            UseShellExecute = true
        });
    }

    private void ExportPackage(JsonElement root)
    {
        var mode = root.GetProperty("mode").GetString() ?? "";
        var name = root.GetProperty("presetName").GetString() ?? "FaceForge_Preset";
        var jslot = root.GetProperty("jslotContents").GetString() ?? "";
        var preserve = root.GetProperty("preserveSculpt").GetBoolean();
        var permission = root.TryGetProperty("redistributionPermissionConfirmed", out var permissionElement)
                         && permissionElement.GetBoolean();
        var required = ReadStringArray(root, "dependencies");
        var selectedAppearance = root.TryGetProperty("appearanceChoices", out var choicesElement)
            ? JsonSerializer.Deserialize<List<AppearanceChoice>>(
                choicesElement.GetRawText(),
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? []
            : [];
        var resolved = _catalog?.ResolveDependencies(required) ??
                       required.Select(item =>
                           new PluginProvider(item, null, false, false, 0, 0)).ToList();
        var targetRace = root.TryGetProperty("targetRaceEditorId", out var raceElement) &&
                         raceElement.ValueKind == JsonValueKind.String
            ? raceElement.GetString()
            : null;
        var targetSex = root.TryGetProperty("targetSex", out var sexElement) &&
                        sexElement.ValueKind == JsonValueKind.String
            ? sexElement.GetString() ?? "female"
            : "female";

        var dialog = new SaveFileDialog
        {
            Title = mode == "follower-head-kit"
                ? "Export Follower Forge Head Kit"
                : mode == "racemenu-export-stage"
                    ? "Export RaceMenu Head Stage"
                    : "Export RaceMenu Preset Pack",
            Filter = "ZIP archive (*.zip)|*.zip",
            FileName = name + (mode == "follower-head-kit"
                ? "-Follower-Head-Kit.zip"
                : mode == "racemenu-export-stage"
                    ? "-RaceMenu-Head-Export.zip"
                    : "-RaceMenu-Preset-Pack.zip"),
            AddExtension = true,
            DefaultExt = ".zip",
            OverwritePrompt = true
        };
        if (dialog.ShowDialog(this) != true) return;

        var result = ExportPackager.Build(new ExportRequest(
            mode,
            dialog.FileName,
            name,
            jslot,
            _selectedPreset?.NifPath,
            _selectedPreset?.DdsPath,
            preserve,
            permission,
            resolved,
            selectedAppearance,
            targetRace,
            targetSex));
        Post("export-complete", result);
    }

    private void Post(string type, object payload)
    {
        if (Browser.CoreWebView2 is null) return;
        Browser.CoreWebView2.PostWebMessageAsJson(
            JsonSerializer.Serialize(new { type, payload }, JsonOptions));
    }

    private static IReadOnlyList<string> ReadStringArray(JsonElement root, string property)
    {
        if (!root.TryGetProperty(property, out var values) ||
            values.ValueKind != JsonValueKind.Array) return [];
        return values.EnumerateArray()
            .Select(item => item.GetString())
            .Where(item => !string.IsNullOrWhiteSpace(item))
            .Select(item => item!)
            .ToList();
    }

    private static string SafeError(Exception exception)
    {
        return exception switch
        {
            JsonException => "The local bridge received malformed data.",
            HttpRequestException => "The vision request could not reach the configured provider.",
            TaskCanceledException => "The operation timed out or was cancelled.",
            _ => exception.Message.Length <= 500
                ? exception.Message
                : exception.Message[..500]
        };
    }

    private void OnDownloadStarting(object? sender, CoreWebView2DownloadStartingEventArgs e)
    {
        var suggested = Path.GetFileName(e.ResultFilePath);
        if (string.IsNullOrWhiteSpace(suggested) ||
            !suggested.EndsWith(".jslot", StringComparison.OrdinalIgnoreCase))
        {
            suggested = "FaceForge_Preset.jslot";
        }

        var dialog = new SaveFileDialog
        {
            Title = "Export RaceMenu preset",
            Filter = "RaceMenu preset (*.jslot)|*.jslot",
            FileName = suggested,
            AddExtension = true,
            DefaultExt = ".jslot",
            OverwritePrompt = true
        };
        if (dialog.ShowDialog(this) == true)
            e.ResultFilePath = dialog.FileName;
        else
            e.Cancel = true;
    }
}
