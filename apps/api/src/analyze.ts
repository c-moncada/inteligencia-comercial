import type {
  FinancialAnalysisResult,
  Insight,
  InventoryRow,
  ProductAnalysis,
  SaleRow,
} from "./types.js";
import { maxOf, minOf } from "./numbers.js";

const SAFETY_STOCK_DAYS = 7;
const EXCESS_COVERAGE_DAYS = 90;
const LOW_MARGIN_THRESHOLD = 10;
const HIGH_MARGIN_THRESHOLD = 30;
const DEAD_STOCK_DAYS = 60;
const TREND_ALERT_PERCENT = 25;

export interface AnalysisOptions {
  /** Días de período a usar cuando los datos no traen fechas reales. */
  periodDaysOverride?: number | null;
  /** Productos cuyo costo se asumió porque no venía en los archivos. */
  productsWithoutCost?: Iterable<string>;
}

function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function isoDay(value: number): string {
  return new Date(value).toISOString().slice(0, 10);
}

function money(value: number): string {
  return value.toLocaleString("es-HN", { maximumFractionDigits: 2 });
}

function trendLabel(percent: number | null): ProductAnalysis["trend"] {
  if (percent === null) return "sin datos";
  if (percent >= 15) return "creciendo";
  if (percent <= -15) return "cayendo";
  return "estable";
}

