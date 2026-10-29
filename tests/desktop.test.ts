import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

test("desktop mantém sandbox, restringe IPC ao próprio localhost e encerra seus serviços", async () => {
  type Handler = (...args: unknown[]) => unknown;
  const appEvents = new Map<string, Handler>(),
    ipc = new Map<string, Handler>(),
    windowEvents = new Map<string, Handler>();
  const opened: string[] = [];
  let options: Record<string, unknown> = {},
    killed = false,
    stopped = false,
    exited = false,
    quit = false,
    loadedUrl = "";
  const nativeTheme = { themeSource: "dark" };
  const webContents = {
    session: {
      setPermissionRequestHandler: () => {},
      setPermissionCheckHandler: () => {},
    },
    send: () => {},
    on: (name: string, handler: Handler) => windowEvents.set(name, handler),
    setWindowOpenHandler: (handler: Handler) =>
      windowEvents.set("open", handler),
  };
  class Window {
    webContents = webContents;
    constructor(input: Record<string, unknown>) {
      options = input;
    }
    loadFile = async () => {};
    loadURL = async (url: string) => {
      loadedUrl = url;
    };
    isDestroyed = () => false;
    isMinimized = () => false;
    show = () => {};
    focus = () => {};
    restore = () => {};
  }
  const fakeApp = {
    isPackaged: true,
    setName: () => {},
    requestSingleInstanceLock: () => true,
    on: (name: string, handler: Handler) => appEvents.set(name, handler),
    whenReady: () => Promise.resolve(),
    getPath: () => "C:/ci-test-data",
    getVersion: () => "0.2.0",
    quit: () => {
      quit = true;
    },
    exit: () => {
      exited = true;
    },
  };
  const fakeElectron = {
    app: fakeApp,
    BrowserWindow: Window,
    nativeTheme,
    safeStorage: {},
    ipcMain: {
      handle: (name: string, handler: Handler) => ipc.set(name, handler),
    },
    shell: {
      openExternal: async (url: string) => {
        opened.push(url);
      },
    },
    dialog: {
      showMessageBox: async () => {
        throw new Error("Unexpected startup dialog");
      },
    },
    utilityProcess: {
      fork: () => ({
        on: () => {},
        kill: () => {
          killed = true;
        },
      }),
    },
  };
  const context = vm.createContext({
    require: (name: string) => {
      if (name === "electron") return fakeElectron;
      if (name === "node:path") return path;
      if (name === "node:fs/promises")
        return {
          mkdir: async () => {},
          readFile: async () => {
            throw new Error("No theme fixture");
          },
          open: async () => ({ write: async () => {}, close: async () => {} }),
        };
      if (name === "./database.cjs")
        return {
          freePort: async () => 32123,
          startDatabase: async () => ({
            url: "postgresql://test-only",
            stop: async () => {
              stopped = true;
            },
          }),
        };
      if (name === "./updater.cjs")
        return {
          createUpdater: () => ({
            snapshot: () => ({ phase: "idle" }),
            subscribe: () => () => {},
            execute: async () => ({ phase: "current" }),
          }),
        };
      if (name === "./update-backup.cjs")
        return { backupUpdateData: async () => {} };
      if (
        name
          .replaceAll("\\", "/")
          .endsWith("updater/node_modules/electron-updater")
      )
        return { autoUpdater: {} };
      throw new Error(`Unexpected require: ${name}`);
    },
    __dirname: path.resolve("desktop"),
    process: { resourcesPath: "C:/ci-test-resources", env: {} },
    fetch: async () => ({ ok: true }),
    setTimeout,
    URL,
    console,
    AbortSignal,
  });
  vm.runInContext(
    readFileSync(path.resolve("desktop/main.cjs"), "utf8"),
    context,
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(loadedUrl, "http://127.0.0.1:32123/");
  assert.deepEqual(
    options.webPreferences &&
      JSON.parse(JSON.stringify(options.webPreferences)),
    {
      preload: path.resolve("desktop/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  );
  const local = {
    sender: webContents,
    senderFrame: { url: "http://127.0.0.1:32123/" },
  };
  await ipc.get("ci:open-browser")!(local);
  assert.deepEqual(opened, ["http://127.0.0.1:32123/"]);
  await assert.rejects(
    async () =>
      ipc.get("ci:open-browser")!({
        ...local,
        senderFrame: { url: "https://example.invalid/" },
      }),
    /Origem/,
  );
  await assert.rejects(
    async () => ipc.get("ci:open-browser")!({ ...local, sender: {} }),
    /Origem/,
  );
  ipc.get("ci:theme")!(local, "light");
  assert.equal(nativeTheme.themeSource, "light");
  assert.throws(() => ipc.get("ci:theme")!(local, "arbitrary"), /inválido/);
  assert.equal(
    (windowEvents.get("open")!() as { action: string }).action,
    "deny",
  );
  await assert.rejects(
    async () =>
      ipc.get("ci:update-action")!({ ...local, sender: {} }, "install"),
    /Origem/,
  );
  assert.equal(
    ((await ipc.get("ci:update-status")!(local)) as { phase: string }).phase,
    "idle",
  );
  appEvents.get("second-instance")!({}, ["--quit"]);
  assert.equal(quit, true);
  appEvents.get("before-quit")!({ preventDefault: () => {} });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(killed, true);
  assert.equal(stopped, true);
  assert.equal(exited, true);
});
