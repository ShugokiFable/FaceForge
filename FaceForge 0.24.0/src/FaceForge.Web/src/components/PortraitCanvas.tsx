import { useCallback, useEffect, useRef } from "react";
import type { FaceLandmark } from "../domain/faceAnalysis";

interface PortraitCanvasProps {
  photoUrl: string | null;
  landmarks: readonly FaceLandmark[] | null;
  onImageReady: (image: HTMLImageElement | null) => void;
}

const featureLines = [
  [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109, 10],
  [33, 160, 158, 133, 153, 144, 33],
  [362, 385, 387, 263, 373, 380, 362],
  [70, 63, 105, 66, 107],
  [336, 296, 334, 293, 300],
  [168, 6, 197, 195, 5, 4, 1, 19, 94, 2],
  [98, 97, 2, 326, 327],
  [61, 0, 291, 17, 61],
  [61, 13, 291, 14, 61]
] as const;

export default function PortraitCanvas({
  photoUrl,
  landmarks,
  onImageReady
}: PortraitCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const bounds = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(bounds.width * ratio));
    const height = Math.max(1, Math.round(bounds.height * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#151c23";
    context.fillRect(0, 0, width, height);

    const image = imageRef.current;
    if (!image) {
      context.save();
      context.translate(width / 2, height * 0.52);
      context.fillStyle = "#303b45";
      context.beginPath();
      context.ellipse(0, -height * 0.13, width * 0.17, height * 0.2, 0, 0, Math.PI * 2);
      context.fill();
      context.beginPath();
      context.ellipse(0, height * 0.22, width * 0.42, height * 0.26, 0, Math.PI, Math.PI * 2);
      context.fill();
      context.strokeStyle = "#66b6c955";
      context.setLineDash([5 * ratio, 5 * ratio]);
      context.beginPath();
      context.moveTo(-width * 0.34, 0);
      context.lineTo(width * 0.34, 0);
      context.moveTo(0, -height * 0.35);
      context.lineTo(0, height * 0.23);
      context.stroke();
      context.restore();
      return;
    }

    const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
    const drawWidth = image.naturalWidth * scale;
    const drawHeight = image.naturalHeight * scale;
    const offsetX = (width - drawWidth) / 2;
    const offsetY = (height - drawHeight) / 2;
    context.drawImage(image, offsetX, offsetY, drawWidth, drawHeight);

    if (!landmarks) return;
    const toCanvas = (index: number) => ({
      x: offsetX + landmarks[index].x * drawWidth,
      y: offsetY + landmarks[index].y * drawHeight
    });

    context.save();
    context.strokeStyle = "#77c5d6";
    context.fillStyle = "#b8ecf5";
    context.lineWidth = Math.max(1, 1.2 * ratio);
    context.shadowColor = "#091017";
    context.shadowBlur = 2 * ratio;
    for (const line of featureLines) {
      context.beginPath();
      line.forEach((index, position) => {
        const target = toCanvas(index);
        if (position === 0) context.moveTo(target.x, target.y);
        else context.lineTo(target.x, target.y);
      });
      context.stroke();
    }
    for (const index of [10, 152, 234, 454, 33, 133, 362, 263, 1, 98, 327, 61, 291]) {
      const target = toCanvas(index);
      context.beginPath();
      context.arc(target.x, target.y, 2.1 * ratio, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }, [landmarks]);

  useEffect(() => {
    if (!photoUrl) {
      imageRef.current = null;
      onImageReady(null);
      draw();
      return;
    }
    const image = new Image();
    image.onload = () => {
      imageRef.current = image;
      onImageReady(image);
      draw();
    };
    image.onerror = () => {
      imageRef.current = null;
      onImageReady(null);
      draw();
    };
    image.src = photoUrl;
  }, [photoUrl, draw, onImageReady]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    draw();
    return () => observer.disconnect();
  }, [draw]);

  return <canvas ref={canvasRef} className="portrait-canvas" aria-label="Portrait preview" />;
}
