/**
 * Arranque de desarrollo con un solo comando.
 *
 * Levanta la API y la interfaz web, y suma el servicio de pronóstico solo si su
 * entorno de Python ya está creado. Así `npm run dev` funciona desde el primer
 * momento, sin pedir tres terminales ni instalar nada de Python para empezar.
 *
 * No usa dependencias: solo el módulo `child_process` de Node.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const isWindows = process.platform === "win32";

const services = [
  { name: "api", command: "npm", args: ["--workspace", "apps/api", "run", "dev"] },
  { name: "web", command: "npm", args: ["--workspace", "apps/web", "run", "dev"] },
];

const venv = join(root, "apps", "ml", ".venv");
const python = isWindows
  ? join(venv, "Scripts", "python.exe")
  : join(venv, "bin", "python");

if (existsSync(python)) {
  services.push({
    name: "ml",
    command: python,
    args: ["-m", "uvicorn", "app.main:app", "--reload", "--port", "8000"],
    cwd: join(root, "apps", "ml"),
  });
} else {
  console.log(
    "\n[dev] El servicio de pronóstico (Python) no está instalado: se omite.\n" +
      "[dev] La plataforma funciona igual estimando la demanda con el promedio de ventas.\n" +
      "[dev] Para activarlo, sigue la sección de instalación del README.\n",
  );
}

const children = [];
let closing = false;

/** En Windows npm es un .cmd, y un .cmd solo se lanza a través del shell. */
function commandLine(service) {
  return [service.command, ...service.args]
    .map((part) => (/\s/.test(part) ? `"${part}"` : part))
    .join(" ");
}

for (const service of services) {
  const child = spawn(commandLine(service), {
    cwd: service.cwd ?? root,
    stdio: "inherit",
    shell: true,
  });

  child.on("exit", (code) => {
    if (closing) return;
    console.error(`\n[dev] El servicio "${service.name}" terminó con código ${code}.`);
    stop(code ?? 1);
  });

  children.push(child);
}

console.log(
  "\n[dev] API en http://localhost:3001 · interfaz en http://localhost:5173\n" +
    "[dev] Ctrl+C para detener todo.\n",
);

function stop(code) {
  if (closing) return;
  closing = true;

  for (const child of children) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    // En Windows `kill` no alcanza a los procesos que abre npm por debajo.
    if (isWindows && child.pid) {
      spawn("taskkill", ["/pid", String(child.pid), "/f", "/t"], { stdio: "ignore" });
    } else {
      child.kill("SIGTERM");
    }
  }

  setTimeout(() => process.exit(code), 400);
}

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
