import multer from "multer";
import { AppError } from "../utils/AppError.js";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

const storage = multer.memoryStorage();

function fileFilter(
  _req: Express.Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
): void {
  if (!file.originalname || file.originalname.trim() === "") {
    cb(new AppError("Invalid file name", 400));
    return;
  }
  cb(null, true);
}

export const uploadSingle = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE, files: 1 },
  fileFilter,
}).single("file");

export const uploadMultiple = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE, files: 10 },
  fileFilter,
}).array("files", 10);
