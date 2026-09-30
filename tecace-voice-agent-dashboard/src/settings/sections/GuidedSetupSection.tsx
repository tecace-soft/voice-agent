import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { Check, MessagesSquare, SendHorizontal } from "lucide-react";
import { Exchange } from "@/components/public/Exchange";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { scrollToEnd } from "@/lib/scroll";
import type { SetupTopic, SetupUnavailableReason, TopicStatus } from "../../api/types";
import type { SectionId } from "../../routing";
import { SectionIntro } from "../SettingsShell";
import type { GuidedSetup } from "../setup/useGuidedSetup";
import { TOPIC_LABEL, canSend, changeLabel, visibleMessages } from "../setup/setupState";
import { EmptyState, FieldMessage, Tag, usePublish } from "./shared";

// Guided setup: the consultant interviews the owner and writes transfers, message scenarios and
// appointments into the call-settings draft as they go. The board beside it (SetupBoard, in the
// studio's side panel) shows what landed; this is the conversation.

type Props = {
  setup: GuidedSetup;
  onOpenSection: (id: SectionId) => void;
  /** The studio's Publish, for the finished state's CTA. */
  onPublish: () => Promise<void>;
  dirty: boolean;
};

const CONFIRM_RESET = "Start the interview over? What's already on the board stays in your draft.";

