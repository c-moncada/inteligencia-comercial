/**
 * Gráficos dibujados con SVG.
 *
 * No se usa ninguna librería de gráficos: el proyecto se despliega como sitio
 * estático y cada dependencia extra pesa en la carga inicial. Con SVG plano se
 * controla el detalle y el resultado se imprime bien.
 */

import { useState } from "react";
import type { HealthLevel, InventoryBreakdown, TimelinePoint } from "../types";
import { amount, money, moneyShort, percent } from "../lib/format";

const WIDTH = 880;

function niceCeiling(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

/** Evolución de ventas y ganancia a lo largo del período cargado. */
export function TrendChart({
  points,
  granularityLabel,
}: {
  points: TimelinePoint[];
  granularityLabel: string;
}) {
  const [active, setActive] = useState<number | null>(null);

  if (points.length < 2) return null;

  const height = 280;
  const padding = { top: 18, right: 18, bottom: 38, left: 68 };
  const plotWidth = WIDTH - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const top = niceCeiling(Math.max(...points.map((point) => point.revenue)));
  const x = (index: number) =>
    padding.left + (points.length === 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth);
  const y = (value: number) => padding.top + plotHeight - (value / top) * plotHeight;

  const line = (key: "revenue" | "grossProfit") =>
    points.map((point, index) => `${index === 0 ? "M" : "L"}${x(index)},${y(point[key])}`).join(" ");

  const area = `${line("revenue")} L${x(points.length - 1)},${padding.top + plotHeight} L${x(0)},${padding.top + plotHeight} Z`;

  const gridValues = [0, 0.25, 0.5, 0.75, 1].map((ratio) => ratio * top);
  const tickStep = Math.max(1, Math.ceil(points.length / 7));
  const activePoint = active === null ? null : points[active];

  return (
    <figure className="chart">
      <figcaption>
        <span>Ventas y ganancia {granularityLabel}</span>
        <div className="chart-legend">
          <span className="legend-item legend-revenue">Ventas</span>
          <span className="legend-item legend-profit">Ganancia</span>
        </div>
      </figcaption>

      <div className="chart-canvas">
        <svg viewBox={`0 0 ${WIDTH} ${height}`} role="img" aria-label="Evolución de las ventas">
          <defs>
            <linearGradient id="revenue-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-revenue)" stopOpacity="0.28" />
              <stop offset="100%" stopColor="var(--chart-revenue)" stopOpacity="0.02" />
            </linearGradient>
          </defs>

          {gridValues.map((value) => (
            <g key={value}>
              <line
                x1={padding.left}
                x2={WIDTH - padding.right}
                y1={y(value)}
                y2={y(value)}
                className="grid-line"
              />
              <text x={padding.left - 12} y={y(value) + 4} className="axis-label" textAnchor="end">
                {moneyShort(value)}
              </text>
            </g>
          ))}

          <path d={area} fill="url(#revenue-fill)" />
          <path d={line("revenue")} className="series series-revenue" />
          <path d={line("grossProfit")} className="series series-profit" />

          {points.map((point, index) =>
            index % tickStep === 0 || index === points.length - 1 ? (
              <text
                key={point.date}
                x={x(index)}
                y={height - 12}
                className="axis-label"
                textAnchor="middle"
              >
                {point.label}
              </text>
            ) : null,
          )}

          {activePoint ? (
            <g>
              <line
                x1={x(active!)}
                x2={x(active!)}
                y1={padding.top}
                y2={padding.top + plotHeight}
                className="hover-line"
              />
              <circle cx={x(active!)} cy={y(activePoint.revenue)} r="5" className="dot dot-revenue" />
              <circle
                cx={x(active!)}
                cy={y(activePoint.grossProfit)}
                r="5"
                className="dot dot-profit"
              />
            </g>
          ) : null}

          <rect
            x={padding.left}
            y={padding.top}
            width={plotWidth}
            height={plotHeight}
            fill="transparent"
            onMouseLeave={() => setActive(null)}
            onMouseMove={(event) => {
              const box = event.currentTarget.getBoundingClientRect();
              const ratio = (event.clientX - box.left) / box.width;
              const index = Math.round(ratio * (points.length - 1));
              setActive(Math.min(points.length - 1, Math.max(0, index)));
            }}
          />
        </svg>

        {activePoint ? (
          <div
            className="chart-tooltip"
            // Se limita a los extremos para que el globo no se salga de la tarjeta.
            style={{ left: `${Math.min(90, Math.max(10, (x(active!) / WIDTH) * 100))}%` }}
            role="status"
          >
            <strong>{activePoint.label}</strong>
            <span>Ventas: {money(activePoint.revenue)}</span>
            <span>Ganancia: {money(activePoint.grossProfit)}</span>
            <span>{amount(activePoint.units)} unidades</span>
          </div>
        ) : null}
      </div>
    </figure>
  );
}

/** Reparto del inventario entre lo que rota, lo que sobra y lo detenido. */
export function InventoryBar({ breakdown }: { breakdown: InventoryBreakdown }) {
  if (breakdown.total <= 0) return null;

  const segments = [
    {
      id: "healthy",
      label: "Se está moviendo",
      value: breakdown.healthy,
      help: "Inventario dentro de la cobertura objetivo.",
    },
    {
      id: "excess",
      label: "De más",
      value: breakdown.excess,
      help: "Existencia por encima de 90 días de venta.",
    },
    {
      id: "dead",
      label: "Detenido",
      value: breakdown.dead,
      help: "Productos sin ventas recientes.",
    },
  ].filter((segment) => segment.value > 0);

  return (
    <figure className="chart chart-inventory">
      <figcaption>
        <span>En qué está tu inventario</span>
        <strong>{money(breakdown.total)} al costo</strong>
      </figcaption>

      <div className="stacked-bar" role="img" aria-label="Composición del inventario">
        {segments.map((segment) => (
          <div
            key={segment.id}
            className={`stacked-segment segment-${segment.id}`}
            style={{ flexGrow: segment.value }}
            title={`${segment.label}: ${money(segment.value)}`}
          />
        ))}
      </div>

      <ul className="stacked-legend">
        {segments.map((segment) => (
          <li key={segment.id}>
            <span className={`legend-dot segment-${segment.id}`} />
            <div>
              <strong>{segment.label}</strong>
              <span>
                {money(segment.value)} · {percent((segment.value / breakdown.total) * 100)}
              </span>
              <small>{segment.help}</small>
            </div>
          </li>
        ))}
      </ul>
    </figure>
  );
}

/** Puntaje general del negocio como un anillo. */
export function ScoreRing({ score, level }: { score: number; level: HealthLevel }) {
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const filled = (Math.min(100, Math.max(0, score)) / 100) * circumference;

  return (
    <div className={`score-ring level-${level}`}>
      <svg viewBox="0 0 130 130" role="img" aria-label={`Puntaje del negocio: ${score} de 100`}>
        <circle cx="65" cy="65" r={radius} className="ring-track" />
        <circle
          cx="65"
          cy="65"
          r={radius}
          className="ring-value"
          strokeDasharray={`${filled} ${circumference - filled}`}
          transform="rotate(-90 65 65)"
        />
        <text x="65" y="62" className="ring-score" textAnchor="middle">
          {score}
        </text>
        <text x="65" y="84" className="ring-caption" textAnchor="middle">
          de 100
        </text>
      </svg>
    </div>
  );
}

/** Barra proporcional que acompaña a cada producto de una lista destacada. */
export function ValueBar({ value, max, tone }: { value: number; max: number; tone: string }) {
  const width = max > 0 ? Math.max(3, (Math.abs(value) / max) * 100) : 0;
  return (
    <div className="value-bar">
      <div className={`value-bar-fill tone-${tone}`} style={{ width: `${width}%` }} />
    </div>
  );
}
