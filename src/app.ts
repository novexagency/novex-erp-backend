import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { env } from "./config/env.js";
import { prisma } from "./lib/prisma.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { apiRateLimiter } from "./middleware/rateLimit.js";
import authRoutes from "./modules/auth/auth.routes.js";
import companyRoutes from "./modules/company/company.routes.js";
import crmRoutes from "./modules/crm/crm.routes.js";
import platformRoutes from "./modules/platform/platform.routes.js";
import masterDataRoutes from "./modules/masterData/masterData.routes.js";
import inventoryRoutes from "./modules/inventory/inventory.routes.js";
import procurementRoutes from "./modules/procurement/procurement.routes.js";
import rbacRoutes from "./modules/rbac/rbac.routes.js";
import accountingRoutes from "./modules/accounting/accounting.routes.js";
import financeRoutes from "./modules/finance/finance.routes.js";
import hrRoutes from "./modules/hr/hr.routes.js";
import operationsRoutes from "./modules/operations/operations.routes.js";
import posRoutes from "./modules/pos/pos.routes.js";
import salesRoutes from "./modules/sales/sales.routes.js";
import tenantRoutes from "./modules/tenant/tenant.routes.js";
import branchesRoutes from "./modules/branches/branches.routes.js";
import uploadRoutes from "./modules/uploads/upload.routes.js";
import reportsRoutes from "./modules/reports/reports.routes.js";
import workflowRoutes from "./modules/workflow/workflow.routes.js";

export function createApp() {
  const app = express();

  app.set("trust proxy", 1);

  app.use(helmet());
  const corsOrigins = env.CORS_ORIGIN.split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  app.use(
    cors({
      origin: corsOrigins.length === 1 ? corsOrigins[0] : corsOrigins,
      credentials: true,
    })
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  /**
   * Vercel may rewrite `/` to destination `/api` (framework rewrite behavior).
   * Normalize before routes so the welcome handler matches.
   */
  app.use((req, _res, next) => {
    if (req.url === "/api" || req.url === "/api/" || req.url.startsWith("/api?")) {
      req.url = `/${req.url.slice(4)}` || "/";
      if (req.url === "") req.url = "/";
    }
    next();
  });

  app.use("/api/", apiRateLimiter);

  const welcome = (_req: express.Request, res: express.Response) => {
    res.status(200).json({
      success: true,
      message: "Novex ERP API",
      health: "/health",
      ready: "/health/ready",
      docsHint: "Use /api/v1/* with credentials",
      phase: "21-production-ops",
    });
  };
  app.get("/", welcome);
  app.get("/api", welcome);

  /** Liveness — process up (no DB). */
  app.get("/health/live", (_req, res) => {
    res.status(200).json({
      success: true,
      data: { status: "ok", phase: "21-production-ops" },
    });
  });

  /** Readiness — DB reachable. */
  app.get("/health/ready", async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.status(200).json({
        success: true,
        data: { status: "ready", database: "up" },
      });
    } catch {
      res.status(503).json({
        success: false,
        message: "Database unavailable",
        data: { status: "not_ready", database: "down" },
      });
    }
  });

  app.get("/health", (_req, res) => {
    res.status(200).json({
      success: true,
      message: "ok",
      locales: ["en", "ar"],
      phase: "21-production-ops",
    });
  });

  // Auth (global)
  app.use("/api/v1/auth", authRoutes);

  // Tenant SaaS namespace — tenant identity resolved from authenticated user
  app.use("/api/v1/tenant", tenantRoutes);

  // Branches / facilities (tenant-scoped)
  app.use("/api/v1/tenant/branches", branchesRoutes);

  // Company profile, system config, single warehouse (Phase 03)
  app.use("/api/v1/tenant/company", companyRoutes);

  // Tenant RBAC — roles & permissions (Phase 04)
  app.use("/api/v1/tenant/rbac", rbacRoutes);

  // Master data — products, categories, units, taxes, etc. (Phase 05)
  app.use("/api/v1/tenant/master-data", masterDataRoutes);

  // CRM & customers (Phase 06)
  app.use("/api/v1/tenant/crm", crmRoutes);

  // Suppliers & procurement (Phase 07)
  app.use("/api/v1/tenant/procurement", procurementRoutes);

  // Advanced inventory — single warehouse (Phase 08)
  app.use("/api/v1/tenant/inventory", inventoryRoutes);

  // Sales management & invoicing (Phase 09)
  app.use("/api/v1/tenant/sales", salesRoutes);

  // Point of Sale & cashier (Phase 10)
  app.use("/api/v1/tenant/pos", posRoutes);

  // Financial management — treasury / cashbook (Phase 11)
  app.use("/api/v1/tenant/finance", financeRoutes);

  // General ledger & accounting engine (Phase 12)
  app.use("/api/v1/tenant/accounting", accountingRoutes);

  // Human resources & employee management (Phase 13)
  app.use("/api/v1/tenant/hr", hrRoutes);

  // Operations — tasks, projects, assets, maintenance (Phase 15)
  app.use("/api/v1/tenant/operations", operationsRoutes);

  // Approvals, documents & in-app notifications (Phase 16)
  app.use("/api/v1/tenant/workflow", workflowRoutes);

  // Advanced dashboard, reports & BI exports (Phase 17)
  app.use("/api/v1/tenant/reports", reportsRoutes);

  // NOVEX Central Control Panel (platform) — superadmin only
  app.use("/api/v1/platform", platformRoutes);

  // Shared authenticated uploads
  app.use("/api/v1/uploads", uploadRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
