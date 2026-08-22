import { useRef, useState } from "react";
import { formatBytes } from "../lib/format";

/**
 * Vercel corta en 4.5 MB el cuerpo de cualquier solicitud a una función
 * serverless. Es un límite de la plataforma, no del plan contratado, así que
 * conviene avisar antes de intentar la carga y no después del error.
 */
const HOSTED_UPLOAD_LIMIT = 4.5 * 1024 * 1024;

export function UploadPanel({
  files,
  onAddFiles,
  onRemoveFile,
  pasted,
  onPastedChange,
  leadTime,
  onLeadTimeChange,
  onAnalyze,
  onDemo,
  loading,
}: {
  files: File[];
  onAddFiles: (incoming: FileList | null) => void;
  onRemoveFile: (index: number) => void;
  pasted: string;
  onPastedChange: (value: string) => void;
  leadTime: number;
  onLeadTimeChange: (value: number) => void;
  onAnalyze: () => void;
  onDemo: () => void;
  loading: boolean;
}) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  const tooLargeForHosting = !import.meta.env.DEV && totalBytes > HOSTED_UPLOAD_LIMIT;

  return (
    <section className="upload-panel">
      <div
        className={`dropzone ${dragging ? "is-dragging" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          onAddFiles(event.dataTransfer.files);
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
          Las exportaciones tal como salen de tu sistema: Excel, CSV, TXT, JSON o HTML. Puedes
          soltar ventas e inventario juntos, en cualquier orden.
        </span>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          onChange={(event) => {
            onAddFiles(event.target.files);
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
                onClick={() => onRemoveFile(index)}
                aria-label={`Quitar ${file.name}`}
              >
                Quitar
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {tooLargeForHosting ? (
        <p className="warnings">
          Los archivos suman {formatBytes(totalBytes)}. La versión en línea acepta hasta 4.5 MB
          por análisis. Guardar la exportación como <b>.xlsx</b> en vez de CSV la reduce alrededor
          de un 30%; si con eso no alcanza, exporta por trimestre o corre la plataforma en tu
          computadora, donde el límite es de 25 MB por archivo.
        </p>
      ) : null}

      <div className="upload-extras">
        <details className="paste-block">
          <summary>O pega los datos directamente</summary>
          <textarea
            value={pasted}
            onChange={(event) => onPastedChange(event.target.value)}
            placeholder={"Fecha;Producto;Cantidad;Precio;Costo\n01/03/2026;Aceite 1L;3;45.50;32.00"}
            rows={6}
          />
        </details>

        <label className="lead-time">
          <span>¿Cuántos días tarda en llegar un pedido a tu proveedor?</span>
          <input
            type="number"
            min={1}
            max={180}
            value={leadTime}
            onChange={(event) => onLeadTimeChange(Number(event.target.value) || 1)}
          />
          <small>
            Con este dato se calcula cuándo hay que pedir para no quedarse sin producto. Si el
            archivo de inventario ya lo trae, manda el del archivo.
          </small>
        </label>
      </div>

      <div className="upload-actions">
        <button type="button" onClick={onAnalyze} disabled={loading}>
          {loading ? "Leyendo y calculando…" : "Analizar mi negocio"}
        </button>
        <button type="button" className="secondary" onClick={onDemo} disabled={loading}>
          Ver una demostración
        </button>
      </div>
    </section>
  );
}
