import { VoiceOrb } from "@/components/call/VoiceOrb";

type Props = {
  /** Height of the wordmark; width follows. */
  className?: string;
  /** Diameter of the orb in CSS pixels, or false for the wordmark alone. */
  mark?: number | false;
};

/**
 * The TecAce logo: the orb as the mark, then the wordmark from tecace.com.
 * The mark is the same film the call's orb plays, idling, so the thing that
 * listens on the call is the thing on the letterhead. The wordmark is the
 * site's own PNG (980 × 272, navy on white), so it belongs on white surfaces;
 * the sticky bar and header are both white. Where a live orb already sits
 * beside the logo, pass `mark={false}` rather than showing two.
 */
export function Logo({ className = "h-6", mark = 28 }: Props) {
  return (
    <span className="inline-flex shrink-0 items-center gap-2">
      {mark ? <BrandMark size={mark} /> : null}
      <img
        src="/tecace-logo.png"
        alt="TecAce"
        width={980}
        height={272}
        // `priority` was next/image's preload hint; the plain tag's equivalent is to not defer it.
        loading="eager"
        className={`w-auto ${className}`}
      />
    </span>
  );
}

/** The orb on its own, for where there is no room or no white for the wordmark. */
export function BrandMark({ size = 28, className }: { size?: number; className?: string }) {
  return <VoiceOrb state="idle" size={size} className={className} />;
}
