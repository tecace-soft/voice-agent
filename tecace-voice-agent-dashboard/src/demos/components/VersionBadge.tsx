import { cn } from "@/lib/utils";

/**
 * The build this page came from.
 *
 * The promo set this from `next.config.ts` at build time. Nothing sets it here: the badge is for
 * telling two deploys apart while a demo is being worked on, which is not worth a required build
 * variable. `VITE_APP_VERSION` is read if someone defines one, and the default is what ships.
 */
export const APP_VERSION: string = import.meta.env.VITE_APP_VERSION ?? "v0";

export function VersionBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn("ta-caption-2 text-muted-foreground tabular-nums", className)}
      title="Build version"
    >
      {APP_VERSION}
    </span>
  );
}
