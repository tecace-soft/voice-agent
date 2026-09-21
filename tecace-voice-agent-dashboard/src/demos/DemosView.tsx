import type { ViewId } from "../components/Sidebar";
import { DemosGate } from "./DemosGate";
import { DemoPlaceholderPage } from "./pages/DemoPlaceholderPage";
import { DemoProspectPage } from "./pages/DemoProspectPage";
import { OverviewScreen } from "./screens/OverviewScreen";
import { ProspectsScreen } from "./screens/ProspectsScreen";

// Which Demos screen to show for a route. Everything goes through the gate (promo sign-in + the
// .tw styling boundary).
export function DemosView({
  view,
  id,
  onShowProspects,
}: {
  view: ViewId;
  id: string | undefined;
  onShowProspects: () => void;
}) {
  return (
    <DemosGate>
      {view === "demoOverview" && <OverviewScreen />}
      {view === "demoProspects" && <ProspectsScreen />}
      {view === "demoProspect" && (id ? <DemoProspectPage id={id} onBack={onShowProspects} /> : <ProspectsScreen />)}
      {view === "demoPipeline" && (
        <DemoPlaceholderPage
          title="Pipeline"
          body="Coming soon: the CRM board, every prospect by stage with the activity feed beside it."
        />
      )}
    </DemosGate>
  );
}
