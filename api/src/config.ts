import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  ATTACHMENTS_PATH: z.string().default("./storage"),
  BOOTSTRAP_PASSWORD: z.string().min(12).optional(),
  SMTP_HOST: z.string().default("smtp.gmail.com"),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(465),
  SMTP_SECURE: z.string().default("true").transform(value => value !== "false"),
  SMTP_USER: z.string().email().default("ziiihelpdesk@gmail.com"),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default("HardSystem <ziiihelpdesk@gmail.com>"),
  PORTAL_URL: z.string().url().default("http://192.168.100.68:8080/portal.html"),
  PAYPAL_MODE: z.enum(["sandbox", "live"]).default("sandbox"),
  PAYPAL_CLIENT_ID: z.preprocess(value => value === "" ? undefined : value, z.string().min(10).optional()),
  PAYPAL_CLIENT_SECRET: z.preprocess(value => value === "" ? undefined : value, z.string().min(10).optional()),
  PAYPAL_COP_PER_USD: z.coerce.number().positive().default(4000),
});

export const config = schema.parse(process.env);