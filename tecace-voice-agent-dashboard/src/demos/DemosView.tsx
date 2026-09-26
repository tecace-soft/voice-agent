import type { ViewId } from "../components/Sidebar";
import { DemosGate } from "./DemosGate";
import { OverviewScreen } from "./screens/OverviewScreen";
import { PipelineScreen } from "./screens/PipelineScreen";
import { ProspectScreen } from "./screens/ProspectScreen";
import { ProspectsScreen } from "./screens/ProspectsScreen";
import { isPromoId } from "./routes";

// Which Demos screen to show for a route. Everything goes through the gate (the .tw styling
// boundary).
//
// `operator` is false for the one case where these screens are not being read by us: a customer in
// the demo stage, looking at the receptionist we built for them. They get their own record and
// nothing around it — the three pipeline screens read across every prospect, so there is no version
// of them that belongs to one customer, and a fallback to the prospect list would be exactly the
// leak this is here to prevent.
export function DemosView({
  view,
  id,
  operator = true,
  onOnboarded,
}: {
  view: ViewId;
  id: string | undefined;
  operator?: boolean;
  /** The customer started onboarding from their demo page. */
  onOnboarded?: () => void | Promise<void>;
}) {
  if (!operator) {
    return (
      <DemosGate>
        {id && isPromoId(id) ? (
          <ProspectScreen key={id} id={id} operator={false} onOnboarded={onOnboarded} />
        ) : (
          <p className="ta-body-2 text-muted-foreground">
            Your demo isn't set up yet. We'll be in touch as soon as it is.
          </p>
        )}
      </DemosGate>
    );
  }

  return (
    <DemosGate>
      {view === "demoOverview" && <OverviewScreen />}
      {view === "demoProspects" && <ProspectsScreen />}
      {/* Only a well-formed id reaches ProspectScreen (kept verbatim), which puts it in a demo path. */}
      {view === "demoProspect" &&
        (id && isPromoId(id) ? <ProspectScreen key={id} id={id} /> : <ProspectsScreen />)}
      {view === "demoPipeline" && <PipelineScreen />}
    </DemosGate>
  );
}
