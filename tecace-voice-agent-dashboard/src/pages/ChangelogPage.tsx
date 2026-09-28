import { APP_VERSION, visibleReleases, type ChangeKind } from "../changelog";

// What changed, release by release (src/changelog.ts). Reached from the version under the sidebar;
// open to every signed-in account. Customers see their own lines, admins also the operator ones.

const KIND_LABEL: Record<ChangeKind, string> = { new: "New", improved: "Improved", fixed: "Fixed" };
const KIND_BADGE: Record<ChangeKind, string> = {
  new: "badge badge-admin badge-sm",
  improved: "badge badge-neutral badge-sm",
  fixed: "badge badge-success badge-sm",
};

function longDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function ChangelogPage({ isAdmin }: { isAdmin: boolean }) {
  const releases = visibleReleases(isAdmin);
  return (
    <div className="view">
      <section className="card">
        <div className="card-head">
          <div>
            <div className="card-title ta-headline-2">Changelog</div>
            <div className="card-sub ta-caption-1">
              You're on version {APP_VERSION}. What changed in each release, newest first.
            </div>
          </div>
        </div>
        <ol className="changelog">
          {releases.map((release) => (
            <li key={release.version} className="changelog-release">
              <div className="changelog-head">
                <span className="ta-label-1 changelog-version">v{release.version}</span>
                <span className="ta-caption-1 muted">{longDate(release.date)}</span>
                {release.version === APP_VERSION ? <span className="badge badge-outline badge-sm">Current</span> : null}
              </div>
              <div className="ta-headline-2 changelog-title">{release.title}</div>
              <ul className="changelog-items">
                {release.items.map((item, i) => (
                  <li key={i} className="ta-body-2">
                    <span className={KIND_BADGE[item.kind]}>{KIND_LABEL[item.kind]}</span>
                    <span>{item.text}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
