import { CalendarClock, Eye, NotebookPen, PhoneCall } from "lucide-react";
import type { CustomerStage, Heat } from "@/lib/types";
import type { STATUS_STYLES } from "@/components/admin/shared";

export const STAGE_LABEL: Record<CustomerStage, string> = {
  new: "New",
  contacted: "Contacted",
  interested: "Interested",
  won: "Won",
  lost: "Lost",
};

export const STAGE_KIND: Record<CustomerStage, keyof typeof STATUS_STYLES> = {
  new: "neutral",
  contacted: "active",
  interested: "caution",
  won: "positive",
  lost: "negative",
};

export const HEAT_KIND: Record<Heat, keyof typeof STATUS_STYLES> = {
  hot: "negative",
  warm: "caution",
  cold: "neutral",
};

/** The icon for a timeline or feed row, by what happened. */
export const ENTRY_ICON = {
  note: NotebookPen,
  view: Eye,
  call: PhoneCall,
} as const;

export const FOLLOW_UP_ICON = CalendarClock;

/** An ISO instant as the value a date input wants. */
export function toDateValue(iso?: string): string {
  return iso ? iso.slice(0, 10) : "";
}

/** "2h", "3d", "just now" — a feed column has no room for a full timestamp. */
export function sinceLabel(iso: string, now = Date.now()): string {
  const ms = now - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}
