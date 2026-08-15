using System.IO.Compression;

namespace FaceForge.Core;

/// <summary>
/// Renders the player's actual chargen head -- the real .tri meshes from the indexed install, with
/// race and EFM slider morphs applied -- to a PNG, so the same MediaPipe landmark detector and
/// measurement code that read an uploaded photo can read the head FaceForge would produce. This is
/// the forward model the "Analyze &amp; improve" loop optimises against: it renders a candidate slider
/// set, measures the render exactly like a photo, and compares.
///
/// The rasteriser is a direct port of the calibration renderer <c>qa/render-head.py</c> (orthographic
/// projection, per-face Lambert shading, back-face cull, z-buffer, painted irises so the eyes read as
/// open), which is the renderer the shipped baselines were measured from -- so a render here is
/// comparable to those baselines by construction.
/// </summary>
public static class HeadRenderer
{
    private static readonly float[] Skin = [0.85f, 0.70f, 0.62f];
    private static readonly float[] Sclera = [0.95f, 0.94f, 0.92f];
    private static readonly float[] Iris = [0.14f, 0.11f, 0.09f];
    // Upper/lower lid skin (in shadow) and the lash line, used to reshape the bare eyeball into a
    // readable eye instead of a white ball. Approximate until the real eye/lid NIF meshes are drawn.
    private static readonly float[] LidSkin = [0.62f, 0.50f, 0.44f];
    private static readonly float[] Lash = [0.20f, 0.15f, 0.13f];
    // The "brows" chargen mesh is the whole brow-ridge surface, not eyebrow hair, so it must be skin
    // coloured -- tinting it dark painted a band across the forehead. Real eyebrows are a separate
    // head-part NIF, drawn later by the appearance composite.
    private static readonly float[] Brow = Skin;

    public sealed record RenderRequest(
        string Sex,
        bool HighPoly,
        string? RaceEditorId,
        IReadOnlyDictionary<string, double> Sliders,
        double YawDegrees = 0,
        double PitchDegrees = double.NaN,
        int Size = 512,
        /// <summary>Texture the head with the installed skin .dds (for the preview); off keeps the fast flat render used by the fit.</summary>
        bool Textured = false,
        /// <summary>Sculpt reshape: scale head width (X) about the centroid. 1 = unchanged; &lt;1 narrows (raises face aspect). The EFM morphs cannot elongate a round Skyrim head; this can.</summary>
        double FaceWidthScale = 1.0,
        /// <summary>Sculpt reshape: scale head height (Z) about the centroid. 1 = unchanged; &gt;1 lengthens.</summary>
        double FaceHeightScale = 1.0,
        /// <summary>Sculpt reshape: push the nose region forward (+depth) as a fraction of head height, falloff-weighted around the nose tip. Drives profile nose projection, which the EFM morphs barely move.</summary>
        double NoseForward = 0.0,
        /// <summary>Sculpt reshape: lift the lower face (jaw/chin) upward as a fraction of head height, smoothly ramped below the centroid. Shortens the lower face past what the (weak, capped-at-3) EFM_Jaw_Height morph can reach.</summary>
        double JawRaise = 0.0);

    private static readonly System.Collections.Concurrent.ConcurrentDictionary<string, DdsTexture?> SkinCache = new();

    /// <summary>
    /// The pitch (in degrees) at which each head reads as facing the camera with zero nod -- found
    /// once by the calibration tool and baked into the shipped baselines. A caller that wants a
    /// frontal, measurement-comparable render should use this for <see cref="RenderRequest.PitchDegrees"/>.
    /// </summary>
    public static double FrontalPitch(string sex, bool highPoly) =>
        (sex.Equals("male", StringComparison.OrdinalIgnoreCase), highPoly) switch
        {
            (false, false) => 10.3,
            (false, true) => 8.3,
            (true, false) => 4.2,
            (true, true) => 4.6
        };

    /// <summary>Renders to PNG bytes, or null when the head meshes are not present in this install.</summary>
    public static byte[]? RenderPng(
        ResolvedDataView view,
        MorphRegistrySnapshot morphInfo,
        RenderRequest request,
        BsaMorphIndex? bsaMorphs = null)
    {
        var parts = BuildParts(view, morphInfo, request, bsaMorphs);
        if (parts is null) return null;
        ApplyReshape(parts, request);
        var pitch = double.IsNaN(request.PitchDegrees)
            ? FrontalPitch(request.Sex, request.HighPoly)
            : request.PitchDegrees;
        var rgba = Rasterize(parts, request.Size, request.YawDegrees, pitch);
        return Png.Encode(rgba, request.Size, request.Size);
    }

    private sealed class Part
    {
        public required float[] Vertices;
        public required int[] Triangles;
        public required float[] Color;
        public bool IsEyes;
        public float[]? Uvs;
        public int[]? TriangleUvs;
        public DdsTexture? Texture;
    }

    /// <summary>The chargen parts after race + slider morphs, each with the tri path RaceMenu keys sculpt by.</summary>
    private sealed record MorphedParts(
        MorphRegistry.HeadPartPaths Config, Morphable Head, Morphable? Brows, Morphable? Eyes, Morphable? Mouth);

