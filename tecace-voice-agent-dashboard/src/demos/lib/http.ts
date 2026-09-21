/**
 * A failed request often carries no JSON at all: a crashed route returns an
 * empty 500, a proxy returns HTML. Parsing that blindly reports "Unexpected
 * end of JSON input" and hides what actually went wrong, so read the body as
 * text first and only then try to make sense of it.
 */
export async function readJson<T>(response: Response): Promise<T> {
  const body = await response.text();

  let parsed: unknown = undefined;
  if (body.trim()) {
    try {
      parsed = JSON.parse(body);
    } catch {
      // Not JSON; the text itself is the best error message available.
    }
  }

  if (response.ok) {
    if (parsed === undefined) {
      throw new Error(`The server returned an empty response (${response.status}).`);
    }
    return parsed as T;
  }

  const message =
    (parsed as { error?: string } | undefined)?.error ||
    body.trim().slice(0, 300) ||
    `The server returned ${response.status} ${response.statusText}.`;
  throw new Error(message);
}
