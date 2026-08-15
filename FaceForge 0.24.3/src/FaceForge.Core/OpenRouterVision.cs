using System.Net;
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
    /// interpretation builds the whole face when the landmark model could not map the source;
    /// assessment is a read-only critique (a 0-100 match rating plus comments, no slider changes)
    /// used by the "Analyze fit" button so the user can judge a manual tweak.
    /// </summary>
    public sealed record VisionContext(bool HasLocalAnalysis, bool Stylized, bool Assess = false)
    {
        /// <summary>
        /// Delta bound. EFM sliders run to +/-3, so a +/-3 refinement delta could invert a local
        /// measurement outright; refinement is held to a third of the range. Interpreting from
        /// neutral has nothing to refine, so it gets the full range.
        /// </summary>
        public double Limit => HasLocalAnalysis ? 1 : 3;

        public static VisionContext Refinement { get; } = new(true, false);
        public static VisionContext Assessment { get; } = new(true, false, true);
    }

    /// <summary>A labelled image sent to the model: the target photo or a FaceForge render, at some angle.</summary>
    public sealed record VisionImage(string Label, string DataUrl);

    private readonly HttpClient _client = client ?? new HttpClient
    {
        Timeout = TimeSpan.FromSeconds(90)
    };

    public static string BuildRequestJson(
        string model,
        string imageDataUrl,
        VisionContext? context = null) =>
        BuildRequestJson(model, [new VisionImage("Target portrait (front)", imageDataUrl)], null, context);

    /// <summary>
    /// Multi-image request: the target photo from up to three angles AND FaceForge's current render
    /// from the same angles, plus the current slider values as text, so the model can see the gap
    /// between what FaceForge produces and the photo instead of guessing from the photo alone.
    /// </summary>
    public static string BuildRequestJson(
        string model,
        IReadOnlyList<VisionImage> images,
        string? sliderContext,
        VisionContext? context = null)
    {
        var visionContext = context ?? VisionContext.Refinement;
        if (string.IsNullOrWhiteSpace(model) || model.Length > 160 || model.Any(char.IsWhiteSpace))
            throw new ArgumentException("Enter a valid OpenRouter image-capable model ID.", nameof(model));
        if (images is null || images.Count == 0)
            throw new ArgumentException("At least one image is required.", nameof(images));
        if (images.Count > 8)
            throw new ArgumentException("Too many images for one vision request.", nameof(images));
        foreach (var image in images)
            if (image.DataUrl.Length > 8_000_000 || !ImageDataUrl.IsMatch(image.DataUrl))
                throw new ArgumentException("Each analysis image must be a JPEG, PNG, or WebP data URL under 8 MB.");

        var schema = BuildResultSchema(visionContext);

        var userContent = new List<object>
        {
            new { type = "text", text = BuildUserPrompt(visionContext, images.Count, sliderContext) }
        };
        foreach (var image in images)
        {
            userContent.Add(new { type = "text", text = image.Label });
            userContent.Add(new { type = "image_url", image_url = new { url = image.DataUrl } });
        }

        var body = new
        {
            model,
            messages = new object[]
            {
                new { role = "system", content = BuildSystemPrompt(visionContext) },
                new { role = "user", content = userContent.ToArray() }
            },
            temperature = 0,
            // Generous ceilings: 700 truncated the assess reply on models that emit a little prose or
            // reasoning before the JSON, which surfaced as "returned truncated JSON". The payloads are
            // small either way, so headroom costs little and stops the parse failing mid-object.
            max_tokens = visionContext.Assess ? 2000 : 1600,
            stream = false,
            // Provider routing is a filter, and every clause narrows the pool. Asking for
            // zero-data-retention endpoints AND strict structured-output support at the
            // same time left no endpoint for any model, and OpenRouter reports an empty
            // pool as HTTP 404 — so every request failed, whatever model was entered.
            //
            // data_collection "deny" is kept: it is the clause that actually protects the
            // photograph, and it is widely supported. require_parameters is dropped so a
            // provider that ignores response_format still routes; the reply is parsed
            // leniently below for exactly that case.
            provider = new
            {
                data_collection = "deny"
            },
            response_format = new
            {
                type = "json_schema",
                json_schema = new
                {
                    name = "faceforge_vision",
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
        // When both the photo and FaceForge's own render are supplied, the task is a comparison, and
        // the profile views carry the depth cues (nose/chin/brow/lip projection) a front view hides.
        var compare =
            "You may be shown the TARGET portrait from up to three angles (front, left, right) AND FaceForge's " +
            "CURRENT Skyrim render from the same angles, each image labelled. When a current render is present, " +
            "judge how the render differs from the photo, feature by feature. The side/profile views are the only " +
            "views that reveal depth -- nose projection and tip up/down, chin projection, brow-ridge prominence, " +
            "lip projection -- so use them for anything front-on cannot show. ";
        var style = context.Stylized
            ? "This source is a stylized illustration. Retain its distinctive silhouette, eye spacing and angle, brow direction, and relative nose and mouth proportions while normalizing oversized eyes, simplified noses, jaws, and lips toward plausible human anatomy. Do not copy art exaggeration literally or collapse a distinctive face to a generic neutral face. "
            : "The portrait is a photograph. Report the geometry you can see and do not stylize it. ";
        var job = context.Assess
            ? "Do NOT change any sliders. Rate from 0 to 100 how closely the current render matches the target portrait across all supplied angles (fit_score), and give short, specific comments on what still differs most (shape, proportions, individual features), most important first."
            : context.HasLocalAnalysis
                ? "A local estimate and its current render are given. Return small corrective deltas that move the render toward the photo, not a description of the whole face. Use zero for anything already matching."
                : "Local landmark measurement is unavailable or too unreliable to use on this source, so your values are the entire result. Describe the whole face, not a correction, and use the full range where the geometry clearly calls for it.";
        return shared + compare + style + job;
    }

    internal static string BuildUserPrompt(VisionContext context, int imageCount = 1, string? sliderContext = null)
    {
        var limit = context.Limit.ToString("0.##", System.Globalization.CultureInfo.InvariantCulture);
        var sliders = string.IsNullOrWhiteSpace(sliderContext)
            ? ""
            : $"The render was produced by these current EFM slider values (name: value):\n{sliderContext}\n";
        if (context.Assess)
        {
            return
                sliders +
                "Compare the labelled target-photo and current-render images. " +
                "Return raw JSON with fit_score (integer 0-100, how well the render matches the photo) and up to 8 short observations " +
                "naming the biggest remaining differences, most important first. Do not return slider values.";
        }
        return
            sliders +
            "Compare the labelled images (target photo vs current render, all angles) for face height/width, jaw, chin, eyes, brows, nose, and lips. " +
            "Return all requested EFM values in the strict schema. " +
            $"Keep each value between -{limit} and {limit}. " +
            (context.HasLocalAnalysis
                ? "Use zero when the render already matches the photo for that feature or the images give no better evidence."
                : "Use zero only when the image gives no usable cue; preserve clearly distinctive feature relationships.");
    }

    public Task<VisionResult> AnalyzeAsync(
        string apiKey,
        string model,
        string imageDataUrl,
        VisionContext? context = null,
        CancellationToken cancellationToken = default) =>
        AnalyzeAsync(apiKey, model, [new VisionImage("Target portrait (front)", imageDataUrl)], null, context, cancellationToken);

    public async Task<VisionResult> AnalyzeAsync(
        string apiKey,
        string model,
        IReadOnlyList<VisionImage> images,
        string? sliderContext,
        VisionContext? context = null,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(apiKey))
            throw new ArgumentException("Enter an OpenRouter API key.");

        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            "https://openrouter.ai/api/v1/chat/completions");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey.Trim());
        request.Headers.UserAgent.ParseAdd("FaceForge/0.24.28");
        request.Headers.TryAddWithoutValidation("X-Title", "FaceForge");
        request.Content = new StringContent(
            BuildRequestJson(model, images, sliderContext, context),
            Encoding.UTF8,
            "application/json");

        using var response = await _client.SendAsync(request, cancellationToken);
        var content = await response.Content.ReadAsStringAsync(cancellationToken);
        if (!response.IsSuccessStatusCode)
            throw new InvalidOperationException(DescribeFailure(response.StatusCode, content));
        return ParseResponse(model, content, context);
    }

    /// <summary>
    /// Builds a failure message that repeats what OpenRouter actually said. The previous
    /// generic text ("check the model, key, credits, and privacy routing") gave the user
    /// no way to tell an unknown model from an empty provider pool from a spent balance.
    /// </summary>
    internal static string DescribeFailure(HttpStatusCode status, string responseBody)
    {
        var detail = ExtractErrorMessage(responseBody);
        var advice = status switch
        {
            HttpStatusCode.NotFound =>
                " No endpoint matched. The model ID may be wrong, or no provider for it accepts images under a no-training data policy. Try another image-capable model.",
            HttpStatusCode.Unauthorized => " The API key was rejected.",
            HttpStatusCode.PaymentRequired => " The OpenRouter account is out of credit.",
            HttpStatusCode.TooManyRequests => " Rate limited; wait and retry.",
            _ => ""
        };
        return $"OpenRouter returned HTTP {(int)status}."
            + (detail.Length > 0 ? $" {detail}" : "")
            + advice;
    }

    private static string ExtractErrorMessage(string responseBody)
    {
        if (string.IsNullOrWhiteSpace(responseBody)) return "";
        try
        {
            using var document = JsonDocument.Parse(responseBody);
            if (document.RootElement.TryGetProperty("error", out var error))
            {
                if (error.ValueKind == JsonValueKind.String) return Trim(error.GetString());
                if (error.TryGetProperty("message", out var message)) return Trim(message.GetString());
            }
        }
        catch (JsonException)
        {
            // Not JSON; fall through and quote the raw body instead.
        }
        return Trim(responseBody);
    }

    private static string Trim(string? value)
    {
        var text = (value ?? "").Replace('\n', ' ').Replace('\r', ' ').Trim();
        return text.Length > 300 ? text[..300] + "…" : text;
    }

    public static VisionResult ParseResponse(
        string model,
        string responseJson,
        VisionContext? context = null)
    {
        using var response = JsonDocument.Parse(responseJson);
        if (!response.RootElement.TryGetProperty("choices", out var choices) ||
            choices.ValueKind != JsonValueKind.Array || choices.GetArrayLength() == 0)
            throw new InvalidDataException(
                "OpenRouter returned no choices. Confirm the model ID is a vision (image-understanding) model.");

        var message = choices[0].TryGetProperty("message", out var messageElement)
            ? messageElement
            : default;
        var content = ExtractMessageText(message);
        if (string.IsNullOrWhiteSpace(content))
            throw new InvalidDataException(DescribeEmptyContent(message, choices[0]));

        return ParseStructuredResult(model, content, context);
    }

    /// <summary>
    /// Pulls the text out of an OpenRouter message, whether the provider returned <c>content</c> as a
    /// plain string or as a multimodal parts array (<c>[{ "type": "text", "text": ... }]</c>).
    /// </summary>
    private static string ExtractMessageText(JsonElement message)
    {
        if (message.ValueKind != JsonValueKind.Object) return "";
        if (!message.TryGetProperty("content", out var content)) return "";
        if (content.ValueKind == JsonValueKind.String) return content.GetString() ?? "";
        if (content.ValueKind == JsonValueKind.Array)
        {
            var builder = new StringBuilder();
            foreach (var part in content.EnumerateArray())
            {
                if (part.ValueKind != JsonValueKind.Object) continue;
                if (part.TryGetProperty("text", out var text) && text.ValueKind == JsonValueKind.String)
                    builder.Append(text.GetString());
            }
            return builder.ToString();
        }
        return "";
    }

    /// <summary>
    /// The most common cause of an empty reply is picking an image-<em>generation</em> model (its
    /// output is an image, not the text/JSON FaceForge asks for). The message names that explicitly
    /// so the user knows to switch models rather than retrying the same one.
    /// </summary>
    private static string DescribeEmptyContent(JsonElement message, JsonElement choice)
    {
        _ = choice;
        var producedImage = message.ValueKind == JsonValueKind.Object &&
                            message.TryGetProperty("images", out _);

        var refusal = message.ValueKind == JsonValueKind.Object &&
                      message.TryGetProperty("refusal", out var refusalText) &&
                      refusalText.ValueKind == JsonValueKind.String &&
                      !string.IsNullOrWhiteSpace(refusalText.GetString())
            ? " The model refused: " + Trim(refusalText.GetString())
            : "";

        return
            "The model returned no text to analyze"
            + (producedImage ? " (it returned an image instead). " : ". ")
            + "This usually means an image-generation model was selected. Choose a vision "
            + "(image-understanding) model that reads a photo and replies with text — for example "
            + "google/gemini-2.5-flash, openai/gpt-4o, or anthropic/claude-3.7-sonnet. "
            + "Models whose IDs end in \"-image\" or \"-image-pro\" generate pictures and will not work."
            + refusal;
    }

    /// <summary>
    /// Returns the JSON object inside a model reply. A provider honouring response_format
    /// returns bare JSON, but now that require_parameters no longer filters those providers
    /// out, replies may arrive fenced in ```json or wrapped in a sentence. Scanning for the
    /// outermost balanced braces accepts both without accepting nonsense.
    /// </summary>
    internal static string ExtractJsonObject(string content)
    {
        var text = (content ?? "").Trim();
        if (text.StartsWith('{') && text.EndsWith('}')) return text;

        var start = text.IndexOf('{');
        if (start < 0) throw new InvalidDataException("The vision model did not return JSON.");

        var depth = 0;
        var inString = false;
        var escaped = false;
        for (var index = start; index < text.Length; index++)
        {
            var character = text[index];
            if (inString)
            {
                if (escaped) escaped = false;
                else if (character == '\\') escaped = true;
                else if (character == '"') inString = false;
                continue;
            }
            if (character == '"') inString = true;
            else if (character == '{') depth++;
            else if (character == '}' && --depth == 0) return text[start..(index + 1)];
        }
        throw new InvalidDataException("The vision model returned truncated JSON.");
    }

    public static VisionResult ParseStructuredResult(
        string model,
        string content,
        VisionContext? context = null)
    {
        var visionContext = context ?? VisionContext.Refinement;
        var limit = visionContext.Limit;
        using var result = JsonDocument.Parse(ExtractJsonObject(content));
        var root = result.RootElement;

        if (visionContext.Assess)
        {
            var score = root.GetProperty("fit_score").GetInt32();
            score = Math.Clamp(score, 0, 100);
            var comments = root.TryGetProperty("observations", out var obsElement) && obsElement.ValueKind == JsonValueKind.Array
                ? obsElement.EnumerateArray().Select(item => item.GetString() ?? "").Where(item => item.Length > 0).Take(8).ToList()
                : new List<string>();
            return new VisionResult(model, score / 100.0, comments, new Dictionary<string, double>(), score);
        }

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
        if (context.Assess)
        {
            return new
            {
                type = "object",
                properties = new Dictionary<string, object>
                {
                    ["fit_score"] = new Dictionary<string, object>
                    {
                        ["type"] = "integer", ["minimum"] = 0, ["maximum"] = 100
                    },
                    ["observations"] = new Dictionary<string, object>
                    {
                        ["type"] = "array",
                        ["maxItems"] = 8,
                        ["items"] = new Dictionary<string, object> { ["type"] = "string", ["maxLength"] = 180 }
                    }
                },
                required = new[] { "fit_score", "observations" },
                additionalProperties = false
            };
        }
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
