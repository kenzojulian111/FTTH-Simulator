import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import net from "node:net";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const python = process.platform === "win32"
  ? path.join(root, ".venv", "Scripts", "python.exe")
  : path.join(root, ".venv", "bin", "python");

if (!existsSync(python)) {
  console.error(`Project virtualenv not found at ${python}. Create/activate the project venv and install backend requirements first.`);
  process.exit(1);
}

const processes = [];
let stopping = false;

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of processes) {
    if (!child.pid || child.exitCode !== null) continue;
    try {
      if (process.platform === "win32") child.kill("SIGTERM");
      else process.kill(-child.pid, "SIGTERM");
    } catch { /* process already exited */ }
  }
  setTimeout(() => process.exit(code), 800).unref();
}

function start(label, command, args, env = {}) {
  const child = spawn(command, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: "inherit",
    detached: process.platform !== "win32",
  });
  processes.push(child);
  child.once("error", (error) => {
    console.error(`[${label}] failed to start: ${error.message}`);
    stop(1);
  });
  child.once("exit", (code, signal) => {
    if (!stopping) {
      console.error(`[${label}] exited (${signal ?? code ?? "unknown"}); stopping the other services.`);
      stop(code || 1);
    }
  });
}

function assertPortAvailable(port, service) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", (error) => {
      if (error.code === "EADDRINUSE") {
        reject(new Error(`Port ${port} (${service}) is already in use. Inspect it with: ss -ltnp 'sport = :${port}'`));
      } else reject(error);
    });
    probe.once("listening", () => probe.close((error) => error ? reject(error) : resolve()));
    probe.listen(port, "127.0.0.1");
  });
}

process.once("SIGINT", () => stop(130));
process.once("SIGTERM", () => stop(143));

try {
  await assertPortAvailable(8000, "FastAPI API and SQLite persistence");
  await assertPortAvailable(5173, "Vite");
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

start("FastAPI canonical API :8000", python, ["-m", "uvicorn", "backend.app.main:app", "--host", "127.0.0.1", "--port", "8000", "--workers", "1"]);
start("Vite", "npm", ["run", "dev"]);

console.log("FTTH dev stack starting: FastAPI + SQLite :8000, Vite :5173. Rust is not used by the application stack.");
