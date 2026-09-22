import type { ViewId } from "../components/Sidebar";
import { DemosGate } from "./DemosGate";
import { OverviewScreen } from "./screens/OverviewScreen";
import { PipelineScreen } from "./screens/PipelineScreen";
import { ProspectScreen } from "./screens/ProspectScreen";
import { ProspectsScreen } from "./screens/ProspectsScreen";
import { isPromoId } from "./routes";

// Which Demos screen to show for a route. Everything goes through the gate (promo sign-in + the
// .tw styling boundary).
export function DemosView({
  view,
  id,
}: {
  view: ViewId;
  id: string | undefined;
}) {
  return (
    <DemosGate>
      {view === "demoOverview" && <OverviewScreen />}
      {view === "demoProspects" && <ProspectsScreen />}
      {/* Only a well-formed id reaches ProspectScreen (kept verbatim), which puts it in a promo path. */}
      {view === "demoProspect" &&
        (id && isPromoId(id) ? <ProspectScreen key={id} id={id} /> : <ProspectsScreen />)}
      {view === "demoPipeline" && <PipelineScreen />}
    </DemosGate>
  );
}
