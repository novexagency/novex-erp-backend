import { Readable } from "node:stream";
import {
  buildUploadFolder,
  cloudinary,
  type UploadedAsset,
} from "../../lib/cloudinary.js";
import { AppError } from "../../utils/AppError.js";

type UploadKind = "image" | "raw" | "auto";

function toAsset(result: {
  public_id: string;
  url: string;
  secure_url: string;
  resource_type: string;
  format?: string;
  bytes: number;
  width?: number;
  height?: number;
  original_filename?: string;
}): UploadedAsset {
  return {
    publicId: result.public_id,
    url: result.url,
    secureUrl: result.secure_url,
    resourceType: result.resource_type,
    format: result.format,
    bytes: result.bytes,
    width: result.width,
    height: result.height,
    originalFilename: result.original_filename,
  };
}

export async function uploadBuffer(options: {
  buffer: Buffer;
  filename: string;
  mimetype: string;
  kind: UploadKind;
  organizationId?: string;
  folder?: string;
}): Promise<UploadedAsset> {
  const folder = buildUploadFolder(options.organizationId, options.folder);
  const resourceType = options.kind === "image" ? "image" : options.kind === "raw" ? "raw" : "auto";

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: resourceType,
        use_filename: true,
        unique_filename: true,
        overwrite: false,
      },
      (error, result) => {
        if (error || !result) {
          reject(new AppError(error?.message || "Upload failed", 502));
          return;
        }
        resolve(toAsset(result));
      }
    );

    Readable.from(options.buffer).pipe(stream);
  });
}

export async function deleteAsset(publicId: string, resourceType: "image" | "raw" | "auto" = "image") {
  const result = await cloudinary.uploader.destroy(publicId, {
    resource_type: resourceType === "auto" ? "image" : resourceType,
  });

  if (result.result !== "ok" && result.result !== "not found") {
    throw new AppError(`Failed to delete asset: ${result.result}`, 502);
  }

  return result;
}
