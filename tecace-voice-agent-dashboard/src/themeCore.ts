// The theme lives in two places on <html>, because two stylesheets read it: the transcribe CSS and
// the design-system tokens read `data-theme`, while Tailwind's `dark:` variant and the promo theme
// read the `.dark` class. Setting them in one function is what keeps them from disagreeing.
export type Theme = "light" | "dark";

/** The slice of an Element this needs — so it can be tested without a DOM. */
export interface ThemeTarget {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  classList: { toggle(name: string, force?: boolean): boolean };
}

export function readTheme(root: ThemeTarget): Theme {
  return root.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

export function applyTheme(root: ThemeTarget, theme: Theme): void {
  root.setAttribute("data-theme", theme);
  root.classList.toggle("dark", theme === "dark");
}
