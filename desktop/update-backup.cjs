const fs = require("node:fs/promises"),
  path = require("node:path");
async function backupUpdateData(userData, version) {
  const root = path.resolve(userData),
    backupRoot = path.join(root, "update-backups");
  const folder = path.join(
    backupRoot,
    `${version.replace(/[^a-z0-9.-]/gi, "_")}-${new Date().toISOString().replace(/[:.]/g, "-")}`,
  );
  if (!folder.startsWith(backupRoot + path.sep))
    throw new Error("Destino de backup inválido.");
  await fs.mkdir(folder, { recursive: true });
  for (const name of [
    "database",
    "agent",
    "imports",
    "database.json",
    "ai-settings.json",
    "agent-settings.json",
    "appearance.json",
  ]) {
    const source = path.join(root, name);
    try {
      await fs.access(source);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    await fs.cp(source, path.join(folder, name), {
      recursive: true,
      force: false,
      errorOnExist: true,
    });
  }
  await fs.writeFile(
    path.join(folder, "backup.json"),
    JSON.stringify({
      version,
      createdAt: new Date().toISOString(),
      databaseStopped: true,
    }),
    { flag: "wx" },
  );
  return folder;
}
module.exports = { backupUpdateData };
