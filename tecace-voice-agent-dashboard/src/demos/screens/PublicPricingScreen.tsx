import { Pricing } from "@/components/public/Pricing";
import { mailtoFor } from "@/lib/links";

/**
 * The promo's `app/c/[id]/pricing/page.tsx`: the price list as a prospect reaches it from their
 * demo — same prices, plus the way back and an email that says whose demo it was.
 *
 * As with the scenarios page, the loading and the "not available" case moved to the public entry, so
 * what is left is the shaping. Only what the business itself should see is passed in.
 */
type Props = {
  customerId: string;
  name: string;
  agentName: string;
  demoUrl: string;
};

export function PublicPricingScreen({ customerId, name, agentName, demoUrl }: Props) {
  return (
    <Pricing
      mailto={mailtoFor(name, demoUrl)}
      demo={{ id: customerId, businessName: name, agentName }}
    />
  );
}
