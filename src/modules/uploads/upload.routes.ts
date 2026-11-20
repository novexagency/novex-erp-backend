import { Router } from "express";
import { authGuard } from "../../middleware/authGuard.js";
import { uploadMultiple, uploadSingle } from "../../middleware/upload.js";
import * as uploadController from "./upload.controller.js";

const router = Router();

router.use(authGuard);

router.post("/image", uploadSingle, uploadController.uploadImage);
router.post("/file", uploadSingle, uploadController.uploadFile);
router.post("/many", uploadMultiple, uploadController.uploadMany);
router.delete("/", uploadController.removeAsset);

export default router;
