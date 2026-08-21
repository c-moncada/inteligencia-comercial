import { useMemo, useRef, useState } from "react";
import type {
  AnalysisResult,
  BusinessDecision,
  IngestTableReport,
  ProductAnalysis,
  ResultSource,
} from "./types";

// En el despliegue la API vive en el mismo dominio, bajo /api; en desarrollo
// corre aparte en el puerto 3001.
const API_URL =
  import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? "http://localhost:3001" : "");

const currency = new Intl.NumberFormat("es-HN", {
  style: "currency",
  currency: "HNL",
  maximumFractionDigits: 2,
});

const number = new Intl.NumberFormat("es-HN", { maximumFractionDigits: 2 });

const sourceCopy: Record<ResultSource, { label: string; description: string }> = {
  ml: {
    label: "Usa machine learning",
    description: "Resultado estimado por el modelo con el historial de ventas.",
  },
  rules: {
    label: "No usa ML",
    description: "Resultado calculado con datos reales, fórmulas o reglas configuradas.",
  },
  hybrid: {
    label: "ML + reglas",
    description: "Combina una predicción del modelo con fórmulas financieras o de inventario.",
  },
  baseline: {
    label: "No usa ML · promedio",
    description: "Estimación basada en el promedio histórico porque el modelo no fue seleccionado.",
  },
};

function SourceTag({ source }: { source: ResultSource }) {
  const copy = sourceCopy[source];
  return (
    <span className={`source-tag source-${source}`} title={copy.description}>
      {copy.label}
    </span>
  );
}

function Metric({
  label,
  value,
  detail,
  source,
}: {
  label: string;
  value: string;
  detail?: string;
  source?: ResultSource;
}) {
  return (
    <article className="metric">
      <div className="metric-label">
        <span>{label}</span>
        {source ? <SourceTag source={source} /> : null}
      </div>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </article>
  );
}

function priorityLabel(priority: BusinessDecision["priority"]): string {
  if (priority === "high") return "Urgente";
  if (priority === "medium") return "Importante";
  return "Revisar";
}

function confidenceLabel(confidence: BusinessDecision["confidence"]): string {
  if (confidence === "high") return "Confianza alta";
  if (confidence === "medium") return "Confianza media";
  return "Confianza baja";
}

function deadlineLabel(days: number | null): string {
  if (days === null) return "Sin fecha calculada";
  if (days < 0) return `Pedir hoy · atraso estimado ${Math.abs(days)} días`;
  if (days === 0) return "Decidir hoy";
  if (days === 1) return "Decidir en 1 día";
  return `Decidir en ${days} días`;
}