    /// <summary>
    /// Loads the head/brows/eyes/mouth chargen meshes and applies the race morph and every slider morph,
    /// giving the morphed (but not yet reshaped) parts. Both the renderer and the sculpt exporter build
    /// from this, so the exported sculpt reshapes the exact same geometry the preview shows.
    /// </summary>
    private static MorphedParts? BuildMorphedParts(
        ResolvedDataView view,
        MorphRegistrySnapshot morphInfo,
        RenderRequest request,
        BsaMorphIndex? bsaMorphs)
    {
        var config = MorphRegistry.HeadConfigurations().FirstOrDefault(item =>
            item.Sex.Equals(request.Sex, StringComparison.OrdinalIgnoreCase) &&
            item.HighPoly == request.HighPoly);
        if (config is null) return null;

        var head = LoadMorphable(view, morphInfo, config.HeadTri, bsaMorphs);
        if (head is null) return null; // no head mesh -> cannot render at all

        // Race is a named morph in <Sex>HeadRaces.tri applied on top of the base head vertices, the
        // same way the game builds a race's starting face.
        if (!string.IsNullOrWhiteSpace(request.RaceEditorId) &&
            !request.RaceEditorId.Equals("Neutral", StringComparison.OrdinalIgnoreCase))
        {
            var racesTri = request.Sex.Equals("male", StringComparison.OrdinalIgnoreCase)
                ? @"Actors\Character\Character Assets\MaleHeadRaces.tri"
                : @"Actors\Character\Character Assets\FemaleHeadRaces.tri";
            if (view.TryResolve(Path.Combine("meshes", racesTri), out var racesPath))
            {
                try
                {
                    var races = TriFile.Read(racesPath);
                    var raceMorph = races.FindMorph(request.RaceEditorId);
                    if (raceMorph is not null && races.VertexCount == head.Base.VertexCount)
                        AddDelta(head.Vertices, raceMorph, 1.0);
                }
                catch { /* a missing or mismatched race tri just leaves the neutral head. */ }
            }
        }

        var sliderMorphs = SliderMorphMap(morphInfo, request.Sex);
        var brows = LoadMorphable(view, morphInfo, config.BrowsTri, bsaMorphs);
        var eyes = LoadMorphable(view, morphInfo, config.EyesTri, bsaMorphs);
        var mouth = LoadMorphable(view, morphInfo, config.MouthTri, bsaMorphs);

        foreach (var (slider, value) in request.Sliders)
        {
            if (Math.Abs(value) < 1e-4) continue;
            if (!sliderMorphs.TryGetValue(slider, out var pair)) continue;
            var morphName = value > 0 ? pair.Positive : pair.Negative;
            if (string.IsNullOrWhiteSpace(morphName) ||
                morphName.Equals("None", StringComparison.OrdinalIgnoreCase))
                continue;
            var weight = Math.Abs(value);
            // The morph lives on whichever part carries it: head, brows, eyes, or mouth.
            foreach (var target in new[] { head, brows, eyes, mouth })
                target?.TryApply(morphName, weight);
        }

        return new MorphedParts(config, head, brows, eyes, mouth);
    }

    /// <summary>One head part's sculpt: the tri RaceMenu keys it by, its vertex count, and the moved verts.</summary>
    public sealed record SculptPart(string Host, int Vertices, IReadOnlyList<int[]> Data);

    /// <summary>
    /// Converts the sculpt reshape (width/height scale, nose-forward, jaw-lift carried on the request)
    /// into per-vertex RaceMenu sculpt deltas for the head, eyes and brows -- the same three hosts a
    /// hand-made preset sculpts. Deltas are (reshaped - morphed) in mesh units, scaled by <paramref
    /// name="divisor"/> and rounded, moved vertices only. Because it reshapes the identical geometry the
    /// renderer does (via <see cref="BuildMorphedParts"/> + <see cref="ApplyReshape"/>), the exported
    /// head matches the preview. Non-destructive: it only writes preset sculpt data, never game files.
    /// </summary>
    public static IReadOnlyList<SculptPart>? ComputeSculpt(
        ResolvedDataView view,
        MorphRegistrySnapshot morphInfo,
        RenderRequest request,
        BsaMorphIndex? bsaMorphs,
        int divisor = 10000)
    {
        var m = BuildMorphedParts(view, morphInfo, request, bsaMorphs);
        if (m is null) return null;

        // Head first: ApplyReshape derives its centroid/bounds/nose/jaw pivot from parts[0], exactly as
        // the render does, so eyes and brows reshape consistently with the head.
        var hosts = new (string Host, Morphable? Part)[]
        {
            (m.Config.HeadTri, m.Head),
            (m.Config.EyesTri, m.Eyes),
            (m.Config.BrowsTri, m.Brows)
        };
        var present = hosts.Where(h => h.Part is not null).ToList();
        var originals = present.Select(h => (float[])h.Part!.Vertices.Clone()).ToList();
        var parts = present.Select(h => new Part { Vertices = h.Part!.Vertices, Triangles = h.Part.Base.Triangles, Color = Skin }).ToList();

        ApplyReshape(parts, request);

        var result = new List<SculptPart>();
        for (var p = 0; p < present.Count; p++)
        {
            var orig = originals[p];
            var now = present[p].Part!.Vertices;
            var data = new List<int[]>();
            for (var vi = 0; vi * 3 + 2 < now.Length; vi++)
            {
                var dx = (int)Math.Round((now[vi * 3] - orig[vi * 3]) * divisor);
                var dy = (int)Math.Round((now[vi * 3 + 1] - orig[vi * 3 + 1]) * divisor);
                var dz = (int)Math.Round((now[vi * 3 + 2] - orig[vi * 3 + 2]) * divisor);
                if (dx == 0 && dy == 0 && dz == 0) continue;
                data.Add([vi, dx, dy, dz]);
            }
            result.Add(new SculptPart(present[p].Host, now.Length / 3, data));
        }
        return result;
    }

