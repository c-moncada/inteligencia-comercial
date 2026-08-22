import { useState } from "react";
import type { AnalysisResult, RankedProduct } from "./types";
import { longDate, money } from "./lib/format";
import { ActionPlan } from "./components/ActionPlan";
import { DataReport } from "./components/DataReport";
import { Overview } from "./components/Overview";
import { ProductExplorer } from "./components/ProductExplorer";
import { UploadPanel } from "./components/UploadPanel";

// En el despliegue la API vive en el mismo dominio, bajo /api; en desarrollo
// corre aparte en el puerto 3001.
const API_URL =
  import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? "http://localhost:3001" : "");

type Tab = "overview" | "plan" | "products" | "data";

const tabs: { id: Tab; label: string }[] = [
  { id: "overview", label: "Resumen" },
  { id: "plan", label: "Qué hacer" },
  { id: "products", label: "Productos" },
  { id: "data", label: "Tus datos" },
];

function Landing({ onDemo, loading }: { onDemo: () => void; loading: boolean }) {
  return (
    <section className="landing">
      <h2>¿Qué vas a ver?</h2>
      <div className="landing-grid">
        <article>
          <h3>Cómo va tu negocio</h3>
          <p>
            Cuánto vendiste, cuánto ganaste de verdad después del costo y qué tan sano está el
            margen, en una sola pantalla.
          </p>
        </article>
        <article>
          <h3>Dónde está tu dinero</h3>
          <p>
            Cuánto vale tu inventario, cuánto se está moviendo y cuánto lleva meses parado sin
            venderse.
          </p>
        </article>
        <article>
          <h3>Qué productos mandan</h3>
          <p>
            Los de mayor rotación, los de mayor margen, los que sostienen la ganancia y los que solo
            ocupan espacio.
          </p>
        </article>
        <article>
          <h3>Qué hacer esta semana</h3>
          <p>
            Qué comprar y cuánto, qué dejar de comprar, qué liquidar y qué precio revisar, ordenado
            por el dinero en juego.
          </p>
        </article>
      </div>
      <p className="landing-hint">
        ¿No tienes los archivos a mano?{" "}
        <button type="button" className="link" onClick={onDemo} disabled={loading}>
          Mira la demostración con datos de ejemplo
        </button>
        .
      </p>
    </section>
  );
}

function App() {
  const [files, setFiles] = useState<File[]>([]);
  const [pasted, setPasted] = useState("");
  const [leadTime, setLeadTime] = useState(7);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [errorDetails, setErrorDetails] = useState<string[]>([]);
  const [tab, setTab] = useState<Tab>("overview");
  const [productSearch, setProductSearch] = useState("");
  const [showUpload, setShowUpload] = useState(true);
  const [sourceLabel, setSourceLabel] = useState("");

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

  function afterAnalysis(analysis: AnalysisResult, label: string) {
    setResult(analysis);
    setSourceLabel(label);
    setTab("overview");
    setProductSearch("");
    setShowUpload(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function loadDemo() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${API_URL}/api/analysis/demo?leadTime=${leadTime}`);
      afterAnalysis(await readResponse(response), "Datos de demostración");
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "Error desconocido.");
    } finally {
      setLoading(false);
    }
  }

  async function analyze() {
    if (files.length === 0 && !pasted.trim()) {
      setError("Agrega al menos un archivo o pega los datos en el cuadro de texto.");
      return;
    }

    const data = new FormData();
    for (const file of files) data.append("files", file);
    if (pasted.trim()) {
      data.append("files", new Blob([pasted], { type: "text/csv" }), "datos_pegados.csv");
    }

    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `${API_URL}/api/analysis/ingest?leadTime=${leadTime}`,
        { method: "POST", body: data },
      );
      const label = files.length > 0 ? files.map((file) => file.name).join(", ") : "Datos pegados";
      afterAnalysis(await readResponse(response), label);
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "Error desconocido.");
    } finally {
      setLoading(false);
    }
  }

  function openProduct(product: RankedProduct) {
    setProductSearch(product.productName);
    setTab("products");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <div>
            <strong>Inteligencia comercial</strong>
            <span>Tus ventas y tu inventario, convertidos en decisiones</span>
          </div>
        </div>

        {result ? (
          <div className="header-meta">
            <div>
              <span>Período analizado</span>
              <strong>
                {result.period.assumed
                  ? `${result.period.days} días asumidos`
                  : `${longDate(result.period.from)} — ${longDate(result.period.to)}`}
              </strong>
            </div>
            <button type="button" className="secondary" onClick={() => setShowUpload((v) => !v)}>
              {showUpload ? "Ocultar carga" : "Analizar otros datos"}
            </button>
          </div>
        ) : null}
      </header>

      <main>
        {!result ? (
          <section className="hero">
            <h1>Mira tu negocio con números claros</h1>
            <p>
              Carga las exportaciones de ventas e inventario tal como salen de tu sistema. En unos
              segundos verás cuánto ganas de verdad, dónde está detenido tu dinero y qué conviene
              hacer primero.
            </p>
          </section>
        ) : null}

        {showUpload ? (
          <UploadPanel
            files={files}
            onAddFiles={addFiles}
            onRemoveFile={removeFile}
            pasted={pasted}
            onPastedChange={setPasted}
            leadTime={leadTime}
            onLeadTimeChange={setLeadTime}
            onAnalyze={analyze}
            onDemo={loadDemo}
            loading={loading}
          />
        ) : null}

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

        {loading ? <p className="loading">Leyendo tus archivos y calculando…</p> : null}

        {!result && !loading ? <Landing onDemo={loadDemo} loading={loading} /> : null}

        {result ? (
          <>
            <div className="analysis-source">
              <span>Analizando</span>
              <strong>{sourceLabel}</strong>
              {result.decisionSummary.urgentActions > 0 ? (
                <em>
                  {result.decisionSummary.urgentActions} acciones urgentes ·{" "}
                  {money(result.decisionSummary.profitProtected)} de ganancia en juego
                </em>
              ) : null}
            </div>

            <nav className="tabs" aria-label="Secciones del análisis">
              {tabs.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={tab === item.id ? "tab is-active" : "tab"}
                  onClick={() => setTab(item.id)}
                  aria-current={tab === item.id ? "page" : undefined}
                >
                  {item.label}
                  {item.id === "plan" && result.decisions.length > 0 ? (
                    <span className="tab-count">{result.decisions.length}</span>
                  ) : null}
                  {item.id === "products" ? (
                    <span className="tab-count">{result.products.length}</span>
                  ) : null}
                </button>
              ))}
            </nav>

            {tab === "overview" ? (
              <Overview
                result={result}
                onSelectProduct={openProduct}
                onGoToPlan={() => setTab("plan")}
              />
            ) : null}
            {tab === "plan" ? <ActionPlan result={result} /> : null}
            {tab === "products" ? (
              <ProductExplorer
                result={result}
                search={productSearch}
                onSearchChange={setProductSearch}
              />
            ) : null}
            {tab === "data" ? <DataReport result={result} /> : null}
          </>
        ) : null}
      </main>

      <footer className="app-footer">
        <p>
          Las cifras son estimaciones de apoyo para decidir, no órdenes de compra. Revisa pedidos
          pendientes, mínimos del proveedor, efectivo disponible y espacio de bodega antes de
          actuar.
        </p>
      </footer>
    </div>
  );
}

export default App;
