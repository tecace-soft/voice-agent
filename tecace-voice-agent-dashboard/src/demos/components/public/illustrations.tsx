/**
 * One drawn language for the public pages.
 *
 * Every drawing is line art on `currentColor` at a single 1.5 stroke, so it
 * inherits the text colour it sits in and needs no asset pipeline, no licence,
 * and no second file to keep in sync. Brand blue is reserved for what the
 * voice agent itself does — a ring it answers, a booking it writes — which is
 * why the accent groups carry `text-primary` rather than a hex value.
 *
 * All of these are decoration next to copy that already says the same thing,
 * so they are aria-hidden.
 */

const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

type Props = { className?: string };

/** The desk phone, ringing. Used wherever a call is arriving. */
function DeskPhone() {
  return (
    <g {...STROKE}>
      <rect x="60" y="90" width="80" height="26" rx="7" />
      <circle cx="78" cy="103" r="2" />
      <circle cx="88" cy="103" r="2" />
      <circle cx="98" cy="103" r="2" />
      <path d="M64 64h10a6 6 0 0 1 6 6v2h40v-2a6 6 0 0 1 6-6h10a6 6 0 0 1 6 6v8a6 6 0 0 1-6 6h-10a6 6 0 0 1-6-6v-2H80v2a6 6 0 0 1-6 6H64a6 6 0 0 1-6-6v-8a6 6 0 0 1 6-6z" />
      <path d="M142 102c10 2 10 7 0 9s-10 7 0 9" />
    </g>
  );
}

function Rings() {
  return (
    <g {...STROKE} className="text-primary">
      <path d="M48 64a18 18 0 0 0 0 22M38 57a30 30 0 0 0 0 36" />
      <path d="M152 64a18 18 0 0 1 0 22M162 57a30 30 0 0 1 0 36" />
    </g>
  );
}

/** Hero: the shop phone ringing on the counter. */
export function PhoneRinging({ className }: Props) {
  return (
    <svg viewBox="0 0 200 140" className={className} aria-hidden role="presentation">
      <DeskPhone />
      <Rings />
      <path {...STROKE} d="M24 126h152" opacity={0.5} />
    </svg>
  );
}

/**
 * The call nobody picked up, and where it went. The one red mark on the page
 * is this one, because a missed call is the problem being named.
 */
export function CallWalksAway({ className }: Props) {
  return (
    <svg viewBox="18 22 190 100" className={className} aria-hidden role="presentation">
      <g {...STROKE}>
        <rect x="26" y="30" width="48" height="82" rx="9" />
        <path d="M42 40h16" />
        <path d="M38 96h24" opacity={0.5} />
      </g>
      <g {...STROKE} className="text-destructive">
        <path d="M40 62l20 16M60 62L40 78" />
      </g>
      <g {...STROKE} opacity={0.6} strokeDasharray="4 5">
        <path d="M82 92c26 22 54 20 68-2" />
      </g>
      <g {...STROKE}>
        <path d="M148 86l6-6 6 6" />
        <path d="M134 62h62l-9 16h-44z" />
        <path d="M143 78v34h44V78" />
        <path d="M158 112V94h14v18" />
      </g>
    </svg>
  );
}

/** Step one: it rings, at an hour that suits the caller. */
export function StepRings({ className }: Props) {
  return (
    <svg viewBox="0 0 120 100" className={className} aria-hidden role="presentation">
      <g {...STROKE}>
        <rect x="34" y="52" width="52" height="20" rx="6" />
        <circle cx="46" cy="62" r="1.75" />
        <circle cx="54" cy="62" r="1.75" />
        <circle cx="62" cy="62" r="1.75" />
        <rect x="37" y="38" width="46" height="11" rx="5.5" />
      </g>
      <g {...STROKE} className="text-primary">
        <path d="M26 38a14 14 0 0 0 0 18M94 38a14 14 0 0 1 0 18" />
      </g>
    </svg>
  );
}

/** Step two: it answers, and it already knows the business. */
export function StepAnswers({ className }: Props) {
  return (
    <svg viewBox="0 0 120 100" className={className} aria-hidden role="presentation">
      <g {...STROKE} opacity={0.55}>
        <rect x="20" y="24" width="44" height="34" rx="6" />
        <path d="M28 36h20M28 44h28" />
      </g>
      <g {...STROKE} className="text-primary">
        <rect x="48" y="40" width="54" height="36" rx="8" />
        <path d="M58 52h30M58 62h20" />
        <path d="M62 76l-6 12 16-12" />
      </g>
    </svg>
  );
}

/** Step three: what comes back to you, written down. */
export function StepWritesItDown({ className }: Props) {
  return (
    <svg viewBox="0 0 120 100" className={className} aria-hidden role="presentation">
      <g {...STROKE}>
        <rect x="22" y="26" width="48" height="46" rx="6" />
        <path d="M22 38h48M34 26v-6M58 26v-6" />
      </g>
      <g {...STROKE} className="text-primary">
        <path d="M34 54l8 8 16-18" />
        <path d="M76 58h18M88 52l6 6-6 6" />
      </g>
    </svg>
  );
}

/** The scenarios, stacked: more of the same work, not yet turned on. */
export function ScenarioStack({ className }: Props) {
  return (
    <svg viewBox="0 0 140 110" className={className} aria-hidden role="presentation">
      <g {...STROKE} opacity={0.35}>
        <rect x="34" y="14" width="76" height="30" rx="8" />
      </g>
      <g {...STROKE} opacity={0.6}>
        <rect x="26" y="34" width="84" height="32" rx="8" />
      </g>
      <g {...STROKE} className="text-primary">
        <rect x="18" y="56" width="92" height="36" rx="9" />
        <path d="M32 70h44M32 80h26" />
        <rect x="82" y="68" width="9" height="13" rx="4.5" />
        <rect x="97" y="68" width="9" height="13" rx="4.5" />
        <path d="M91 74.5h6" />
      </g>
    </svg>
  );
}

/** Going live: the number you already print stays the number you print. */
export function KeepYourNumber({ className }: Props) {
  return (
    <svg viewBox="0 0 200 110" className={className} aria-hidden role="presentation">
      <g {...STROKE}>
        <rect x="18" y="32" width="68" height="46" rx="9" />
        <rect x="30" y="44" width="10" height="15" rx="5" />
        <rect x="54" y="44" width="10" height="15" rx="5" />
        <path d="M40 51.5h14" />
        <path d="M30 68h34" opacity={0.5} />
      </g>
      <g {...STROKE} className="text-primary">
        <path d="M98 54h28" />
        <path d="M119 47l7 7-7 7" />
        <path d="M144 58a21 21 0 0 1 42 0" />
        <rect x="138" y="56" width="12" height="21" rx="6" />
        <rect x="180" y="56" width="12" height="21" rx="6" />
        <path d="M186 77v3a6 6 0 0 1-6 6h-9" />
      </g>
    </svg>
  );
}
