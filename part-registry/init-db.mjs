/**
 * Creates part_registry.db from init.sql
 * Run: npx sql.js init-db.mjs   OR   node init-db.mjs (after npm i sql.js)
 */
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import initSqlJs from "sql.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "part_registry.db");
const schemaPath = join(__dirname, "init.sql");

const SQL = await initSqlJs();
const db = new SQL.Database();
const schema = readFileSync(schemaPath, "utf8");
db.exec(schema);
const data = db.export();
writeFileSync(dbPath, Buffer.from(data));
db.close();

console.log("Created", dbPath);