    private static IReadOnlyList<Part>? BuildParts(
        ResolvedDataView view,
        MorphRegistrySnapshot morphInfo,
        RenderRequest request,
        BsaMorphIndex? bsaMorphs)
    {
        var m = BuildMorphedParts(view, morphInfo, request, bsaMorphs);
        if (m is null) return null;
        var head = m.Head;
        var brows = m.Brows;
        var eyes = m.Eyes;
        var mouth = m.Mouth;

        // The head, brow-ridge and mouth chargen meshes all share the head diffuse and its UV space,
        // so in the textured preview they wear the same skin texture and blend seamlessly (drawing
        // them flat instead painted patches over the skin). The eyeball has its own eye texture. The
        // flat (fit) render leaves every part untextured for maximum landmark signal and speed.
        var skin = request.Textured ? ResolveSkin(view, request.Sex, request.RaceEditorId) : null;

        static Part Make(Morphable part, float[] color, bool isEyes, DdsTexture? texture)
        {
            var useTexture = texture is not null && part.Base.HasUvs;
            return new Part
            {
                Vertices = part.Vertices,
                Triangles = part.Base.Triangles,
                Color = color,
                IsEyes = isEyes,
                Uvs = useTexture ? part.Base.Uvs : null,
                TriangleUvs = useTexture ? part.Base.TriangleUvs : null,
                Texture = useTexture ? texture : null
            };
        }

        // The head chargen mesh already carries the brow ridge and lips in its own UV space, so the
        // textured preview draws only the head (skin) plus the eyes. The separate brow and mouth
        // chargen meshes have UVs that span the whole texture (drawing them textured put a shrunk
        // "mini-face" over each brow), so they are used only by the untextured fit render, where they
        // add landmark signal.
        var parts = new List<Part> { Make(head, Skin, false, skin) };
        if (!request.Textured)
        {
            if (brows is not null) parts.Add(Make(brows, Skin, false, null));
            if (mouth is not null) parts.Add(Make(mouth, Skin, false, null));
        }
        if (eyes is not null) parts.Add(Make(eyes, Sclera, true, null));
        return parts;
    }

    /// <summary>A chargen part whose vertices can be morphed by name from its own tri plus any matched EFM extension.</summary>
    private sealed class Morphable
    {
        public required TriFile Base;
        public required float[] Vertices;
        public required Dictionary<string, TriMorph> Morphs;

        public void TryApply(string morphName, double weight)
        {
            if (Morphs.TryGetValue(morphName, out var morph)) AddDelta(Vertices, morph, weight);
        }
    }

    private static Morphable? LoadMorphable(
        ResolvedDataView view,
        MorphRegistrySnapshot morphInfo,
        string relTriUnderMeshes,
        BsaMorphIndex? bsaMorphs)
    {
        if (!view.TryResolve(Path.Combine("meshes", relTriUnderMeshes), out var path)) return null;
        TriFile tri;
        try { tri = TriFile.Read(path); }
        catch { return null; }

        var morphs = new Dictionary<string, TriMorph>(StringComparer.OrdinalIgnoreCase);
        foreach (var morph in tri.Morphs) morphs[morph.Name] = morph;

        // Merge the EFM extension morphs registered against this exact chargen mesh (topology must
        // match, since a morph is a per-vertex delta that cannot address a different mesh).
        foreach (var extension in MorphRegistry.ReadMorphExtensions(view))
        {
            if (!PathsMatch(extension.BasePath, relTriUnderMeshes)) continue;
            if (!view.TryResolve(extension.ExtensionRelPath, out var extPath)) continue;
            try
            {
                var ext = TriFile.Read(extPath);
                if (ext.VertexCount != tri.VertexCount) continue;
                foreach (var morph in ext.Morphs) morphs[morph.Name] = morph;
            }
            catch { /* skip an unreadable extension. */ }
        }

        // And the extension morphs packed inside a .bsa (High Poly Head puts its whole EFM set there,
        // so without this every chin/jaw/cheek/brow slider is inert on an HPH head).
        if (bsaMorphs is not null)
            foreach (var morph in bsaMorphs.ExtensionMorphs(relTriUnderMeshes, tri.VertexCount))
                morphs[morph.Name] = morph;

        return new Morphable { Base = tri, Vertices = (float[])tri.Vertices.Clone(), Morphs = morphs };
    }

