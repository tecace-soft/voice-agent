import { demoFetch } from "@/api";
import { useState } from "react";
import { Clock, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DEMO_TIME_STEPS } from "@/lib/analytics";
import { readJson } from "@/lib/http";
import { DEFAULT_DEMO_MINUTES, type Customer } from "@/lib/types";

/**
 * Adds minutes to a demo and saves at once. Only `addDemoMinutes` is sent, so
 * unsaved edits elsewhere on the page are neither saved nor lost by it.
 */
export async function addDemoTime(customerId: string, minutes: number): Promise<Customer> {
  const response = await demoFetch(`/customers/${customerId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ addDemoMinutes: minutes }),
  });
  const { customer } = await readJson<{ customer: Customer }>(response);
  toast.success(`Added ${minutes} minutes. The demo now has ${customer.demoMinutes} in all.`);
  return customer;
}

function reportFailure(caught: unknown) {
  toast.error(caught instanceof Error ? caught.message : "Could not add time.");
}

type Props = {
  customerId: string;
  demoMinutes: number | undefined;
  onAdded: (customer: Customer) => void;
};

/** The button on the customer page: "Demo time" with the total, and a menu of steps. */
export function AddDemoTimeMenu({ customerId, demoMinutes, onAdded }: Props) {
  const [busy, setBusy] = useState(false);

  async function add(minutes: number) {
    setBusy(true);
    try {
      onAdded(await addDemoTime(customerId, minutes));
    } catch (caught) {
      reportFailure(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={busy}
        render={
          <Button variant="outline">
            <Clock className="size-4" />
            Demo time: {demoMinutes ?? DEFAULT_DEMO_MINUTES} min
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-44 rounded-lg">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Add demo time</DropdownMenuLabel>
          {DEMO_TIME_STEPS.map((minutes) => (
            <DropdownMenuItem key={minutes} onClick={() => void add(minutes)}>
              <Plus className="size-4" />
              {minutes} minutes
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The same steps as a submenu, for the row menu in the customer list. */
export function AddDemoTimeSubmenu({
  customerId,
  onAdded,
}: {
  customerId: string;
  onAdded: () => void;
}) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Clock className="size-4" />
        Add demo time
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        {DEMO_TIME_STEPS.map((minutes) => (
          <DropdownMenuItem
            key={minutes}
            onClick={() =>
              void addDemoTime(customerId, minutes).then(onAdded, reportFailure)
            }
          >
            <Plus className="size-4" />
            {minutes} minutes
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
