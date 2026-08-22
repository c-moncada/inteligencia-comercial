import express from "express";
import multer from "multer";
import { analyzeBusinessData } from "./analyze.js";
import { buildBusinessOverview } from "./business.js";
import { buildBusinessDecisions, mergeForecastIntoProducts } from "./decisions.js";
import { demoFiles } from "./demo.js";
import type { IngestOutcome, SourceFile } from "./ingest/index.js";
import { IngestError, ingestFiles } from "./ingest/index.js";
import { requestDemandForecast } from "./ml.js";
import type { AnalysisResult, DemandForecastResult } from "./types.js";

export const VERSION = "0.5.0";

function forecastWithoutDates(reason: string): DemandForecastResult {
  return {
    status: "rules_only",
    message: reason,
    history_days: 0,
    minimum_history_days: 120,
    evaluation: null,
    forecasts: [],
    assumptions: [
      "La demanda se estimó con el promedio del período cargado, sin modelo entrenado.",
      "El rango probable se abre a un 35% porque no hay historial para medir el error.",
    ],
    method: "rules_only",
    method_label: "Reglas de inventario",
  };
}

async function analyzeDataset(outcome: IngestOutcome): Promise<AnalysisResult> {
  const financial = analyzeBusinessData(outcome.sales, outcome.inventory, {
    periodDaysOverride: outcome.assumedPeriodDays,
    productsWithoutCost: outcome.productsWithoutCost,
  });

  const forecast = outcome.datesDetected
    ? await requestDemandForecast(outcome.sales, outcome.inventory)
    : forecastWithoutDates(
        "Los datos cargados no traen fechas de venta, así que no se entrenó el modelo de demanda. Las cifras provienen de reglas de inventario sobre el período asumido.",
      );

  const merged = mergeForecastIntoProducts(financial, forecast);
  const { decisions, summary: decisionSummary } = buildBusinessDecisions(merged, forecast);
  const overview = buildBusinessOverview(merged, outcome.sales, outcome.datesDetected);

  return {
    ...merged,
    forecast,
    decisions,
    decisionSummary,
    ingest: outcome.report,
    overview,
  };
}

function filesFromRequest(request: express.Request): SourceFile[] {
  const uploaded = request.files;
  const files: SourceFile[] = [];

  if (Array.isArray(uploaded)) {
    for (const file of uploaded) {
      files.push({ name: file.originalname || "archivo", buffer: file.buffer });
    }
  } else if (uploaded && typeof uploaded === "object") {
    for (const group of Object.values(uploaded)) {
      for (const file of group) {
        files.push({ name: file.originalname || "archivo", buffer: file.buffer });
      }
    }
  }

  if (files.length > 0) return files;

  // Datos pegados o enviados como JSON desde otra aplicación.
  const body = request.body as unknown;

  if (typeof body === "string" && body.trim()) {
    return [{ name: "datos pegados", buffer: Buffer.from(body, "utf8") }];
  }

  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;

    if (typeof record.text === "string" && record.text.trim()) {
      return [{ name: "datos pegados", buffer: Buffer.from(record.text, "utf8") }];
    }

    if (Array.isArray(record.files)) {
      for (const entry of record.files) {
        if (!entry || typeof entry !== "object") continue;
        const item = entry as { name?: unknown; content?: unknown };
        if (typeof item.content !== "string") continue;
        files.push({
          name: typeof item.name === "string" ? item.name : "archivo",
          buffer: Buffer.from(item.content, "utf8"),
        });
      }
      if (files.length > 0) return files;
    }

    if (Array.isArray(record.sales) || Array.isArray(record.inventory)) {
      return [
        { name: "datos en JSON", buffer: Buffer.from(JSON.stringify(record), "utf8") },
      ];
    }
  }

  return [];
}

function handleError(response: express.Response, error: unknown): void {
  if (error instanceof IngestError) {
    response.status(400).json({ error: error.message, details: error.details });
    return;
  }

  const message = error instanceof Error ? error.message : "Error desconocido.";
  response.status(400).json({ error: message });
}

/** Crea la aplicación de Express, sin ponerla a escuchar en un puerto. */
export function createApp(): express.Express {
  const app = express();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024, files: 12 },
  });

  app.use((_request, response, next) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");
    response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    next();
  });
  app.use(express.json({ limit: "32mb" }));
  app.use(express.text({ limit: "32mb", type: ["text/plain", "text/csv"] }));

  app.get("/api/health", (_request, response) => {
    response.json({ ok: true, version: VERSION });
  });

  app.get("/api/analysis/demo", async (request, response) => {
    try {
      const outcome = ingestFiles(demoFiles(), {
        defaultLeadTimeDays: Number(request.query.leadTime ?? 7) || 7,
      });
      response.json(await analyzeDataset(outcome));
    } catch (error) {
      handleError(response, error);
    }
  });

  /**
   * Punto de entrada universal: acepta cualquier cantidad de archivos, en
   * cualquier formato y con cualquier nombre de campo, o datos pegados como
   * texto o JSON. El sistema decide qué es venta y qué es inventario.
   */
  const ingestHandler: express.RequestHandler = async (request, response) => {
    try {
      const files = filesFromRequest(request);
      if (files.length === 0) {
        response.status(400).json({
          error:
            "Adjunta al menos un archivo (CSV, Excel, JSON o texto) o envía los datos como texto pegado.",
        });
        return;
      }

      const outcome = ingestFiles(files, {
        defaultLeadTimeDays: Number(request.query.leadTime ?? 7) || 7,
        assumedPeriodDays: Number(request.query.periodDays ?? 30) || 30,
      });
      response.json(await analyzeDataset(outcome));
    } catch (error) {
      handleError(response, error);
    }
  };

  app.post("/api/analysis/ingest", upload.any(), ingestHandler);

  /** Se mantiene la ruta anterior para no romper integraciones existentes. */
  app.post("/api/analysis/upload", upload.any(), ingestHandler);

  return app;
}