    /// <summary>Resolves and decodes the installed head skin .dds (Mature Skin etc.), cached by path.</summary>
    private static DdsTexture? ResolveSkin(ResolvedDataView view, string sex, string? raceEditorId)
    {
        // Human female/male head diffuse. Beast races use their own paths; those fall through to the
        // generic female/male head, which is close enough for a shape preview.
        var folder = sex.Equals("male", StringComparison.OrdinalIgnoreCase) ? "male" : "female";
        var candidates = new[]
        {
            Path.Combine("textures", "actors", "character", folder, folder + "head.dds"),
            Path.Combine("textures", "actors", "character", folder, folder + "headhuman.dds")
        };
        foreach (var candidate in candidates)
        {
            if (!view.TryResolve(candidate, out var abs)) continue;
            return SkinCache.GetOrAdd(abs, key =>
            {
                try { return DdsTexture.Load(File.ReadAllBytes(key), 1024); }
                catch { return null; }
            });
        }
        return null;
    }

    private static Dictionary<string, (string Negative, string Positive)> SliderMorphMap(
        MorphRegistrySnapshot morphInfo, string sex)
    {
        var map = new Dictionary<string, (string, string)>(StringComparer.OrdinalIgnoreCase);
        foreach (var set in morphInfo.SliderSets)
        {
            if (!set.Sex.Equals(sex, StringComparison.OrdinalIgnoreCase)) continue;
            foreach (var slider in set.Sliders)
                map.TryAdd(slider.Name, (slider.NegativeMorph, slider.PositiveMorph));
        }
        return map;
    }

