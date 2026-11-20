import { createApp } from "./app.js";
import { env } from "./config/env.js";

const app = createApp();

/** On Vercel, `api/index.js` exports the app — do not listen. */
const isVercel = Boolean(process.env.VERCEL);

if (!isVercel) {
  app.listen(env.PORT, () => {
    console.log(`Novex ERP API listening on http://localhost:${env.PORT}`);
    console.log(`Environment: ${env.NODE_ENV}`);
  });
}

export default app;
