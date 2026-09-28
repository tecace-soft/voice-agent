import { useState, type ComponentProps } from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SignupForm } from "../signup/SignupForm";
import { openDashboard } from "../signup/api";
import type { SetupState } from "./capabilities";

// "Request setup" on the public demo page: the business asks for this receptionist, and signs up in
// the same step (name, email, password, then the code from the email). An admin approves it; from
// then on everything the page shows read-only is theirs to change.
//
// Once somebody has asked, the page offers sign-in instead: the request is theirs, and the page is
// public, so it never says who.

/** The page's buttons for it: one look wherever it appears, and the right words for the state. */
export function RequestSetupButton({
  setup,
  onOpen,
  ...props
}: { setup: SetupState; onOpen: () => void } & Omit<ComponentProps<typeof Button>, "onClick">) {
  if (setup !== "available") {
    return (
      <Button variant="outline" {...props} nativeButton={false} render={<a href="/" />}>
        {setup === "requested" ? "Setup requested · Sign in" : "Sign in"}
      </Button>
    );
  }
  return (
    <Button {...props} onClick={onOpen}>
      Request setup
    </Button>
  );
}

export function RequestSetupDialog({
  open,
  onOpenChange,
  demoId,
  businessName,
  agentName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  demoId: string;
  businessName: string;
  agentName: string;
}) {
  const [done, setDone] = useState<"signed-in" | "requested" | null>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[440px]">
        {done ? (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <CheckCircle2 className="text-success size-10" aria-hidden />
            <DialogTitle className="ta-headline-1">{done === "signed-in" ? "You're in" : "Request sent"}</DialogTitle>
            <DialogDescription className="ta-body-2 text-muted-foreground max-w-[34ch]">
              {done === "signed-in"
                ? `We'll review it and email you when you can start editing ${agentName}. Until then you can look through everything in your account.`
                : "We'll review it and get back to you. Once it's approved, sign in with the email and password you just chose."}
            </DialogDescription>
            {done === "signed-in" ? (
              <Button size="lg" className="mt-2 h-11" onClick={openDashboard}>
                Go to my receptionist
              </Button>
            ) : (
              <Button size="lg" variant="outline" className="mt-2 h-11" onClick={() => onOpenChange(false)}>
                Back to the demo
              </Button>
            )}
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="ta-headline-1">Set up {agentName} for {businessName}</DialogTitle>
              <DialogDescription className="ta-body-2 text-muted-foreground">
                Create your account to request setup. Once we approve it, you can change everything you see on this
                page and test it before your phone line goes live.
              </DialogDescription>
            </DialogHeader>
            <SignupForm
              mode={{ kind: "claim", demoId, businessName }}
              onSignedIn={() => setDone("signed-in")}
              onRequested={() => setDone("requested")}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