export function analyzeBusinessData(
  sales: SaleRow[],
  inventory: InventoryRow[],
  options: AnalysisOptions = {},
): FinancialAnalysisResult {
  if (sales.length === 0) throw new Error("No hay ventas para analizar.");

  const withoutCost = new Set(options.productsWithoutCost ?? []);

  const dates = sales.map((sale) => new Date(sale.sale_date).getTime());
  const minDate = minOf(dates);
  const maxDate = maxOf(dates);
  const observedDays = Math.max(1, Math.floor((maxDate - minDate) / 86_400_000) + 1);
  const assumedPeriod = options.periodDaysOverride ?? null;
  const periodDays = assumedPeriod ?? observedDays;
  const midpoint = minDate + (maxDate - minDate) / 2;

  const inventoryByProduct = new Map(inventory.map((item) => [item.product_id, item]));

  const salesByProduct = new Map<string, SaleRow[]>();
  for (const sale of sales) {
    const current = salesByProduct.get(sale.product_id) ?? [];
    current.push(sale);
    salesByProduct.set(sale.product_id, current);
  }

  const products: ProductAnalysis[] = [];
  const insights: Insight[] = [];

  const productIds = new Set<string>([
    ...salesByProduct.keys(),
    ...inventoryByProduct.keys(),
  ]);

  for (const productId of productIds) {
    const rows = salesByProduct.get(productId) ?? [];
    const stock = inventoryByProduct.get(productId);
    const currentStock = stock?.current_stock ?? 0;
    const leadTimeDays = stock?.lead_time_days ?? SAFETY_STOCK_DAYS;
    const inventoryUnitCost = stock?.unit_cost ?? 0;

    const unitsSold = rows.reduce((sum, row) => sum + row.quantity, 0);
    const revenue = rows.reduce((sum, row) => sum + row.quantity * row.unit_price, 0);
    const costOfGoods = rows.reduce((sum, row) => sum + row.quantity * row.unit_cost, 0);
    const grossProfit = revenue - costOfGoods;
    const marginPercent = revenue > 0 ? (grossProfit / revenue) * 100 : 0;
    const averageUnitPrice = unitsSold > 0 ? revenue / unitsSold : stock?.unit_price ?? 0;
    const unitMargin = unitsSold > 0 ? grossProfit / unitsSold : 0;

    const averageDailyDemand = unitsSold > 0 ? unitsSold / periodDays : 0;
    const predictedDemand30Days = averageDailyDemand * 30;
    const coverageDays = averageDailyDemand > 0 ? currentStock / averageDailyDemand : null;

    const demandDuringLeadTime = averageDailyDemand * leadTimeDays;
    const safetyStock = averageDailyDemand * SAFETY_STOCK_DAYS;
    const reorderPoint = demandDuringLeadTime + safetyStock;
    const suggestedPurchase = Math.max(0, Math.ceil(reorderPoint - currentStock));

    const shortageUnits = Math.max(0, demandDuringLeadTime - currentStock);
    const profitAtRisk = shortageUnits * Math.max(unitMargin, 0);

    const desiredMaximumStock = averageDailyDemand * EXCESS_COVERAGE_DAYS;
    const excessUnits = Math.max(0, currentStock - desiredMaximumStock);
    const trappedCapital = excessUnits * Math.max(inventoryUnitCost, 0);
    const inventoryValue = Math.max(currentStock, 0) * Math.max(inventoryUnitCost, 0);

    const lastSale = rows.length > 0
      ? maxOf(rows.map((row) => new Date(row.sale_date).getTime()))
      : null;
    const daysSinceLastSale =
      lastSale === null || assumedPeriod !== null
        ? null
        : Math.max(0, Math.floor((maxDate - lastSale) / 86_400_000));

    let trendPercent: number | null = null;
    if (assumedPeriod === null && rows.length > 0 && maxDate > minDate) {
      let firstHalf = 0;
      let secondHalf = 0;
      for (const row of rows) {
        const time = new Date(row.sale_date).getTime();
        if (time <= midpoint) firstHalf += row.quantity;
        else secondHalf += row.quantity;
      }
      if (firstHalf > 0) trendPercent = ((secondHalf - firstHalf) / firstHalf) * 100;
      else if (secondHalf > 0) trendPercent = 100;
    }

    const productName =
      stock?.product_name || rows[0]?.product_name || productId;

    const analysis: ProductAnalysis = {
      productId,
      productName,
      unitsSold: round(unitsSold),
      revenue: round(revenue),
      grossProfit: round(grossProfit),
      marginPercent: round(marginPercent),
      averageDailyDemand: round(averageDailyDemand, 4),
      predictedDemand30Days: round(predictedDemand30Days),
      currentStock: round(currentStock),
      coverageDays: coverageDays === null ? null : round(coverageDays),
      suggestedPurchase,
      trappedCapital: round(trappedCapital),
      profitAtRisk: round(profitAtRisk),
      leadTimeDays: round(leadTimeDays),
      unitCost: round(Math.max(inventoryUnitCost, 0)),
      unitMargin: round(unitMargin),
      averageUnitPrice: round(averageUnitPrice),
      inventoryValue: round(inventoryValue),
      trendPercent: trendPercent === null ? null : round(trendPercent),
      trend: trendLabel(trendPercent),
      daysSinceLastSale,
      abcClass: "C",
      profitShare: 0,
      costKnown: !withoutCost.has(productId),
      hasSales: rows.length > 0,
    };
    products.push(analysis);
  }

  products.sort((left, right) => right.grossProfit - left.grossProfit);

  const revenue = products.reduce((sum, product) => sum + product.revenue, 0);
  const grossProfit = products.reduce((sum, product) => sum + product.grossProfit, 0);
  const positiveProfit = products.reduce(
    (sum, product) => sum + Math.max(product.grossProfit, 0),
    0,
  );

  let cumulative = 0;
  for (const product of products) {
    const share = positiveProfit > 0 ? Math.max(product.grossProfit, 0) / positiveProfit : 0;
    cumulative += share;
    product.profitShare = round(share * 100);
    product.abcClass = !product.hasSales ? "C" : cumulative <= 0.8 ? "A" : cumulative <= 0.95 ? "B" : "C";
  }

  for (const product of products) {
    if (product.trappedCapital > 0 && product.hasSales) {
      insights.push({
        type: "excess_inventory",
        priority:
          product.coverageDays !== null && product.coverageDays > 180 ? "high" : "medium",
        title: `Capital detenido en ${product.productName}`,
        explanation: `El inventario cubre aproximadamente ${product.coverageDays ?? 0} días de venta. Se estiman L ${money(product.trappedCapital)} por encima de una cobertura de ${EXCESS_COVERAGE_DAYS} días.`,
        recommendedAction:
          "Reducir o pausar nuevas compras y revisar promociones o redistribución.",
        impactAmount: product.trappedCapital,
        productId: product.productId,
        productName: product.productName,
      });
    }

    if (!product.hasSales && product.inventoryValue > 0) {
      insights.push({
        type: "dead_stock",
        priority: product.inventoryValue >= 10_000 ? "high" : "medium",
        title: `Inventario sin rotación: ${product.productName}`,
        explanation: `El producto tiene ${product.currentStock} unidades en existencia y no registró ninguna venta en el período analizado. Representa L ${money(product.inventoryValue)} inmovilizados.`,
        recommendedAction:
          "Verificar si el producto sigue vigente y evaluar liquidación, promoción o devolución al proveedor.",
        impactAmount: product.inventoryValue,
        productId: product.productId,
        productName: product.productName,
      });
    }

    if (
      product.hasSales &&
      product.daysSinceLastSale !== null &&
      product.daysSinceLastSale >= DEAD_STOCK_DAYS &&
      product.inventoryValue > 0
    ) {
      insights.push({
        type: "dead_stock",
        priority: product.inventoryValue >= 10_000 ? "high" : "medium",
        title: `Sin ventas recientes: ${product.productName}`,
        explanation: `La última venta fue hace ${product.daysSinceLastSale} días y quedan ${product.currentStock} unidades, equivalentes a L ${money(product.inventoryValue)}.`,
        recommendedAction:
          "Confirmar si el producto salió de rotación y decidir liquidación o promoción antes de que pierda valor.",
        impactAmount: product.inventoryValue,
        productId: product.productId,
        productName: product.productName,
      });
    }

    if (product.profitAtRisk > 0) {
      insights.push({
        type: "stockout_risk",
        priority: product.profitAtRisk >= 5_000 ? "high" : "medium",
        title: `Ganancia en riesgo por agotamiento de ${product.productName}`,
        explanation: `El inventario podría no cubrir los días de reposición. La ganancia bruta potencialmente expuesta es de L ${money(product.profitAtRisk)}.`,
        recommendedAction: `Evaluar la compra de ${product.suggestedPurchase} unidades, considerando pedidos ya emitidos y disponibilidad de efectivo.`,
        impactAmount: product.profitAtRisk,
        productId: product.productId,
        productName: product.productName,
      });
    }

    if (product.marginPercent < LOW_MARGIN_THRESHOLD && product.revenue > 0 && product.costKnown) {
      insights.push({
        type: "low_margin",
        priority: product.marginPercent <= 0 ? "high" : "medium",
        title: `Margen bajo en ${product.productName}`,
        explanation: `El producto tiene un margen bruto aproximado de ${product.marginPercent}%, pese a generar L ${money(product.revenue)} en ventas.`,
        recommendedAction:
          "Revisar precio, costo, descuentos y condiciones de compra antes de impulsar más volumen.",
        impactAmount: Math.max(
          0,
          product.revenue * ((LOW_MARGIN_THRESHOLD - product.marginPercent) / 100),
        ),
        productId: product.productId,
        productName: product.productName,
      });
    }

    if (
      product.marginPercent >= HIGH_MARGIN_THRESHOLD &&
      product.unitsSold > 0 &&
      product.costKnown
    ) {
      insights.push({
        type: "profitable_product",
        priority: "low",
        title: `Producto rentable: ${product.productName}`,
        explanation: `Generó L ${money(product.grossProfit)} de ganancia bruta con un margen de ${product.marginPercent}% y representa el ${product.profitShare}% de la ganancia total.`,
        recommendedAction: "Proteger su disponibilidad y evaluar oportunidades de venta cruzada.",
        impactAmount: product.grossProfit,
        productId: product.productId,
        productName: product.productName,
      });
    }

    if (
      product.trendPercent !== null &&
      product.trendPercent <= -TREND_ALERT_PERCENT &&
      product.revenue > 0
    ) {
      insights.push({
        type: "demand_drop",
        priority: product.abcClass === "A" ? "high" : "medium",
        title: `Demanda a la baja en ${product.productName}`,
        explanation: `Las unidades vendidas cayeron ${Math.abs(product.trendPercent)}% en la segunda mitad del período comparada con la primera.`,
        recommendedAction:
          "Revisar competencia, precio y disponibilidad antes de reponer con el ritmo anterior.",
        impactAmount: Math.max(0, product.grossProfit * (Math.abs(product.trendPercent) / 100)),
        productId: product.productId,
        productName: product.productName,
      });
    }

    if (
      product.trendPercent !== null &&
      product.trendPercent >= TREND_ALERT_PERCENT &&
      product.revenue > 0
    ) {
      insights.push({
        type: "demand_growth",
        priority: "low",
        title: `Demanda en crecimiento: ${product.productName}`,
        explanation: `Las unidades vendidas subieron ${product.trendPercent}% en la segunda mitad del período.`,
        recommendedAction:
          "Asegurar abastecimiento y revisar si el inventario acompaña el crecimiento.",
        impactAmount: Math.max(0, product.grossProfit * (product.trendPercent / 100)),
        productId: product.productId,
        productName: product.productName,
      });
    }
  }

  insights.sort((left, right) => {
    const priority = { high: 3, medium: 2, low: 1 };
    return (
      priority[right.priority] - priority[left.priority] ||
      right.impactAmount - left.impactAmount
    );
  });

  const inventoryValue = products.reduce((sum, product) => sum + product.inventoryValue, 0);
  const deadStockValue = products.reduce(
    (sum, product) =>
      sum +
      (!product.hasSales ||
      (product.daysSinceLastSale !== null && product.daysSinceLastSale >= DEAD_STOCK_DAYS)
        ? product.inventoryValue
        : 0),
    0,
  );

  const assumptions = [
    assumedPeriod === null
      ? "La demanda futura inicial se estima con el promedio diario del período cargado."
      : `Los datos no traen fechas: se asume un período de ${assumedPeriod} días para calcular la demanda diaria.`,
    `Se considera inventario excesivo lo que supera ${EXCESS_COVERAGE_DAYS} días de demanda estimada.`,
    `El punto de reposición usa el tiempo de entrega más ${SAFETY_STOCK_DAYS} días de inventario de seguridad.`,
    `Se marca como inventario sin rotación lo que no registra ventas en ${DEAD_STOCK_DAYS} días o más.`,
    "La clasificación ABC ordena los productos por su aporte acumulado a la ganancia bruta.",
    "Los importes representan estimaciones de apoyo y no sustituyen la revisión financiera de la empresa.",
  ];

  if (withoutCost.size > 0) {
    assumptions.push(
      `${withoutCost.size} productos no traían costo: se asumió margen cero para no reportar ganancias que no pueden comprobarse.`,
    );
  }

  return {
    period: {
      from: isoDay(minDate),
      to: isoDay(maxDate),
      days: periodDays,
      assumed: assumedPeriod !== null,
    },
    summary: {
      revenue: round(revenue),
      grossProfit: round(grossProfit),
      grossMarginPercent: round(revenue > 0 ? (grossProfit / revenue) * 100 : 0),
      trappedCapital: round(
        products.reduce((sum, product) => sum + product.trappedCapital, 0),
      ),
      profitAtRisk: round(products.reduce((sum, product) => sum + product.profitAtRisk, 0)),
      productsAnalyzed: products.length,
      inventoryValue: round(inventoryValue),
      deadStockValue: round(deadStockValue),
      productsWithoutSales: products.filter((product) => !product.hasSales).length,
      productsWithoutCost: products.filter((product) => !product.costKnown).length,
    },
    insights,
    products,
    assumptions,
  };
}
