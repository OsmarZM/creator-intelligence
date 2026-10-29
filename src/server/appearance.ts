import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { dataDirectory } from "./data-directory";
const schema = z.object({ theme: z.enum(["dark", "light"]) }).strict();
export async function appearance() {
  try {
    return schema.parse(
      JSON.parse(
        await readFile(path.join(dataDirectory(), "appearance.json"), "utf8"),
      ),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { theme: "dark" as const };
    throw new Error("Não foi possível ler a preferência de aparência.");
  }
}
export async function saveAppearance(input: unknown) {
  const value = schema.parse(input);
  await mkdir(dataDirectory(), { recursive: true });
  const target = path.join(dataDirectory(), "appearance.json"),
    temp = `${target}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value));
  await rename(temp, target);
  return value;
}