function trendLabel(product: Pick<ProductAnalysis, "trend" | "trendPercent">): string {
  if (product.trend === "sin datos" || product.trendPercent === null) return "Sin comparación";
  const sign = product.trendPercent > 0 ? "+" : "";
  return `${product.trend} (${sign}${number.format(product.trendPercent)}%)`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const roleCopy: Record<IngestTableReport["role"], string> = {
  sales: "Ventas",
  inventory: "Inventario",
  catalog: "Catálogo de productos",
  both: "Ventas e inventario",
  ignored: "No utilizada",
};

function DecisionCard({
  decision,
  forecastSource,
}: {
  decision: BusinessDecision;
  forecastSource: ResultSource;
}) {
  const hasForecast =
    decision.type !== "liquidate_dead_stock" &&
    decision.forecastExpectedUnits !== null &&
    decision.forecastMinimumUnits !== null &&
    decision.forecastMaximumUnits !== null;

  return (
    <article className={`decision decision-${decision.type}`}>
      <div className="decision-top">
        <div className="badges">
          <span className={`priority ${decision.priority}`}>{priorityLabel(decision.priority)}</span>
          <span className={`confidence ${decision.confidence}`}>
            {confidenceLabel(decision.confidence)}
          </span>
          <SourceTag source={decision.source} />
        </div>
        <div className="impact">
          <small>{decision.impactLabel}</small>
          <strong>{currency.format(decision.impactAmount)}</strong>
        </div>
      </div>

      <h3>{decision.title}</h3>
      <p className="decision-explanation">{decision.explanation}</p>

      {decision.reasons.length > 0 ? (
        <ul className="reasons">
          {decision.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : null}

      {hasForecast ? (
        <div className="forecast-range">
          <div className="forecast-heading">
            <span>Demanda esperada a 30 días</span>
            <SourceTag source={forecastSource} />
          </div>
          <strong>{number.format(decision.forecastExpectedUnits ?? 0)} unidades</strong>
          <small>
            Rango probable: {number.format(decision.forecastMinimumUnits ?? 0)}–
            {number.format(decision.forecastMaximumUnits ?? 0)}
          </small>
        </div>
      ) : null}

      <div className="decision-kpis">
        {decision.type === "restock" ? (
          <>
            <div><span>Compra sugerida</span><strong>{number.format(decision.suggestedPurchase)} unidades</strong></div>
            <div><span>Inversión requerida</span><strong>{currency.format(decision.investmentRequired)}</strong></div>
            <div><span>Ganancia estimada</span><strong>{currency.format(decision.expectedGrossProfit)}</strong></div>
            <div><span>Rentabilidad bruta</span><strong>{number.format(decision.estimatedReturnPercentage)}%</strong></div>
            <div><span>Recuperación estimada</span><strong>{decision.estimatedPaybackDays === null ? "No calculada" : `${number.format(decision.estimatedPaybackDays)} días`}</strong></div>
            <div><span>Plazo para decidir</span><strong>{deadlineLabel(decision.decisionDeadlineDays)}</strong></div>
          </>
        ) : null}

        {decision.type === "pause_purchases" ? (
          <>
            <div><span>Inventario actual</span><strong>{number.format(decision.currentStock)} unidades</strong></div>
            <div><span>Cobertura estimada</span><strong>{decision.daysOfCoverage === null ? "Sin demanda" : `${number.format(decision.daysOfCoverage)} días`}</strong></div>
            <div><span>Compra sugerida</span><strong>0 unidades</strong></div>
            <div><span>Capital detenido</span><strong>{currency.format(decision.trappedCapital)}</strong></div>
          </>
        ) : null}

        {decision.type === "liquidate_dead_stock" ? (
          <>
            <div><span>Inventario actual</span><strong>{number.format(decision.currentStock)} unidades</strong></div>
            <div><span>Última venta</span><strong>{decision.daysSinceLastSale === null ? "Sin ventas en el período" : `Hace ${decision.daysSinceLastSale} días`}</strong></div>
            <div><span>Capital inmovilizado</span><strong>{currency.format(decision.trappedCapital)}</strong></div>
          </>
        ) : null}

        {decision.type === "review_margin" ? (
          <>
            <div><span>Venta esperada 30 días</span><strong>{currency.format(decision.expectedRevenue)}</strong></div>
            <div><span>Ganancia adicional posible</span><strong>{currency.format(decision.marginOpportunity)}</strong></div>
            <div><span>Inventario actual</span><strong>{number.format(decision.currentStock)} unidades</strong></div>
          </>
        ) : null}
      </div>

      <div className="action"><b>Acción recomendada:</b> {decision.recommendedAction}</div>
    </article>
  );
}

function IngestPanel({ result }: { result: AnalysisResult }) {
  const { ingest } = result;

  return (
    <section className="ingest-panel" aria-label="Lectura de los archivos">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Lectura automática</p>
          <h2>Qué se leyó y cómo se interpretó</h2>
        </div>
        <span>
          {ingest.salesRows.toLocaleString("es-HN")} líneas de venta ·{" "}
          {ingest.inventoryRows.toLocaleString("es-HN")} productos en inventario
        </span>
      </div>

      {ingest.warnings.length > 0 ? (
        <ul className="warnings">
          {ingest.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}

      {ingest.errors.length > 0 ? (
        <ul className="warnings errors">
          {ingest.errors.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}

      <div className="ingest-facts">
        <div><span>Archivos leídos</span><strong>{ingest.files.length}</strong></div>
        <div><span>Productos con ventas</span><strong>{ingest.productsWithSales}</strong></div>
        <div><span>Productos cruzados con inventario</span><strong>{ingest.productsMatched}</strong></div>
        <div><span>Costo disponible</span><strong>{Math.round(ingest.costCoverage * 100)}% de los productos</strong></div>
        <div>
          <span>Fechas de venta</span>
          <strong>
            {ingest.datesDetected
              ? "Detectadas"
              : `Ausentes · período asumido de ${ingest.assumedPeriodDays} días`}
          </strong>
        </div>
      </div>

      <details>
        <summary>Detalle de columnas reconocidas</summary>
        {ingest.tables.map((table) => (
          <div className="ingest-table" key={`${table.source}-${table.sheet ?? ""}`}>
            <h4>
              {table.source}
              {table.sheet ? ` · ${table.sheet}` : ""}
              <span className={`role role-${table.role}`}>{roleCopy[table.role]}</span>
            </h4>
            <p className="ingest-meta">
              Formato {table.format} · separador {table.delimiter} · codificación {table.encoding} ·{" "}
              {table.headerLine > 0
                ? `encabezado en la fila ${table.headerLine} con contenido`
                : "sin encabezado, columnas deducidas por contenido"}{" "}
              · {table.rowsUsed} filas usadas de {table.rowsRead}
              {table.rowsDiscarded > 0 ? ` (${table.rowsDiscarded} descartadas)` : ""}
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
                        <td><strong>{mapping.column}</strong></td>
                        <td>{mapping.fieldLabel}</td>
                        <td>
                          <span
                            className={`confidence ${
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
              <p className="ingest-note" key={note}>{note}</p>
            ))}

            {table.issues.map((issue) => (
              <p className={`ingest-note issue-${issue.level}`} key={issue.message}>
                {issue.message} ({issue.count} {issue.count === 1 ? "fila" : "filas"})
              </p>
            ))}
          </div>
        ))}
      </details>
    </section>
  );
}

function App() {
  const [files, setFiles] = useState<File[]>([]);
  const [pastedData, setPastedData] = useState("");
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [errorDetails, setErrorDetails] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  async function readResponse(response: Response): Promise<AnalysisResult> {
    const body = await response.json();
    if (!response.ok) {
      setErrorDetails(Array.isArray(body.details) ? body.details : []);
      throw new Error(body.error ?? "No se pudo completar el análisis.");
    }
    setErrorDetails([]);
    return body;
  }

  function addFiles(incoming: FileList | null) {
    if (!incoming) return;
    setFiles((current) => [...current, ...Array.from(incoming)]);
  }

  function removeFile(index: number) {
    setFiles((current) => current.filter((_, position) => position !== index));
  }

  async function loadDemo() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${API_URL}/api/analysis/demo`);
      setResult(await readResponse(response));
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "Error desconocido.");
    } finally {
      setLoading(false);
    }
  }

  async function analyze() {
    if (files.length === 0 && !pastedData.trim()) {
      setError("Agrega al menos un archivo o pega los datos en el cuadro de texto.");
      return;
    }

    const data = new FormData();
    for (const file of files) data.append("files", file);
    if (pastedData.trim()) {
      data.append(
        "files",
        new Blob([pastedData], { type: "text/csv" }),
        "datos_pegados.csv",
      );
    }

    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${API_URL}/api/analysis/ingest`, {
        method: "POST",
        body: data,
      });
      setResult(await readResponse(response));
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "Error desconocido.");
    } finally {
      setLoading(false);
    }
  }

  const restockForecasts = useMemo(
    () => result?.decisions.filter((decision) => decision.type === "restock") ?? [],
    [result],
  );

  const forecastSource: ResultSource = useMemo(() => {
    if (!result) return "rules";
    if (result.forecast.method === "machine_learning" || result.forecast.method === "hybrid_blend") {
      return "ml";
    }
    if (result.forecast.forecasts.length > 0) return "baseline";
    return "rules";
  }, [result]);

  const hybridSource: ResultSource = forecastSource === "ml" ? "hybrid" : "rules";

  return (
    <main>
      <header>
        <div>
          <p className="eyebrow">MVP 0.4 · Lectura universal de archivos</p>
          <h1>De cualquier exportación a decisiones que impactan el dinero</h1>
          <p className="subtitle">
            Carga los archivos como los exporta tu sistema: CSV, Excel, JSON, texto o datos pegados,
            con cualquier nombre de columna. La plataforma reconoce las columnas, cruza ventas con
            inventario y responde qué comprar, qué dejar de comprar y qué liberar.
          </p>
        </div>
        <button className="secondary" type="button" onClick={loadDemo} disabled={loading}>
          Ver demostración
        </button>
      </header>

      <section className="upload-panel">
        <div
          className={`dropzone ${dragging ? "dragging" : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            addFiles(event.dataTransfer.files);
          }}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") inputRef.current?.click();
          }}
        >
          <strong>Arrastra aquí tus archivos o haz clic para elegirlos</strong>
          <span>
            CSV, TXT, Excel (.xlsx), JSON, HTML o cualquier exportación tabular. Puedes cargar
            varios archivos a la vez y en cualquier orden.
          </span>
          <input
            ref={inputRef}
            type="file"
            multiple
            hidden
            onChange={(event) => {
              addFiles(event.target.files);
              event.target.value = "";
            }}
          />
        </div>

        {files.length > 0 ? (
          <ul className="file-list">
            {files.map((file, index) => (
              <li key={`${file.name}-${index}`}>
                <span>{file.name}</span>
                <small>{formatBytes(file.size)}</small>
                <button
                  type="button"
                  className="link"
                  onClick={() => removeFile(index)}
                  aria-label={`Quitar ${file.name}`}
                >
                  Quitar
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <details className="paste-block">
          <summary>O pega los datos directamente</summary>
          <textarea
            value={pastedData}
            onChange={(event) => setPastedData(event.target.value)}
            placeholder={"Fecha;Producto;Cantidad;Precio;Costo\n01/03/2026;Aceite 1L;3;45.50;32.00"}
            rows={6}
          />
        </details>

        <button type="button" onClick={analyze} disabled={loading}>
          {loading ? "Leyendo y calculando…" : "Analizar mi empresa"}
        </button>
      </section>

      <section className="source-legend" aria-label="Origen de los resultados">
        <div>
          <strong>Cómo leer las etiquetas</strong>
          <span>Cada resultado indica si viene del modelo o de una fórmula controlada.</span>
        </div>
        <div className="source-legend-items">
          <div><SourceTag source="ml" /><small>{sourceCopy.ml.description}</small></div>
          <div><SourceTag source="rules" /><small>{sourceCopy.rules.description}</small></div>
          <div><SourceTag source="hybrid" /><small>{sourceCopy.hybrid.description}</small></div>
          <div><SourceTag source="baseline" /><small>{sourceCopy.baseline.description}</small></div>
        </div>
      </section>

      {error ? (
        <div className="error" role="alert">
          <p>{error}</p>
          {errorDetails.length > 0 ? (
            <ul>
              {errorDetails.map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {result ? (
        <>
          <IngestPanel result={result} />

          <section className="decision-summary" aria-label="Impacto económico estimado">
            <div className="summary-heading">
              <div>
                <p className="eyebrow">Resumen ejecutivo</p>
                <h2>Impacto económico que requiere atención</h2>
              </div>
              <span>
                {result.decisionSummary.urgentActions} acciones urgentes de{" "}
                {result.decisionSummary.totalActions}
              </span>
            </div>
            <div className="metrics executive-metrics">
              <Metric
                label="Capital para liberar"
                value={currency.format(result.decisionSummary.capitalToRelease)}
                detail="Inventario por encima de la cobertura objetivo"
                source="rules"
              />
              <Metric
                label="Inventario sin rotación"
                value={currency.format(result.decisionSummary.deadStockValue)}
                detail="Productos sin ventas recientes"
                source="rules"
              />
              <Metric
                label="Ganancia protegida"
                value={currency.format(result.decisionSummary.profitProtected)}
                detail="Exposición por posibles agotamientos"
                source={hybridSource}
              />
              <Metric
                label="Inversión recomendada"
                value={currency.format(result.decisionSummary.recommendedInvestment)}
                detail="Compras sugeridas por demanda y reposición"
                source={hybridSource}
              />
              <Metric
                label="Ganancia adicional posible"
                value={currency.format(result.decisionSummary.marginOpportunity)}
                detail="Oportunidad al mejorar márgenes bajos"
                source={hybridSource}
              />
            </div>
          </section>

          <section>
            <div className="section-heading">
              <div>
                <p className="eyebrow">Plan de acción</p>
                <h2>Decisiones recomendadas, ordenadas por prioridad</h2>
              </div>
              <span>{result.decisions.length} decisiones</span>
            </div>

            <div className="decisions">
              {result.decisions.map((decision) => (
                <DecisionCard
                  decision={decision}
                  forecastSource={forecastSource}
                  key={decision.id}
                />
              ))}
            </div>
          </section>

          <section className="forecast-business-section">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Reposición basada en demanda</p>
                <h2>Compras sugeridas con impacto financiero</h2>
              </div>
              <span>{restockForecasts.length} productos para evaluar</span>
            </div>

            {restockForecasts.length > 0 ? (
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Producto</th>
                      <th>Demanda probable</th>
                      <th>Origen recomendación</th>
                      <th>Confianza</th>
                      <th>Tendencia</th>
                      <th>Inventario</th>
                      <th>Comprar</th>
                      <th>Inversión</th>
                      <th>Ganancia estimada</th>
                      <th>Plazo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {restockForecasts.map((item) => (
                      <tr key={item.id}>
                        <td><strong>{item.productName}</strong></td>
                        <td>
                          <div className="value-with-source">
                            <span>
                              {number.format(item.forecastMinimumUnits ?? 0)}–
                              {number.format(item.forecastMaximumUnits ?? 0)} unidades
                            </span>
                            <SourceTag source={item.source} />
                          </div>
                        </td>
                        <td><SourceTag source={item.source} /></td>
                        <td><span className={`confidence ${item.confidence}`}>{confidenceLabel(item.confidence)}</span></td>
                        <td>{item.trend}</td>
                        <td>{number.format(item.currentStock)}</td>
                        <td><strong>{item.suggestedPurchase}</strong></td>
                        <td>{currency.format(item.investmentRequired)}</td>
                        <td>{currency.format(item.expectedGrossProfit)}</td>
                        <td>{deadlineLabel(item.decisionDeadlineDays)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="notice">No se detectaron compras urgentes con los datos cargados.</p>
            )}
          </section>

          <section>
            <div className="section-heading">
              <div>
                <p className="eyebrow">Contexto del análisis</p>
                <h2>Resultados financieros observados</h2>
              </div>
            </div>
            <div className="metrics context-metrics">
              <Metric
                label="Ventas analizadas"
                value={currency.format(result.summary.revenue)}
                detail={`${result.period.days} días de información${result.period.assumed ? " (período asumido)" : ""}`}
                source="rules"
              />
              <Metric
                label="Ganancia bruta histórica"
                value={currency.format(result.summary.grossProfit)}
                detail={`Margen bruto ${result.summary.grossMarginPercent}%`}
                source="rules"
              />
              <Metric
                label="Valor del inventario"
                value={currency.format(result.summary.inventoryValue)}
                detail={`${result.summary.productsWithoutSales} productos sin ventas en el período`}
                source="rules"
              />
              <Metric
                label="Productos analizados"
                value={number.format(result.summary.productsAnalyzed)}
                detail={`${result.period.from} a ${result.period.to}`}
                source="rules"
              />
            </div>
          </section>

          <section>
            <div className="section-heading">
              <div>
                <p className="eyebrow">Detalle</p>
                <h2>Rentabilidad e inventario por producto</h2>
              </div>
              <span>Clase A: concentra la ganancia · Clase C: aporta poco</span>
            </div>
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>Clase</th>
                    <th>Ventas</th>
                    <th>Ganancia</th>
                    <th>Margen</th>
                    <th>Tendencia</th>
                    <th>Demanda 30 días</th>
                    <th>Cobertura</th>
                    <th>Última venta</th>
                    <th>Compra sugerida</th>
                  </tr>
                </thead>
                <tbody>
                  {result.products.map((product) => (
                    <tr key={product.productId}>
                      <td>
                        {product.productName}
                        {product.costKnown ? null : <small className="flag"> sin costo</small>}
                      </td>
                      <td><span className={`abc abc-${product.abcClass}`}>{product.abcClass}</span></td>
                      <td>{currency.format(product.revenue)}</td>
                      <td>{currency.format(product.grossProfit)}</td>
                      <td>{product.marginPercent}%</td>
                      <td>{trendLabel(product)}</td>
                      <td>
                        <div className="value-with-source">
                          <span>{number.format(product.predictedDemand30Days)} unidades</span>
                          <SourceTag source={forecastSource} />
                        </div>
                      </td>
                      <td>{product.coverageDays === null ? "Sin demanda" : `${number.format(product.coverageDays)} días`}</td>
                      <td>
                        {product.daysSinceLastSale === null
                          ? product.hasSales
                            ? "Sin fechas"
                            : "Sin ventas"
                          : `Hace ${product.daysSinceLastSale} días`}
                      </td>
                      <td>{product.suggestedPurchase} unidades</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <details className="technical-details">
            <summary>
              Estado técnico del modelo
              {result.forecast.method_label ? ` · ${result.forecast.method_label}` : ""}
            </summary>
            <p>{result.forecast.message}</p>
            {result.forecast.evaluation ? (
              <div className="technical-grid">
                <Metric
                  label="Error del método (MAE)"
                  value={`${number.format(result.forecast.evaluation.mae)} unidades`}
                  source={forecastSource}
                />
                <Metric
                  label="Error de referencia"
                  value={`${number.format(result.forecast.evaluation.baseline_mae)} unidades`}
                  source="baseline"
                />
                <Metric
                  label="Mejora"
                  value={`${number.format(result.forecast.evaluation.improvement_percent)}%`}
                  source="rules"
                />
                <Metric
                  label="Método usado"
                  value={result.forecast.method_label ?? result.forecast.evaluation.selected_method}
                  source={forecastSource}
                />
              </div>
            ) : null}
            <ul>
              {result.forecast.assumptions.map((assumption) => (
                <li key={assumption}>{assumption}</li>
              ))}
            </ul>
          </details>

          <details>
            <summary>Supuestos del análisis financiero</summary>
            <ul>
              {result.assumptions.map((assumption) => (
                <li key={assumption}>{assumption}</li>
              ))}
            </ul>
          </details>
        </>
      ) : (
        <section className="empty-state">
          <h2>Empieza con la demostración</h2>
          <p>
            Verás recomendaciones de compra, capital detenido, inventario sin rotación y
            oportunidades de margen expresadas en lempiras. La demostración usa exportaciones
            desordenadas a propósito para mostrar cómo se reconocen las columnas.
          </p>
        </section>
      )}
    </main>
  );
}

export default App;
