import type { NextFunction, Request, Response } from "express";
import type { z } from "zod";
import { AppError } from "../../utils/AppError.js";
import * as branchesService from "./branches.service.js";
import type { createBranchSchema, updateBranchSchema } from "./branches.validation.js";

function param(value: string | string[] | undefined): string {
  if (typeof value === "string" && value.length > 0) return value;
  throw new AppError("Missing route parameter", 400);
}

export async function listBranches(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await branchesService.listBranches(req.tenant!.tenantId);
    res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function createBranch(req: Request, res: Response, next: NextFunction) {
  try {
    const body = req.body as z.infer<typeof createBranchSchema>;
    const item = await branchesService.createBranch(req.tenant!.tenantId, body);
    res.status(201).json({ success: true, data: { item } });
  } catch (err) {
    next(err);
  }
}

export async function updateBranch(req: Request, res: Response, next: NextFunction) {
  try {
    const body = req.body as z.infer<typeof updateBranchSchema>;
    const item = await branchesService.updateBranch(
      req.tenant!.tenantId,
      param(req.params.id),
      body
    );
    res.status(200).json({ success: true, data: { item } });
  } catch (err) {
    next(err);
  }
}
