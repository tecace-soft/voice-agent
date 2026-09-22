
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Customer } from "@/lib/types";

type Props = {
  customer: Customer;
  onChange: (partial: Partial<Customer>) => void;
  onResearch: () => void;
  researching: boolean;
};

export function ResearchInputsPanel({
  customer,
  onChange,
  onResearch,
  researching,
}: Props) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="ta-headline-2">Research inputs</h3>
        <p className="ta-caption-1 text-muted-foreground">
          The name is what gets researched. The links and notes only help pick the
          right business and fill the gaps.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="businessName" className="ta-label-1">
          Business name
        </Label>
        <Input
          id="businessName"
          value={customer.businessName}
          onChange={(event) => onChange({ businessName: event.target.value })}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="websiteUrl" className="ta-label-1">
            Website
          </Label>
          <Input
            id="websiteUrl"
            placeholder="https://example.com"
            value={customer.websiteUrl ?? ""}
            onChange={(event) => onChange({ websiteUrl: event.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="mapsUrl" className="ta-label-1">
            Google Maps link
          </Label>
          <Input
            id="mapsUrl"
            placeholder="https://maps.app.goo.gl/..."
            value={customer.mapsUrl ?? ""}
            onChange={(event) => onChange({ mapsUrl: event.target.value })}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="researchNotes" className="ta-label-1">
          Notes for the research
        </Label>
        <Textarea
          id="researchNotes"
          className="min-h-20"
          value={customer.researchNotes ?? ""}
          onChange={(event) => onChange({ researchNotes: event.target.value })}
        />
      </div>

      <Button variant="outline" onClick={onResearch} disabled={researching}>
        <RefreshCw className="size-4" />
        {researching ? "Researching" : "Run research again"}
      </Button>
    </div>
  );
}
