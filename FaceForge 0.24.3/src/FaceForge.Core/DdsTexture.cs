using System.Buffers.Binary;
using BCnEncoder.Decoder;
using BCnEncoder.Shared;

namespace FaceForge.Core;

/// <summary>
/// Decodes a BCn-compressed .dds skin texture to an RGBA buffer the rasteriser can sample, so the
/// rendered head wears the player's actual skin (Mature Skin etc.) instead of a flat colour. A small
/// mip is decoded rather than the full 4K image -- the preview is only a few hundred pixels wide, and
/// BC7 decoding a 16-megapixel top mip would be needlessly slow.
/// </summary>
public sealed class DdsTexture
{
    public int Width { get; }
    public int Height { get; }
    private readonly byte[] _rgba; // width*height*4

    private DdsTexture(int width, int height, byte[] rgba)
    {
        Width = width;
        Height = height;
        _rgba = rgba;
    }

    /// <summary>Samples the texture with nearest lookup; u,v are wrapped to [0,1). Returns 0..1 RGB.</summary>
    public (float R, float G, float B) Sample(float u, float v)
    {
        u -= MathF.Floor(u);
        v -= MathF.Floor(v);
        var x = Math.Clamp((int)(u * Width), 0, Width - 1);
        var y = Math.Clamp((int)(v * Height), 0, Height - 1);
        var i = (y * Width + x) * 4;
        return (_rgba[i] / 255f, _rgba[i + 1] / 255f, _rgba[i + 2] / 255f);
    }

    public static DdsTexture? Load(byte[] dds, int maxSize = 1024)
    {
        try
        {
            if (dds.Length < 128 || dds[0] != (byte)'D' || dds[1] != (byte)'D' ||
                dds[2] != (byte)'S' || dds[3] != (byte)' ')
                return null;

            var height = (int)BinaryPrimitives.ReadUInt32LittleEndian(dds.AsSpan(12));
            var width = (int)BinaryPrimitives.ReadUInt32LittleEndian(dds.AsSpan(16));
            var mipCount = Math.Max(1, (int)BinaryPrimitives.ReadUInt32LittleEndian(dds.AsSpan(28)));
            var fourCc = System.Text.Encoding.ASCII.GetString(dds, 84, 4);

            CompressionFormat format;
            var headerSize = 128;
            if (fourCc == "DX10")
            {
                headerSize = 148;
                var dxgi = BinaryPrimitives.ReadUInt32LittleEndian(dds.AsSpan(128));
                format = dxgi switch
                {
                    71 or 72 => CompressionFormat.Bc1,
                    77 or 78 => CompressionFormat.Bc3,
                    80 => CompressionFormat.Bc4,
                    83 => CompressionFormat.Bc5,
                    98 or 99 => CompressionFormat.Bc7,
                    28 or 29 => CompressionFormat.Rgba,
                    87 => CompressionFormat.Bgra,
                    _ => CompressionFormat.Unknown
                };
            }
            else
            {
                format = fourCc switch
                {
                    "DXT1" => CompressionFormat.Bc1,
                    "DXT3" => CompressionFormat.Bc2,
                    "DXT5" => CompressionFormat.Bc3,
                    "ATI1" or "BC4U" => CompressionFormat.Bc4,
                    "ATI2" or "BC5U" => CompressionFormat.Bc5,
                    _ => CompressionFormat.Bgra // assume an uncompressed BGRA surface
                };
            }
            if (format == CompressionFormat.Unknown) return null;

            var blockBytes = format switch
            {
                CompressionFormat.Bc1 or CompressionFormat.Bc4 => 8,
                CompressionFormat.Bc2 or CompressionFormat.Bc3 or CompressionFormat.Bc5 or CompressionFormat.Bc7 => 16,
                _ => 0 // uncompressed
            };

            // Walk the mip chain to the smallest mip whose largest side is still >= maxSize (or the
            // last mip), so the decode stays cheap.
            var offset = headerSize;
            var mipWidth = width;
            var mipHeight = height;
            for (var mip = 0; mip < mipCount; mip++)
            {
                var mipSize = blockBytes > 0
                    ? Math.Max(1, (mipWidth + 3) / 4) * Math.Max(1, (mipHeight + 3) / 4) * blockBytes
                    : mipWidth * mipHeight * 4;
                var largest = Math.Max(mipWidth, mipHeight);
                var isLast = mip == mipCount - 1;
                if (largest <= maxSize || isLast)
                {
                    if (offset + mipSize > dds.Length) return null;
                    var block = dds.AsSpan(offset, mipSize).ToArray();
                    return Decode(block, mipWidth, mipHeight, format);
                }
                offset += mipSize;
                mipWidth = Math.Max(1, mipWidth / 2);
                mipHeight = Math.Max(1, mipHeight / 2);
            }
            return null;
        }
        catch
        {
            return null;
        }
    }

    private static DdsTexture Decode(byte[] block, int width, int height, CompressionFormat format)
    {
        var rgba = new byte[width * height * 4];
        if (format is CompressionFormat.Rgba)
        {
            Array.Copy(block, rgba, Math.Min(block.Length, rgba.Length));
        }
        else if (format is CompressionFormat.Bgra)
        {
            for (var i = 0; i + 3 < rgba.Length && i + 3 < block.Length; i += 4)
            {
                rgba[i] = block[i + 2]; rgba[i + 1] = block[i + 1]; rgba[i + 2] = block[i]; rgba[i + 3] = block[i + 3];
            }
        }
        else
        {
            var colors = new BcDecoder().DecodeRaw(block, width, height, format);
            for (var i = 0; i < colors.Length && i * 4 + 3 < rgba.Length; i++)
            {
                rgba[i * 4] = colors[i].r;
                rgba[i * 4 + 1] = colors[i].g;
                rgba[i * 4 + 2] = colors[i].b;
                rgba[i * 4 + 3] = colors[i].a;
            }
        }
        return new DdsTexture(width, height, rgba);
    }
}
