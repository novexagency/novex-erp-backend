import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { AppError } from "../utils/AppError.js";
import { env } from "../config/env.js";

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: err.flatten().fieldErrors,
    });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      message: err.message,
      ...(err.errors !== undefined ? { errors: err.errors } : {}),
    });
    return;
  }

  console.error(err);

  res.status(500).json({
    success: false,
    message: env.NODE_ENV === "production" ? "Internal server error" : String(err),
  });
}
