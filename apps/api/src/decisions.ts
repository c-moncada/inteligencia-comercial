import type {
  BusinessDecision,
  DecisionSummary,
  DemandForecastResult,
  FinancialAnalysisResult,
  ProductAnalysis,
  ProductForecast,
  ResultSource,
} from "./types.js";

const TARGET_MARGIN_PERCENT = 10;
const DEAD_STOCK_DAYS = 60;
const RULES_INTERVAL_PERCENT = 0.35;

function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function money(value: number): string {
  return Math.round(value).toLocaleString("es-HN", { maximumFractionDigits: 0 });
}

/** Unidades y días se leen mejor sin decimales y con separador de miles. */
function count(value: number): string {
  return Math.round(value).toLocaleString("es-HN", { maximumFractionDigits: 0 });
}

function restockPriority(forecast: ProductForecast): "high" | "medium" | "low" {
  if (
    (forecast.decision_deadline_days !== null && forecast.decision_deadline_days <= 0) ||
    forecast.profit_at_risk >= 5_000
  ) {
    return "high";
  }

  if (
    (forecast.decision_deadline_days !== null && forecast.decision_deadline_days <= 7) ||
    forecast.profit_at_risk >= 1_000
  ) {
    return "medium";
  }

  return "low";
}

function deadlineText(days: number | null): string {
  if (days === null) return "No se pudo calcular una fecha límite por falta de demanda.";
  if (days < 0) {
    return `El inventario ya es insuficiente para cubrir los días de reposición; la decisión está atrasada aproximadamente ${Math.abs(days)} días.`;
  }
  if (days === 0) return "El pedido debería revisarse hoy para no quedar expuesto durante la reposición.";
  return `La compra debería decidirse dentro de los próximos ${days} días.`;
}

/**
 * Pronóstico de respaldo calculado solo con reglas.
 *
 * Se usa cuando el servicio de machine learning no está disponible o cuando los
 * datos cargados no permiten entrenarlo. Mantiene el mismo formato para que las
 * decisiones se construyan siempre igual, pero se marca con confianza baja.
 */
export function rulesForecast(product: ProductAnalysis): ProductForecast {
  const expected = product.predictedDemand30Days;
  const band = expected * RULES_INTERVAL_PERCENT;
  const expectedDaily = product.averageDailyDemand;
  const demandDuringLeadTime = expectedDaily * product.leadTimeDays;
  const safetyStock = expectedDaily * 7;
  const suggestedPurchase = Math.max(
    0,
    Math.ceil(demandDuringLeadTime + safetyStock - product.currentStock),
  );
  const shortage = Math.max(0, demandDuringLeadTime - product.currentStock);
  const unitMargin = Math.max(product.unitMargin, 0);
  const investment = suggestedPurchase * Math.max(product.unitCost, 0);
  const sellable = Math.min(suggestedPurchase, Math.max(0, expected - product.currentStock));
  const expectedRevenue = sellable * product.averageUnitPrice;
  const expectedProfit = sellable * unitMargin;
  const dailyProfit = expectedDaily * unitMargin;

  return {
    product_id: product.productId,
    product_name: product.productName,
    forecast_30_days: round(expected),
    forecast_min_30_days: round(Math.max(0, expected - band)),
    forecast_max_30_days: round(expected + band),
    model_forecast_30_days: round(expected),
    baseline_forecast_30_days: round(expected),
    confidence: "low",
    current_stock: product.currentStock,
    lead_time_days: product.leadTimeDays,
    days_of_coverage: product.coverageDays,
    expected_daily_demand: product.averageDailyDemand,
    demand_during_lead_time: round(demandDuringLeadTime),
    safety_stock_units: round(safetyStock),
    suggested_purchase: suggestedPurchase,
    projected_shortage_units: round(shortage),
    decision_deadline_days:
      product.coverageDays === null
        ? null
        : Math.floor(product.coverageDays - product.leadTimeDays),
    average_unit_price: product.averageUnitPrice,
    unit_cost: product.unitCost,
    unit_margin: round(unitMargin),
    investment_required: round(investment),
    expected_revenue_from_purchase: round(expectedRevenue),
    expected_gross_profit_from_purchase: round(expectedProfit),
    estimated_return_percentage: investment > 0 ? round((expectedProfit / investment) * 100) : 0,
    estimated_payback_days: investment > 0 && dailyProfit > 0 ? round(investment / dailyProfit, 1) : null,
    profit_at_risk: round(shortage * unitMargin),
  };
}

