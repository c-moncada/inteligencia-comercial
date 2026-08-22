import { useMemo, useState } from "react";
import type { AnalysisResult, BusinessDecision, DecisionType } from "../types";
import { amount, coverageText, deadlineText, money, percent, whole } from "../lib/format";
import { downloadActionPlan } from "../lib/csv";

const typeCopy: Record<DecisionType, { label: string; verb: string }> = {
  restock: { label: "Comprar", verb: "Reponer antes de quedarte sin producto" },
  pause_purchases: { label: "Dejar de comprar", verb: "Ya tienes de sobra" },
  liquidate_dead_stock: { label: "Liberar dinero", verb: "Mercadería parada" },
  review_margin: { label: "Subir el margen", verb: "Vendes mucho y ganas poco" },
};

const priorityCopy: Record<BusinessDecision["priority"], string> = {
  high: "Urgente",
  medium: "Importante",
  low: "Cuando puedas",
};

function KeyNumbers({ decision }: { decision: BusinessDecision }) {
  const rows: { label: string; value: string }[] = [];

  if (decision.type === "restock") {
    rows.push(
      { label: "Cuánto comprar", value: `${whole(decision.suggestedPurchase)} unidades` },
      { label: "Cuánto cuesta", value: money(decision.investmentRequired) },
      { label: "Cuánto deja", value: money(decision.expectedGrossProfit) },
      { label: "Rentabilidad", value: percent(decision.estimatedReturnPercentage) },
      {
        label: "Recupera la inversión en",
        value:
          decision.estimatedPaybackDays === null
            ? "No calculado"
            : `${amount(decision.estimatedPaybackDays)} días`,
      },
      { label: "Plazo para decidir", value: deadlineText(decision.decisionDeadlineDays) },
    );
  }

  if (decision.type === "pause_purchases") {
    rows.push(
      { label: "Existencia actual", value: `${whole(decision.currentStock)} unidades` },
      { label: "Te alcanza para", value: coverageText(decision.daysOfCoverage) },
      { label: "Dinero de más", value: money(decision.trappedCapital) },
      { label: "Cuánto comprar", value: "Nada por ahora" },
    );
  }

  if (decision.type === "liquidate_dead_stock") {
    rows.push(
      { label: "Existencia actual", value: `${whole(decision.currentStock)} unidades` },
      {
        label: "Última venta",
        value:
          decision.daysSinceLastSale === null
            ? "Sin ventas en el período"
            : `Hace ${decision.daysSinceLastSale} días`,
      },
      { label: "Dinero inmovilizado", value: money(decision.trappedCapital) },
    );
  }

  if (decision.type === "review_margin") {
    rows.push(
      { label: "Venta esperada (30 días)", value: money(decision.expectedRevenue) },
      { label: "Ganancia que podrías sumar", value: money(decision.marginOpportunity) },
      { label: "Existencia actual", value: `${whole(decision.currentStock)} unidades` },
    );
  }

  return (
    <div className="decision-numbers">
      {rows.map((row) => (
        <div key={row.label}>
          <span>{row.label}</span>
          <strong>{row.value}</strong>
        </div>
      ))}
    </div>
  );
}

