// Where the promo's pop-ups render. Base UI portals render into <body> by default — outside every
// .tw element, where the scoped Tailwind styles don't reach. This is one shared `.tw` element at the
// end of <body>, so dialogs, menus, selects and tooltips get the promo styling. It's created when a
// portal-using component first renders on a Demos view — not when a pop-up first opens: e.g. the
// Prospects screen mounts a DialogPortal straight away. It's never created on transcribe screens.
let container: HTMLElement | null = null;

export function twPortalContainer(): HTMLElement {
  if (!container || !container.isConnected) {
    container = document.createElement("div");
    container.className = "tw";
    container.setAttribute("data-tw-portal", "");
    document.body.appendChild(container);
  }
  return container;
}
