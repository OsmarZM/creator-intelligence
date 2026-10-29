import path from "node:path";
export function dataDirectory() {
  return process.env.CI_DATA_DIR || path.resolve("storage");
}