function DecisionCard({
  decision,
  done,
  onToggle,
}: {
  decision: BusinessDecision;
  done: boolean;
  onToggle: () => void;
}) {
  const copy = typeCopy[decision.type];

  // Un "L 0" como cifra principal no le dice nada a nadie: cuando no hay
  // ganancia expuesta se muestra lo que la compra deja.
  const showsProfitInstead =
    decision.type === "restock" &&
    decision.impactAmount <= 0 &&
    decision.expectedGrossProfit > 0;
  const impactLabel = showsProfitInstead ? "Ganancia de la compra" : decision.impactLabel;
  const impactAmount = showsProfitInstead ? decision.expectedGrossProfit : decision.impactAmount;

  return (
    <article className={`decision type-${decision.type} ${done ? "is-done" : ""}`}>
      <div className="decision-head">
        <div className="decision-tags">
          <span className={`chip chip-${decision.type}`}>{copy.label}</span>
          <span className={`chip priority-${decision.priority}`}>
            {priorityCopy[decision.priority]}
          </span>
        </div>
        <div className="decision-impact">
          <small>{impactLabel}</small>
          <strong>{money(impactAmount)}</strong>
        </div>
      </div>

      <h3>{decision.title}</h3>
      <p className="decision-lead">{copy.verb}</p>
      <p className="decision-explanation">{decision.explanation}</p>

      {decision.reasons.length > 0 ? (
        <div className="decision-reasons">
          <span>Por qué</span>
          <ul>
            {decision.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <KeyNumbers decision={decision} />

      <p className="decision-action">
        <b>Qué hacer:</b> {decision.recommendedAction}
      </p>

      <label className="decision-done">
        <input type="checkbox" checked={done} onChange={onToggle} />
        <span>{done ? "Resuelto" : "Marcar como resuelto"}</span>
      </label>
    </article>
  );
}

type Filter = "all" | DecisionType;

export function ActionPlan({ result }: { result: AnalysisResult }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [urgentOnly, setUrgentOnly] = useState(false);
  const [done, setDone] = useState<Set<string>>(new Set());

  const { decisions, decisionSummary } = result;

  const counts = useMemo(() => {
    const map = new Map<DecisionType, number>();
    for (const decision of decisions) {
      map.set(decision.type, (map.get(decision.type) ?? 0) + 1);
    }
    return map;
  }, [decisions]);

  const visible = useMemo(() => {
    const list = decisions.filter((decision) => {
      if (filter !== "all" && decision.type !== filter) return false;
      if (urgentOnly && decision.priority !== "high") return false;
      return true;
    });

    // Lo resuelto baja al final para que arriba quede siempre lo pendiente.
    return [...list].sort((left, right) => {
      const leftDone = done.has(left.id) ? 1 : 0;
      const rightDone = done.has(right.id) ? 1 : 0;
      return leftDone - rightDone;
    });
  }, [decisions, filter, urgentOnly, done]);

  function toggle(id: string) {
    setDone((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const pending = decisions.length - done.size;

  if (decisions.length === 0) {
    return (
      <div className="tab-panel">
        <p className="notice">
          Con los datos cargados no salió ninguna acción pendiente: no hay compras urgentes,
          inventario detenido ni márgenes por debajo del objetivo.
        </p>
      </div>
    );
  }

  return (
    <div className="tab-panel">
      <section className="plan-summary" aria-label="Dinero en juego">
        <div>
          <span>Hay que invertir</span>
          <strong>{money(decisionSummary.recommendedInvestment)}</strong>
          <small>En compras para no perder venta</small>
        </div>
        <div>
          <span>Se protege</span>
          <strong>{money(decisionSummary.profitProtected)}</strong>
          <small>Ganancia que se pierde si te quedas sin producto</small>
        </div>
        <div>
          <span>Se puede liberar</span>
          <strong>{money(decisionSummary.capitalToRelease + decisionSummary.deadStockValue)}</strong>
          <small>Dinero atrapado en mercadería que no rota</small>
        </div>
        <div>
          <span>Se puede ganar de más</span>
          <strong>{money(decisionSummary.marginOpportunity)}</strong>
          <small>Al corregir los márgenes más bajos</small>
        </div>
      </section>

      <div className="plan-toolbar">
        <div className="filters" role="group" aria-label="Filtrar acciones">
          <button
            type="button"
            className={filter === "all" ? "filter is-active" : "filter"}
            onClick={() => setFilter("all")}
          >
            Todas ({decisions.length})
          </button>
          {(Object.keys(typeCopy) as DecisionType[])
            .filter((type) => (counts.get(type) ?? 0) > 0)
            .map((type) => (
              <button
                key={type}
                type="button"
                className={filter === type ? "filter is-active" : "filter"}
                onClick={() => setFilter(type)}
              >
                {typeCopy[type].label} ({counts.get(type)})
              </button>
            ))}
          <button
            type="button"
            className={urgentOnly ? "filter is-active" : "filter"}
            onClick={() => setUrgentOnly((current) => !current)}
          >
            Solo urgentes ({decisionSummary.urgentActions})
          </button>
        </div>

        <div className="plan-actions">
          <span className="plan-progress">
            {pending === 0
              ? "Todo resuelto"
              : `${pending} de ${decisions.length} pendientes`}
          </span>
          <button type="button" className="ghost" onClick={() => downloadActionPlan(decisions)}>
            Descargar plan
          </button>
          <button type="button" className="ghost" onClick={() => window.print()}>
            Imprimir
          </button>
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="notice">Ninguna acción coincide con el filtro elegido.</p>
      ) : (
        <div className="decisions">
          {visible.map((decision) => (
            <DecisionCard
              key={decision.id}
              decision={decision}
              done={done.has(decision.id)}
              onToggle={() => toggle(decision.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
