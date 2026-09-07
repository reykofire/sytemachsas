import Fastify from "fastify";
import { config } from "./config.js";
import { pool } from "./database.js";
const app = Fastify({
    logger: {
        level: config.NODE_ENV === "production" ? "info" : "debug",
    },
    trustProxy: true,
});
app.get("/api/health/live", async () => ({ status: "ok" }));
app.get("/api/health/ready", async (_request, reply) => {
    try {
        await pool.query("SELECT 1");
        return { status: "ready", database: "connected" };
    }
    catch (error) {
        app.log.error(error, "Database readiness check failed");
        return reply.code(503).send({ status: "unavailable" });
    }
});
const shutdown = async (signal) => {
    app.log.info({ signal }, "Shutting down");
    await app.close();
    await pool.end();
    process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
await app.listen({ host: config.HOST, port: config.PORT });
