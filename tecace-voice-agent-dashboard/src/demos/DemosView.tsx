import type { ViewId } from "../components/Sidebar";
import type { ProspectTab, SectionId } from "../routing";
import { DemosGate } from "./DemosGate";
import { DemoAnalyticsScreen } from "./screens/DemoAnalyticsScreen";
import { MyReceptionistScreen } from "./screens/MyReceptionistScreen";
import { ProspectScreen } from "./screens/ProspectScreen";
import { PROSPECTS_VIEW_KEY, ProspectsScreen } from "./screens/ProspectsScreen";
import { useEffect } from "react";
import { demoHref, isPromoId } from "./routes";

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
  section,
  onSection,
  tab,
  onTab,
}: {
  view: ViewId;
  id: string | undefined;
  /** Dashboard-only: the open settings section on a prospect's page. */
  section?: SectionId;
  onSection?: (section: SectionId) => void;
  /** Dashboard-only: the open tab on a prospect's page. */
  tab?: ProspectTab;
  onTab?: (tab: ProspectTab) => void;
  operator?: boolean;
}) {
  if (!operator) {
    return (
      <DemosGate>
        {id && isPromoId(id) && (view === "myOverview" || view === "myCalls") ? (
          <MyReceptionistScreen key={`${view}-${id}`} id={id} page={view === "myCalls" ? "calls" : "overview"} />
        ) : id && isPromoId(id) ? (
          <ProspectScreen
            key={id}
            id={id}
            operator={false}
            section={section}
            onSection={onSection}
            tab={tab}
            onTab={onTab}
          />
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
      {view === "demoOverview" && <DemoAnalyticsScreen />}
      {view === "demoProspects" && <ProspectsScreen />}
      {/* Only a well-formed id reaches ProspectScreen (kept verbatim), which puts it in a demo path. */}
      {view === "demoProspect" &&
        (id && isPromoId(id) ? (
          <ProspectScreen key={id} id={id} section={section} onSection={onSection} tab={tab} onTab={onTab} />
        ) : <ProspectsScreen />)}
      {/* The promo's CRM page is the Prospects board now; its old address still opens it there. */}
      {view === "demoPipeline" && <PipelineRedirect />}
    </DemosGate>
  );
}

function PipelineRedirect() {
  useEffect(() => {
    try {
      window.localStorage.setItem(PROSPECTS_VIEW_KEY, JSON.stringify("board"));
    } catch {
      // Without storage the list opens on the table; the board is one click away.
    }
    window.location.replace(demoHref("demoProspects"));
  }, []);
  return null;
}
