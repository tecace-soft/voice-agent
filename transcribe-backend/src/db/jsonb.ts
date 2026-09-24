import { sql } from "./client.js";

/**
 * Bind a value for a JSONB column. **Do not pre-stringify it.**
 *
 * postgres.js learns from the server's ParameterDescription that `$n::jsonb` is OID 3802, and
 * types.js registers the json serializer (JSON.stringify) for that OID, so the driver encodes it
 * itself (connection.js: `options.serializers[type](x)`). Encoding it here as well stores a JSON
 * *string* instead of an object.
 *
 * That is not hypothetical: the first production import stored every JSONB column double-encoded,
 * so `profile.name` was undefined and the Customers tab showed ten rows of "Unnamed". The data was
 * fine; the binding was not. `jsonbBinding.test.ts` pins this against postgres.js's own serializer
 * table, and reads every writer's source to check none of them has grown the broken shape back.
 *
 * It lives in its own module because three writers now need it, and a rule with three copies is a
 * rule that will be right in two places.
 */
export const jsonb = (value: unknown) =>
  value === null || value === undefined ? null : sql.json(value as Parameters<typeof sql.json>[0]);
