// The guided setup interview's shapes: a consultant chat that walks a business owner through the
// three things a receptionist can be told to do (put callers through, take messages, book) and
// writes the answers into the call-settings DRAFT through function tools.
//
// Pure, and importing nothing, so every other module in src/setup (and the dashboard's copy of the
// wire types) can lean on it without pulling in config or the database.

export const SETUP_TOPICS = ["transfers", "messages", "appointments"] as const;
export type SetupTopic = (typeof SETUP_TOPICS)[number];
export type TopicStatus = "pending" | "done" | "skipped";

/** One setting the consultant wrote during a turn, shown under its reply so nothing changes unseen. */
export type SetupChange = {
  kind: "transfer" | "message" | "appointments" | "timezone";
  op: "add" | "update" | "remove";
  id?: string;
  label: string;
};

export type SetupMessage = { role: "user" | "assistant"; text: string; at: string; changes?: SetupChange[] };

export type SetupSession = {
  id: string;
  status: "active" | "finished";
  topics: Record<SetupTopic, TopicStatus>;
  turnCount: number;
  maxTurns: number;
  messages: SetupMessage[];
  startedAt: string;
  finishedAt?: string;
};

export const pendingTopics = (): Record<SetupTopic, TopicStatus> => ({
  transfers: "pending",
  messages: "pending",
  appointments: "pending",
});

/** Responses API input items, as this backend sends them (and receives them back in `output`). */
export type SetupInputItem =
  | { type: "message"; role: "user"; content: { type: "input_text"; text: string }[] }
  | {
      type: "message";
      role: "assistant";
      id?: string;
      status?: string;
      content: { type: "output_text"; text: string; annotations?: unknown[] }[];
    }
  | { type: "function_call"; id?: string; call_id: string; name: string; arguments: string; status?: string }
  | { type: "function_call_output"; call_id: string; output: string }
  | { type: "reasoning"; id: string; summary: unknown[]; encrypted_content?: string };
