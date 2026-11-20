/**
 * Vercel serverless entry — exports the Express app (no app.listen).
 * Local/PM2 still use dist/server.js.
 *
 * Root `/` is answered here before Express: Vercel rewrites `/` → `/api`,
 * which has historically caused FUNCTION_INVOCATION_FAILED on the base URL.
 */
const { createApp } = require("../dist/app.js");

const app = createApp();

function pathOnly(url) {
  return String(url || "/").split("?")[0] || "/";
}

function isRootPath(pathname) {
  return (
    pathname === "/" ||
    pathname === "" ||
    pathname === "/api" ||
    pathname === "/api/"
  );
}

module.exports = (req, res) => {
  const pathname = pathOnly(req.url);

  if (isRootPath(pathname)) {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(
      JSON.stringify({
        success: true,
        message: "Novex ERP API",
        health: "/health",
        ready: "/health/ready",
        docsHint: "Use /api/v1/* with credentials",
        phase: "21-production-ops",
      })
    );
    return;
  }

  // Normalize accidental /api prefix from framework rewrite edge cases
  if (pathname.startsWith("/api/") && !pathname.startsWith("/api/v1")) {
    // leave /api/v1/* alone; only strip bare /api → already handled above
  }

  return app(req, res);
};