    /// <summary>
    /// Applies the sculpt-space reshape (width/height scale about the head centroid, plus a nose-tip
    /// forward push) that the EFM morphs cannot express. All parts share one centroid so the eyes stay
    /// seated as the face narrows; the nose push is Gaussian-weighted around the frontmost head vertex,
    /// so only the nose moves forward. In-render this is the same affine the export writes as sculpt
    /// deltas, so the preview and the in-game head match. Axes: X = width, Z = height, Y = forward depth.
    /// </summary>
    private static void ApplyReshape(IReadOnlyList<Part> parts, RenderRequest request)
    {
        var widthScale = (float)request.FaceWidthScale;
        var heightScale = (float)request.FaceHeightScale;
        var noseForward = (float)request.NoseForward;
        var jawRaise = (float)request.JawRaise;
        if (parts.Count == 0 ||
            (Math.Abs(widthScale - 1f) < 1e-6f && Math.Abs(heightScale - 1f) < 1e-6f &&
             Math.Abs(noseForward) < 1e-6f && Math.Abs(jawRaise) < 1e-6f))
            return;

        var head = parts[0].Vertices;
        var count = head.Length / 3;
        if (count == 0) return;
        float cx = 0, cz = 0;
        float minZ = float.MaxValue, maxZ = float.MinValue;
        float minX = float.MaxValue, maxX = float.MinValue;
        float ntx = 0, nty = float.MinValue, ntz = 0; // nose tip = frontmost (max Y) head vertex
        for (var i = 0; i < head.Length; i += 3)
        {
            cx += head[i]; cz += head[i + 2];
            if (head[i] < minX) minX = head[i];
            if (head[i] > maxX) maxX = head[i];
            if (head[i + 2] < minZ) minZ = head[i + 2];
            if (head[i + 2] > maxZ) maxZ = head[i + 2];
            if (head[i + 1] > nty) { nty = head[i + 1]; ntx = head[i]; ntz = head[i + 2]; }
        }
        cx /= count; cz /= count;
        var headSize = Math.Max(maxZ - minZ, 1e-3f);
        var maxAbsX = Math.Max(Math.Max(maxX - cx, cx - minX), 1e-3f);
        // Nose-forward falloff: anisotropic + lower-gated so ONLY the nose moves, never the mouth.
        // Measured on the HPH head (noseprobe harness): the upper lip sits ~0.08-0.10 of head height below
        // the nose tip, and the old isotropic sigma=0.09 gave it ~50% of the push -- that dragged the
        // philtrum and upper lip forward (or inward, on a pull) and closed the nose-to-mouth gap. It was
        // invisible in the front-only preview and ugly in-game. Fix: a tight LATERAL sigma (a nose is
        // narrow -- spare the cheeks), a normal depth/vertical sigma, and a hard LOWER GATE that fades the
        // push to zero between the subnasale and the lip line, pinning the mouth exactly like the neck seam.
        var noseSigmaX = headSize * 0.06f;   // lateral: narrow, keeps the cheeks/nasolabial out of it
        var noseSigmaY = headSize * 0.09f;   // depth
        var noseSigmaZ = headSize * 0.09f;   // vertical (reaches up to the bridge, gated below the tip)
        var noseTwoSx2 = 2f * noseSigmaX * noseSigmaX;
        var noseTwoSy2 = 2f * noseSigmaY * noseSigmaY;
        var noseTwoSz2 = 2f * noseSigmaZ * noseSigmaZ;
        var noseGateStart = 0.03f * headSize; // below the tip: full push down to here (nostril base)
        var noseGateEnd = 0.07f * headSize;   // ...faded to zero by here, above the upper lip
        var forwardAmount = noseForward * headSize;
        // Jaw-corner lift: raise the LATERAL jawline (the gonial angle, under the ears) toward the mouth
        // to close the "mouth sits above the jawline" gap and tighten a low, heavy jaw. It deliberately
        // does NOT touch the chin (centre) or move anything vertically overall, so the face keeps its
        // length -- a tighter jawline actually reads as MORE elongated, not shorter. Weighted by how
        // lateral a vertex is (0 near the centre chin, 1 out at the jaw sides) and a vertical Gaussian
        // centred on the jaw angle a little below the centroid.
        var jawCornerZ = cz - 0.20f * headSize;
        var jawSigmaZ = 0.10f * headSize; // tight enough that the lift has decayed to ~nothing by eye level
        var jawTwoSigmaZ2 = 2f * jawSigmaZ * jawSigmaZ;
        var jawLiftMax = jawRaise * headSize;

        // The whole reshape fades to zero over the lowest fifth of the head (the neck), so the exported
        // sculpt leaves the neck-seam vertices where the body expects them; without this the width and
        // height scales alone shift the seam ~0.7 units and the in-game head tears off the neck.
        var neckTop = minZ + 0.20f * headSize;
        var neckSpan = Math.Max(neckTop - minZ, 1e-3f);

        for (var partIndex = 0; partIndex < parts.Count; partIndex++)
        {
            var v = parts[partIndex].Vertices;
            // The jaw corners are head geometry: applying the lift to the separate eye/brow parts tilts
            // the eyes (their outer, more-lateral verts rise more than the inner ones). Head only.
            var applyJaw = jawLiftMax != 0f && partIndex == 0;
            for (var i = 0; i < v.Length; i += 3)
            {
                float ox = v[i], oy = v[i + 1], oz = v[i + 2];
                float tx = cx + (ox - cx) * widthScale;
                float tz = cz + (oz - cz) * heightScale;
                if (applyJaw)
                {
                    // Lateral weight: 0 for the inner ~35% (chin/centre stays put), ramping to 1 at the
                    // jaw sides; vertical Gaussian centred on the jaw angle. Lifts only the jaw corners.
                    var lateral = Math.Clamp((Math.Abs(ox - cx) / maxAbsX - 0.35f) / 0.35f, 0f, 1f);
                    if (lateral > 0f)
                    {
                        var dzc = oz - jawCornerZ;
                        var vert = (float)Math.Exp(-(dzc * dzc) / jawTwoSigmaZ2);
                        tz += jawLiftMax * lateral * vert;
                    }
                }
                float ty = oy;
                if (forwardAmount != 0f)
                {
                    float dx = ox - ntx, dy = oy - nty, dz = oz - ntz;
                    var weight = (float)Math.Exp(-(dx * dx / noseTwoSx2 + dy * dy / noseTwoSy2 + dz * dz / noseTwoSz2));
                    // Lower gate: pin the mouth. below>0 means the vertex sits beneath the nose tip; fade
                    // the push out between the subnasale and the lip so the upper lip never moves.
                    var below = ntz - oz;
                    if (below > noseGateStart)
                    {
                        var g = Math.Clamp((below - noseGateStart) / (noseGateEnd - noseGateStart), 0f, 1f);
                        weight *= 1f - (g * g * (3f - 2f * g)); // smoothstep 1 -> 0
                    }
                    ty = oy + forwardAmount * weight;
                }
                var mask = Math.Clamp((oz - minZ) / neckSpan, 0f, 1f);
                mask = mask * mask * (3f - 2f * mask); // smoothstep: 0 at the seam, 1 above the neck
                v[i] = ox + (tx - ox) * mask;
                v[i + 1] = oy + (ty - oy) * mask;
                v[i + 2] = oz + (tz - oz) * mask;
            }
        }
    }

    private static void AddDelta(float[] vertices, TriMorph morph, double weight)
    {
        var scale = (float)(morph.Multiplier * weight);
        var count = Math.Min(vertices.Length, morph.Deltas.Length);
        for (var index = 0; index < count; index++)
            vertices[index] += morph.Deltas[index] * scale;
    }

    private static bool PathsMatch(string left, string right) =>
        string.Equals(NormalizePath(left), NormalizePath(right), StringComparison.OrdinalIgnoreCase);

    private static string NormalizePath(string value) =>
        value.Trim().Trim(',').Trim().Replace('/', '\\').TrimStart('\\');

    // --- Rasteriser (port of qa/render-head.py:render) ---------------------------------------

