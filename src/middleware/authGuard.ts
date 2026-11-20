import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { verifyAccessToken } from "../lib/tokens.js";
import { AppError } from "../utils/AppError.js";

export async function authGuard(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = req.cookies?.[env.ACCESS_COOKIE_NAME] as string | undefined;
    if (!token) {
      throw new AppError("Authentication required", 401);
    }

    const payload = verifyAccessToken(token);
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        name: true,
        isSuperAdmin: true,
        isActive: true,
        lockedUntil: true,
      },
    });

    if (!user || !user.isActive) {
      throw new AppError("Authentication required", 401);
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new AppError("Account temporarily locked. Try again later.", 423);
    }

    req.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      isSuperAdmin: user.isSuperAdmin,
    };

    next();
  } catch (err) {
    if (err instanceof AppError) {
      next(err);
      return;
    }
    next(new AppError("Authentication required", 401));
  }
}
