const { EventEmitter } = require("node:events");

// No URL or installer path comes from the renderer. electron-updater owns the
// configured GitHub feed, download cache, SHA-512 validation and NSIS launch.
function createUpdater({
  updater,
  version,
  prepareInstall,
  recoverInstall = () => {},
}) {
  const events = new EventEmitter();
  let state = {
    phase: updater ? "idle" : "unavailable",
    currentVersion: version,
  };
  let action = false;
  const publish = (patch) => {
    state = { ...state, ...patch };
    events.emit("state", { ...state });
    return { ...state };
  };
  const fail = (message) =>
    publish({ phase: "error", message, percent: undefined });
  if (updater) {
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowDowngrade = false;
    updater.allowPrerelease = false;
    updater.logger = null;
    updater.on("checking-for-update", () =>
      publish({ phase: "checking", message: undefined }),
    );
    updater.on("update-available", (info) =>
      publish({
        phase: "available",
        version: info.version,
        message: undefined,
      }),
    );
    updater.on("update-not-available", () =>
      publish({ phase: "current", message: undefined }),
    );
    updater.on("download-progress", (progress) =>
      publish({
        phase: "downloading",
        percent: Math.max(0, Math.min(100, Number(progress.percent) || 0)),
      }),
    );
    updater.on("update-downloaded", (info) =>
      publish({
        phase: "downloaded",
        version: info.version,
        percent: 100,
        message: undefined,
      }),
    );
    updater.on("error", () => {
      const installing = state.phase === "installing";
      fail(
        "Não foi possível concluir a atualização. Verifique sua conexão e tente novamente.",
      );
      if (installing) void recoverInstall();
    });
  }
  return {
    snapshot: () => ({ ...state }),
    subscribe: (callback) => {
      events.on("state", callback);
      return () => events.off("state", callback);
    },
    async execute(command) {
      if (!updater)
        throw new Error(
          "Atualizações estão disponíveis no aplicativo Windows instalado.",
        );
      if (action)
        throw new Error("Já existe uma operação de atualização em andamento.");
      if (!["check", "download", "install"].includes(command))
        throw new Error("Ação de atualização inválida.");
      if (command === "download" && state.phase !== "available")
        throw new Error("Verifique uma nova versão antes de baixar.");
      if (command === "install" && state.phase !== "downloaded")
        throw new Error("Conclua o download antes de instalar.");
      if (
        command === "check" &&
        ["downloaded", "installing"].includes(state.phase)
      )
        return { ...state };
      action = true;
      try {
        if (command === "check") await updater.checkForUpdates();
        if (command === "download") {
          publish({ phase: "downloading", percent: 0, message: undefined });
          await updater.downloadUpdate();
        }
        if (command === "install") {
          // Keep the download reusable if the app is busy or its backup fails.
          try {
            await prepareInstall();
          } catch (error) {
            publish({ phase: "downloaded", message: error.message });
            return { ...state };
          }
          publish({
            phase: "installing",
            message: "Backup concluído. Instalando e reabrindo o aplicativo…",
          });
          updater.quitAndInstall(true, true);
        }
        return { ...state };
      } catch {
        return fail(
          "Não foi possível concluir a atualização. Verifique sua conexão e tente novamente.",
        );
      } finally {
        action = false;
      }
    },
  };
}
module.exports = { createUpdater };
