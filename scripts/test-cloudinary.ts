import "dotenv/config";
import { v2 as cloudinary } from "cloudinary";

async function main() {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });

  const result = await cloudinary.uploader.upload(
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    { folder: "novex-erp/smoke-test" }
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        publicId: result.public_id,
        secureUrl: result.secure_url,
      },
      null,
      2
    )
  );

  await cloudinary.uploader.destroy(result.public_id);
  console.log("deleted smoke-test asset");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
