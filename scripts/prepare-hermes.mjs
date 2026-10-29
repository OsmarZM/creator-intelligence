import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, writeFile, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
const commit = "f6f707b78317530980e1d0bf5ca77c8464a9148b";
const source = process.env.CI_HERMES_SOURCE;
const pythonRoot = process.env.CI_PYTHON_ROOT;
if (!source || !pythonRoot)
  throw new Error(
    "Build requires CI_HERMES_SOURCE (upstream checkout) and CI_PYTHON_ROOT (portable CPython). End users receive both in the installer.",
  );
const root = path.resolve(".desktop-resources/hermes"),
  code = path.join(root, "source"),
  python = path.join(root, "python");
await mkdir(code, { recursive: true });
await mkdir("storage/build-cache", { recursive: true });
const archive = path.resolve("storage/build-cache/hermes-source.tar");
const run = (file, args, options = {}) =>
  execFileSync(file, args, { stdio: "inherit", windowsHide: true, ...options });
const tree = execFileSync(
  "git",
  ["-C", source, "ls-tree", "--name-only", commit],
  { encoding: "utf8", windowsHide: true },
)
  .trim()
  .split(/\r?\n/);
const directories = new Set([
  "acp_adapter",
  "agent",
  "assets",
  "cron",
  "gateway",
  "hermes_cli",
  "locales",
  "plugins",
  "providers",
  "tools",
  "tui_gateway",
]);
const paths = tree.filter(
  (name) =>
    name.endsWith(".py") ||
    ["LICENSE", "README.md", "pyproject.toml", "uv.lock"].includes(name) ||
    directories.has(name),
);
run("git", [
  "-C",
  source,
  "archive",
  "--format=tar",
  `--output=${archive}`,
  commit,
  "--",
  ...paths,
]);
run("tar", ["-xf", archive, "-C", code]);
await cp(pythonRoot, python, {
  recursive: true,
  filter: (entry) => {
    const relative = path.relative(pythonRoot, entry).replaceAll("\\", "/");
    return (
      !relative.startsWith("Lib/site-packages") &&
      !relative.startsWith("Scripts") &&
      !relative.startsWith("include") &&
      !relative.startsWith("libs") &&
      !relative.includes("__pycache__")
    );
  },
});
const requirements = path.join(root, "requirements.lock.txt");
run(
  process.env.CI_UV || "uv",
  [
    "export",
    "--project",
    code,
    "--frozen",
    "--no-dev",
    "--no-emit-project",
    "--output-file",
    requirements,
  ],
  { stdio: ["ignore", "ignore", "inherit"] },
);
run(process.env.CI_UV || "uv", [
  "pip",
  "install",
  "--python",
  path.join(python, "python.exe"),
  "--target",
  path.join(python, "Lib/site-packages"),
  "--require-hashes",
  "--only-binary",
  ":all:",
  "--requirements",
  requirements,
]);
await access(path.join(code, "LICENSE"));
const manifest = {
  engine: "hermes",
  commit,
  sourceArchiveSha256: createHash("sha256")
    .update(await readFile(archive))
    .digest("hex"),
  dependenciesSha256: createHash("sha256")
    .update(await readFile(requirements))
    .digest("hex"),
  python: execFileSync(path.join(python, "python.exe"), ["--version"], {
    encoding: "utf8",
    windowsHide: true,
  }).trim(),
  profile: "owned by Creator Intelligence; no personal configuration included",
};
await writeFile(
  path.join(root, "MANIFEST.json"),
  JSON.stringify(manifest, null, 2),
);
console.log(JSON.stringify(manifest));
