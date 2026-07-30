import type { IntakeStatus } from "./api/types";
import { STATUS_LABEL } from "./lib";

// A colored pill for a client's lifecycle status.
export function StatusBadge({ status }: { status: IntakeStatus }) {
  return <span className={`badge badge-${status}`}>{STATUS_LABEL[status]}</span>;
}

// Small helper to render loading / error consistently across pages.
export function AsyncState({ loading, error }: { loading: boolean; error: string | null }) {
  if (loading) return <p className="muted">Loading…</p>;
  if (error) return <p className="error">{error}</p>;
  return null;
}
