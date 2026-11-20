import { v2 as cloudinary } from "cloudinary";
import { env } from "../config/env.js";

cloudinary.config({
  cloud_name: env.CLOUDINARY_CLOUD_NAME,
  api_key: env.CLOUDINARY_API_KEY,
  api_secret: env.CLOUDINARY_API_SECRET,
  secure: true,
});

export { cloudinary };

export type UploadedAsset = {
  publicId: string;
  url: string;
  secureUrl: string;
  resourceType: string;
  format?: string;
  bytes: number;
  width?: number;
  height?: number;
  originalFilename?: string;
};

export function buildUploadFolder(organizationId?: string, subfolder?: string): string {
  const parts = [env.CLOUDINARY_FOLDER];
  if (organizationId) parts.push(organizationId);
  if (subfolder) parts.push(subfolder);
  return parts.join("/");
}
