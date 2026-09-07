import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pool } from "./database.js";
const migrationsPath = resolve(process.cwd(), "migrations");
async function migrate() {
    await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
    const appliedResult = await pool.query("SELECT version FROM schema_migrations");
    const applied = new Set(appliedResult.rows.map(({ version }) => version));
    const files = (await readdir(migrationsPath))
        .filter((file) => file.endsWith(".sql"))
        .sort();
    for (const file of files) {
        const version = file.replace(/\.sql$/, "");
        if (applied.has(version))
            continue;
        const sql = await readFile(resolve(migrationsPath, file), "utf8");
        await pool.query(sql);
        console.info(`Applied migration ${version}`);
    }
}
try {
    await migrate();
}
finally {
    await pool.end();
}
