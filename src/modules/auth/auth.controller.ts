import type { NextFunction, Request, Response } from "express";
import { env } from "../../config/env.js";
import { clearAuthCookies, setAuthCookies } from "../../lib/cookies.js";
import { hashToken } from "../../lib/tokens.js";
import { AppError } from "../../utils/AppError.js";
import * as authService from "./auth.service.js";
import type {
  ChangePasswordInput,
  ConfirmPasswordResetInput,
  LoginInput,
} from "./auth.validation.js";

function meta(req: Request) {
  return {
    ipAddress: req.ip,
    userAgent: req.get("user-agent") || undefined,
  };
}

export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const body = req.body as LoginInput;
    const { user, tokens } = await authService.login(body, meta(req));
    setAuthCookies(res, tokens.accessToken, tokens.refreshToken);
    res.status(200).json({ success: true, data: { user } });
  } catch (err) {
    next(err);
  }
}

export async function refresh(req: Request, res: Response, next: NextFunction) {
  try {
    const raw = req.cookies?.[env.REFRESH_COOKIE_NAME] as string | undefined;
    const { user, tokens } = await authService.refresh(raw, meta(req));
    setAuthCookies(res, tokens.accessToken, tokens.refreshToken);
    res.status(200).json({ success: true, data: { user } });
  } catch (err) {
    next(err);
  }
}

export async function logout(req: Request, res: Response, next: NextFunction) {
  try {
    const raw = req.cookies?.[env.REFRESH_COOKIE_NAME] as string | undefined;
    await authService.logout(raw, meta(req), req.user?.id);
    clearAuthCookies(res);
    res.clearCookie(env.TENANT_COOKIE_NAME, {
      httpOnly: true,
      secure: env.COOKIE_SECURE,
      sameSite: env.COOKIE_SAME_SITE,
      path: "/",
    });
    res.status(200).json({ success: true, message: "Logged out" });
  } catch (err) {
    next(err);
  }
}

export async function me(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Authentication required", 401);
    const user = await authService.me(req.user.id);
    res.status(200).json({ success: true, data: { user } });
  } catch (err) {
    next(err);
  }
}

export async function changePassword(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Authentication required", 401);
    const body = req.body as ChangePasswordInput;
    await authService.changePassword(req.user.id, body, meta(req));
    clearAuthCookies(res);
    res.status(200).json({
      success: true,
      message: "Password changed. Please sign in again.",
    });
  } catch (err) {
    next(err);
  }
}

export async function confirmPasswordReset(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const body = req.body as ConfirmPasswordResetInput;
    await authService.confirmPasswordReset(body, meta(req));
    res.status(200).json({
      success: true,
      message: "Password updated. You can sign in now.",
    });
  } catch (err) {
    next(err);
  }
}

export async function listSessions(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Authentication required", 401);
    const sessions = await authService.listSessions(req.user.id);
    res.status(200).json({ success: true, data: { sessions } });
  } catch (err) {
    next(err);
  }
}

function param(value: string | string[] | undefined): string {
  if (typeof value === "string" && value.length > 0) return value;
  throw new AppError("Missing route parameter", 400);
}

export async function revokeSession(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Authentication required", 401);
    const sessionId = param(req.params.sessionId);
    await authService.revokeSession(req.user.id, sessionId, meta(req));
    res.status(200).json({ success: true, message: "Session revoked" });
  } catch (err) {
    next(err);
  }
}

export async function revokeAllSessions(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    if (!req.user) throw new AppError("Authentication required", 401);
    const raw = req.cookies?.[env.REFRESH_COOKIE_NAME] as string | undefined;
    const except = raw ? hashToken(raw) : undefined;
    await authService.revokeAllSessions(req.user.id, meta(req), except);
    res.status(200).json({ success: true, message: "All other sessions revoked" });
  } catch (err) {
    next(err);
  }
}

export async function loginHistory(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Authentication required", 401);
    const events = await authService.listLoginHistory(req.user.id);
    res.status(200).json({ success: true, data: { events } });
  } catch (err) {
    next(err);
  }
}
