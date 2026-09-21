// Turning a pasted or dropped image into something small enough to put in a JSON body.
//
// A screenshot off a modern display is commonly 3–8 MB of PNG, which is far more than anyone needs
// to read a chart label and more than the backend will accept. So we redraw it at a sane size in a
// canvas and re-encode, in the browser, before it ever reaches the network.
//
// PNG first, because screenshots are mostly flat colour and text, and JPEG's ringing around glyphs
// is exactly the artefact that makes a screenshot of a bug hard to read. JPEG is the fallback only
// when PNG comes out too big — a photo of a monitor, or a screenshot with a photographic backdrop,
// where PNG is the wrong codec anyway.

// Longest edge after downscaling. 1600 keeps a full-width dashboard screenshot readable — the point
// is to see which number is wrong, not to count pixels.
const MAX_EDGE = 1600;

// Ceiling for the encoded data URL. The route rejects anything over 2.5 MB, so landing under 1.8 MB
// leaves room and means a rejection is a real bug rather than a boundary case.
const MAX_CHARS = 1_800_000;

const ALLOWED = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export class ScreenshotError extends Error {}

/** Roughly how many bytes a base64 data URL represents — for showing a size to a person. */
export function dataUrlBytes(dataUrl: string): number {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The first image on a paste event, or null if the clipboard held no image. */
export function imageFromClipboard(items: DataTransferItemList | null): File | null {
  if (!items) return null;
  for (const item of items) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) return file;
    }
  }
  return null;
}

async function load(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new ScreenshotError("That file isn't an image we can read."));
      img.src = url;
    });
  } finally {
    // Revoking after decode is safe — the bitmap is already in memory — and not doing it leaks the
    // blob for the life of the page, which matters when someone is pasting attempt after attempt.
    URL.revokeObjectURL(url);
  }
}

/**
 * Downscale and re-encode an image file to a data URL the backend will accept.
 *
 * Throws ScreenshotError with a message written for the person who pasted it, never a raw
 * canvas/DOM error — this runs in response to a deliberate action, so a failure has to say what to
 * do instead.
 */
export async function toDataUrl(file: File): Promise<string> {
  if (!ALLOWED.includes(file.type)) {
    throw new ScreenshotError("Attach a PNG, JPEG, WebP or GIF.");
  }

  const img = await load(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ScreenshotError("Your browser wouldn't let us process that image.");
  // Screenshots are usually scaled down by a non-integer factor; without smoothing the text turns
  // to aliased mush, which defeats the purpose of attaching it.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const png = canvas.toDataURL("image/png");
  if (png.length <= MAX_CHARS) return png;

  for (const quality of [0.85, 0.7, 0.55]) {
    const jpeg = canvas.toDataURL("image/jpeg", quality);
    if (jpeg.length <= MAX_CHARS) return jpeg;
  }

  throw new ScreenshotError(
    "That image is too large even after resizing. Crop it to the part that matters and try again.",
  );
}
