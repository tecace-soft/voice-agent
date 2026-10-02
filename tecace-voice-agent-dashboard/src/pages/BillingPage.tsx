// Billing — a placeholder until payments are in the dashboard. It exists so a demo's Launch
// instructions ("Next step: set up billing") has somewhere real to lead: onboarding starts once
// billing is in place and an admin approves the setup. Open to every signed-in account, demo-stage
// owners included. When billing is built, this page is where it goes.

export function BillingPage() {
  return (
    <div className="view">
      <section className="card">
        <div className="card-head">
          <div>
            <div className="card-title ta-headline-2">Billing</div>
            <div className="card-sub ta-caption-1">Onboarding starts once billing is set up.</div>
          </div>
          <span className="badge badge-outline badge-sm">Coming soon</span>
        </div>
        <p className="card-foot ta-body-2">
          Payments aren't in the dashboard yet. For now we set billing up with you directly. Once it's in place and
          we've approved your setup, your receptionist moves to onboarding: every setting becomes yours to change
          and test, and you get your own number.
        </p>
      </section>
    </div>
  );
}
