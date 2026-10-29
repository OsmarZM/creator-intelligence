import {
  cp,
  mkdir,
  readdir,
  copyFile,
  readFile,
  writeFile,
  access,
  rm,
  lstat,
} from "node:fs/promises";
import path from "node:path";
import verifyRuntime from "./verify-runtime.cjs";
import {prepareNextRuntime} from "./prepare-next-runtime.mjs";
const root = process.cwd(),
  target = path.join(root, ".desktop-resources");
const pgRoot = process.env.CI_POSTGRES_ROOT || "C:/Program Files/PostgreSQL/18";
await access(path.join(root, ".next/standalone/server.js"));
for (const file of ["MANIFEST.json", "source/run_agent.py", "source/LICENSE", "python/python.exe"])
  await access(path.join(target, "hermes", file));
const serverTarget=path.resolve(target,"server");
if(path.relative(root,serverTarget)!==path.join(".desktop-resources","server"))throw new Error("Destino de build fora do workspace.");
try{if((await lstat(target)).isSymbolicLink()||(await lstat(serverTarget)).isSymbolicLink())throw new Error("Destino de build não pode ser link.");}catch(error){if(error.code!=="ENOENT")throw error;}
await rm(serverTarget,{recursive:true,force:true});
await mkdir(serverTarget, { recursive: true });
await cp(path.join(root, ".next/standalone"), path.join(target, "server"), {
  recursive: true,
  dereference:true,
  filter: (source) => {
    const relative=path.relative(path.join(root,".next/standalone"),source);
    return !["storage","release",".desktop-resources","output",".playwright-cli"].includes(relative.split(path.sep)[0])&&!path.basename(source).startsWith(".env")&&!/^(ai-settings|database|appearance)\.json$/.test(path.basename(source));
  },
});
await cp(
  path.join(root, ".next/static"),
  path.join(target, "server/.next/static"),
  { recursive: true },
);
await cp(path.join(root, "public"), path.join(target, "server/public"), {
  recursive: true,
});
if(!process.argv.includes("--server-only")) {
await mkdir(path.join(target, "postgres/bin"), { recursive: true });
for (const name of await readdir(path.join(pgRoot, "bin"))) {
  if (
    name.endsWith(".dll") ||
    ["postgres.exe", "pg_ctl.exe", "initdb.exe"].includes(name)
  )
    await copyFile(
      path.join(pgRoot, "bin", name),
      path.join(target, "postgres/bin", name),
    );
}
await cp(path.join(pgRoot, "lib"), path.join(target, "postgres/lib"), {
  recursive: true,
});
await cp(path.join(pgRoot, "share"), path.join(target, "postgres/share"), {
  recursive: true,
});
for (const name of await readdir(pgRoot)) {
  if (/license|copyright/i.test(name))
    await copyFile(
      path.join(pgRoot, name),
      path.join(target, "postgres", name),
    ).catch(() => {});
}
} else {
  await access(path.join(target,"postgres/bin/postgres.exe"));
}
await cp(
  path.join(root, "prisma/migrations"),
  path.join(target, "migrations"),
  { recursive: true },
);
await writeFile(
  path.join(target, "postgres/SOURCE.txt"),
  `PostgreSQL Windows runtime copied for local packaging from ${pgRoot}.\nPreserve included upstream licenses.\n`,
);
// Reject accidental build-time environment files in the server distribution.
async function verify(folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (entry.name.startsWith(".env"))
      throw new Error("Environment file found in desktop payload");
    if (entry.isDirectory()) await verify(path.join(folder, entry.name));
  }
}
await verify(path.join(target, "server"));
await prepareNextRuntime(root, serverTarget);
verifyRuntime(path.join(target,"server"));
const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
console.log(
  `Desktop ${pkg.version}: backend, static assets, migrations and Windows PostgreSQL prepared.`,
);
