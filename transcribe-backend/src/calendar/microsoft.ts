import type { Interval } from "./availability.js";
import { accessToken, type OAuthTokens } from "./oauth.js";
import { failed, call, type BookingRequest, type CalendarClient, type Target } from "./types.js";

// Outlook (Microsoft 365 and outlook.com) over Microsoft Graph: the calendars, the events in a
// range, and creating one. https://learn.microsoft.com/graph/api/resources/calendar

const API = "https://graph.microsoft.com/v1.0";

export function microsoftClient(tokens: OAuthTokens, save: (next: OAuthTokens) => Promise<void>): CalendarClient {
  const headers = async () => ({
    authorization: `Bearer ${await accessToken("outlook", tokens, save)}`,
    "content-type": "application/json",
    // Times come back in UTC, so nothing downstream has to know Windows zone names.
    prefer: 'outlook.timezone="UTC"',
  });

  return {
    kind: "calendar",

    async targets(): Promise<Target[]> {
      const res = await call(`${API}/me/calendars?$select=id,name,canEdit,isDefaultCalendar&$top=100`, {
        headers: await headers(),
      });
      if (!res.ok) throw failed("Outlook", res.status, res.json()?.error?.message);
      return (res.json()?.value ?? [])
        .filter((c: any) => c.canEdit !== false)
        .map((c: any) => ({ id: String(c.id), name: String(c.name ?? "Calendar"), primary: Boolean(c.isDefaultCalendar) }));
    },

    async busy(target: string, from: number, to: number): Promise<Interval[]> {
      const out: Interval[] = [];
      const params = new URLSearchParams({
        startDateTime: new Date(from).toISOString(),
        endDateTime: new Date(to).toISOString(),
        $select: "start,end,showAs,isCancelled",
        $top: "500",
      });
      let url: string | undefined = `${API}/me/calendars/${encodeURIComponent(target)}/calendarView?${params}`;
      // calendarView pages; a busy month for a clinic is easily more than one page.
      for (let page = 0; url && page < 10; page++) {
        const res = await call(url, { headers: await headers() });
        if (!res.ok) throw failed("Outlook", res.status, res.json()?.error?.message);
        const data = res.json();
        for (const e of data?.value ?? []) {
          if (e.isCancelled || e.showAs === "free" || e.showAs === "workingElsewhere") continue;
          out.push({ start: Date.parse(`${e.start.dateTime}Z`), end: Date.parse(`${e.end.dateTime}Z`) });
        }
        url = data?.["@odata.nextLink"];
      }
      return out;
    },

    async book(target: string, request: BookingRequest) {
      const res = await call(`${API}/me/calendars/${encodeURIComponent(target)}/events`, {
        method: "POST",
        headers: await headers(),
        body: JSON.stringify({
          subject: request.title,
          body: { contentType: "text", content: request.notes },
          start: { dateTime: new Date(request.start).toISOString().slice(0, 19), timeZone: "UTC" },
          end: { dateTime: new Date(request.end).toISOString().slice(0, 19), timeZone: "UTC" },
          showAs: "busy",
        }),
      });
      if (!res.ok) throw failed("Outlook", res.status, res.json()?.error?.message);
      const event = res.json();
      return { id: String(event.id), start: request.start, end: request.end, link: event.webLink };
    },
  };
}

export async function microsoftAccount(tokens: OAuthTokens, save: (next: OAuthTokens) => Promise<void>): Promise<string> {
  const res = await call(`${API}/me?$select=mail,userPrincipalName`, {
    headers: { authorization: `Bearer ${await accessToken("outlook", tokens, save)}` },
  });
  const me = res.ok ? res.json() : null;
  return String(me?.mail || me?.userPrincipalName || "");
}
