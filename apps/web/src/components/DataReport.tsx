import type { AnalysisResult, ForecastMethod, IngestTableReport } from "../types";
import { amount, formatBytes, percent, whole } from "../lib/format";

const roleCopy: Record<IngestTableReport["role"], string> = {
  sales: "Ventas",
  inventory: "Inventario",
  catalog: "Catálogo de productos",
  both: "Ventas e inventario",
  ignored: "No utilizada",
};

/**
 * Cómo se estimó la demanda, explicado sin jerga.
 *
 * Toda la parte técnica del pronóstico vive aquí y no en las pantallas de
 * negocio: quien quiera revisarla la encuentra, y quien no, no tropieza con
 * ella mientras mira sus números.
 */
const methodCopy: Record<ForecastMethod, { title: string; plain: string }> = {
  machine_learning: {
    title: "Modelo entrenado con tu historial",
    plain:
      "Hay suficiente historial de ventas para entrenar un modelo y comprobar que acierta más que el simple promedio.",
  },
  hybrid_blend: {
    title: "Mezcla de modelo y promedio",
    plain:
      "El modelo y el promedio histórico se combinaron porque juntos acertaron más que cualquiera de los dos por separado.",
  },
  historical_baseline: {
    title: "Promedio histórico",
    plain:
      "El promedio de tus ventas pasadas resultó más confiable que el modelo, así que se usó ese.",
  },
  moving_average: {
    title: "Promedio reciente con tendencia",
    plain:
      "Con el historial disponible se pesan más las semanas recientes y se sigue la tendencia con prudencia.",
  },
  simple_average: {
    title: "Promedio del período",
    plain:
      "El historial es corto, así que la demanda se estima con el promedio diario del período cargado.",
  },
  rules_only: {
    title: "Promedio de tus ventas y reglas de inventario",
    plain:
      "La demanda se estimó con el promedio diario del período, el tiempo de reposición y un inventario de seguridad.",
  },
};

/**
 * El método "reglas de inventario" se usa por dos razones distintas y conviene
 * decir cuál fue: o los datos no traen fechas, o el servicio opcional de
 * pronóstico no está levantado en este entorno.
 */
function methodFor(forecast: AnalysisResult["forecast"]) {
  const base = methodCopy[forecast.method ?? "rules_only"];
  if ((forecast.method ?? "rules_only") !== "rules_only") return base;

  if (forecast.status === "unavailable") {
    return {
      title: base.title,
      plain: `${base.plain} El servicio opcional que afina el pronóstico con un modelo no está activo en este entorno; las decisiones se calculan igual y quedan marcadas como estimación.`,
    };
  }

  return {
    title: base.title,
    plain:
      "Los archivos no traen fechas de venta, así que se leyeron como el total de un período y la demanda se estimó con ese promedio.",
  };
}