export function buildBusinessDecisions(
  financial: FinancialAnalysisResult,
  forecastResult: DemandForecastResult,
): { decisions: BusinessDecision[]; summary: DecisionSummary } {
  const modelForecasts = forecastResult.forecasts;
  const usingModel = modelForecasts.length > 0;

  const forecasts = usingModel
    ? modelForecasts
    : financial.products.filter((product) => product.hasSales).map(rulesForecast);

  const forecastSource: ResultSource =
    forecastResult.evaluation?.selected_method === "machine_learning"
      ? "ml"
      : usingModel
        ? "baseline"
        : "rules";
  const restockSource: ResultSource = forecastSource === "ml" ? "hybrid" : "rules";

  const forecastsByProduct = new Map(forecasts.map((item) => [item.product_id, item]));
  const productsById = new Map(financial.products.map((item) => [item.productId, item]));

  const decisions: BusinessDecision[] = [];

  for (const forecast of forecasts) {
    if (forecast.suggested_purchase <= 0 || forecast.investment_required <= 0) continue;

    const product = productsById.get(forecast.product_id);
    const priority = restockPriority(forecast);
    const reasons: string[] = [];

    if (forecast.decision_deadline_days !== null && forecast.decision_deadline_days <= 0) {
      reasons.push("El inventario ya no cubre el tiempo de reposición.");
    }
    if (forecast.profit_at_risk > 0) {
      reasons.push(`Ganancia expuesta estimada de L ${money(forecast.profit_at_risk)}.`);
    }
    if (product?.abcClass === "A") {
      reasons.push("Es un producto clase A: concentra buena parte de la ganancia.");
    }
    if (product?.trend === "creciendo") {
      reasons.push("La demanda viene creciendo respecto a la primera mitad del período.");
    }
    if (product?.trend === "cayendo") {
      reasons.push("La demanda viene cayendo: conviene comprar con prudencia.");
    }
    if (!usingModel) {
      reasons.push(
        "La demanda se estimó con el promedio de venta del período: conviene contrastarla con lo que sabes de la temporada.",
      );
    }

    const returnText =
      forecast.estimated_return_percentage > 0
        ? `La compra tendría una rentabilidad bruta estimada de ${round(forecast.estimated_return_percentage)}%.`
        : "La rentabilidad no pudo estimarse con los datos disponibles.";

    decisions.push({
      id: `restock:${forecast.product_id}`,
      type: "restock",
      priority: product?.trend === "cayendo" && priority === "high" ? "medium" : priority,
      confidence: forecast.confidence,
      source: restockSource,
      reasons,
      daysSinceLastSale: product?.daysSinceLastSale ?? null,
      trend: product?.trend ?? "sin datos",
      productId: forecast.product_id,
      productName: forecast.product_name,
      title: `Reponer ${forecast.product_name}`,
      explanation: `Se esperan alrededor de ${count(forecast.forecast_30_days)} unidades de demanda en los próximos 30 días, dentro de un rango probable de ${count(forecast.forecast_min_30_days)} a ${count(forecast.forecast_max_30_days)}. ${deadlineText(forecast.decision_deadline_days)} ${returnText}`,
      recommendedAction: `Evaluar la compra de ${forecast.suggested_purchase} unidades. Confirmar pedidos pendientes, capacidad de almacenamiento y efectivo antes de emitir la orden.`,
      impactLabel: "Ganancia protegida",
      impactAmount: round(forecast.profit_at_risk),
      forecastExpectedUnits: round(forecast.forecast_30_days),
      forecastMinimumUnits: round(forecast.forecast_min_30_days),
      forecastMaximumUnits: round(forecast.forecast_max_30_days),
      currentStock: round(forecast.current_stock),
      suggestedPurchase: forecast.suggested_purchase,
      leadTimeDays: round(forecast.lead_time_days),
      daysOfCoverage: forecast.days_of_coverage,
      decisionDeadlineDays: forecast.decision_deadline_days,
      investmentRequired: round(forecast.investment_required),
      expectedRevenue: round(forecast.expected_revenue_from_purchase),
      expectedGrossProfit: round(forecast.expected_gross_profit_from_purchase),
      estimatedReturnPercentage: round(forecast.estimated_return_percentage),
      estimatedPaybackDays: forecast.estimated_payback_days,
      profitAtRisk: round(forecast.profit_at_risk),
      trappedCapital: 0,
      marginOpportunity: 0,
    });
  }

  for (const product of financial.products) {
    const forecast = forecastsByProduct.get(product.productId);

    const withoutRotation =
      product.inventoryValue > 0 &&
      (!product.hasSales ||
        (product.daysSinceLastSale !== null && product.daysSinceLastSale >= DEAD_STOCK_DAYS));

    if (withoutRotation) {
      decisions.push({
        id: `dead:${product.productId}`,
        type: "liquidate_dead_stock",
        priority: product.inventoryValue >= 10_000 ? "high" : "medium",
        confidence: "high",
        source: "rules",
        reasons: [
          product.hasSales
            ? `Última venta registrada hace ${product.daysSinceLastSale} días.`
            : "No registró ninguna venta en el período analizado.",
          `Mantiene L ${money(product.inventoryValue)} inmovilizados.`,
        ],
        daysSinceLastSale: product.daysSinceLastSale,
        trend: product.trend,
        productId: product.productId,
        productName: product.productName,
        title: `Liberar inventario de ${product.productName}`,
        explanation: product.hasSales
          ? `Quedan ${product.currentStock} unidades y la última venta fue hace ${product.daysSinceLastSale} días. El inventario representa L ${money(product.inventoryValue)} al costo.`
          : `Quedan ${product.currentStock} unidades sin ninguna venta en el período. El inventario representa L ${money(product.inventoryValue)} al costo.`,
        recommendedAction:
          "Confirmar vigencia del producto y decidir liquidación, promoción, traslado o devolución al proveedor.",
        impactLabel: "Capital inmovilizado",
        impactAmount: round(product.inventoryValue),
        forecastExpectedUnits: forecast?.forecast_30_days ?? product.predictedDemand30Days,
        forecastMinimumUnits: forecast?.forecast_min_30_days ?? null,
        forecastMaximumUnits: forecast?.forecast_max_30_days ?? null,
        currentStock: product.currentStock,
        suggestedPurchase: 0,
        leadTimeDays: product.leadTimeDays,
        daysOfCoverage: product.coverageDays,
        decisionDeadlineDays: null,
        investmentRequired: 0,
        expectedRevenue: 0,
        expectedGrossProfit: 0,
        estimatedReturnPercentage: 0,
        estimatedPaybackDays: null,
        profitAtRisk: 0,
        trappedCapital: round(product.inventoryValue),
        marginOpportunity: 0,
      });
      continue;
    }

    if (product.trappedCapital > 0) {
      const priority =
        (product.coverageDays !== null && product.coverageDays > 180) ||
        product.trappedCapital >= 25_000
          ? "high"
          : "medium";

      decisions.push({
        id: `pause:${product.productId}`,
        type: "pause_purchases",
        priority,
        confidence: "high",
        source: "rules",
        reasons: [
          `El inventario cubre ${count(product.coverageDays ?? 0)} días de venta.`,
          product.trend === "cayendo"
            ? "La demanda viene cayendo, por lo que la cobertura real podría ser mayor."
            : "La cobertura supera el objetivo de 90 días.",
        ],
        daysSinceLastSale: product.daysSinceLastSale,
        trend: product.trend,
        productId: product.productId,
        productName: product.productName,
        title: `Pausar compras de ${product.productName}`,
        explanation: `El inventario actual cubre alrededor de ${count(product.coverageDays ?? 0)} días de venta. Se estiman L ${money(product.trappedCapital)} invertidos por encima de una cobertura objetivo de 90 días.`,
        recommendedAction:
          "Suspender nuevas compras, revisar pedidos abiertos y evaluar promoción, redistribución o devolución al proveedor.",
        impactLabel: "Capital para liberar",
        impactAmount: round(product.trappedCapital),
        forecastExpectedUnits: forecast?.forecast_30_days ?? product.predictedDemand30Days,
        forecastMinimumUnits: forecast?.forecast_min_30_days ?? null,
        forecastMaximumUnits: forecast?.forecast_max_30_days ?? null,
        currentStock: product.currentStock,
        suggestedPurchase: 0,
        leadTimeDays: forecast?.lead_time_days ?? product.leadTimeDays,
        daysOfCoverage: product.coverageDays,
        decisionDeadlineDays: null,
        investmentRequired: 0,
        expectedRevenue: 0,
        expectedGrossProfit: 0,
        estimatedReturnPercentage: 0,
        estimatedPaybackDays: null,
        profitAtRisk: 0,
        trappedCapital: round(product.trappedCapital),
        marginOpportunity: 0,
      });
    }

    // Sin costo real no se puede afirmar que el margen sea bajo.
    if (
      product.costKnown &&
      product.marginPercent < TARGET_MARGIN_PERCENT &&
      product.revenue > 0
    ) {
      const expectedUnits = forecast?.forecast_30_days ?? product.predictedDemand30Days;
      const averagePrice = forecast?.average_unit_price ?? product.averageUnitPrice;
      const expectedRevenue30 = expectedUnits * averagePrice;
      const marginGap = Math.max(0, TARGET_MARGIN_PERCENT - product.marginPercent);
      const opportunity = expectedRevenue30 * (marginGap / 100);
      const priority = opportunity >= 5_000 || product.marginPercent <= 0 ? "high" : "medium";

      decisions.push({
        id: `margin:${product.productId}`,
        type: "review_margin",
        priority,
        confidence: forecast?.confidence ?? "medium",
        source: restockSource,
        reasons: [
          `Margen bruto actual de ${round(product.marginPercent)}%.`,
          product.abcClass === "A"
            ? "Es un producto clase A: cada punto de margen pesa mucho."
            : `Aporta el ${product.profitShare}% de la ganancia bruta.`,
        ],
        daysSinceLastSale: product.daysSinceLastSale,
        trend: product.trend,
        productId: product.productId,
        productName: product.productName,
        title: `Mejorar el margen de ${product.productName}`,
        explanation: `El margen bruto actual es de ${round(product.marginPercent)}%. Alcanzar al menos ${TARGET_MARGIN_PERCENT}% sobre la venta esperada de los próximos 30 días podría aportar aproximadamente L ${money(opportunity)} adicionales.`,
        recommendedAction:
          "Revisar precio, costo de compra, descuentos y comisiones antes de impulsar más volumen.",
        impactLabel: "Ganancia adicional posible",
        impactAmount: round(opportunity),
        forecastExpectedUnits: expectedUnits,
        forecastMinimumUnits: forecast?.forecast_min_30_days ?? null,
        forecastMaximumUnits: forecast?.forecast_max_30_days ?? null,
        currentStock: product.currentStock,
        suggestedPurchase: 0,
        leadTimeDays: forecast?.lead_time_days ?? product.leadTimeDays,
        daysOfCoverage: product.coverageDays,
        decisionDeadlineDays: null,
        investmentRequired: 0,
        expectedRevenue: round(expectedRevenue30),
        expectedGrossProfit: 0,
        estimatedReturnPercentage: 0,
        estimatedPaybackDays: null,
        profitAtRisk: 0,
        trappedCapital: 0,
        marginOpportunity: round(opportunity),
      });
    }
  }

  const priorityWeight = { high: 3, medium: 2, low: 1 } as const;
  decisions.sort(
    (left, right) =>
      priorityWeight[right.priority] - priorityWeight[left.priority] ||
      right.impactAmount - left.impactAmount,
  );

  const summary: DecisionSummary = {
    deadStockValue: round(
      decisions
        .filter((item) => item.type === "liquidate_dead_stock")
        .reduce((sum, item) => sum + item.trappedCapital, 0),
    ),
    capitalToRelease: round(
      decisions
        .filter((item) => item.type === "pause_purchases")
        .reduce((sum, item) => sum + item.trappedCapital, 0),
    ),
    profitProtected: round(decisions.reduce((sum, item) => sum + item.profitAtRisk, 0)),
    recommendedInvestment: round(
      decisions.reduce((sum, item) => sum + item.investmentRequired, 0),
    ),
    marginOpportunity: round(decisions.reduce((sum, item) => sum + item.marginOpportunity, 0)),
    urgentActions: decisions.filter((item) => item.priority === "high").length,
    totalActions: decisions.length,
  };

  return { decisions, summary };
}

export function mergeForecastIntoProducts(
  financial: FinancialAnalysisResult,
  forecastResult: DemandForecastResult,
): FinancialAnalysisResult {
  if (forecastResult.forecasts.length === 0) return financial;

  const forecastsByProduct = new Map(
    forecastResult.forecasts.map((item) => [item.product_id, item]),
  );

  const products = financial.products.map((product) => {
    const forecast = forecastsByProduct.get(product.productId);
    if (!forecast) return product;

    return {
      ...product,
      predictedDemand30Days: forecast.forecast_30_days,
      coverageDays: forecast.days_of_coverage,
      suggestedPurchase: forecast.suggested_purchase,
      profitAtRisk: forecast.profit_at_risk,
    };
  });

  return {
    ...financial,
    products,
    summary: {
      ...financial.summary,
      profitAtRisk: round(
        forecastResult.forecasts.reduce((sum, item) => sum + item.profit_at_risk, 0),
      ),
    },
  };
}
