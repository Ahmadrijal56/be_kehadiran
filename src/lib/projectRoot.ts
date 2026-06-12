import path from "node:path";
import { fileURLToPath } from "node:url";

/** Root repo (berisi package.json & prisma/) — dari dist/lib/*.js naik 2 level. */
export function getProjectRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../..");
}
