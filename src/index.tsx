// bun-server.ts
import { serve } from "bun";
import index from "./index.html";

/**
 * Where your real API is listening.
 * • Keep it in an env var so prod/staging/dev can diverge cleanly.
 * • Use a URL object so we can preserve host/port/query with zero string-concat bugs.
 */
const API_ORIGIN = new URL(
  Bun.env.API_ORIGIN ?? "http://localhost:3100"  // fallback for local dev
);

serve({
  /**
   * A single handler lets us do fine-grained routing ourselves.
   * Bun will stream responses automatically; no manual piping needed.
   */
  async fetch(req) {
    const { pathname, search } = new URL(req.url);

    // ---------- 1. Proxy all /api/* traffic ----------
    if (pathname.startsWith("/api")) {
      // Strip the /api prefix before forwarding, e.g. /api/users → /users
      const upstreamPath = pathname.replace(/^\/api/, "");
      const target = new URL(upstreamPath + search, API_ORIGIN);

      // Forward the request verbatim—method, body, headers, etc.
      // You can filter or rewrite headers here if necessary.
      const upstreamResp = await fetch(target, {
        method: req.method,
        headers: req.headers,
        body:
          req.method === "GET" || req.method === "HEAD"
            ? undefined
            : req.body,
        // Keep streaming semantics (important for large uploads/downloads)
        duplex: "half",
      });

      // Mirror the upstream status, headers, and body.
      return new Response(upstreamResp.body, {
        status: upstreamResp.status,
        statusText: upstreamResp.statusText,
        headers: upstreamResp.headers,
      });
    }

    // ---------- 2. Serve client SPA for everything else ----------
    return new Response(index, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  },

  // ---------- 3. Dev niceties ----------
  development:
    process.env.NODE_ENV !== "production" && {
      hmr: true,
      console: true,
    },
});

console.log(`🚀  Bun server is live on ${process.env.BUN_SERVER_URL ?? "default port"}`);

