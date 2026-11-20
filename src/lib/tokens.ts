import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

export type AccessTokenPayload = {
  sub: string;
  email: string;
  isSuperAdmin: boolean;
};

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRES_IN as jwt.SignOptions["expiresIn"],
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET);
  if (typeof decoded !== "object" || decoded === null || !("sub" in decoded)) {
    throw new Error("Invalid access token");
  }
  return decoded as AccessTokenPayload;
}

export function generateRefreshToken(): string {
  return crypto.randomBytes(48).toString("base64url");
}

export function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export function refreshExpiryDate(): Date {
  const date = new Date();
  date.setDate(date.getDate() + env.REFRESH_TOKEN_DAYS);
  return date;
}