export function GuidedSetupSection({ setup, onOpenSection, onPublish, dirty }: Props) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const session = setup.session;
  const visible = visibleMessages(setup);

  useEffect(() => {
    scrollToEnd(endRef.current);
  }, [visible.length, setup.pending]);

  // Focus the composer when an interview appears while this is open (not one that was already there
  // when the section opened — that would pop the keyboard on a phone), and again when a turn comes
  // back: the input was disabled meanwhile, so focus would otherwise have fallen to the page.
  const sessionId = session?.id;
  const lastSessionId = useRef(sessionId);
  useEffect(() => {
    if (sessionId && sessionId !== lastSessionId.current) textareaRef.current?.focus();
    lastSessionId.current = sessionId;
  }, [sessionId]);
  const wasPending = useRef(setup.pending);
  useEffect(() => {
    if (wasPending.current !== null && setup.pending === null) textareaRef.current?.focus();
    wasPending.current = setup.pending;
  }, [setup.pending]);

  // A failed turn hands its text back to the composer; the person presses Send again.
  useEffect(() => {
    if (setup.retryText) setText(setup.retryText);
  }, [setup.retryText]);

  const busy = setup.pending !== null;

  function submit(e?: FormEvent) {
    e?.preventDefault();
    const t = text.trim();
    if (!t || !canSend(setup)) return;
    setText("");
    void setup.send(t);
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends, Shift+Enter is a new line — and never while an IME (Korean input) is composing.
    // Safari fires the Enter that commits a composition with isComposing false but keyCode 229.
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      submit();
    }
  }

  // A failed opener is started again; a failed answer is already back in the composer (see above),
  // so Try again hands it to the person to send rather than resending it blindly.
  function retry() {
    if (setup.retryText) textareaRef.current?.focus();
    else if (setup.retryText === "" || !session) void setup.start();
  }

  function confirmReset() {
    if (window.confirm(CONFIRM_RESET)) void setup.reset();
  }

  let body: ReactNode;
  if (setup.loading) {
    body = <p className="ta-body-2 text-muted-foreground">Loading…</p>;
  } else if (setup.loadError) {
    body = (
      <div className="flex flex-col items-start gap-3">
        <FieldMessage>{setup.loadError}</FieldMessage>
        <Button variant="outline" onClick={setup.reload}>
          Try again
        </Button>
      </div>
    );
  } else if (!setup.available) {
    body = <UnavailableCard reason={setup.unavailableReason} onOpenSection={onOpenSection} />;
  } else if (session === null) {
    body = (
      <>
        <EmptyState
          title="Set up by talking it through"
          action={
            <Button onClick={() => void setup.start()} disabled={busy}>
              {busy ? "Starting…" : "Start the interview"}
            </Button>
          }
        >
          About ten questions. You can stop any time, and everything you've said so far stays in your draft.
        </EmptyState>
        {setup.error ? (
          <div className="mt-3 flex items-center gap-3">
            <p role="alert" className="ta-caption-1 text-destructive">
              {setup.error}
            </p>
            <Button variant="ghost" size="sm" onClick={retry} disabled={busy}>
              Try again
            </Button>
          </div>
        ) : null}
      </>
    );
  } else {
    const finished = session.status === "finished";
    const atLimit = !finished && session.turnCount >= session.maxTurns;
    body = (
      <>
        <div className="flex flex-col overflow-hidden rounded-2xl border">
          <div
            role="log"
            aria-live="polite"
            aria-label="Interview"
            className="flex max-h-[min(58dvh,640px)] min-h-[320px] flex-col gap-3 overflow-y-auto p-4"
          >
            {visible.map((m, i) => (
              <div key={i} className="flex flex-col gap-1.5">
                <Exchange
                  speaker={m.role === "user" ? "caller" : "agent"}
                  text={m.text}
                  agentName="Consultant"
                  callerLabel="You"
                  animate
                  className="[&_p]:whitespace-pre-wrap"
                />
                {m.role === "assistant" && m.changes?.length ? (
                  <div className="flex flex-wrap gap-1.5 pl-1">
                    {m.changes.map((c, j) => (
                      <Tag key={j} tone="blue">
                        {changeLabel(c)}
                      </Tag>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
            {busy ? (
              <div className="flex items-center gap-2">
                <span className="bg-muted-foreground size-1.5 animate-pulse rounded-full" aria-hidden />
                <span className="ta-caption-1 text-muted-foreground">The consultant is thinking…</span>
              </div>
            ) : null}
            <div ref={endRef} />
          </div>

          {setup.error ? (
            <div className="flex items-center gap-3 border-t px-4 py-2">
              <p role="alert" className="ta-caption-1 text-destructive">
                {setup.error}
              </p>
              {setup.retryText !== null && !finished ? (
                <Button variant="ghost" size="sm" onClick={retry} disabled={busy}>
                  Try again
                </Button>
              ) : null}
            </div>
          ) : null}

          {finished ? (
            <FinishedPanel
              dirty={dirty}
              busy={busy}
              onPublish={onPublish}
              onReview={() => onOpenSection("transfers")}
              onReset={confirmReset}
            />
          ) : (
            <>
              <form onSubmit={submit} className="flex items-end gap-2 border-t p-3">
                <Textarea
                  ref={textareaRef}
                  aria-label="Your answer"
                  placeholder="Type your answer…"
                  rows={2}
                  disabled={busy || atLimit}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={onKey}
                  className="min-h-0 flex-1"
                />
                <Button type="submit" size="sm" aria-label="Send" disabled={!canSend(setup) || !text.trim()}>
                  <SendHorizontal className="size-4" />
                </Button>
              </form>
              {atLimit ? (
                <p className="ta-caption-1 text-muted-foreground px-4 pb-3">
                  This interview has reached its limit. Finish in the sections, or start over.
                </p>
              ) : null}
            </>
          )}
        </div>
        <div className="ta-caption-1 text-muted-foreground mt-2 flex justify-between">
          <span>
            Turn {session.turnCount} of {session.maxTurns}
          </span>
          <button type="button" className="hover:underline disabled:opacity-50" onClick={confirmReset} disabled={busy}>
            Start over
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <SectionIntro>
        Answer a few questions and the consultant sets up who calls go to, what messages to take and how appointments
        are booked. Everything lands in your draft — test it with a call, then publish.
      </SectionIntro>
      {session ? <TopicChips topics={session.topics} /> : null}
      <div className={session ? "mt-4" : undefined}>{body}</div>
    </>
  );
}

function TopicChips({ topics }: { topics: Record<SetupTopic, TopicStatus> }) {
  return (
    <ol aria-label="Topics" className="flex flex-wrap gap-2">
      {(Object.keys(TOPIC_LABEL) as SetupTopic[]).map((topic) => {
        const status = topics[topic];
        const className =
          status === "done"
            ? "bg-primary/10 text-primary"
            : status === "skipped"
              ? "bg-muted text-muted-foreground line-through"
              : "bg-muted text-muted-foreground";
        return (
          <li key={topic} className={`ta-caption-1 inline-flex items-center gap-1 rounded-full px-2.5 py-1 ${className}`}>
            {status === "done" ? <Check className="size-3" aria-hidden /> : null}
            {TOPIC_LABEL[topic]}
            {status === "skipped" ? <span className="sr-only"> skipped</span> : null}
          </li>
        );
      })}
    </ol>
  );
}

const UNAVAILABLE: Record<SetupUnavailableReason, { title: string; body: string }> = {
  demo_stage: {
    title: "Available once onboarding starts",
    body: "The guided interview is for a business being set up. Your demo's settings are read-only here; once onboarding starts, the consultant can set up transfers, messages and appointments with you. The board beside this shows what your demo has now.",
  },
  no_openai_key: {
    title: "Not switched on for this server",
    body: "The consultant needs an OpenAI key on the server. Set things up in the sections on the left instead.",
  },
  no_profile: {
    title: "Add your business information first",
    body: "The consultant starts from what it knows about your business.",
  },
};

function UnavailableCard({
  reason,
  onOpenSection,
}: {
  reason: SetupUnavailableReason | null;
  onOpenSection: (id: SectionId) => void;
}) {
  const copy = UNAVAILABLE[reason ?? "no_openai_key"];
  return (
    <div className="flex items-start gap-3 rounded-2xl border p-4">
      <MessagesSquare className="text-muted-foreground mt-0.5 size-5 shrink-0" aria-hidden />
      <div className="flex min-w-0 flex-col items-start gap-1">
        <p className="ta-label-1">{copy.title}</p>
        <p className="ta-caption-1 text-muted-foreground">{copy.body}</p>
        {reason === "no_profile" ? (
          <Button className="mt-2" onClick={() => onOpenSection("business-info")}>
            Open Business information
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function FinishedPanel({
  dirty,
  busy,
  onPublish,
  onReview,
  onReset,
}: {
  dirty: boolean;
  busy: boolean;
  onPublish: () => Promise<void>;
  onReview: () => void;
  onReset: () => void;
}) {
  const { publishing, error, publish } = usePublish(onPublish);

  return (
    <div className="bg-primary/5 flex flex-col gap-3 border-t p-4">
      <p className="ta-label-1">That's everything.</p>
      <p className="ta-caption-1 text-muted-foreground">
        Review what's on the board, try a test call, then publish so callers get it.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={onReview}>
          Review transfers
        </Button>
        <Button onClick={() => void publish()} disabled={!dirty || publishing}>
          {publishing ? "Publishing" : "Publish"}
        </Button>
        <Button variant="ghost" onClick={onReset} disabled={busy}>
          Start over
        </Button>
      </div>
      {error ? <FieldMessage>{error}</FieldMessage> : null}
    </div>
  );
}
