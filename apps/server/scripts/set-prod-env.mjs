import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

// Load repo-root .env before production checks in config.ts
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
dotenv.config({ path: path.join(root, ".env"), override: true });

process.env.NODE_ENV = process.env.NODE_ENV || "production";