    private static byte[] Rasterize(IReadOnlyList<Part> parts, int size, double yawDegrees, double pitchDegrees)
    {
        // Pose every part: yaw about the up axis (z), then pitch about the left-right axis (x).
        var posed = parts.Select(part => new Part
        {
            Vertices = Pose(part.Vertices, yawDegrees, pitchDegrees),
            Triangles = part.Triangles,
            Color = part.Color,
            IsEyes = part.IsEyes,
            Uvs = part.Uvs,
            TriangleUvs = part.TriangleUvs,
            Texture = part.Texture
        }).ToArray();

        // Framing comes from the head (part 0) alone, so adding eyes cannot rescale the image.
        var head = posed[0].Vertices;
        FindBounds(head, out var minX, out var minZ, out var maxX, out var maxZ, out var centerX, out var centerZ);
        var scale = (float)(size * 0.8 / Math.Max(Math.Max(maxX - minX, maxZ - minZ), 1e-6f));

        var image = new float[size * size * 3];
        var zbuffer = new float[size * size];
        Array.Fill(zbuffer, -1e9f);
        var owner = new int[size * size];
        Array.Fill(owner, -1);

        var light = Normalize(0f, 1f, 0.3f);

        for (var partIndex = 0; partIndex < posed.Length; partIndex++)
        {
            var part = posed[partIndex];
            var verts = part.Vertices;
            var tris = part.Triangles;
            var texture = part.Texture;
            var uvs = part.Uvs;
            var triUvs = part.TriangleUvs;
            var textured = texture is not null && uvs is not null && triUvs is not null && triUvs.Length == tris.Length;
            for (var tri = 0; tri + 2 < tris.Length; tri += 3)
            {
                var a = tris[tri]; var b = tris[tri + 1]; var c = tris[tri + 2];
                var ax = verts[a * 3]; var ay = verts[a * 3 + 1]; var az = verts[a * 3 + 2];
                var bx = verts[b * 3]; var by = verts[b * 3 + 1]; var bz = verts[b * 3 + 2];
                var cx = verts[c * 3]; var cy = verts[c * 3 + 1]; var cz = verts[c * 3 + 2];

                // Face normal; cull back faces (the camera looks along +y, so front faces have ny > 0).
                var nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
                var ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
                var nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
                var nlen = MathF.Sqrt(nx * nx + ny * ny + nz * nz);
                if (nlen < 1e-9f) continue;
                nx /= nlen; ny /= nlen; nz /= nlen;
                if (ny <= 0) continue;
                var shade = Math.Clamp(nx * light[0] + ny * light[1] + nz * light[2], 0f, 1f) * 0.8f + 0.2f;

                // Project to screen: x -> horizontal, z -> vertical (down), y -> depth.
                var sax = (ax - centerX) * scale + size / 2f; var say = -(az - centerZ) * scale + size / 2f;
                var sbx = (bx - centerX) * scale + size / 2f; var sby = -(bz - centerZ) * scale + size / 2f;
                var scx = (cx - centerX) * scale + size / 2f; var scy = -(cz - centerZ) * scale + size / 2f;

                var x0 = (int)MathF.Floor(Math.Min(sax, Math.Min(sbx, scx)));
                var x1 = (int)MathF.Ceiling(Math.Max(sax, Math.Max(sbx, scx)));
                var y0 = (int)MathF.Floor(Math.Min(say, Math.Min(sby, scy)));
                var y1 = (int)MathF.Ceiling(Math.Max(say, Math.Max(sby, scy)));
                x0 = Math.Max(0, x0); y0 = Math.Max(0, y0);
                x1 = Math.Min(size - 1, x1); y1 = Math.Min(size - 1, y1);
                if (x1 < x0 || y1 < y0) continue;

                var area = (sby - scy) * (sax - scx) + (scx - sbx) * (say - scy);
                if (MathF.Abs(area) < 1e-9f) continue;

                // Triangle UVs. The .tri and the .dds share the same top-left origin, so V is used as-is.
                float ua = 0, va = 0, ub = 0, vb = 0, uc = 0, vc = 0;
                if (textured)
                {
                    var ia = triUvs![tri]; var ib = triUvs[tri + 1]; var ic = triUvs[tri + 2];
                    ua = uvs![ia * 2]; va = uvs[ia * 2 + 1];
                    ub = uvs[ib * 2]; vb = uvs[ib * 2 + 1];
                    uc = uvs[ic * 2]; vc = uvs[ic * 2 + 1];
                }

                for (var py = y0; py <= y1; py++)
                for (var px = x0; px <= x1; px++)
                {
                    var w0 = ((sby - scy) * (px - scx) + (scx - sbx) * (py - scy)) / area;
                    var w1 = ((scy - say) * (px - scx) + (sax - scx) * (py - scy)) / area;
                    var w2 = 1f - w0 - w1;
                    if (w0 < 0 || w1 < 0 || w2 < 0) continue;
                    var depth = w0 * ay + w1 * by + w2 * cy;
                    var pixel = py * size + px;
                    if (depth <= zbuffer[pixel]) continue;
                    zbuffer[pixel] = depth;
                    owner[pixel] = partIndex;
                    if (textured)
                    {
                        // The skin texture already carries its own shading/detail, so apply only a
                        // gentle directional term over a high ambient base to avoid muddying it.
                        var texShade = shade * 0.4f + 0.6f;
                        var (tr, tg, tb) = texture!.Sample(w0 * ua + w1 * ub + w2 * uc, w0 * va + w1 * vb + w2 * vc);
                        image[pixel * 3] = tr * texShade;
                        image[pixel * 3 + 1] = tg * texShade;
                        image[pixel * 3 + 2] = tb * texShade;
                    }
                    else
                    {
                        image[pixel * 3] = part.Color[0] * shade;
                        image[pixel * 3 + 1] = part.Color[1] * shade;
                        image[pixel * 3 + 2] = part.Color[2] * shade;
                    }
                }
            }
        }

        // Reshape each visible eyeball into an open eye so the render reads correctly -- but only when
        // the eye is not textured; a textured eyeball already shows a real iris.
        for (var partIndex = 0; partIndex < posed.Length; partIndex++)
        {
            if (!posed[partIndex].IsEyes || posed[partIndex].Texture is not null) continue;
            DrawEyes(image, owner, size, partIndex);
        }

        var rgba = new byte[size * size * 4];
        for (var pixel = 0; pixel < size * size; pixel++)
        {
            rgba[pixel * 4] = ToByte(image[pixel * 3]);
            rgba[pixel * 4 + 1] = ToByte(image[pixel * 3 + 1]);
            rgba[pixel * 4 + 2] = ToByte(image[pixel * 3 + 2]);
            rgba[pixel * 4 + 3] = 255;
        }
        return rgba;
    }

