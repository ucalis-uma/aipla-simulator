/**
 * unit テスト共通ヘルパー。
 * data-integrity/helpers.ts と同じ規約（import.meta.url 経由のパス解決・
 * 作業ディレクトリに依存しない）に従う。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const unitRepoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

export function readUnitJson<T>(relativePath: string): T {
  const raw = readFileSync(path.join(unitRepoRoot, relativePath), "utf-8");
  return JSON.parse(raw) as T;
}
