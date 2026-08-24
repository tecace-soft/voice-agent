// Loading placeholder for the first fetch — the dashboard's own shape in muted blocks, so the
// layout doesn't jump when the numbers arrive (and no spinners scattered around the page).
export function DashboardSkeleton() {
  return (
    <div className="view" aria-hidden="true">
      <div className="kpi-grid">
        {[0, 1, 2, 3].map((i) => (
          <div className="stat-card" key={i}>
            <div className="stat-card-body">
              <div className="skeleton skeleton-line short" />
              <div className="skeleton skeleton-value" />
            </div>
            <footer className="stat-card-foot">
              <div className="skeleton skeleton-line" />
            </footer>
          </div>
        ))}
      </div>
      <div className="card">
        <div className="card-head">
          <div className="skeleton skeleton-line short" />
        </div>
        <div className="chart-body">
          <div className="skeleton skeleton-chart" />
        </div>
      </div>
    </div>
  );
}
