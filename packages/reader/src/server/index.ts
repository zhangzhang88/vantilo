import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildServer } from "./app.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const port = Number(process.env.PORT ?? 5174);
const host = process.env.HOST ?? "127.0.0.1";
const app = await buildServer({ projectRoot });

try {
  await app.listen({ host, port });
  console.log(`Magazine Reader server: http://${host}:${port}`);
  if (process.env.MAGAZINE_SYNC_DISABLE !== "1") {
    void app.inject({ method: "POST", url: "/api/source-sync/github" }).then((response) => {
      if (response.statusCode >= 400) {
        console.warn(`Magazine sync startup check failed: ${response.body}`);
        return;
      }
      const report = response.json() as { importedCount?: number; failedCount?: number };
      console.log(`Magazine sync startup check: imported=${report.importedCount ?? 0}, failed=${report.failedCount ?? 0}`);
    }).catch((error) => console.warn("Magazine sync startup check failed", error));
  }
} catch (error) {
  console.error(error);
  process.exit(1);
}
