import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

const WEBM_MIME_CANDIDATES = [
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
];

let ffmpegSingleton: FFmpeg | null = null;
let ffmpegLoadPromise: Promise<FFmpeg> | null = null;

function pickSupportedWebmMimeType(): string {
  const rec = globalThis.MediaRecorder;
  if (!rec?.isTypeSupported) return "video/webm";
  for (const mime of WEBM_MIME_CANDIDATES) {
    if (rec.isTypeSupported(mime)) return mime;
  }
  return "video/webm";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

function frameMsFromFps(fps: number): number {
  const safeFps = Math.max(2, Math.min(60, Math.floor(fps)));
  return 1000 / safeFps;
}

export async function encodeFramesToWebm(opts: {
  framesRgba: Uint8ClampedArray[];
  size: number;
  fps: number;
}): Promise<Blob> {
  const { framesRgba, size, fps } = opts;
  if (typeof document === "undefined" || typeof MediaRecorder === "undefined") {
    throw new Error("Video export requires a browser with MediaRecorder support.");
  }
  if (framesRgba.length === 0) {
    throw new Error("No frames to encode.");
  }

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable.");

  const mimeType = pickSupportedWebmMimeType();
  const stream = canvas.captureStream(Math.max(2, Math.min(60, fps)));
  const chunks: BlobPart[] = [];
  const recorder = new MediaRecorder(stream, { mimeType });

  await new Promise<void>((resolve, reject) => {
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onerror = () => reject(new Error("MediaRecorder failed."));
    recorder.onstop = () => resolve();

    recorder.start();
    void (async () => {
      try {
        const ms = frameMsFromFps(fps);
        for (const frame of framesRgba) {
          ctx.putImageData(new ImageData(frame, size, size), 0, 0);
          // Keep consistent timing so loops are smooth once transcoded.
          await sleep(ms);
        }
        recorder.stop();
      } catch (e) {
        reject(e);
      }
    })();
  });

  return new Blob(chunks, { type: "video/webm" });
}

async function getFfmpeg(): Promise<FFmpeg> {
  if (ffmpegSingleton) return ffmpegSingleton;
  if (ffmpegLoadPromise) return ffmpegLoadPromise;

  ffmpegLoadPromise = (async () => {
    const ffmpeg = new FFmpeg();
    const baseUrl = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd";
    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseUrl}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(
        `${baseUrl}/ffmpeg-core.wasm`,
        "application/wasm",
      ),
    });
    ffmpegSingleton = ffmpeg;
    return ffmpeg;
  })();

  return ffmpegLoadPromise;
}

export async function transcodeWebmToMp4(opts: {
  webmBlob: Blob;
  outputName?: string;
  crf?: number;
}): Promise<Blob> {
  const { webmBlob, outputName = "normie-loop.mp4", crf = 23 } = opts;
  const ffmpeg = await getFfmpeg();
  const inName = "input.webm";
  const outName = outputName.endsWith(".mp4") ? outputName : `${outputName}.mp4`;

  await ffmpeg.writeFile(inName, await fetchFile(webmBlob));
  await ffmpeg.exec([
    "-i",
    inName,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-crf",
    String(Math.max(16, Math.min(35, Math.floor(crf)))),
    "-preset",
    "veryfast",
    "-movflags",
    "+faststart",
    "-an",
    outName,
  ]);
  const outData = await ffmpeg.readFile(outName);
  await ffmpeg.deleteFile(inName);
  await ffmpeg.deleteFile(outName);
  return new Blob([outData], { type: "video/mp4" });
}
