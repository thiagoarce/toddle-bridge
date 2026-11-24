import Fastify from "fastify";
import { previewDraft } from "./draft.ts";

const app = Fastify({ logger: false, bodyLimit: 100_000 });
app.get("/health", async () => ({ status: "ok", mode: "preview-only", version: "0.1.0" }));
app.post("/drafts/preview", async (request, reply) => {
  try { return previewDraft(request.body); }
  catch { return reply.code(400).send({ error: "Invalid draft fields" }); }
});
const port = Number(process.env.PORT || 3210);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid port");
await app.listen({ host: "127.0.0.1", port });
console.log("Toddle Bridge: http://127.0.0.1:" + port + " (preview only)");
