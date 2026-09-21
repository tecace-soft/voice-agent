import type { PromoProspect } from "./api";

export const PROSPECT_STATUS_LABEL: Record<PromoProspect["status"], string> = {
  researching: "Researching",
  ready: "Ready",
  error: "Error",
};
