// bun-server.ts – “routes” version
import { serve } from "bun";
import index from "./index.html";

const API_HOST = "http://127.0.0.1:5000"; // or from env

// Generic proxy helper
function proxy(req: Request) {
  const url = new URL(req.url);
  const target = new URL(url.pathname + url.search, API_HOST);
  return fetch(target, {
    method: req.method,
    headers: req.headers,
    body: ["GET", "HEAD"].includes(req.method) ? undefined : req.body,
    duplex: "half",
  });
}

serve({
  routes: {
    // 1. Proxy every verb under /api/*
    "/api/*": {
      async GET(req)     { return proxy(req); },
      async POST(req)    { return proxy(req); },
      async PUT(req)     { return proxy(req); },
      async PATCH(req)   { return proxy(req); },
      async DELETE(req)  { return proxy(req); },
      async OPTIONS(req) { return proxy(req); },
    },

    // 2. Serve the SPA everywhere else
    "/*": index,
  },

  // 3. Dev extras
  development:
    process.env.NODE_ENV !== "production" && {
      hmr: true,
      console: true,
    },
});

console.log("🚀 Bun server with route-level proxy is running.");
