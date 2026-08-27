import { useCallback, useRef, useState, type DragEvent } from "react";
import { IconAlert, IconImage, IconX } from "../icons";
import { dataUrlBytes, formatBytes, ScreenshotError, toDataUrl } from "../screenshot";

// Attaching a screenshot to a feedback note.
//
// Paste is the path people actually use — a bug report starts with Win+Shift+S, and the next thing
// they do is Ctrl+V. So the state lives in a hook the *page* owns and hangs off the form's onPaste,
// which means pasting works with the cursor in the message box (where it will be) and not only when
// this control has focus. Drop and a file picker are here too, because paste is invisible: nothing
// on screen tells you it's an option until it's written down.

export interface Screenshot {
  value: string | null;
  error: string | null;
  accept: (file: File | null | undefined) => Promise<void>;
  clear: () => void;
}

export function useScreenshot(): Screenshot {
  const [value, setValue] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const accept = useCallback(async (file: File | null | undefined) => {
    if (!file) return;
    setError(null);
    try {
      setValue(await toDataUrl(file));
    } catch (e) {
      setError(
        e instanceof ScreenshotError ? e.message : "Couldn't read that image. Try a different one.",
      );
    }
  }, []);

  const clear = useCallback(() => {
    setValue(null);
    setError(null);
  }, []);

  return { value, error, accept, clear };
}

export function ScreenshotField({ shot, busy }: { shot: Screenshot; busy?: boolean }) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setOver(false);
    void shot.accept(event.dataTransfer.files[0]);
  }

  return (
    <div className="field">
      <span className="field-label ta-caption-1">
        {shot.value ? "Screenshot" : "Screenshot (optional)"}
      </span>

      {shot.value ? (
        <figure className="shot-preview">
          <img src={shot.value} alt="The screenshot you attached" />
          <figcaption className="ta-caption-2 muted">
            {formatBytes(dataUrlBytes(shot.value))}
          </figcaption>
          <button
            type="button"
            className="shot-remove"
            onClick={shot.clear}
            disabled={busy}
            aria-label="Remove screenshot"
            title="Remove screenshot"
          >
            <IconX size={14} />
          </button>
        </figure>
      ) : (
        <button
          type="button"
          className={`shot-drop${over ? " is-over" : ""}`}
          onClick={() => input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
          disabled={busy}
        >
          <IconImage size={18} />
          <span className="ta-label-1">Paste, drop, or choose an image</span>
          <span className="ta-caption-2 muted">
            Press Ctrl+V anywhere in this form to attach what you just captured
          </span>
        </button>
      )}

      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        hidden
        onChange={(e) => {
          void shot.accept(e.target.files?.[0]);
          // Cleared so picking the same file again after a removal still fires a change event.
          e.target.value = "";
        }}
      />

      {shot.error && (
        <span className="field-hint ta-caption-2 shot-error" role="alert">
          <IconAlert size={12} />
          {shot.error}
        </span>
      )}
    </div>
  );
}
