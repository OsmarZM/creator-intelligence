const fs = require("node:fs/promises");
const path = require("node:path");
const net = require("node:net");
const { randomBytes, createHash } = require("node:crypto");
const { execFile, spawn } = require("node:child_process");
const { promisify } = require("node:util");
const run = promisify(execFile);
// pg_ctl can leave inherited pipe handles open in its long-lived Windows child.
// Observe the controller process exit without capturing service stdio.
function control(file, args, env, timeout = 130000) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      env,
      windowsHide: true,
      stdio: "ignore",
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(
        new Error(
          "O controle do PostgreSQL excedeu o tempo limite. Consulte postgres.log.",
        ),
      );
    }, timeout);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `O controle do PostgreSQL falhou (${code}). Consulte postgres.log.`,
          ),
        );
    });
  });
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}
async function startDatabase({
  userData,
  resourceRoot,
  serverRoot,
  safeStorage,
  status,
}) {
  if (!safeStorage.isEncryptionAvailable())
    throw new Error(
      "A proteção de credenciais do Windows não está disponível para este usuário.",
    );
  const { Client } = require(path.join(serverRoot, "node_modules/pg"));
  const root = path.join(resourceRoot, "postgres"),
    bin = path.join(root, "bin"),
    data = path.join(userData, "database"),
    configPath = path.join(userData, "database.json");
  await fs.access(path.join(bin, "postgres.exe"));
  let config;
  try {
    config = JSON.parse(await fs.readFile(configPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT")
      throw new Error(
        "A configuração do banco local não pôde ser lida. Preserve a pasta de dados.",
      );
    config = {
      port: await freePort(),
      passwordCipher: safeStorage
        .encryptString(randomBytes(32).toString("hex"))
        .toString("base64"),
    };
    await fs.writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
  }
  const password = safeStorage.decryptString(
    Buffer.from(config.passwordCipher, "base64"),
  );
  const env = {
    ...process.env,
    PATH: `${bin};${process.env.PATH}`,
    LC_MESSAGES: "C",
  };
  let initialized = true;
  try {
    await fs.access(path.join(data, "PG_VERSION"));
  } catch {
    initialized = false;
  }
  if (!initialized) {
    status("Preparando seu banco local pela primeira vez…");
    const passwordFile = path.join(userData, "database-init.tmp");
    try {
      await fs.writeFile(passwordFile, password, { mode: 0o600 });
      await run(
        path.join(bin, "initdb.exe"),
        [
          "-D",
          data,
          "-U",
          "creator",
          "--auth=scram-sha-256",
          `--pwfile=${passwordFile}`,
          "--encoding=UTF8",
          "--locale=C",
        ],
        { windowsHide: true, env, timeout: 600000, maxBuffer: 2 * 1024 * 1024 },
      );
    } finally {
      await fs.unlink(passwordFile).catch(() => {});
    }
  }
  status("Iniciando o PostgreSQL local…");
  let running = false;
  try {
    await control(
      path.join(bin, "pg_ctl.exe"),
      ["status", "-D", data],
      env,
      15000,
    );
    running = true;
  } catch {}
  if (!running) {
    config.port = await freePort();
    await fs.writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
    await control(
      path.join(bin, "pg_ctl.exe"),
      [
        "start",
        "-D",
        data,
        "-l",
        path.join(userData, "postgres.log"),
        "-o",
        `-h 127.0.0.1 -p ${config.port}`,
        "-w",
        "-t",
        "120",
      ],
      env,
    );
  }
  const options = {
    host: "127.0.0.1",
    port: config.port,
    user: "creator",
    password,
    connectionTimeoutMillis: 15000,
  };
  const admin = new Client({ ...options, database: "postgres" });
  await admin.connect();
  try {
    if (
      !(
        await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [
          "creator_intelligence",
        ])
      ).rowCount
    )
      await admin.query('CREATE DATABASE "creator_intelligence"');
  } finally {
    await admin.end();
  }
  status("Conferindo a estrutura e o histórico do banco…");
  const client = new Client({ ...options, database: "creator_intelligence" });
  await client.connect();
  try {
    await client.query(
      'CREATE TABLE IF NOT EXISTS "_ci_desktop_migrations" (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())',
    );
    const migrations = path.join(resourceRoot, "migrations");
    for (const name of (await fs.readdir(migrations)).sort()) {
      if (name.endsWith(".toml")) continue;
      const sql = await fs.readFile(
          path.join(migrations, name, "migration.sql"),
          "utf8",
        ),
        checksum = createHash("sha256").update(sql).digest("hex");
      const existing = await client.query(
        'SELECT checksum FROM "_ci_desktop_migrations" WHERE name=$1',
        [name],
      );
      if (existing.rowCount) {
        if (existing.rows[0].checksum !== checksum)
          throw new Error(
            "Uma migração aplicada foi alterada. O banco foi preservado.",
          );
        continue;
      }
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO "_ci_desktop_migrations" (name,checksum) VALUES ($1,$2)',
          [name, checksum],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.end();
  }
  return {
    url: `postgresql://creator:${encodeURIComponent(password)}@127.0.0.1:${config.port}/creator_intelligence`,
    stop: async () => {
      await control(
        path.join(bin, "pg_ctl.exe"),
        ["stop", "-D", data, "-m", "fast", "-w", "-t", "30"],
        env,
        35000,
      );
    },
  };
}
module.exports = { startDatabase, freePort };
