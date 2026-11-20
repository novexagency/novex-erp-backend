import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../utils/AppError.js";
import * as uploadService from "./upload.service.js";

function requireFile(req: Request) {
  if (!req.file) {
    throw new AppError("No file uploaded. Use form field name: file", 400);
  }
  return req.file;
}

export async function uploadImage(req: Request, res: Response, next: NextFunction) {
  try {
    const file = requireFile(req);
    if (!file.mimetype.startsWith("image/")) {
      throw new AppError("Only image files are allowed on this endpoint", 400);
    }

    const organizationId =
      typeof req.body.organizationId === "string" ? req.body.organizationId : undefined;
    const folder = typeof req.body.folder === "string" ? req.body.folder : "images";

    const asset = await uploadService.uploadBuffer({
      buffer: file.buffer,
      filename: file.originalname,
      mimetype: file.mimetype,
      kind: "image",
      organizationId,
      folder,
    });

    res.status(201).json({ success: true, data: { asset } });
  } catch (err) {
    next(err);
  }
}

export async function uploadFile(req: Request, res: Response, next: NextFunction) {
  try {
    const file = requireFile(req);
    const organizationId =
      typeof req.body.organizationId === "string" ? req.body.organizationId : undefined;
    const folder = typeof req.body.folder === "string" ? req.body.folder : "files";

    const asset = await uploadService.uploadBuffer({
      buffer: file.buffer,
      filename: file.originalname,
      mimetype: file.mimetype,
      kind: "auto",
      organizationId,
      folder,
    });

    res.status(201).json({ success: true, data: { asset } });
  } catch (err) {
    next(err);
  }
}

export async function uploadMany(req: Request, res: Response, next: NextFunction) {
  try {
    const files = req.files as Express.Multer.File[] | undefined;
    if (!files || files.length === 0) {
      throw new AppError("No files uploaded. Use form field name: files", 400);
    }

    const organizationId =
      typeof req.body.organizationId === "string" ? req.body.organizationId : undefined;
    const folder = typeof req.body.folder === "string" ? req.body.folder : "files";

    const assets = await Promise.all(
      files.map((file) =>
        uploadService.uploadBuffer({
          buffer: file.buffer,
          filename: file.originalname,
          mimetype: file.mimetype,
          kind: "auto",
          organizationId,
          folder,
        })
      )
    );

    res.status(201).json({ success: true, data: { assets } });
  } catch (err) {
    next(err);
  }
}

export async function removeAsset(req: Request, res: Response, next: NextFunction) {
  try {
    const publicId =
      typeof req.body.publicId === "string"
        ? req.body.publicId
        : typeof req.query.publicId === "string"
          ? req.query.publicId
          : "";

    if (!publicId) {
      throw new AppError("publicId is required", 400);
    }

    const rawType =
      typeof req.body.resourceType === "string"
        ? req.body.resourceType
        : typeof req.query.resourceType === "string"
          ? req.query.resourceType
          : "image";

    const resourceType =
      rawType === "raw" || rawType === "auto" || rawType === "image" ? rawType : "image";

    await uploadService.deleteAsset(publicId, resourceType);
    res.status(200).json({ success: true, message: "Asset deleted" });
  } catch (err) {
    next(err);
  }
}
