module.exports = {
  afterPack: async (context) => {
    const fs = require("node:fs/promises"),
      path = require("node:path");
    const resources = path.join(context.appOutDir, "resources");
    const archive = require("@electron/asar");
    const metadata = JSON.parse(
      archive
        .extractFile(path.join(resources, "app.asar"), "package.json")
        .toString(),
    );
    if (
      metadata.version !== require("../package.json").version ||
      metadata.main !== "desktop/main.cjs"
    )
      throw new Error("Metadados do aplicativo empacotado inválidos.");
    for (const required of [
      "runtime/hermes_bridge.py",
      "updater/node_modules/electron-updater/out/main.js",
      "hermes/MANIFEST.json",
      "hermes/source/run_agent.py",
      "hermes/source/LICENSE",
      "hermes/python/python.exe",
      "server/server.js",
      "server/node_modules/pg/lib/index.js",
      "server/node_modules/next/package.json",
      "server/.next/static",
      "postgres/bin/postgres.exe",
      "postgres/bin/initdb.exe",
      "migrations/20261026170000_initial/migration.sql",
    ]) {
      await fs.access(path.join(resources, required));
    }
    require("../scripts/verify-runtime.cjs")(path.join(resources, "server"));
    try {
      await fs.access(path.join(resources, "server/.env"));
      throw new Error("O pacote não pode conter .env.");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  },
  appId: "br.com.fortatech.creatorintelligence",
  productName: "Creator Intelligence",
  directories: { output: "release" },
  asar: true,
  npmRebuild: false,
  files: [
    "desktop/main.cjs",
    "desktop/database.cjs",
    "desktop/preload.cjs",
    "desktop/updater.cjs",
    "desktop/update-backup.cjs",
    "desktop/loading.*",
    "desktop/icon.*",
    "package.json",
    "!node_modules/**",
  ],
  extraResources: [
    {
      from: ".desktop-resources/updater",
      to: "updater",
      filter: ["**/*", "!**/.env", "!**/.env.*"],
    },
    {from:".desktop-resources/updater/node_modules",to:"updater/node_modules",filter:["**/*"]},
    { from: "runtime/hermes_bridge.py", to: "runtime/hermes_bridge.py" },
    {
      from: ".desktop-resources/hermes",
      to: "hermes",
      filter: [
        "**/*",
        "!**/__pycache__/**",
        "!**/.env",
        "!**/.env.*",
        "!**/.git/**",
      ],
    },
    {
      from: ".desktop-resources/server",
      to: "server",
      filter: ["**/*", "!.env", "!**/.env", "!**/.env.*"],
    },
    {
      from: ".desktop-resources/server/node_modules",
      to: "server/node_modules",
      filter: ["**/*"],
    },
    { from: ".desktop-resources/postgres", to: "postgres" },
    { from: "prisma/migrations", to: "migrations" },
  ],
  win: {
    icon: "desktop/icon.ico",
    target: [{ target: "nsis", arch: ["x64"] }],
    signAndEditExecutable: true,
    // Keep icon/version editing on unsigned builds without walking every
    // bundled third-party executable looking for a signing certificate.
    signExecutable: process.env.CI_SIGN_WINDOWS === "1",
  },
  publish: [
    {
      provider: "github",
      owner: "OsmarZM",
      repo: "creator-intelligence",
      releaseType: "release",
    },
  ],
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    deleteAppDataOnUninstall: false,
    artifactName: "Creator-Intelligence-Setup-${version}.${ext}",
  },
};
