import { existsSync } from "node:fs";
import path from "node:path";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { registerRoutes } from "./routes";

const app = Fastify({ logger: { level: "warn" } });
registerRoutes(app);

// Production (container): serve the built web app from the same port, SPA fallback to index.html.
const webDist = process.env.PROJECT_HUB_WEB_DIST;
if (webDist && existsSync(path.join(webDist, "index.html"))) {
  await app.register(fastifyStatic, { root: path.resolve(webDist) });
  app.setNotFoundHandler((req, reply) =>
    req.method === "GET" && !req.url.startsWith("/api/") ? reply.sendFile("index.html") : reply.code(404).send({ error: "not_found" }),
  );
}

const host = process.env.PROJECT_HUB_HOST ?? "127.0.0.1";
const port = Number(process.env.PROJECT_HUB_PORT ?? 4310);
app.listen({ host, port }).then(
  () => console.log(`project-hub server on http://${host}:${port}`),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
