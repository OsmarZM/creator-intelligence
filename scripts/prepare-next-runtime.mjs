import {cp, lstat, mkdir} from "node:fs/promises";
import path from "node:path";
import {createRequire} from "node:module";

// Next's production server imports this directory at startup. Keep it
// explicit: excluding a project's output folder must not remove Next's own.
export async function prepareNextRuntime(projectRoot, serverRoot) {
  const root = path.resolve(projectRoot);
  const target = path.resolve(serverRoot);
  const allowed = [".desktop-resources/server", "release/win-unpacked/resources/server"];
  if (!allowed.some(relative => path.resolve(root, relative) === target))
    throw new Error("Destino de runtime fora das pastas de empacotamento.");
  let current = root;
  for (const segment of path.relative(root, target).split(path.sep)) {
    current = path.join(current, segment);
    if ((await lstat(current)).isSymbolicLink()) throw new Error("Runtime não pode ser link.");
  }
  const localRequire = createRequire(path.join(root, "package.json"));
  const nextRoot = path.dirname(localRequire.resolve("next/package.json"));
  const destination = path.join(target, "node_modules/next/dist/build/output");
  await mkdir(destination, {recursive: true});
  await cp(path.join(nextRoot, "dist/build/output"), destination, {recursive: true});
}
