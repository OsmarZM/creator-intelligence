import { cp, mkdir, readFile, writeFile, rm, lstat } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
const root = process.cwd(),
  target = path.resolve(root, ".desktop-resources/updater");
if (path.relative(root, target) !== path.join(".desktop-resources", "updater"))
  throw new Error("Destino de runtime inválido.");
for (const folder of [path.dirname(target), target]) {
  try {
    if ((await lstat(folder)).isSymbolicLink())
      throw new Error("Runtime não pode usar link.");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
async function locate(name, from) {
  const require = createRequire(path.join(from, "package.json"));
  try {
    return path.dirname(require.resolve(name + "/package.json"));
  } catch {
    let directory = path.dirname(require.resolve(name));
    while (true) {
      try {
        const data = JSON.parse(
          await readFile(path.join(directory, "package.json"), "utf8"),
        );
        if (data.name === name) return directory;
      } catch {}
      const parent = path.dirname(directory);
      if (parent === directory)
        throw new Error(`Dependência não localizada: ${name}`);
      directory = parent;
    }
  }
}
const copied=new Map();
async function copy(name, from, destination) {
  const source = await locate(name, from);
  const metadata = JSON.parse(await readFile(path.join(source,"package.json"),"utf8"));
  if(copied.has(name)){
    if(copied.get(name)!==metadata.version)throw new Error(`Versões conflitantes no runtime de atualização: ${name}`);
    return;
  }
  copied.set(name,metadata.version);
  const output = path.join(destination, "node_modules", name);
  await mkdir(path.dirname(output), { recursive: true });
  await cp(source, output, {
    recursive: true,
    dereference: true,
    filter: (file) =>
      !path.relative(source, file).split(path.sep).includes("node_modules") &&
      !path.basename(file).startsWith(".env"),
  });
  for (const dependency of Object.keys(metadata.dependencies ?? {}))
    await copy(dependency, source, destination);
}
await writeFile(
  path.join(target, "package.json"),
  JSON.stringify({
    name: "creator-intelligence-updater-runtime",
    private: true,
  }),
);
await copy("electron-updater", root, target);
const require = createRequire(path.join(target, "package.json"));
const installed = require("electron-updater/package.json");
if (installed.version !== "6.8.11")
  throw new Error("Versão de runtime inesperada.");
console.log(`Updater ${installed.version}: dependências isoladas preparadas.`);
