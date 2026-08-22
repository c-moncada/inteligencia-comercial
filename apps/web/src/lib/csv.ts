import type { AnalysisResult, BusinessDecision, DecisionType } from "../types";

/**
 * Exportación a CSV.
 *
 * Se usa punto y coma como separador y se agrega la marca BOM al inicio porque
 * es lo que abre bien Excel en español sin pedir nada al usuario.
 */

const SEPARATOR = ";";

const typeLabel: Record<DecisionType, string> = {
  restock: "Comprar",
  pause_purchases: "Dejar de comprar",
  liquidate_dead_stock: "Liberar dinero",
  review_margin: "Subir el margen",
};

const priorityLabel: Record<BusinessDecision["priority"], string> = {
  high: "Urgente",
  medium: "Importante",
  low: "Revisar",
};

function cell(value: string | number | null): string {
  if (value === null) return "";
  const text = typeof value === "number" ? String(value) : value;
  if (text.includes(SEPARATOR) || text.includes('"') || text.includes("\n")) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function toCsv(headers: string[], rows: (string | number | null)[][]): string {
  const lines = [headers.join(SEPARATOR)];
  for (const row of rows) lines.push(row.map(cell).join(SEPARATOR));
  return `﻿${lines.join("\r\n")}`;
}

function download(content: string, filename: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** El plan de acción tal como se ve en pantalla, para llevarlo a una reunión. */
export function downloadActionPlan(decisions: BusinessDecision[]): void {
  const content = toCsv(
    [
      "Prioridad",
      "Qué hacer",
      "Producto",
      "Impacto en dinero",
      "Concepto del impacto",
      "Compra sugerida (unidades)",
      "Inversión requerida",
      "Ganancia estimada",
      "Existencia actual",
      "Cobertura (días)",
      "Plazo para decidir (días)",
      "Acción recomendada",
      "Motivos",
    ],
    decisions.map((decision) => [
      priorityLabel[decision.priority],
      typeLabel[decision.type],
      decision.productName,
      decision.impactAmount,
      decision.impactLabel,
      decision.suggestedPurchase,
      decision.investmentRequired,
      decision.expectedGrossProfit,
      decision.currentStock,
      decision.daysOfCoverage,
      decision.decisionDeadlineDays,
      decision.recommendedAction,
      decision.reasons.join(" | "),
    ]),
  );

  download(content, `plan-de-accion-${new Date().toISOString().slice(0, 10)}.csv`);
}

/** El detalle por producto, para seguir trabajándolo en una hoja de cálculo. */
export function downloadProducts(result: AnalysisResult): void {
  const content = toCsv(
    [
      "Código",
      "Producto",
      "Clase",
      "Unidades vendidas",
      "Ventas",
      "Ganancia",
      "Margen %",
      "Aporte a la ganancia %",
      "Existencia actual",
      "Valor del inventario",
      "Cobertura (días)",
      "Rotación anual",
      "Demanda estimada 30 días",
      "Compra sugerida",
      "Días desde la última venta",
      "Tendencia",
      "Costo conocido",
    ],
    result.products.map((product) => [
      product.productId,
      product.productName,
      product.abcClass,
      product.unitsSold,
      product.revenue,
      product.grossProfit,
      product.marginPercent,
      product.profitShare,
      product.currentStock,
      product.inventoryValue,
      product.coverageDays,
      product.currentStock > 0
        ? Math.round(((product.averageDailyDemand * 365) / product.currentStock) * 100) / 100
        : null,
      product.predictedDemand30Days,
      product.suggestedPurchase,
      product.daysSinceLastSale,
      product.trend,
      product.costKnown ? "Sí" : "No",
    ]),
  );

  download(content, `productos-${new Date().toISOString().slice(0, 10)}.csv`);
}
