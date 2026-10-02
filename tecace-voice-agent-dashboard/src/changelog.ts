// What changed, release by release — the single source for the version number the sidebar shows and
// the Changelog page. Newest first. `package.json`'s version must equal the first entry
// (tests/changelog.test.ts checks it).
//
// To release: add an entry on top with the next version (0.0.x until the first customer launch) and
// today's date, bump `version` in package.json to match, and write each line for the person using
// the dashboard — what they can now do, not which file moved. Lines only operators can see (Demo,
// Accounts, Agent numbers) get `admin: true` and are left out for customers.
//
// Versions 0.0.1–0.0.9 were written afterwards from the commit history and HISTORY.md, one per
// working day.

export type ChangeKind = "new" | "improved" | "fixed";

export type ChangeItem = {
  kind: ChangeKind;
  text: string;
  /** Only shown to admins: it concerns screens a customer never sees. */
  admin?: boolean;
};

export type Release = {
  version: string;
  /** YYYY-MM-DD. */
  date: string;
  /** One line that sums the release up. */
  title: string;
  items: ChangeItem[];
};

export const CHANGELOG: Release[] = [
  {
    version: "0.0.15",
    date: "2026-10-02",
    title: "Set up your receptionist yourself; a Sales section for prospects",
    items: [
      {
        kind: "new",
        text: "Request setup no longer waits for us. Pick a plan, add a card and your receptionist is yours to change and test straight away. Nothing is charged until your line is live; your 14-day free trial starts that day.",
      },
      {
        kind: "new",
        text: "Billing, in the sidebar: your plan, the card on file, when the free trial ends and the first bill comes. Payments are in test mode for now: cards are checked but never charged.",
      },
      {
        kind: "improved",
        text: "A new home page for each stage. While you're being set up: a checklist of what's left, what we do for you, and your phone line. Once you're live: calls answered, bookings made, messages waiting for you, callers put through, and who needs a reply.",
      },
      {
        kind: "improved",
        text: "The demo home leads with calling your receptionist and asking for setup, and leaves out our own link-tracking numbers.",
      },
      {
        kind: "improved",
        text: "Approve and Decline on a prospect are only needed for setups you start yourself; a customer's own request moves them to onboarding without you.",
        admin: true,
      },
      {
        kind: "improved",
        text: "Demo › Customers and CRM are one page, Sales › Prospects: a table or a board of the same prospects. The first tab, Needs you, holds what is on you (a setup request, an overdue follow-up, failed research), and a Next step column says what happens next instead of three status columns.",
        admin: true,
      },
      {
        kind: "improved",
        text: "A prospect's page opens on an Overview: where the deal is, one card with the next thing to do (approve, follow up, research, send the link), the demo link with its minutes, the deal's stage, follow-up date and notes, and the contact. Each change saves as you make it. Calls, Receptionist, Research and Outreach email are the other tabs.",
        admin: true,
      },
      {
        kind: "new",
        text: "Demo analytics replaces the Demo Overview: how many prospects opened their link, called, asked for setup and went live, the most active prospects, and the latest activity across all of them.",
        admin: true,
      },
      {
        kind: "new",
        text: "New prospect asks for two things, the name and a website or Google Maps link; the contact can wait. Review every unreviewed call on a prospect in one press.",
        admin: true,
      },
    ],
  },
  {
    version: "0.0.14",
    date: "2026-10-02",
    title: "A clearer sign-up page, and your earlier transfer number where calls use it",
    items: [
      {
        kind: "improved",
        text: "The sign-up page (/start) has a new layout: the form sits beside how it works, each field shows an example, you can show the password you typed, and the free trial length is stated up front.",
      },
      {
        kind: "improved",
        text: "Demo pages (the link we send a business) match the new sign-up page: a larger headline, one clear Request setup button and a footer with how to reach us.",
      },
      {
        kind: "improved",
        text: "The pricing page you reach from a demo has the same look, with the business's name at the top and a clear way back to the demo.",
      },
      {
        kind: "improved",
        text: "Your earlier transfer number can be edited: click it to change its type or when it can be used, without adding a new number. Saving adds it to your transfers with your changes.",
      },
      {
        kind: "improved",
        text: "Rows under Transfer calls, Take a message and Text a link show \"Edit\" so it's clear you can click them to change them.",
      },
      {
        kind: "fixed",
        text: "Transfer calls lists the transfer number you set up before transfer scenarios for as long as calls still use it, instead of \"No transfers yet\". Add it to your transfers in one click; it stays in use until you publish.",
      },
      {
        kind: "fixed",
        text: "Call forwarding shows the right missed-call code for Verizon mobile phones (*71). The busy and no-answer codes it showed before (*90, *92) are for landlines and are now under Landline.",
      },
      {
        kind: "improved",
        text: "Call forwarding shows both ways to forward for your phone company at once, missed calls and every call, each with what it does, instead of making you pick one first.",
      },
    ],
  },
  {
    version: "0.0.13",
    date: "2026-10-01",
    title: "Refill your details from research; your prompts up front",
    items: [
      {
        kind: "new",
        text: "Dashboard overview shows whether the voice agent's call server, outbound poller and scenario runner are running.",
        admin: true,
      },
      {
        kind: "improved",
        text: "Call forwarding has a new step: how to turn off answer confirmation (\"press 1 to accept\") for your phone company or phone app, so callers reach your receptionist without waiting or hearing key tones.",
      },
      {
        kind: "fixed",
        text: "Callers forwarded from a mobile phone no longer hear loud key tones when your receptionist picks up. If your phone company still asks to press 1 to accept, turn on the switch in Call forwarding and your receptionist presses it for you.",
      },
      {
        kind: "new",
        text: "Business information › Fill in from research: we read your website, its FAQ pages and your Google listing again and fill in the form and your FAQs for you. Nothing changes for callers until you check it and press Save, and Undo puts the form back.",
      },
      {
        kind: "improved",
        text: "Custom training opens with your receptionist's prompts, already open. They're built from Business information, Agent profile and FAQs and rebuilt whenever you save those. Before, they were behind an \"Advanced: prompts\" button at the bottom of the page, easy to miss.",
      },
      {
        kind: "improved",
        text: "When we research your business, we now copy the FAQs already on your website and Google listing into your FAQs, in the order you published them, so you don't have to type them in again.",
      },
      {
        kind: "new",
        text: "Scenario tests: run written test calls against a business's receptionist, once per press, and see each conversation, the tools it used, and why it passed or failed.",
        admin: true,
      },
    ],
  },
  {
    version: "0.0.12",
    date: "2026-09-30",
    title: "A calls overview and chat-style transcripts; voicemail gets its own section",
    items: [
      {
        kind: "fixed",
        text: "Opening Appointments no longer signs you out when a connected calendar needs attention; it says to reconnect instead. Calendars connected earlier keep working as they are.",
      },
      {
        kind: "fixed",
        text: "Appointments: Google Calendar can now be connected. A calendar that can't be connected yet says \"Not available\" instead of \"Needs setup\".",
      },
      {
        kind: "improved",
        text: "Answered calls is now Transcripts, under Dashboard next to Overview. Open a call and the conversation reads like a text-message chat — the caller on the right, your receptionist on the left — just like the test call on your demo. Each call sits in its own outlined box, the open one is outlined in blue, and Hide conversation at the bottom closes it.",
      },
      {
        kind: "new",
        text: "Dashboard › Overview: your receptionist at a glance — calls, minutes, callbacks requested and this month's talk time, calls per day, and your most recent calls with what each caller wanted and how it ended. Pick the last 7, 30 or 90 days. It's the page you land on when you sign in.",
      },
      {
        kind: "new",
        text: "Admins can view every business together or pick one on Dashboard › Overview; the choice stays in the address.",
        admin: true,
      },
      {
        kind: "improved",
        text: "Overview, Analytics, Per person, Daily activity and the runs lists are grouped under Voicemail in the menu, since they show your voicemail transcriptions rather than your receptionist's calls.",
      },
    ],
  },
  {
    version: "0.0.11",
    date: "2026-09-29",
    title: "Guided setup; links, Back and refresh land where you were",
    items: [
      {
        kind: "new",
        text: "Guided setup: a consultant asks you about transfers, messages and appointments and fills in your settings as you answer. A board beside the chat shows what's set up so far, with Edit links into each section. Everything lands in your draft, so you can try it on a test call and publish when you're happy.",
      },
      {
        kind: "new",
        text: "While your business is being set up, the Business page offers the guided interview first.",
      },
      {
        kind: "improved",
        text: "Customers: built for hundreds of customers — phase tabs with counts, a category filter, a created date, sorting by any column, and pages sized to fit the screen (or 25 / 50 / 100 per page). The list uses the full width and never scrolls sideways.",
        admin: true,
      },
      {
        kind: "improved",
        text: "Real calls to your number now follow what you set up here, the same as a test call: your prompts and Custom training, knowledge, FAQs, instructions, greeting and voice, plus the transfers and message situations you published. Texting a link is test-call only for now.",
      },
      {
        kind: "improved",
        text: "While you're onboarding, calls to your receptionist's number — or your line forwarded to it — are answered as your business with what you've published, so you can check it before go live.",
      },
      {
        kind: "fixed",
        text: "A customer's Activity, Settings, Sources and Share tabs are in the address now: a refresh, Back and Forward, or a shared link opens the same tab, and the address no longer names a settings section while another tab is open.",
        admin: true,
      },
      {
        kind: "fixed",
        text: "The Customers link at the top of a customer's page keeps the mailbox you were looking at.",
        admin: true,
      },
      {
        kind: "fixed",
        text: "Leaving a customer's Business information or Answered calls no longer keeps every other page on that customer. Clicking the page you're on in the sidebar takes you back to the list of customers.",
        admin: true,
      },
      {
        kind: "fixed",
        text: "Switching customers quickly no longer shows the previous customer's details or calls under the new name, and a half-written description no longer carries over to the next customer.",
        admin: true,
      },
      {
        kind: "fixed",
        text: "While you're trying your receptionist, Version · Changelog opens the changelog, and a refresh stays on the section you had open.",
      },
      {
        kind: "fixed",
        text: "An old link to one of your page's other tabs opens your settings instead of a blank page.",
      },
      {
        kind: "fixed",
        text: "Signing in after someone else signed out in the same browser tab starts you on your own page, not on theirs.",
      },
      {
        kind: "fixed",
        text: "Pressing Back after you're taken to your business information no longer opens an empty Overview first.",
      },
      {
        kind: "fixed",
        text: "Agent numbers connects to Twilio with an API key as well as the account's auth token, so syncing the account's numbers works on a server set up with a key.",
        admin: true,
      },
      {
        kind: "improved",
        text: "Agent numbers no longer has a form to register a number by hand: the list comes from Twilio, and Sync from Twilio now sits on the Numbers table.",
        admin: true,
      },
    ],
  },
  {
    version: "0.0.10",
    date: "2026-09-28",
    title: "Your demo's overview and call activity; phone numbers from Twilio",
    items: [
      { kind: "improved", text: "Post-call reviews and business research run on a lower-cost model (gpt-5.6-luna).", admin: true },
      { kind: "improved", text: "Launch instructions show where your receptionist is (demo, onboarding or live) and what each stage lets you do, its own number with a copy button, how to place a test call with questions to try, and the next step." },
      { kind: "new", text: "A Billing page, reached from Launch instructions: onboarding starts once billing is set up. Payments in the app come later." },
      { kind: "new", text: "My receptionist has an Overview: link opens, visitors, calls, minutes, calls per day, what the receptionist couldn't answer, and the latest calls." },
      { kind: "new", text: "Call activity lists every call to your demo receptionist with its summary and full transcript." },
      { kind: "improved", text: "Call activity is a table: one row per call with its date, length, how the caller felt and what they wanted, filters by mood, and a panel with the summary and the transcript." },
      { kind: "improved", text: "A demo's Activity tab adds calls per day, how callers felt and the commonest gaps above the call table, and filters customer calls from your tests.", admin: true },
      { kind: "new", text: "Agent numbers: sync the Twilio account's numbers into the list, see whether each number's webhooks point at the receptionist, and repair them with Configure.", admin: true },
      { kind: "new", text: "Buy a number — toll-free or local, by area code — from the Agent numbers page or straight from an account's Go live checklist; its webhooks are set as it's bought.", admin: true },
      { kind: "new", text: "Release a number bought here back to Twilio by typing it back; numbers bought in the Twilio console are released there, and numbers registered by hand are still deleted from the list.", admin: true },
      { kind: "new", text: "Released numbers stay listed, with Buy back while Twilio still has them for sale.", admin: true },
      { kind: "new", text: "Each number says why its webhooks are out of date, and Configure repairs one or all of them.", admin: true },
      { kind: "improved", text: "The Go live checklist now also checks that Twilio sends the number's calls to the receptionist." },
      { kind: "improved", text: "If your prompts were edited by hand, Business information, FAQs and Custom training now say so — changes there don't reach calls until you rebuild — with Rebuild right there." },
      { kind: "improved", text: "\"What a call is told\" refreshes by itself after you save." },
      { kind: "improved", text: "Business information no longer repeats your week; see Appointments for it." },
      { kind: "fixed", text: "Custom training showed the old prompts after you saved Business information, FAQs or Agent profile, and saving them then quietly undid those changes." },
    ],
  },
  {
    version: "0.0.9",
    date: "2026-09-27",
    title: "Appointments, the settings studio, and the road from demo to live",
    items: [
      {
        kind: "new",
        text: "Appointments: connect Google Calendar, Apple Calendar, any CalDAV calendar, Cal.com, Calendly or Squarespace Scheduling, and the receptionist books callers into it — on test calls and on real calls. Outlook is ready once its sign-in is set up; reservation systems are marked Coming soon.",
      },
      { kind: "new", text: "Booking rules: length, gap around other events, minimum notice, how far ahead, booking hours and notes for the receptionist — saved as a draft and published with the rest of your call settings." },
      { kind: "new", text: "Receptionist settings in one studio: business information, agent profile, FAQs, take a message, transfer calls, text a link, appointments, custom training, test & improve, launch instructions and call forwarding, with the test call beside them." },
      { kind: "new", text: "Transfer calls (cold, warm, waterfall), text-a-link with text consent, and message scenarios, each edited in place and published when you're ready." },
      { kind: "new", text: "In-app test calls use your draft settings and show what the receptionist did: transfers, texts, messages and bookings." },
      { kind: "new", text: "Set-up path: request setup from the demo, approval, onboarding, then a Go live checklist." },
      { kind: "new", text: "Sign up from a demo link with an email code, and sign-in links for approved accounts." },
      { kind: "new", text: "Customer IDs are four letters from the business name plus a number (for example GLHF-0009).", admin: true },
      { kind: "improved", text: "The public demo page plays out the operator's settings on the call and was redesigned call-first.", admin: true },
      { kind: "improved", text: "FAQs are edited as cards you can reorder, and long answers now reach callers in full." },
      { kind: "improved", text: "The receptionist offers to book when a caller asks \"do you do X?\", and names a link's website instead of reading out the address." },
      { kind: "new", text: "Customers: add a customer without researching it, and run research from its page when you're ready.", admin: true },
      { kind: "new", text: "Customers: tick several and delete them together. A customer in onboarding or live keeps its record until its account is unlinked.", admin: true },
      { kind: "improved", text: "Settings read at a larger text size." },
      { kind: "fixed", text: "The customer page keeps one layout across Activity, Settings, Sources and Share.", admin: true },
      { kind: "improved", text: "Version number and this changelog." },
    ],
  },
  {
    version: "0.0.8",
    date: "2026-09-26",
    title: "Customer lifecycle in Demo › Customers",
    items: [
      { kind: "new", text: "Every demo customer gets a permanent ID and a phase (demo, onboarding, production), with ID and phase columns and a phase filter.", admin: true },
      { kind: "new", text: "A demo customer can start onboarding from their own receptionist page; their demo is copied into their business settings.", admin: true },
    ],
  },
  {
    version: "0.0.7",
    date: "2026-09-25",
    title: "Team housekeeping",
    items: [
      { kind: "improved", text: "Shared team notes and deployment fixes behind the scenes; nothing changes on screen.", admin: true },
    ],
  },
  {
    version: "0.0.6",
    date: "2026-09-24",
    title: "Business information follows the demo's knowledge and prompt",
    items: [
      { kind: "improved", text: "Business information is edited the same way as a demo's knowledge and prompt, so a wrong closing time is fixed by changing the time." },
      { kind: "improved", text: "New browser tab icon." },
    ],
  },
  {
    version: "0.0.5",
    date: "2026-09-23",
    title: "Demo test calls",
    items: [
      { kind: "new", text: "Call a demo's receptionist from the browser.", admin: true },
      { kind: "improved", text: "Demos match the original promo project screen for screen.", admin: true },
      { kind: "improved", text: "New app icon." },
    ],
  },
  {
    version: "0.0.4",
    date: "2026-09-22",
    title: "Demos move into the dashboard's own database",
    items: [
      { kind: "new", text: "Demo customers, CRM and research are stored with the rest of the dashboard's data.", admin: true },
      { kind: "improved", text: "Call minutes can be read for any date range." },
      { kind: "fixed", text: "Voicemail transcription and business-description reading fixes." },
    ],
  },
  {
    version: "0.0.3",
    date: "2026-09-21",
    title: "One dashboard",
    items: [
      { kind: "new", text: "The combined TecAce Voice Agent dashboard: voicemail transcription screens and the Demo section behind one sign-in." },
    ],
  },
  {
    version: "0.0.2",
    date: "2026-09-18",
    title: "Phone receptionist: transfers and a steadier voice",
    items: [
      { kind: "fixed", text: "Putting callers through to a person no longer loops, and a declined transfer is handled cleanly." },
      { kind: "fixed", text: "Less audio stutter, and the receptionist always opens the call." },
      { kind: "improved", text: "The receptionist uses the business's persona and saved information." },
    ],
  },
  {
    version: "0.0.1",
    date: "2026-09-17",
    title: "Phone receptionist foundations",
    items: [
      { kind: "improved", text: "More natural conversation flow, faster replies and clearer audio." },
      { kind: "improved", text: "When it doesn't know something, the receptionist says so instead of guessing." },
    ],
  },
];

export const APP_VERSION = CHANGELOG[0]!.version;

/** The releases a viewer should see: operator-only lines dropped for customers, empty releases too. */
export function visibleReleases(isAdmin: boolean): Release[] {
  return CHANGELOG.map((r) => ({ ...r, items: r.items.filter((i) => isAdmin || !i.admin) })).filter(
    (r) => r.items.length > 0,
  );
}
