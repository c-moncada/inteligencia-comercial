import type {
  DemandForecastResult,
  InventoryRow,
  SaleRow,
} from "./types.js";

const ML_SERVICE_URL = process.env.ML_SERVICE_URL ?? "http://localhost:8000";

export async function requestDemandForecast(
  sales: SaleRow[],
  inventory: InventoryRow[],
): Promise<DemandForecastResult> {
  try {
    const response = await fetch(`${ML_SERVICE_URL}/api/ml/forecast`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sales, inventory }),
      signal: AbortSignal.timeout(30_000),
    });

    const body = (await response.json()) as DemandForecastResult & {
      detail?: string;
    };

    if (!response.ok) {
      throw new Error(body.detail ?? "El servicio de machine learning rechazó los datos.");
    }

    return body;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido.";
    return {
      status: "unavailable",
      message: `El servicio de machine learning no está disponible (${message}). Las decisiones se calcularon con reglas de inventario sobre el historial cargado.`,
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
}