    // Reshapes each visible eyeball from a bare white ball into a readable eye: an upper-lid skin
    // band (with a lash line), a dark iris in the middle, and the sclera left showing only at the
    // sides. Without the real eye/lid NIF meshes this is an approximation, but it stops the top and
    // bottom of the white ball from reading as "white eyelids" above and below the iris.
    private static void DrawEyes(float[] image, int[] owner, int size, int eyePart)
    {
        // Split the eye pixels into the two eyes by the midpoint between their horizontal extents.
        var gMinX = size; var gMaxX = -1;
        for (var p = 0; p < size * size; p++)
        {
            if (owner[p] != eyePart) continue;
            var px = p % size;
            if (px < gMinX) gMinX = px;
            if (px > gMaxX) gMaxX = px;
        }
        if (gMaxX < 0) return;
        var split = (gMinX + gMaxX) / 2;

        foreach (var leftSide in new[] { true, false })
        {
            var minX = size; var maxX = -1; var minY = size; var maxY = -1;
            for (var py = 0; py < size; py++)
            for (var px = 0; px < size; px++)
            {
                if (owner[py * size + px] != eyePart) continue;
                if ((px < split) != leftSide) continue;
                if (px < minX) minX = px;
                if (px > maxX) maxX = px;
                if (py < minY) minY = py;
                if (py > maxY) maxY = py;
            }
            if (maxX < 0) continue;
            float h = maxY - minY; float w = maxX - minX;
            if (h < 2 || w < 2) continue;

            // The eye opening is an almond: the upper and lower lid margins are arcs that meet at the
            // inner/outer corners, not the old flat horizontal band that read as a hooded slot and hid
            // the eye shape. The lid skin painted over the top of the eyeball footprint covers the
            // eyeball where the real lid would, and the arc gives the opening a definable shape (which
            // also gives MediaPipe a cleaner eye to land its lid landmarks on).
            var openCx = (minX + maxX) / 2f;
            var openCy = minY + h * 0.56f;                    // opening sits in the lower-middle of the footprint
            var openHalfH = h * 0.32f;                        // max half-height, at the centre of the almond
            var lashThickness = Math.Max(1.5f, h * 0.05f);
            var irisCy = openCy - openHalfH * 0.08f;          // iris rides a touch high, tucked under the upper lid
            var irisR = Math.Min(openHalfH * 0.82f, w * 0.24f);
            var irisR2 = irisR * irisR;
            var pupilR2 = (irisR * 0.42f) * (irisR * 0.42f);

            for (var py = minY; py <= maxY; py++)
            for (var px = minX; px <= maxX; px++)
            {
                var pixel = py * size + px;
                if (owner[pixel] != eyePart) continue;
                if ((px < split) != leftSide) continue;

                // Curved lid margins: arc = 1 at the centre column, 0 at the corners, so the opening
                // tapers to a point at each canthus.
                var u = Math.Clamp((px - openCx) / (w * 0.5f), -1f, 1f);
                var arc = MathF.Sqrt(Math.Max(0f, 1f - u * u));
                var upperY = openCy - openHalfH * arc;
                var lowerY = openCy + openHalfH * arc;

                float[]? c;
                if (py < upperY - lashThickness) c = LidSkin;     // upper lid skin
                else if (py < upperY) c = Lash;                   // lash line along the curved upper margin
                else if (py > lowerY) c = LidSkin;                // thin lower lid
                else
                {
                    var dx = px - openCx; var dy = py - irisCy;
                    var d2 = dx * dx + dy * dy;
                    c = d2 <= pupilR2 ? Lash : d2 <= irisR2 ? Iris : null; // pupil / iris / sclera
                }
                if (c is null) continue; // leave the sclera showing at the sides of the iris
                image[pixel * 3] = c[0]; image[pixel * 3 + 1] = c[1]; image[pixel * 3 + 2] = c[2];
            }
        }
    }

