import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { agentSettingsSchema } from "@/lib/agent";
import { dataDirectory } from "../data-directory";
export async function agentSettings() {
  const defaults = process.env.CI_HERMES_RUNTIME
    ? { engine: "hermes", answerTokens: 4096 }
    : {};
  try {
    const stored = JSON.parse(
      await readFile(path.join(dataDirectory(), "agent-settings.json"), "utf8"),
    );
    if (process.env.CI_HERMES_RUNTIME && stored.engine === undefined)
      stored.answerTokens = Math.max(4096, stored.answerTokens ?? 0);
    return agentSettingsSchema.parse({ ...defaults, ...stored });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return agentSettingsSchema.parse(defaults);
    throw error;
  }
}
export async function saveAgentSettings(input: unknown) {
  const settings = agentSettingsSchema.parse(input);
  await mkdir(dataDirectory(), { recursive: true });
  const target = path.join(dataDirectory(), "agent-settings.json"),
    temp = `${target}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(settings), { mode: 0o600 });
  await rename(temp, target);
  return settings;
}
