/**
 * Vercel serverless entry — exports the Express app (no app.listen).
 * Local/PM2 still use dist/server.js.
 *
 * Root `/` is answered here before Express: Vercel rewrites `/` → `/api`,
 * which has historically caused FUNCTION_INVOCATION_FAILED on the base URL.
 */

let app = null;
let bootError = null;

try {
  const { createApp } = require("../dist/app.js");
  app = createApp();
} catch (err) {
  bootError = err;
  console.error("API boot failed:", err);
}

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

function sendBootError(res) {
  const message =
    bootError && typeof bootError === "object" && "message" in bootError
      ? String(bootError.message)
      : "API boot failed";
  const details =
    bootError && typeof bootError === "object" && "details" in bootError
      ? bootError.details
      : undefined;
  res.statusCode = 500;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(
    JSON.stringify({
      success: false,
      message,
      details,
      hint: "Check Vercel Environment Variables (Production) then Redeploy",
    })
  );
}

module.exports = (req, res) => {
  if (bootError) {
    sendBootError(res);
    return;
  }

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

  return app(req, res);
};
