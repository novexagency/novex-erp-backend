import type { CookieOptions, Response } from "express";
import { env } from "../config/env.js";

function baseCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAME_SITE,
    path: "/",
  };
}

export function setAuthCookies(
  res: Response,
  accessToken: string,
  refreshToken: string
): void {
  const accessMaxAgeMs = 15 * 60 * 1000;
  const refreshMaxAgeMs = env.REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000;

  res.cookie(env.ACCESS_COOKIE_NAME, accessToken, {
    ...baseCookieOptions(),
    maxAge: accessMaxAgeMs,
  });

  res.cookie(env.REFRESH_COOKIE_NAME, refreshToken, {
    ...baseCookieOptions(),
    maxAge: refreshMaxAgeMs,
  });
}

export function clearAuthCookies(res: Response): void {
  const options = baseCookieOptions();
  res.clearCookie(env.ACCESS_COOKIE_NAME, options);
  res.clearCookie(env.REFRESH_COOKIE_NAME, options);
}
