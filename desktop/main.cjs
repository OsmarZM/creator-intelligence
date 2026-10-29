const {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  dialog,
  utilityProcess,
  nativeTheme,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const { safeStorage } = require("electron");
const { startDatabase, freePort } = require("./database.cjs");
const { createUpdater } = require("./updater.cjs");
const { backupUpdateData } = require("./update-backup.cjs");
let window,
  backend,
  database,
  origin,
  stopping = false;
app.setName("Creator Intelligence");
// Explicit isolated profiles let packaged builds be qualified without opening
// the user's conversation or database. Normal launches always use appData.
if (
  process.env.CI_DESKTOP_DIAGNOSTICS === "1" &&
  process.env.CI_DESKTOP_PROFILE
) {
  const profile = path.resolve(process.env.CI_DESKTOP_PROFILE);
  require("node:fs").mkdirSync(profile, { recursive: true });
  app.setPath("userData", profile);
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", (_event, argv) => {
    if (argv.includes("--quit")) {
      app.quit();
      return;
    }
    if (window) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    }
  });
  app
    .whenReady()
    .then(start)
    .catch(async (error) => {
      await dialog.showMessageBox({
        type: "error",
        title: "Não foi possível iniciar o Creator Intelligence",
        message:
          "O aplicativo preservou seus dados. Confira o diagnóstico local antes de tentar novamente.",
        detail: error.message.includes("password")
          ? "Falha ao iniciar o banco local."
          : error.message.slice(0, 1500),
      });
      app.quit();
    });
}
async function start() {
  const userData = app.getPath("userData");
  await fs.mkdir(userData, { recursive: true });
  try {
    const appearance = JSON.parse(
      await fs.readFile(path.join(userData, "appearance.json"), "utf8"),
    );
    nativeTheme.themeSource = appearance.theme === "light" ? "light" : "dark";
  } catch {
    nativeTheme.themeSource = "dark";
  }
  const resourceRoot = app.isPackaged
    ? process.resourcesPath
    : path.join(__dirname, "../.desktop-resources");
  const serverRoot = path.join(resourceRoot, "server");
  const showWindow=!(process.env.CI_DESKTOP_DIAGNOSTICS==="1"&&process.env.CI_DESKTOP_HEADLESS==="1");
  window = new BrowserWindow({
    show:showWindow,
    width: 1440,
    height: 940,
    minWidth: 1000,
    minHeight: 700,
    title: "Creator Intelligence",
    icon: path.join(__dirname, "icon.png"),
    backgroundColor: "#09090d",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const status = (text) => {
    if (window && !window.isDestroyed())
      window.webContents.send("ci:status", text);
  };
  await window.loadFile(path.join(__dirname, "loading.html"));
  if(showWindow)window.show();
  const session = window.webContents.session;
  session.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  session.setPermissionCheckHandler(() => false);
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (origin && new URL(url).origin !== origin) event.preventDefault();
  });
  ipcMain.handle("ci:open-browser", async (event) => {
    if (
      !origin ||
      event.sender !== window.webContents ||
      event.senderFrame.url !== `${origin}/`
    )
      throw new Error("Origem não autorizada.");
    await shell.openExternal(`${origin}/`);
  });
  ipcMain.handle("ci:theme", (event, theme) => {
    if (
      !origin ||
      event.sender !== window.webContents ||
      event.senderFrame.url !== `${origin}/` ||
      !["dark", "light"].includes(theme)
    )
      throw new Error("Origem ou tema inválido.");
    nativeTheme.themeSource = theme;
  });
  const trusted = (event) => {
    if (
      !origin ||
      event.sender !== window.webContents ||
      event.senderFrame.url !== `${origin}/`
    )
      throw new Error("Origem não autorizada.");
  };
  let recovering = false;
  const recoverInstall = async () => {
    if (recovering || !stopping) return;
    recovering = true;
    await dialog.showMessageBox({
      type: "error",
      title: "Atualização não concluída",
      message:
        "Seus dados foram preservados. O aplicativo será reaberto para você tentar novamente.",
    });
    app.relaunch();
    app.exit(0);
  };
  const updates = createUpdater({
    updater: app.isPackaged
      ? require(
          path.join(resourceRoot, "updater/node_modules/electron-updater"),
        ).autoUpdater
      : null,
    version: app.getVersion(),
    recoverInstall,
    prepareInstall: async () => {
      const response = await fetch(`${origin}/api/desktop/prepare-update`, {
        method: "POST",
        signal: AbortSignal.timeout(15000),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error ?? "Aguarde a operação atual terminar.");
      stopping = true;
      try {
        backend?.kill();
        await database?.stop();
        await backupUpdateData(userData, app.getVersion());
      } catch (error) {
        await recoverInstall();
        throw error;
      }
    },
  });
  updates.subscribe((state) => {
    if (window && !window.isDestroyed())
      window.webContents.send("ci:update-state", state);
  });
  ipcMain.handle("ci:update-status", (event) => {
    trusted(event);
    return updates.snapshot();
  });
  ipcMain.handle("ci:update-action", (event, command) => {
    trusted(event);
    return updates.execute(command);
  });
  database = await startDatabase({
    userData,
    resourceRoot,
    serverRoot,
    safeStorage,
    status,
  });
  status("Iniciando o workspace…");
  const port = await freePort();
  origin = `http://127.0.0.1:${port}`;
  const log = await fs.open(path.join(userData, "backend.log"), "a");
  backend = utilityProcess.fork(path.join(serverRoot, "server.js"), [], {
    cwd: serverRoot,
    env: {
      ...process.env,
      NODE_ENV: "production",
      HOSTNAME: "127.0.0.1",
      PORT: String(port),
      DATABASE_URL: database.url,
      CI_DATA_DIR: userData,
      CI_HERMES_BRIDGE: path.join(
        app.isPackaged ? process.resourcesPath : app.getAppPath(),
        "runtime/hermes_bridge.py",
      ),
      CI_HERMES_RUNTIME: path.join(
        app.isPackaged ? process.resourcesPath : resourceRoot,
        "hermes",
      ),
      NEXT_TELEMETRY_DISABLED: "1",
    },
    stdio: "pipe",
    serviceName: "Creator Intelligence Backend",
  });
  backend.stdout?.on("data", (data) => {
    void log.write(data);
  });
  backend.stderr?.on("data", (data) => {
    void log.write(data);
  });
  let exited = false;
  backend.on("exit", () => {
    exited = true;
    void log.close();
    if (!stopping) {
      void dialog.showMessageBox({
        type: "error",
        message:
          "O backend local foi encerrado. Feche e abra o aplicativo; seus dados foram preservados.",
      });
    }
  });
  const deadline = Date.now() + 90000;
  let ready = false;
  while (Date.now() < deadline && !exited) {
    try {
      const response = await fetch(`${origin}/api/health`, {
        signal: AbortSignal.timeout(2000),
      });
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!ready)
    throw new Error(
      "O backend não ficou disponível. Consulte backend.log na pasta de dados do aplicativo.",
    );
  await window.loadURL(`${origin}/`);
  if (process.env.CI_DESKTOP_DIAGNOSTICS === "1") {
    window.webContents.on("console-message", (_event, details) => {
      if (details.level === "error")
        console.error("Renderer:", details.message);
    });
    console.log(
      "CI_DESKTOP_READY",
      JSON.stringify({ origin, userData, version: app.getVersion() }),
    );
    console.log("CI_UPDATE_STATE",JSON.stringify(updates.snapshot()));
    if (process.env.CI_CHECK_UPDATES === "1") {
      updates.subscribe((state) =>
        console.log("CI_UPDATE_STATE", JSON.stringify(state)),
      );
      void updates.execute("check");
    }
  }
}
app.on("window-all-closed", () => app.quit());
app.on("before-quit", (event) => {
  if (stopping) return;
  event.preventDefault();
  stopping = true;
  void (async () => {
    try {
      backend?.kill();
      await database?.stop();
    } catch {
    } finally {
      app.exit();
    }
  })();
});
