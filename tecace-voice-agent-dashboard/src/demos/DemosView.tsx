import type { ViewId } from "../components/Sidebar";
import { DemosGate } from "./DemosGate";
import { DemoPlaceholderPage } from "./pages/DemoPlaceholderPage";
import { DemoProspectPage } from "./pages/DemoProspectPage";
import { DemoProspectsPage } from "./pages/DemoProspectsPage";

// Which Demos screen to show for a route. Everything goes through the gate (promo sign-in + the
// .tw styling boundary).
export function DemosView({
  view,
  id,
  onOpenProspect,
  onShowProspects,
}: {
  view: ViewId;
  id: string | undefined;
  onOpenProspect: (id: string) => void;
  onShowProspects: () => void;
}) {
  return (
    <DemosGate>
      {view === "demoOverview" && (
        <DemoPlaceholderPage
          title="Demo overview"
          body="Coming soon: calls per day, top prospects by minutes and recent calls from the promo app."
        />
      )}
      {view === "demoProspects" && <DemoProspectsPage onOpen={onOpenProspect} />}
      {view === "demoProspect" &&
        (id ? <DemoProspectPage id={id} onBack={onShowProspects} /> : <DemoProspectsPage onOpen={onOpenProspect} />)}
      {view === "demoPipeline" && (
        <DemoPlaceholderPage
          title="Pipeline"
          body="Coming soon: the CRM board, every prospect by stage with the activity feed beside it."
        />
      )}
    </DemosGate>
  );
}
