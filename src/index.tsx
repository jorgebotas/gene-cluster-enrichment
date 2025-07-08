import { serve } from "bun";
import index from "./index.html";

const server = serve({
  routes: {
    // Serve index.html for all unmatched routes.
    "/*": index,

  },

  development: process.env.NODE_ENV !== "production" && {
    // Enable browser hot reloading in development
    hmr: true,

    // Echo console logs from the browser to the server
    console: true,
  },
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    console.log(url)

    // Proxy anything under /api/ to your local Flask/Uvicorn on 5000
    if (url.pathname.startsWith("/api/")) {
      // rebuild a new target URL:
      const target = new URL(req.url);
      target.hostname = "127.0.0.1";
      target.port = "5000";
      console.log(target)

      return fetch(target.toString(), {
        method: req.method,
        headers: req.headers,
        // body can be null for GET/HEAD
        body: ["GET","HEAD"].includes(req.method) ? null : req.body,
      });
    }

    // Otherwise serve your SPA entrypoint
    return new Response(index, {
      headers: { "Content-Type": "text/html" },
    });
  },
});

console.log(`🚀 Server running at ${server.url}`);
