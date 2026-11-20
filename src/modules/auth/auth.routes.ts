import { Router } from "express";
import { authGuard } from "../../middleware/authGuard.js";
import { authRateLimiter } from "../../middleware/rateLimit.js";
import { validate } from "../../middleware/validate.js";
import * as authController from "./auth.controller.js";
import {
  changePasswordSchema,
  confirmPasswordResetSchema,
  loginSchema,
} from "./auth.validation.js";

const router = Router();

// Public tenant/platform login (platform superadmin uses same endpoint; tenant gates differ)
router.post("/login", authRateLimiter, validate(loginSchema), authController.login);
router.post("/refresh", authRateLimiter, authController.refresh);
router.post("/logout", authController.logout);

// Admin/internal password reset confirm (token issued privately — no email delivery)
router.post(
  "/password-reset/confirm",
  authRateLimiter,
  validate(confirmPasswordResetSchema),
  authController.confirmPasswordReset
);

router.get("/me", authGuard, authController.me);
router.post(
  "/change-password",
  authGuard,
  validate(changePasswordSchema),
  authController.changePassword
);
router.get("/sessions", authGuard, authController.listSessions);
router.delete("/sessions/:sessionId", authGuard, authController.revokeSession);
router.post("/sessions/revoke-all", authGuard, authController.revokeAllSessions);
router.get("/login-history", authGuard, authController.loginHistory);

export default router;
