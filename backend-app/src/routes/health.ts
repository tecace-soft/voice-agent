import { Elysia } from "elysia";

// Health / liveness controller.
// Elysia best practice: one `Elysia` instance per controller, composed via `.use()`.
// Method chaining keeps end-to-end type inference intact.
export const health = new Elysia().get("/health", () => ({
  status: "ok",
  uptime: process.uptime(),
}));