    private static float[] Pose(float[] vertices, double yawDegrees, double pitchDegrees)
    {
        var yaw = yawDegrees * Math.PI / 180.0;
        var pitch = pitchDegrees * Math.PI / 180.0;
        float cy = (float)Math.Cos(yaw), sy = (float)Math.Sin(yaw);
        float cp = (float)Math.Cos(pitch), sp = (float)Math.Sin(pitch);
        var result = new float[vertices.Length];
        for (var i = 0; i + 2 < vertices.Length; i += 3)
        {
            var x = vertices[i]; var y = vertices[i + 1]; var z = vertices[i + 2];
            // Yaw about up axis (z): mixes x (left-right) and y (depth).
            var yx = x * cy - y * sy;
            var yy = x * sy + y * cy;
            // Pitch about left-right axis (x): mixes y (depth) and z (up).
            result[i] = yx;
            result[i + 1] = yy * cp - z * sp;
            result[i + 2] = yy * sp + z * cp;
        }
        return result;
    }

    private static void FindBounds(
        float[] verts, out float minX, out float minZ, out float maxX, out float maxZ,
        out float centerX, out float centerZ)
    {
        minX = minZ = float.MaxValue; maxX = maxZ = float.MinValue;
        for (var i = 0; i + 2 < verts.Length; i += 3)
        {
            minX = Math.Min(minX, verts[i]); maxX = Math.Max(maxX, verts[i]);
            minZ = Math.Min(minZ, verts[i + 2]); maxZ = Math.Max(maxZ, verts[i + 2]);
        }
        centerX = (minX + maxX) / 2f; centerZ = (minZ + maxZ) / 2f;
    }

    private static float[] Normalize(float x, float y, float z)
    {
        var len = MathF.Sqrt(x * x + y * y + z * z);
        return len < 1e-9f ? [0, 0, 0] : [x / len, y / len, z / len];
    }

    private static byte ToByte(float value) => (byte)Math.Clamp((int)MathF.Round(value * 255f), 0, 255);
}

/// <summary>Minimal, dependency-free PNG encoder for 8-bit RGBA (used to hand renders to the WebView).</summary>
public static class Png
{
    public static byte[] Encode(byte[] rgba, int width, int height)
    {
        using var output = new MemoryStream();
        output.Write([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

        Span<byte> ihdr = stackalloc byte[13];
        WriteBigEndian(ihdr[..4], (uint)width);
        WriteBigEndian(ihdr.Slice(4, 4), (uint)height);
        ihdr[8] = 8;   // bit depth
        ihdr[9] = 6;   // colour type RGBA
        ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
        WriteChunk(output, "IHDR", ihdr);

        // Raw scanlines, each prefixed with filter byte 0.
        var raw = new byte[height * (1 + width * 4)];
        var cursor = 0;
        for (var y = 0; y < height; y++)
        {
            raw[cursor++] = 0;
            Array.Copy(rgba, y * width * 4, raw, cursor, width * 4);
            cursor += width * 4;
        }
        using var compressed = new MemoryStream();
        using (var deflate = new ZLibStream(compressed, CompressionLevel.Fastest, leaveOpen: true))
            deflate.Write(raw, 0, raw.Length);
        WriteChunk(output, "IDAT", compressed.ToArray());
        WriteChunk(output, "IEND", ReadOnlySpan<byte>.Empty);
        return output.ToArray();
    }

    private static void WriteChunk(Stream stream, string type, ReadOnlySpan<byte> data)
    {
        Span<byte> length = stackalloc byte[4];
        WriteBigEndian(length, (uint)data.Length);
        stream.Write(length);
        var typeBytes = System.Text.Encoding.ASCII.GetBytes(type);
        stream.Write(typeBytes);
        stream.Write(data);
        var crc = Crc32(typeBytes, data);
        Span<byte> crcBytes = stackalloc byte[4];
        WriteBigEndian(crcBytes, crc);
        stream.Write(crcBytes);
    }

    private static void WriteBigEndian(Span<byte> target, uint value)
    {
        target[0] = (byte)(value >> 24);
        target[1] = (byte)(value >> 16);
        target[2] = (byte)(value >> 8);
        target[3] = (byte)value;
    }

    private static uint Crc32(ReadOnlySpan<byte> type, ReadOnlySpan<byte> data)
    {
        var crc = 0xFFFFFFFFu;
        crc = Accumulate(crc, type);
        crc = Accumulate(crc, data);
        return crc ^ 0xFFFFFFFFu;
    }

    private static uint Accumulate(uint crc, ReadOnlySpan<byte> data)
    {
        foreach (var b in data)
        {
            crc ^= b;
            for (var k = 0; k < 8; k++)
                crc = (crc & 1) != 0 ? (crc >> 1) ^ 0xEDB88320u : crc >> 1;
        }
        return crc;
    }
}
