// Stands in for a Demos screen that is ported from the promo app in stage 4.
export function DemoPlaceholderPage({ title, body }: { title: string; body: string }) {
  return (
    <section className="rounded-xl border bg-card px-6 py-5">
      <h2 className="ta-headline-2 text-foreground">{title}</h2>
      <p className="ta-body-2 mt-1 text-muted-foreground">{body}</p>
    </section>
  );
}
