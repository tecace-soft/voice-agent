import { app } from "../src/app";

// Vercel serverless entry point.
// Elysia's `app.handle(request)` is a web-standard fetch handler (Request -> Response),
// exactly what our tests drive. Vercel's Node runtime invokes the export matching each
// HTTP method; `vercel.json` rewrites every path here so Elysia does the routing.
//
// Schema creation is NOT run here (a serverless function shouldn't migrate on each cold
// start). Run `bun run db:migrate` once against the database instead.
const handler = (request: Request): Response | Promise<Response> =>
  app.handle(request);

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
export const HEAD = handler;
