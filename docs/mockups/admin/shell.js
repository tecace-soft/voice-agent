// Shared chrome for the admin mockups: the proposed sidebar, the top bar, the design-notes panel,
// and the few interactions the mockups need (tabs, drawers, dialogs, menus, segment toggles).
// Mockup only: nothing here talks to a backend.

const I = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r=".5"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  building: '<path d="M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16M16 9h2a2 2 0 0 1 2 2v10M8 7h4M8 11h4M8 15h4M2 21h20"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6"/>',
  key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.8-9.8M17 6l3 3M14.5 8.5l2 2"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  chev: '<path d="m9 6 6 6-6 6"/>',
  back: '<path d="m15 6-6 6 6 6"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
  filter: '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  board: '<rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="11" rx="1.5"/><rect x="17" y="4" width="4" height="7" rx="1.5"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  play: '<path d="m7 4 13 8-13 8z"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3"/>',
};
window.icon = (name, cls = "ico") => `<svg class="${cls}" viewBox="0 0 24 24">${I[name] || ""}</svg>`;

const NAV = [
  { items: [["overview", "Overview", "home", "overview.html"], ["transcripts", "Transcripts", "chat", "transcripts.html"]] },
  {
    title: "Sales",
    items: [
      ["prospects", "Prospects", "target", "prospects.html", 2],
      ["demo-analytics", "Demo analytics", "chart", "demo-analytics.html"],
    ],
  },
  {
    title: "Customers",
    items: [
      ["customers", "Customers", "building", "customers.html"],
      ["numbers", "Phone numbers", "phone", "numbers.html", "1", true],
    ],
  },
  { title: "Voicemail", collapsible: true, items: [["voicemail", "Voicemail", "mail", "voicemail.html", "1", true]] },
  {
    title: "Admin",
    items: [
      ["feedback", "Feedback", "inbox", "feedback.html", 1],
      ["team", "Team and API keys", "key", "team.html"],
    ],
  },
];

function sidebar(active) {
  const groups = NAV.map((g) => {
    const items = g.items
      .map(([id, label, ic, href, count, warn]) => {
        const c = count ? `<span class="count${warn ? " warn" : ""}">${count}</span>` : "";
        return `<a class="item${id === active ? " active" : ""}" href="${href}">${icon(ic)}${label}${c}</a>`;
      })
      .join("");
    return `<div class="group">${g.title ? `<p>${g.title}</p>` : ""}${items}</div>`;
  }).join("");
  return `
    <aside class="side">
      <div class="brand"><span class="orb"></span>TecAce <span class="cap" style="font-weight:500">Voice agent</span></div>
      <nav>${groups}</nav>
      <div class="me">
        <span class="avatar">AA</span>
        <div class="col" style="gap:0;min-width:0"><span>Ada Admin</span><a class="cap" href="#">Version 0.0.14 · Changelog</a></div>
        <span class="spacer"></span>
        <button class="btn ghost sm icon" title="Account">${icon("more")}</button>
      </div>
    </aside>`;
}

function topbar(crumbs, right) {
  const parts = crumbs.map((c, i) => (i === crumbs.length - 1 ? `<b>${c}</b>` : `<span>${c}</span><span>/</span>`)).join(" ");
  return `<header class="top"><div class="crumbs">${parts}</div><span class="spacer"></span>${right || ""}<button class="btn ghost icon" title="Theme">${icon("sun")}</button></header>`;
}

/** Called by each page: mounts the shell around #page and wires the interactions. */
window.mount = ({ active, crumbs, right, wide, notes }) => {
  const page = document.getElementById("page");
  const app = document.createElement("div");
  app.className = "app";
  app.innerHTML = sidebar(active) + `<div class="right">${topbar(crumbs, right)}<main class="main${wide ? " wide" : ""}"></main></div>`;
  app.querySelector("main").append(...page.childNodes);
  page.replaceWith(app);
  // <i data-i="copy"></i> in the page markup becomes that icon.
  document.querySelectorAll("i[data-i]").forEach((el) => (el.outerHTML = icon(el.dataset.i)));

  if (notes && notes.length) {
    const box = document.createElement("aside");
    box.className = "notes";
    box.innerHTML =
      `<button class="min" data-hide-notes title="Hide">${icon("x")}</button><h4>변경 메모 (목업 주석, 제품 UI 아님)</h4><ol>` +
      notes.map((n, i) => `<li><span class="pin">${i + 1}</span><span>${n}</span></li>`).join("") +
      "</ol>";
    document.body.append(box);
    const t = document.createElement("button");
    t.className = "btn sm note-toggle";
    t.textContent = "메모 보기/숨기기";
    t.onclick = () => document.body.classList.toggle("hide-notes");
    document.body.append(t);
  }

  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-tab],[data-open],[data-close],[data-menu],[data-seg],[data-hide-notes],[data-switch]");
    document.querySelectorAll(".menu.open").forEach((m) => {
      if (!el || el.dataset.menu !== m.id) m.classList.remove("open");
    });
    if (!el) return;
    if (el.dataset.hideNotes !== undefined) document.body.classList.add("hide-notes");
    if (el.dataset.switch !== undefined) el.classList.toggle("on");
    if (el.dataset.tab) {
      const group = el.closest("[data-tabs]");
      group.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("on", b === el));
      document.querySelectorAll(`[data-panel-of="${group.dataset.tabs}"]`).forEach((p) => {
        p.hidden = p.dataset.panel !== el.dataset.tab;
      });
    }
    if (el.dataset.seg) {
      el.parentElement.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === el));
      const target = el.parentElement.dataset.view;
      if (target) document.querySelectorAll(`[data-view-of="${target}"]`).forEach((p) => (p.hidden = p.dataset.viewName !== el.dataset.seg));
    }
    if (el.dataset.open) {
      e.preventDefault();
      document.getElementById(el.dataset.open).classList.add("open");
      document.getElementById("scrim")?.classList.add("open");
    }
    if (el.dataset.close !== undefined) {
      document.querySelectorAll(".drawer.open,.dialog.open,.scrim.open").forEach((d) => d.classList.remove("open"));
    }
    if (el.dataset.menu) {
      e.stopPropagation();
      document.getElementById(el.dataset.menu).classList.toggle("open");
    }
  });
};

/** A small area chart from a list of numbers, for the mockups' charts. */
window.areaChart = (values, labels) => {
  const w = 640, h = 200, pad = 24, max = Math.max(...values, 1);
  const x = (i) => pad + (i * (w - pad * 2)) / (values.length - 1);
  const y = (v) => h - pad - (v / max) * (h - pad * 2);
  const pts = values.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  const grid = [0, 0.5, 1].map((f) => `<line class="grid-l" x1="${pad}" x2="${w - pad}" y1="${y(max * f)}" y2="${y(max * f)}"/>`).join("");
  const lab = (labels || []).map((l, i) => (i % 2 ? "" : `<text x="${x(i)}" y="${h - 4}" text-anchor="middle">${l}</text>`)).join("");
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${grid}<polygon class="area" points="${pad},${h - pad} ${pts} ${w - pad},${h - pad}"/><polyline class="line" points="${pts}"/>${lab}</svg>`;
};
