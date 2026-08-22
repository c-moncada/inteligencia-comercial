import type { AnalysisResult, ProductRanking, RankedProduct } from "../types";
import { amount, money, percent } from "../lib/format";
import { InventoryBar, ScoreRing, TrendChart, ValueBar } from "./Charts";

const rankingTone: Record<ProductRanking["id"], string> = {
  fast_moving: "good",
  high_margin: "profit",
  slow_moving: "risk",
  top_profit: "accent",
};

function Kpi({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint: string;
  tone?: string;
}) {
  return (
    <article className={`kpi tone-${tone}`}>
      <span className="kpi-label">{label}</span>
      <strong className="kpi-value">{value}</strong>
      <small className="kpi-hint">{hint}</small>
    </article>
  );
}

function RankingCard({
  ranking,
  onSelectProduct,
}: {
  ranking: ProductRanking;
  onSelectProduct: (product: RankedProduct) => void;
}) {
  const max = Math.max(...ranking.items.map((item) => Math.abs(item.value)), 0);
  const tone = rankingTone[ranking.id];

  return (
    <article className={`ranking-card tone-${tone}`}>
      <header>
        <h3>{ranking.title}</h3>
        <p className="ranking-question">{ranking.question}</p>
      </header>

      {ranking.items.length === 0 ? (
        <p className="ranking-empty">{ranking.emptyMessage}</p>
      ) : (
        <ol className="ranking-list">
          {ranking.items.map((item, index) => (
            <li key={item.productId}>
              <button type="button" onClick={() => onSelectProduct(item)}>
                <span className="ranking-position">{index + 1}</span>
                <span className="ranking-body">
                  <span className="ranking-name">
                    {item.productName}
                    {item.abcClass === "A" ? <span className="tag tag-a">Clase A</span> : null}
                  </span>
                  <span className="ranking-value">{item.valueLabel}</span>
                  <ValueBar value={item.value} max={max} tone={tone} />
                  <span className="ranking-detail">{item.detail}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}

      <details className="ranking-note">
        <summary>¿Cómo se calcula?</summary>
        <p>{ranking.note}</p>
      </details>
    </article>
  );
}

export function Overview({
  result,
  onSelectProduct,
  onGoToPlan,
}: {
  result: AnalysisResult;
  onSelectProduct: (product: RankedProduct) => void;
  onGoToPlan: () => void;
}) {
  const { overview, summary, period, decisionSummary } = result;
  const { health, inventoryBreakdown } = overview;
  const idleCapital = inventoryBreakdown.excess + inventoryBreakdown.dead;

  return (
    <div className="tab-panel">
      <section className={`health-hero level-${health.level}`}>
        <ScoreRing score={health.score} level={health.level} />

        <div className="health-copy">
          <p className="eyebrow">
            {period.assumed
              ? `Período asumido de ${period.days} días`
              : `${period.days} días analizados`}
          </p>
          <h2>{health.headline}</h2>
          <p>{health.summary}</p>

          {decisionSummary.totalActions > 0 ? (
            <button type="button" className="ghost" onClick={onGoToPlan}>
              Ver las {decisionSummary.totalActions} acciones recomendadas
              {decisionSummary.urgentActions > 0
                ? ` · ${decisionSummary.urgentActions} urgentes`
                : ""}
            </button>
          ) : null}
        </div>

        <ul className="health-points">
          {health.points.map((point) => (
            <li key={point.id} className={`level-${point.level}`}>
              <span className="health-point-label">{point.label}</span>
              <strong>{point.value}</strong>
              <small>{point.message}</small>
            </li>
          ))}
        </ul>
      </section>

      <section className="kpi-grid" aria-label="Cifras del período">
        <Kpi
          label="Vendiste"
          value={money(summary.revenue)}
          hint={`${amount(summary.productsAnalyzed)} productos analizados`}
          tone="accent"
        />
        <Kpi
          label="Ganancia bruta"
          value={money(summary.grossProfit)}
          hint={`Margen de ${percent(summary.grossMarginPercent)} sobre la venta`}
          tone="good"
        />
        <Kpi
          label="Valor del inventario"
          value={money(inventoryBreakdown.total)}
          hint={
            overview.inventoryTurnsPerYear === null
              ? "Al costo de compra"
              : `Se renueva ${amount(overview.inventoryTurnsPerYear)} veces al año`
          }
          tone="neutral"
        />
        <Kpi
          label="Dinero detenido"
          value={money(idleCapital)}
          hint={
            inventoryBreakdown.total > 0
              ? `${percent((idleCapital / inventoryBreakdown.total) * 100)} de tu inventario`
              : "Sin inventario cargado"
          }
          tone={idleCapital > 0 ? "risk" : "good"}
        />
        <Kpi
          label="Ganancia expuesta"
          value={money(summary.profitAtRisk)}
          hint="Se pierde si los productos se agotan antes de reponer"
          tone={summary.profitAtRisk > 0 ? "watch" : "good"}
        />
        <Kpi
          label="Compras sugeridas"
          value={money(decisionSummary.recommendedInvestment)}
          hint="Inversión para sostener la venta de los próximos 30 días"
          tone="accent"
        />
      </section>

      {overview.highlights.length > 0 ? (
        <section className="highlights" aria-label="Resumen en palabras">
          <h2>Lo que conviene saber</h2>
          <ul>
            {overview.highlights.map((highlight) => (
              <li key={highlight}>{highlight}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="chart-row">
        <TrendChart
          points={overview.timeline.points}
          granularityLabel={overview.timeline.granularityLabel}
        />
        <InventoryBar breakdown={inventoryBreakdown} />
      </div>

      {overview.timeline.points.length < 2 ? (
        <p className="notice">
          Los archivos cargados no traen fechas de venta, así que no se puede dibujar la evolución
          en el tiempo. Agrega la columna de fecha a la exportación de ventas para ver cómo se
          mueve el negocio semana a semana.
        </p>
      ) : null}

      <section aria-label="Productos destacados">
        <div className="section-heading">
          <div>
            <h2>Tus productos, ordenados por lo que importa</h2>
            <p className="section-sub">
              Toca cualquier producto para verlo en el detalle completo.
            </p>
          </div>
        </div>

        <div className="ranking-grid">
          {overview.rankings.map((ranking) => (
            <RankingCard
              key={ranking.id}
              ranking={ranking}
              onSelectProduct={onSelectProduct}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
