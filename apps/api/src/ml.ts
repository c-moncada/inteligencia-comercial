import type {
  DemandForecastResult,
  InventoryRow,
  SaleRow,
} from "./types.js";

/**
 * Dirección del servicio de pronóstico.
 *
 * En local se asume el puerto 8000. En un despliegue solo se llama si la
 * variable ML_SERVICE_URL está configurada: así el entorno en línea responde de
 * inmediato con reglas de inventario en vez de esperar una conexión que no
 * existe.
 */
const configuredUrl = process.env.ML_SERVICE_URL?.trim();
const ML_SERVICE_URL =
  configuredUrl ?? (process.env.VERCEL ? "" : "http://localhost:8000");

/**
 * Cuánto se espera al modelo antes de resolver con reglas.
 *
 * Entrenar sobre miles de productos toma minutos, y nadie se queda mirando una
 * pantalla en blanco tanto rato. Se da más tiempo cuando hay más historial,
 * pero con un tope: pasado eso se responde con el promedio de ventas y se
 * explica por qué, en vez de dejar la solicitud colgada.
 */
const BASE_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;

function timeoutFor(rows: number): number {
  return Math.min(MAX_TIMEOUT_MS, BASE_TIMEOUT_MS + Math.floor(rows / 2_000) * 1_000);
}

function isTimeout(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === "TimeoutError" || /timeout|abort/i.test(error.message);
}

function withoutModel(message: string): DemandForecastResult {
  return {
    status: "unavailable",
    message,
    history_days: 0,
    minimum_history_days: 120,
    evaluation: null,
    forecasts: [],
    assumptions: [
      "La demanda se estimó con el promedio diario del período cargado.",
      "El rango probable se abre a un 35% porque no hubo evaluación del modelo.",
    ],
    method: "rules_only",
    method_label: "Reglas de inventario",
  };
}

export async function requestDemandForecast(
  sales: SaleRow[],
  inventory: InventoryRow[],
): Promise<DemandForecastResult> {
  if (!ML_SERVICE_URL) {
    return withoutModel(
      "Este entorno no tiene configurado el servicio de machine learning. Las decisiones se calcularon con reglas de inventario sobre el historial cargado.",
    );
  }

  try {
    const response = await fetch(`${ML_SERVICE_URL}/api/ml/forecast`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sales, inventory }),
      signal: AbortSignal.timeout(timeoutFor(sales.length)),
    });

    const body = (await response.json()) as DemandForecastResult & {
      detail?: string;
    };

    if (!response.ok) {
      throw new Error(body.detail ?? "El servicio de machine learning rechazó los datos.");
    }

    return body;
  } catch (error) {
    // Que se acabe el tiempo no es lo mismo que no tener el servicio: decirlo
    // igual mandaría a revisar una instalación que está perfectamente bien.
    if (isTimeout(error)) {
      const seconds = Math.round(timeoutFor(sales.length) / 1000);
      return withoutModel(
        `El modelo no terminó de entrenarse dentro de los ${seconds} segundos disponibles: son ${sales.length.toLocaleString("es-HN")} líneas de venta. La demanda se estimó con el promedio del período. Para usar el modelo, analiza un período más corto o menos productos a la vez.`,
      );
    }

    const message = error instanceof Error ? error.message : "Error desconocido.";
    return withoutModel(
      `El servicio de machine learning no está disponible (${message}). Las decisiones se calcularon con reglas de inventario sobre el historial cargado.`,
    );
  }
}
