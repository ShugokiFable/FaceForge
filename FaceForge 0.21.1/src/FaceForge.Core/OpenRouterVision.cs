using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace FaceForge.Core;

public sealed class OpenRouterVision(HttpClient? client = null)
{
    private static readonly Regex ImageDataUrl = new(
        @"^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    public static readonly string[] AllowedSliderKeys =
    [
        "EFM_Brow_Angle", "EFM_Brow_Height", "EFM_Brow_Width",
        "EFM_Cheek_Height", "EFM_Cheek_Width",
        "EFM_Chin_Height", "EFM_Chin_Shape", "EFM_Chin_Width",
        "EFM_Eyes_Height", "EFM_Eyes_Inner_Height", "EFM_Eyes_Lower_Height",
        "EFM_Eyes_Outer_Height", "EFM_Eyes_Size", "EFM_Eyes_Upper_Height",
        "EFM_Eyes_Width", "EFM_Face_Height", "EFM_Jaw_Height", "EFM_Jaw_Width",
        "EFM_Lip_Angle", "EFM_Lip_Height", "EFM_Lip_Lower_Thickness",
        "EFM_Lip_Lower_Width", "EFM_Lip_Upper_Thickness", "EFM_Lip_Upper_Width",
        "EFM_Lip_Width", "EFM_Nose_Bridge_Width", "EFM_Nose_Height",
        "EFM_Nose_Root_Height", "EFM_Nose_Size", "EFM_Nose_Tip_Height",
        "EFM_Nose_Tip_Width", "EFM_Nose_Width", "EFM_Nose_Wing_Height",
        "EFM_Nose_Wing_Width", "EFM_Philtrum_Width"
    ];

    /// <summary>
    /// What the model is being asked to do. Refinement nudges an existing local measurement;
    /// interpretation builds the whole face when the landmark model could not map the source.
    /// </summary>
    public sealed record VisionContext(bool HasLocalAnalysis, bool Stylized)
    {
        /// <summary>
        /// Delta bound. EFM sliders run to +/-3, so a +/-3 refinement delta could invert a local
        /// measurement outright; refinement is held to a third of the range. Interpreting from
        /// neutral has nothing to refine, so it gets the full range.
        /// </summary>
        public double Limit => HasLocalAnalysis ? 1 : 3;

        public static VisionContext Refinement { get; } = new(true, false);
    }

    private readonly HttpClient _client = client ?? new HttpClient
    {
        Timeout = TimeSpan.FromSeconds(90)
    };

    public static string BuildRequestJson(
        string model,
        string imageDataUrl,
        VisionContext? context = null)
    {
        var visionContext = context ?? VisionContext.Refinement;
        if (string.IsNullOrWhiteSpace(model) || model.Length > 160 || model.Any(char.IsWhiteSpace))
            throw new ArgumentException("Enter a valid OpenRouter image-capable model ID.", nameof(model));
        if (imageDataUrl.Length > 8_000_000 || !ImageDataUrl.IsMatch(imageDataUrl))
            throw new ArgumentException("The analysis image must be a JPEG, PNG, or WebP data URL under 8 MB.");

        var schema = BuildResultSchema(visionContext);

        var body = new
        {
            model,
            messages = new object[]
            {
                new
                {
                    role = "system",
                    content = BuildSystemPrompt(visionContext)
                },
                new
                {
                    role = "user",
                    content = new object[]
                    {
                        new
                        {
                            type = "text",
                            text = BuildUserPrompt(visionContext)
                        },
                        new { type = "image_url", image_url = new { url = imageDataUrl } }
                    }
                }
            },
            temperature = 0,
            max_tokens = 1200,
            stream = false,
            provider = new
            {
                require_parameters = true,
                data_collection = "deny",
                zdr = true
            },
            response_format = new
            {
                type = "json_schema",
                json_schema = new
                {
                    name = "faceforge_vision_refinement",
                    strict = true,
                    schema
                }
            }
        };
        return JsonSerializer.Serialize(body);
    }

    public static string BuildResultSchemaJson(VisionContext? context = null) =>
        JsonSerializer.Serialize(BuildResultSchema(context ?? VisionContext.Refinement));

    /// <summary>
    /// The two jobs need different instructions. Telling a model to "return deltas from the local
    /// estimate" when there is no local estimate produced timid, near-zero output for exactly the
    /// stylized sources that needed the model to do all the work.
    /// </summary>
    internal static string BuildSystemPrompt(VisionContext context)
    {
        var shared =
            "You interpret a portrait as a believable Skyrim RaceMenu face. " +
            "Do not identify the person or infer age, ethnicity, health, personality, or attractiveness. " +
            "Assess only visible facial geometry. ";
        var style = context.Stylized
            ? "This source is a stylized illustration. Retain its distinctive shape cues while normalizing oversized eyes, simplified noses, jaws, and lips toward plausible human anatomy, and do not copy art exaggeration literally. "
            : "This source is a photograph. Report the geometry you can see and do not stylize it. ";
        var job = context.HasLocalAnalysis
            ? "Local landmark measurement already produced an estimate. Return small corrective deltas to that estimate, not a description of the whole face. Use zero for anything the local measurement is likely to have got right."
            : "Local landmark measurement failed on this source, so your values are the entire result. Describe the whole face, not a correction, and use the full range where the geometry clearly calls for it.";
        return shared + style + job;
    }

    internal static string BuildUserPrompt(VisionContext context)
    {
        var limit = context.Limit.ToString("0.##", System.Globalization.CultureInfo.InvariantCulture);
        return
            "Review this source for face height/width, jaw, chin, eyes, brows, nose, and lips as they should appear in Skyrim. " +
            "Return all requested EFM values in the strict schema. " +
            $"Keep each value between -{limit} and {limit}, and use zero when uncertain.";
    }

    public async Task<VisionResult> AnalyzeAsync(
        string apiKey,
        string model,
        string imageDataUrl,
        VisionContext? context = null,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(apiKey))
            throw new ArgumentException("Enter an OpenRouter API key.");

        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            "https://openrouter.ai/api/v1/chat/completions");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey.Trim());
        request.Headers.UserAgent.ParseAdd("FaceForge/0.18.0");
        request.Headers.TryAddWithoutValidation("X-Title", "FaceForge");
        request.Content = new StringContent(
            BuildRequestJson(model, imageDataUrl, context),
            Encoding.UTF8,
            "application/json");

        using var response = await _client.SendAsync(request, cancellationToken);
        var content = await response.Content.ReadAsStringAsync(cancellationToken);
        if (!response.IsSuccessStatusCode)
            throw new InvalidOperationException(
                $"OpenRouter returned HTTP {(int)response.StatusCode}. Check the model, key, credits, and privacy routing.");
        return ParseResponse(model, content, context);
    }

    public static VisionResult ParseResponse(
        string model,
        string responseJson,
        VisionContext? context = null)
    {
        using var response = JsonDocument.Parse(responseJson);
        var content = response.RootElement
            .GetProperty("choices")[0]
            .GetProperty("message")
            .GetProperty("content")
            .GetString();
        if (string.IsNullOrWhiteSpace(content))
            throw new InvalidDataException("OpenRouter returned no structured content.");

        return ParseStructuredResult(model, content, context);
    }

    public static VisionResult ParseStructuredResult(
        string model,
        string content,
        VisionContext? context = null)
    {
        var limit = (context ?? VisionContext.Refinement).Limit;
        using var result = JsonDocument.Parse(content);
        var root = result.RootElement;
        var confidence = root.GetProperty("confidence").GetDouble();
        if (!double.IsFinite(confidence) || confidence is < 0 or > 1)
            throw new InvalidDataException("Vision confidence was outside 0..1.");

        var observations = root.GetProperty("observations")
            .EnumerateArray()
            .Select(item => item.GetString() ?? "")
            .Where(item => item.Length > 0)
            .Take(8)
            .ToList();
        var deltas = new Dictionary<string, double>(StringComparer.Ordinal);
        var deltaObject = root.GetProperty("slider_deltas");
        foreach (var key in AllowedSliderKeys)
        {
            if (!deltaObject.TryGetProperty(key, out var value))
                throw new InvalidDataException($"Vision result omitted required slider {key}.");
            var number = value.GetDouble();
            if (!double.IsFinite(number) || Math.Abs(number) > limit)
                throw new InvalidDataException(
                    $"Vision delta for {key} was outside -{limit}..{limit}.");
            deltas[key] = number;
        }
        foreach (var property in deltaObject.EnumerateObject())
        {
            if (!AllowedSliderKeys.Contains(property.Name, StringComparer.Ordinal))
                throw new InvalidDataException($"Vision result returned unsupported slider {property.Name}.");
        }

        return new VisionResult(model, confidence, observations, deltas);
    }

    private static object BuildResultSchema(VisionContext context)
    {
        var sliderProperties = AllowedSliderKeys.ToDictionary(
            key => key,
            _ => (object)new Dictionary<string, object>
            {
                ["type"] = "number",
                ["minimum"] = -context.Limit,
                ["maximum"] = context.Limit,
                ["description"] = context.HasLocalAnalysis
                    ? "Conservative additive adjustment to the existing local EFM estimate."
                    : "Absolute EFM value for this feature, built from the image alone."
            });
        return new
        {
            type = "object",
            properties = new Dictionary<string, object>
            {
                ["confidence"] = new Dictionary<string, object>
                {
                    ["type"] = "number", ["minimum"] = 0, ["maximum"] = 1
                },
                ["observations"] = new Dictionary<string, object>
                {
                    ["type"] = "array",
                    ["maxItems"] = 8,
                    ["items"] = new Dictionary<string, object>
                    {
                        ["type"] = "string", ["maxLength"] = 180
                    }
                },
                ["slider_deltas"] = new Dictionary<string, object>
                {
                    ["type"] = "object",
                    ["properties"] = sliderProperties,
                    ["required"] = AllowedSliderKeys,
                    ["additionalProperties"] = false
                }
            },
            required = new[] { "confidence", "observations", "slider_deltas" },
            additionalProperties = false
        };
    }
}