export function DataReport({ result }: { result: AnalysisResult }) {
  const { ingest, forecast } = result;
  const method = methodFor(forecast);

  return (
    <div className="tab-panel">
      <section className="card">
        <h2>Qué archivos leímos</h2>
        <p className="section-sub">
          {whole(ingest.salesRows)} líneas de venta y {whole(ingest.inventoryRows)} productos en
          inventario, tomados de {ingest.files.length}{" "}
          {ingest.files.length === 1 ? "archivo" : "archivos"}.
        </p>

        {ingest.errors.length > 0 ? (
          <ul className="warnings errors">
            {ingest.errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        ) : null}

        {ingest.warnings.length > 0 ? (
          <ul className="warnings">
            {ingest.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        ) : null}

        <ul className="file-summary">
          {ingest.files.map((file) => (
            <li key={file.name}>
              <strong>{file.name}</strong>
              <span>
                {file.format} · {formatBytes(file.sizeBytes)} ·{" "}
                {file.tables === 1 ? "1 tabla" : `${file.tables} tablas`}
              </span>
            </li>
          ))}
        </ul>

        <div className="facts">
          <div>
            <span>Productos con ventas</span>
            <strong>{whole(ingest.productsWithSales)}</strong>
          </div>
          <div>
            <span>Cruzados con inventario</span>
            <strong>{whole(ingest.productsMatched)}</strong>
          </div>
          <div>
            <span>Con costo real</span>
            <strong>{percent(Math.round(ingest.costCoverage * 100))} de los productos</strong>
          </div>
          <div>
            <span>Fechas de venta</span>
            <strong>
              {ingest.datesDetected
                ? "Detectadas"
                : `Ausentes · período asumido de ${ingest.assumedPeriodDays} días`}
            </strong>
          </div>
        </div>
      </section>

      <section className="card">
        <h2>Cómo se estimó la demanda</h2>
        <p className="method-title">{method.title}</p>
        <p className="section-sub">{method.plain}</p>

        {forecast.evaluation ? (
          <div className="facts">
            <div>
              <span>Error del método</span>
              <strong>{amount(forecast.evaluation.mae)} unidades</strong>
            </div>
            <div>
              <span>Error del promedio simple</span>
              <strong>{amount(forecast.evaluation.baseline_mae)} unidades</strong>
            </div>
            <div>
              <span>Mejora sobre el promedio</span>
              <strong>{percent(forecast.evaluation.improvement_percent)}</strong>
            </div>
            <div>
              <span>Historial usado</span>
              <strong>{whole(forecast.history_days)} días</strong>
            </div>
          </div>
        ) : null}

        <details>
          <summary>Detalle técnico y supuestos del pronóstico</summary>
          <p>{forecast.message}</p>
          <ul>
            {forecast.assumptions.map((assumption) => (
              <li key={assumption}>{assumption}</li>
            ))}
          </ul>
        </details>
      </section>

      <section className="card">
        <h2>Qué columna se interpretó como qué</h2>
        <p className="section-sub">
          La plataforma reconoce los nombres de las columnas por su contenido. Si algo quedó mal
          interpretado, se ve aquí.
        </p>

        {ingest.tables.map((table) => (
          <div className="ingest-table" key={`${table.source}-${table.sheet ?? ""}`}>
            <h3>
              {table.source}
              {table.sheet ? ` · ${table.sheet}` : ""}
              <span className={`role role-${table.role}`}>{roleCopy[table.role]}</span>
            </h3>
            <p className="ingest-meta">
              Formato {table.format} · separador {table.delimiter} · codificación {table.encoding} ·{" "}
              {table.headerLine > 0
                ? `encabezado en la fila ${table.headerLine}`
                : "sin encabezado, columnas deducidas por contenido"}{" "}
              · {whole(table.rowsUsed)} filas usadas de {whole(table.rowsRead)}
              {table.rowsDiscarded > 0 ? ` (${whole(table.rowsDiscarded)} descartadas)` : ""}
            </p>

            {table.mappings.length > 0 ? (
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Columna del archivo</th>
                      <th>Se interpretó como</th>
                      <th>Certeza</th>
                      <th>Cómo se decidió</th>
                    </tr>
                  </thead>
                  <tbody>
                    {table.mappings.map((mapping) => (
                      <tr key={mapping.column + mapping.field}>
                        <td>
                          <strong>{mapping.column}</strong>
                        </td>
                        <td>{mapping.fieldLabel}</td>
                        <td>
                          <span
                            className={`certainty ${
                              mapping.confidence >= 0.9
                                ? "high"
                                : mapping.confidence >= 0.6
                                  ? "medium"
                                  : "low"
                            }`}
                          >
                            {Math.round(mapping.confidence * 100)}%
                          </span>
                        </td>
                        <td>{mapping.note ?? mapping.method}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            {table.unmappedColumns.length > 0 ? (
              <p className="ingest-meta">
                Columnas no utilizadas: {table.unmappedColumns.join(", ")}
              </p>
            ) : null}

            {table.notes.map((note) => (
              <p className="ingest-note" key={note}>
                {note}
              </p>
            ))}

            {table.issues.map((issue) => (
              <p className={`ingest-note issue-${issue.level}`} key={issue.message}>
                {issue.message} ({whole(issue.count)} {issue.count === 1 ? "fila" : "filas"})
              </p>
            ))}
          </div>
        ))}
      </section>

      <section className="card">
        <h2>Supuestos del análisis</h2>
        <ul className="assumption-list">
          {result.assumptions.map((assumption) => (
            <li key={assumption}>{assumption}</li>
          ))}
        </ul>
        <p className="disclaimer">
          Las cifras son una ayuda para decidir, no una orden de compra. Antes de actuar considera
          pedidos ya emitidos, mínimos del proveedor, descuentos por volumen, impuestos y flete,
          espacio de bodega, efectivo disponible y productos sustitutos.
        </p>
      </section>
    </div>
  );
}
