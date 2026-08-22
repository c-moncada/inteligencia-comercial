/**
 * Ejecuta el servicio de pronóstico usando el Python del entorno virtual.
 *
 * Sin esto hay que acordarse de activar el `.venv` antes de cada comando, y
 * `npm test` falla con "No module named pytest" aunque el proyecto esté bien.
 *
 * Uso: node scripts/ml.mjs serve | test
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const mlDir = join(root, "apps", "ml");
const isWindows = process.platform === "win32";

const venvPython = isWindows
  ? join(mlDir, ".venv", "Scripts", "python.exe")
  : join(mlDir, ".venv", "bin", "python");

const mode = process.argv[2] ?? "serve";

if (!existsSync(venvPython)) {
  console.log(
    "\nEl entorno de Python del servicio de pronóstico no está instalado, así que se omite.\n" +
      "Es opcional: la plataforma analiza igual estimando la demanda con el promedio de ventas.\n" +
      "Para instalarlo, sigue la sección \"Instalación\" del README.\n",
  );
  process.exit(mode === "test" ? 0 : 1);
}

const args =
  mode === "test"
    ? ["-m", "pytest", "-q"]
    : ["-m", "uvicorn", "app.main:app", "--reload", "--port", "8000"];

const result = spawnSync(venvPython, args, { cwd: mlDir, stdio: "inherit" });
process.exit(result.status ?? 1);
