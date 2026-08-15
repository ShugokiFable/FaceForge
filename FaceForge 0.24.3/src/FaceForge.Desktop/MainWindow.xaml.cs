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
        // A borderless (WindowStyle=None) window maximizes over the whole screen, covering the taskbar
        // and clipping the footer's export button. Constrain the maximized size to the monitor work area.
        SourceInitialized += (_, _) =>
            HwndSource.FromHwnd(new WindowInteropHelper(this).Handle)?.AddHook(MaximizeHook);
    }

    private const int WmGetMinMaxInfo = 0x0024;
    private const uint MonitorDefaultToNearest = 0x00000002;

    [DllImport("user32.dll")]
    private static extern IntPtr MonitorFromWindow(IntPtr handle, uint flags);

    [DllImport("user32.dll")]
    private static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);

    [StructLayout(LayoutKind.Sequential)]
    private struct Rect { public int Left, Top, Right, Bottom; }

    [StructLayout(LayoutKind.Sequential)]
    private struct MonitorInfo { public int Size; public Rect Monitor; public Rect Work; public uint Flags; }

    [StructLayout(LayoutKind.Sequential)]
    private struct Point { public int X, Y; }

    [StructLayout(LayoutKind.Sequential)]
    private struct MinMaxInfo { public Point Reserved, MaxSize, MaxPosition, MinTrackSize, MaxTrackSize; }

    private static IntPtr MaximizeHook(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        if (msg != WmGetMinMaxInfo) return IntPtr.Zero;
        var monitor = MonitorFromWindow(hwnd, MonitorDefaultToNearest);
        if (monitor == IntPtr.Zero) return IntPtr.Zero;
        var info = new MonitorInfo { Size = Marshal.SizeOf<MonitorInfo>() };
        if (!GetMonitorInfo(monitor, ref info)) return IntPtr.Zero;
        var mmi = Marshal.PtrToStructure<MinMaxInfo>(lParam);
        mmi.MaxPosition.X = info.Work.Left - info.Monitor.Left;
        mmi.MaxPosition.Y = info.Work.Top - info.Monitor.Top;
        mmi.MaxSize.X = info.Work.Right - info.Work.Left;
        mmi.MaxSize.Y = info.Work.Bottom - info.Work.Top;
        Marshal.StructureToPtr(mmi, lParam, true);
        handled = true;
        return IntPtr.Zero;
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
                DescribeStartupFailure(exception),
                "FaceForge could not initialize WebView2",
                MessageBoxButton.OK,
                MessageBoxImage.Error);
            Close();
        }
    }

    /// <summary>
    /// Mod Organizer 2 launches a tool inside its virtual file system, and WebView2's
    /// loader does not survive that: it fails here with a message that says nothing
    /// about MO2, so the user retries under MO2 forever.
    ///
    /// FaceForge never needs to run inside MO2. It only *reads* the mod setup from
    /// disk, so launching it directly works and sees exactly the same mods.
    /// </summary>
    private static string DescribeStartupFailure(Exception exception)
    {
        if (!IsRunningUnderModOrganizer()) return exception.Message;
        return
            "FaceForge appears to have been launched through Mod Organizer 2.\n\n"
            + "MO2 runs tools inside its virtual file system, which WebView2 cannot start under.\n\n"
            + "Close this and run FaceForge.exe directly instead — double-click it outside MO2. "
            + "FaceForge only reads your mod setup, so it finds the same mods either way. "
            + "If it does not detect them, use Settings → Re-Index and point it at your MO2 "
            + "mods folder.\n\n"
            + $"Underlying error: {exception.Message}";
    }

    /// <summary>
    /// USVFS is the library MO2 injects to virtualize the file system, so its presence
    /// in this process is the reliable signal, independent of MO2 version or profile.
    /// </summary>
    private static bool IsRunningUnderModOrganizer()
    {
        try
        {
            foreach (ProcessModule module in Process.GetCurrentProcess().Modules)
            {
                var name = module.ModuleName;
                if (name is not null && name.StartsWith("usvfs", StringComparison.OrdinalIgnoreCase))
                    return true;
            }
        }
        catch
        {
            // Enumerating modules can be denied; fall back to treating it as a normal launch.
        }
        return !string.IsNullOrEmpty(Environment.GetEnvironmentVariable("MO_PROFILE"));
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
                case "browse-mo2-mods":
                    BrowseMo2Mods();
                    break;
                case "mo2-list-profiles":
                    ListMo2Profiles(root.TryGetProperty("path", out var pathElement)
                        ? pathElement.GetString()
                        : null);
                    break;
                case "index-mo2":
                    await IndexMo2Async(root);
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
                case "render-heads":
                    await RenderHeadsAsync(root);
                    break;
                case "compute-sculpt":
                    await ComputeSculptAsync(root);
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
                case "save-debug":
                    SaveDebug(root);
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

    /// <summary>
    /// Opens a folder picker for the MO2 mods folder, then immediately lists the instance's profiles
    /// so the user does not have to type the path.
    /// </summary>
    private void BrowseMo2Mods()
    {
        var dialog = new OpenFolderDialog
        {
            Title = "Choose your MO2 mods folder (for example E:\\MO2\\mods)",
            Multiselect = false
        };
        if (dialog.ShowDialog(this) != true) return;
        ListMo2Profiles(dialog.FolderName);
    }

    /// <summary>
    /// Resolves the MO2 instance around a mods folder and reports its profiles and managed game path
    /// back to the interface, so the profile dropdown can be populated.
    /// </summary>
    private void ListMo2Profiles(string? path)
    {
        if (string.IsNullOrWhiteSpace(path))
        {
            Post("mo2-error", new { message = "Enter the path to your MO2 mods folder first." });
            return;
        }
        try
        {
            var layout = Mo2Environment.Inspect(path);
            Post("mo2-profiles", new
            {
                modsPath = layout.ModsPath,
                profilesDir = layout.ProfilesDir,
                gameDataPath = layout.GameDataPath,
                profiles = layout.Profiles
            });
        }
        catch (Exception exception)
        {
            Post("mo2-error", new { message = SafeError(exception) });
        }
    }

    /// <summary>
    /// Builds the environment index from an MO2 profile: the enabled mods, in priority order, with
    /// only the profile's active plugins counted as installed.
    /// </summary>
    private async Task IndexMo2Async(JsonElement root)
    {
        var modsPath = root.TryGetProperty("modsPath", out var modsElement)
            ? modsElement.GetString()
            : null;
        var profile = root.TryGetProperty("profile", out var profileElement)
            ? profileElement.GetString()
            : null;
        if (string.IsNullOrWhiteSpace(modsPath) || string.IsNullOrWhiteSpace(profile))
        {
            Post("mo2-error", new { message = "Choose the MO2 mods folder and a profile before indexing." });
            return;
        }

        Post("index-started", new { automatic = false, mo2 = true, profile });
        try
        {
            _catalog = await Task.Run(() =>
                EnvironmentCatalog.BuildFromMo2(Mo2Environment.BuildOverlay(modsPath, profile)));
            Post("environment-indexed", _catalog.Summary);
        }
        catch (Exception exception)
        {
            Post("mo2-error", new { message = SafeError(exception) });
        }
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
    /// name, adopt that baked head as the export source so a FollowerForge kit can be built.
    /// </summary>
    private void FindBakedHead(string? name)
    {
        if (_catalog is null)
            throw new InvalidOperationException(
                "Index Skyrim first so FaceForge knows which Data folder to check.");
        if (string.IsNullOrWhiteSpace(name))
            throw new InvalidOperationException("Give the preset a name before checking for its baked head.");

        var baked = _catalog.FindBakedHead(name);
        if (baked is null)
        {
            Post("baked-head-missing", new
            {
                name,
                expectedNif = Path.Combine(
                    _catalog.View.WriteRoot, "SKSE", "Plugins", "CharGen", name + ".nif")
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
                : Path.Combine(_catalog.View.WriteRoot, "SKSE", "Plugins", "CharGen", "Presets")
        };
        if (dialog.ShowDialog(this) != true) return;

        var report = PresetInspector.Inspect(dialog.FileName, _catalog);
        // Adopt it as the export source too, so the share package carries the recomputed
        // requirements rather than the ones FaceForge guessed when it first wrote the file.
        _selectedPreset = CharGenCatalog.InspectTemplate(dialog.FileName);
        Post("preset-inspected", report);
        Post("template-loaded", CharGenCatalog.Load(_selectedPreset));
    }

    /// <summary>
    /// Renders the player's actual chargen head for a batch of (slider set, pose) requests and returns
    /// the images as data URLs. This is the forward model the frontend "Analyze &amp; improve" loop drives:
    /// it renders candidate slider sets at each uploaded photo's pose, then measures the render with the
    /// same MediaPipe pipeline the photos use. Batched so an optimizer step is one round trip.
    /// </summary>
    private async Task RenderHeadsAsync(JsonElement root)
    {
        if (_catalog is null)
        {
            Post("heads-rendered", new { requestId = ReadRequestId(root), images = Array.Empty<object>(), error = "Index Skyrim first." });
            return;
        }

        var sex = root.TryGetProperty("sex", out var sexElement) &&
                  string.Equals(sexElement.GetString(), "male", StringComparison.OrdinalIgnoreCase)
            ? "male" : "female";
        var highPoly = root.TryGetProperty("highPoly", out var hp) && hp.ValueKind == JsonValueKind.True;
        var race = root.TryGetProperty("race", out var raceElement) && raceElement.ValueKind == JsonValueKind.String
            ? raceElement.GetString()
            : null;
        var size = root.TryGetProperty("size", out var sizeElement) && sizeElement.TryGetInt32(out var s)
            ? Math.Clamp(s, 128, 768)
            : 384;

        var requests = new List<(string Id, Dictionary<string, double> Sliders, double Yaw, double Pitch, bool Textured, double WidthScale, double HeightScale, double NoseForward, double JawRaise)>();
        if (root.TryGetProperty("requests", out var requestArray) && requestArray.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in requestArray.EnumerateArray())
            {
                if (requests.Count >= 300) break; // a runaway-loop backstop
                var id = item.TryGetProperty("id", out var idElement) ? idElement.GetString() ?? "" : "";
                var yaw = item.TryGetProperty("yaw", out var yawElement) && yawElement.TryGetDouble(out var y) ? y : 0;
                var pitch = item.TryGetProperty("pitch", out var pitchElement) && pitchElement.TryGetDouble(out var p)
                    ? p : double.NaN;
                var textured = item.TryGetProperty("textured", out var texturedElement) && texturedElement.ValueKind == JsonValueKind.True;
                var widthScale = item.TryGetProperty("faceWidthScale", out var fwElement) && fwElement.TryGetDouble(out var fw) ? fw : 1.0;
                var heightScale = item.TryGetProperty("faceHeightScale", out var fhElement) && fhElement.TryGetDouble(out var fh) ? fh : 1.0;
                var noseForward = item.TryGetProperty("noseForward", out var nfElement) && nfElement.TryGetDouble(out var nf) ? nf : 0.0;
                var jawRaise = item.TryGetProperty("jawRaise", out var jrElement) && jrElement.TryGetDouble(out var jr) ? jr : 0.0;
                var sliders = new Dictionary<string, double>(StringComparer.OrdinalIgnoreCase);
                if (item.TryGetProperty("sliders", out var sliderObject) && sliderObject.ValueKind == JsonValueKind.Object)
                    foreach (var property in sliderObject.EnumerateObject())
                        if (property.Value.TryGetDouble(out var value)) sliders[property.Name] = value;
                requests.Add((id, sliders, yaw, pitch, textured, widthScale, heightScale, noseForward, jawRaise));
            }
        }

        var view = _catalog.View;
        var morphInfo = _catalog.Summary.MorphRegistry;
        var bsaMorphs = _catalog.BsaMorphs;
        var images = await Task.Run(() =>
        {
            var results = new (string Id, string? DataUrl)[requests.Count];
            Parallel.For(0, requests.Count, index =>
            {
                var (id, sliders, yaw, pitch, textured, widthScale, heightScale, noseForward, jawRaise) = requests[index];
                var png = HeadRenderer.RenderPng(view, morphInfo,
                    new HeadRenderer.RenderRequest(sex, highPoly, race, sliders, yaw, pitch, size, textured,
                        widthScale, heightScale, noseForward, jawRaise), bsaMorphs);
                results[index] = (id, png is null ? null : "data:image/png;base64," + Convert.ToBase64String(png));
            });
            return results;
        });

        Post("heads-rendered", new
        {
            requestId = ReadRequestId(root),
            images = images
                .Where(item => item.DataUrl is not null)
                .Select(item => new { id = item.Id, dataUrl = item.DataUrl })
        });
    }

    /// <summary>
    /// Converts the reshape carried on the export slider set into RaceMenu sculpt deltas for the head,
    /// eyes and brows, so the elongation / nose-forward / jaw-lift the preview shows are written into
    /// the exported preset and appear in-game. Mirrors the render-heads request shape.
    /// </summary>
    private async Task ComputeSculptAsync(JsonElement root)
    {
        var requestId = ReadRequestId(root);
        if (_catalog is null)
        {
            Post("sculpt-computed", new { requestId, sculpt = Array.Empty<object>(), divisor = 10000, error = "Index Skyrim first." });
            return;
        }

        var sex = root.TryGetProperty("sex", out var sexElement) &&
                  string.Equals(sexElement.GetString(), "male", StringComparison.OrdinalIgnoreCase)
            ? "male" : "female";
        var highPoly = root.TryGetProperty("highPoly", out var hp) && hp.ValueKind == JsonValueKind.True;
        var race = root.TryGetProperty("race", out var raceElement) && raceElement.ValueKind == JsonValueKind.String
            ? raceElement.GetString()
            : null;
        double Reshape(string name, double fallback) =>
            root.TryGetProperty(name, out var element) && element.TryGetDouble(out var value) ? value : fallback;
        var sliders = new Dictionary<string, double>(StringComparer.OrdinalIgnoreCase);
        if (root.TryGetProperty("sliders", out var sliderObject) && sliderObject.ValueKind == JsonValueKind.Object)
            foreach (var property in sliderObject.EnumerateObject())
                if (property.Value.TryGetDouble(out var value)) sliders[property.Name] = value;

        var request = new HeadRenderer.RenderRequest(sex, highPoly, race, sliders,
            FaceWidthScale: Reshape("faceWidthScale", 1.0),
            FaceHeightScale: Reshape("faceHeightScale", 1.0),
            NoseForward: Reshape("noseForward", 0.0),
            JawRaise: Reshape("jawRaise", 0.0));

        var view = _catalog.View;
        var morphInfo = _catalog.Summary.MorphRegistry;
        var bsaMorphs = _catalog.BsaMorphs;
        var sculpt = await Task.Run(() => HeadRenderer.ComputeSculpt(view, morphInfo, request, bsaMorphs));

        Post("sculpt-computed", new
        {
            requestId,
            divisor = 10000,
            sculpt = (sculpt ?? new List<HeadRenderer.SculptPart>())
                .Select(part => new { host = part.Host, vertices = part.Vertices, data = part.Data })
        });
    }

    private static string ReadRequestId(JsonElement root) =>
        root.TryGetProperty("requestId", out var element) && element.ValueKind == JsonValueKind.String
            ? element.GetString() ?? ""
            : "";

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

        // New multi-image payload: the target photo AND FaceForge's current render, each labelled,
        // from up to three angles, plus the current slider values -- so the model sees the gap. Falls
        // back to the legacy single "imageDataUrl" when the frontend sends only the photo.
        var images = new List<OpenRouterVision.VisionImage>();
        if (root.TryGetProperty("images", out var imagesElement) && imagesElement.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in imagesElement.EnumerateArray())
            {
                var label = item.TryGetProperty("label", out var labelElement) ? labelElement.GetString() ?? "" : "";
                var url = item.TryGetProperty("dataUrl", out var urlElement) ? urlElement.GetString() ?? "" : "";
                if (!string.IsNullOrEmpty(url)) images.Add(new OpenRouterVision.VisionImage(label, url));
            }
        }
        else if (root.TryGetProperty("imageDataUrl", out var single) && single.ValueKind == JsonValueKind.String)
        {
            images.Add(new OpenRouterVision.VisionImage("Target portrait (front)", single.GetString() ?? ""));
        }
        if (images.Count == 0)
            throw new InvalidOperationException("No image was supplied for vision analysis.");

        var sliderContext = root.TryGetProperty("sliderContext", out var sliderElement) &&
                            sliderElement.ValueKind == JsonValueKind.String
            ? sliderElement.GetString()
            : null;
        var assess = root.TryGetProperty("assess", out var assessElement) &&
                     assessElement.ValueKind == JsonValueKind.True;

        // The frontend already knows whether local landmarks succeeded and whether the source is
        // stylized. Both change what the model should be asked for and how far it may move a
        // value, so they must reach the request rather than being dropped here.
        var trustedLocalAnalysis = root.TryGetProperty("analysisMode", out var modeElement)
            ? modeElement.GetString() switch
            {
                "refine" => true,
                "interpret" => false,
                _ => throw new InvalidDataException("Vision analysis mode must be refine or interpret.")
            }
            : root.TryGetProperty("hasLocalAnalysis", out var localElement) &&
              localElement.ValueKind is JsonValueKind.True;
        var context = new OpenRouterVision.VisionContext(
            trustedLocalAnalysis,
            root.TryGetProperty("sourceKind", out var kindElement) &&
            string.Equals(kindElement.GetString(), "stylized", StringComparison.OrdinalIgnoreCase),
            assess);

        if (provider.Equals("openrouter", StringComparison.OrdinalIgnoreCase))
        {
            var apiKey = root.GetProperty("apiKey").GetString() ?? "";
            var model = root.GetProperty("model").GetString() ?? "";
            Post("vision-started", new { model });
            var openRouterResult = await _openRouterVision.AnalyzeAsync(apiKey, model, images, sliderContext, context);
            Post("vision-complete", openRouterResult);
            return;
        }
        if (!Enum.TryParse<CliVisionProviderKind>(provider, ignoreCase: true, out var kind))
            throw new InvalidOperationException("Choose a supported vision provider.");
        var status = CliVisionProvider.GetStatus(kind);
        Post("vision-started", new { model = status.DisplayName });
        var result = await _cliVision.AnalyzeAsync(kind, images, sliderContext, context);
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

    // DEBUG TRACE sink: writes one fit pass's renders + numeric log to Documents\FaceForge Debug\<base>\.
    // Gated on the frontend by the fit.ts DEBUG constant; here it just persists whatever it is handed.
    private void SaveDebug(JsonElement root)
    {
        var baseName = Sanitize(root.TryGetProperty("baseName", out var bn) ? bn.GetString() : null) ?? "fit";
        var pass = root.TryGetProperty("pass", out var pe) && pe.TryGetInt32(out var p) ? p : 0;
        var reset = root.TryGetProperty("reset", out var re) && re.ValueKind == JsonValueKind.True;
        var dir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
            "FaceForge Debug", baseName);
        if (reset && Directory.Exists(dir))
        {
            try { Directory.Delete(dir, true); } catch { /* best effort */ }
        }
        Directory.CreateDirectory(dir);

        void WritePng(string prop, string suffix)
        {
            if (!root.TryGetProperty(prop, out var el) || el.ValueKind != JsonValueKind.String) return;
            var bytes = DecodeDataUrl(el.GetString());
            if (bytes is not null) File.WriteAllBytes(Path.Combine(dir, $"pass{pass:D2}_{suffix}.png"), bytes);
        }
        WritePng("front", "front");
        WritePng("profile", "profile");

        if (root.TryGetProperty("log", out var logEl) && logEl.ValueKind == JsonValueKind.String)
        {
            var logPath = Path.Combine(dir, "trace.md");
            var text = logEl.GetString() ?? "";
            if (reset) File.WriteAllText(logPath, text);
            else File.AppendAllText(logPath, text);
        }
        Post("debug-saved", new { folder = dir, pass });
    }

    private static byte[]? DecodeDataUrl(string? dataUrl)
    {
        if (string.IsNullOrEmpty(dataUrl)) return null;
        var comma = dataUrl.IndexOf(',');
        var b64 = comma >= 0 ? dataUrl[(comma + 1)..] : dataUrl;
        try { return Convert.FromBase64String(b64); } catch { return null; }
    }

    private static string? Sanitize(string? name)
    {
        if (string.IsNullOrWhiteSpace(name)) return null;
        var cleaned = new string(name.Where(c => !Path.GetInvalidFileNameChars().Contains(c)).ToArray());
        return string.IsNullOrWhiteSpace(cleaned) ? null : cleaned.Trim();
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
                ? "Export FollowerForge Head Kit"
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
