/**
 * Thrown when a description cannot be turned into anything usable.
 *
 * Its own module so that the pure shaping in `business/profileShape.ts` can throw it without
 * importing `extractBusiness.ts` — which reaches `config/env.ts` for a model key, and a function
 * that only reshapes an object should not need a database URL to be set before it can run. Same
 * reasoning as `factLimits.ts`.
 *
 * Every thrower means the same thing by it: nothing was written, and whatever was live stays live.
 * Losing a working profile to a model outage or a bad edit is worse than the save not taking.
 */
export class ExtractionError extends Error {}
