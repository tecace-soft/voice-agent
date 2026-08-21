import { Elysia } from "elysia";

// Health / liveness controller.
export const health = new Elysia().get("/health", () => ({
  status: "ok",
  uptime: process.uptime(),
}));
