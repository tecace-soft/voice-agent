import type { ViewId } from "../components/Sidebar";

// The admin-only Demos section. App uses this to pick the breadcrumb, hide the transcribe-only
// topbar controls, and render these views through the promo gate.
export const DEMO_VIEWS: ReadonlySet<ViewId> = new Set<ViewId>([
  "demoOverview",
  "demoProspects",
  "demoProspect",
  "demoPipeline",
]);
