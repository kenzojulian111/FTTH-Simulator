import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const python = path.join(root, ".venv", "bin", "python");

if (!existsSync(python)) {
  console.error("Project virtualenv not found at .venv/bin/python. Create/activate the project venv and install backend requirements first.");
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

process.once("SIGINT", () => stop(130));
process.once("SIGTERM", () => stop(143));

start("Rust API :8000", "cargo", ["run", "--manifest-path", "backend-rust/Cargo.toml"], { FTTH_PORT: "8000" });
start("FastAPI KMZ :8001", python, ["-m", "uvicorn", "backend.app.main:app", "--reload", "--host", "127.0.0.1", "--port", "8001"]);
start("Vite", "npm", ["run", "dev"]);

console.log("FTTH dev stack starting: Rust API :8000, FastAPI KMZ parser :8001, Vite :5173.");
