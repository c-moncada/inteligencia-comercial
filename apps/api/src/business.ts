/**
 * Lectura del negocio.
 *
 * El resto de la API calcula cifras; este módulo las traduce a lo que una
 * persona dueña del negocio quiere saber al abrir la pantalla: cómo va, en qué
 * productos está el dinero, cuáles se mueven, cuáles no y qué pasó con las
 * ventas a lo largo del período.
 */

import type {
  BusinessHealth,
  BusinessOverview,
  FinancialAnalysisResult,
  HealthLevel,
  HealthPoint,
  InventoryBreakdown,
  ProductAnalysis,
  ProductRanking,
  RankedProduct,
  SaleRow,
  SalesTimeline,
  TimelinePoint,
} from "./types.js";

const TOP_N = 6;
const EXCESS_COVERAGE_DAYS = 90;
const DEAD_STOCK_DAYS = 60;
const SLOW_TURNS_THRESHOLD = 2;

function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function money(value: number): string {
  return `L ${round(value).toLocaleString("es-HN", { maximumFractionDigits: 2 })}`;
}

function units(value: number): string {
  return round(value).toLocaleString("es-HN", { maximumFractionDigits: 2 });
}

/** Los días se leen mejor enteros: nadie repone "en 1,113.75 días". */
function days(value: number): string {
  return Math.round(value).toLocaleString("es-HN", { maximumFractionDigits: 0 });
}

/** Veces que el inventario actual se vendería en un año al ritmo del período. */
export function turnsPerYear(product: ProductAnalysis): number | null {
  if (product.currentStock <= 0) return null;
  return round((product.averageDailyDemand * 365) / product.currentStock, 2);
}

/** Porcentaje de lo que estuvo disponible que efectivamente se vendió. */
export function sellThroughPercent(product: ProductAnalysis): number | null {
  const available = product.unitsSold + product.currentStock;
  if (available <= 0) return null;
  return round((product.unitsSold / available) * 100);
}

/** Un producto es de baja rotación si el dinero lleva demasiado tiempo ahí. */
export function isSlowMoving(product: ProductAnalysis): boolean {
  if (product.inventoryValue <= 0) return false;
  if (!product.hasSales) return true;
  if (product.daysSinceLastSale !== null && product.daysSinceLastSale >= DEAD_STOCK_DAYS) {
    return true;
  }
  if (product.coverageDays === null) return true;
  if (product.coverageDays > EXCESS_COVERAGE_DAYS) return true;

  const turns = turnsPerYear(product);
  return turns !== null && turns < SLOW_TURNS_THRESHOLD;
}

function toRanked(
  product: ProductAnalysis,
  value: number,
  valueLabel: string,
  detail: string,
): RankedProduct {
  return {
    productId: product.productId,
    productName: product.productName,
    value: round(value),
    valueLabel,
    detail,
    unitsSold: product.unitsSold,
    revenue: product.revenue,
    grossProfit: product.grossProfit,
    marginPercent: product.marginPercent,
    currentStock: product.currentStock,
    inventoryValue: product.inventoryValue,
    coverageDays: product.coverageDays,
    daysSinceLastSale: product.daysSinceLastSale,
    turnsPerYear: turnsPerYear(product),
    sellThroughPercent: sellThroughPercent(product),
    abcClass: product.abcClass,
    trend: product.trend,
  };
}

function coverageText(product: ProductAnalysis): string {
  if (product.coverageDays === null) return "sin demanda para estimar la cobertura";
  return `el inventario alcanza para ${days(product.coverageDays)} días`;
}

function lastSaleText(product: ProductAnalysis): string {
  if (!product.hasSales) return "No registró ninguna venta en el período.";
  if (product.daysSinceLastSale === null) {
    return "Los datos no traen fechas para ubicar la última venta.";
  }
  if (product.daysSinceLastSale === 0) return "Su última venta fue el último día del período.";
  return `Su última venta fue hace ${product.daysSinceLastSale} días.`;
}

function rotationText(product: ProductAnalysis): string {
  const turns = turnsPerYear(product);
  if (turns === null) return "Sin existencias registradas";
  if (turns === 0) return "No rotó en el período";
  return `Rota ${units(turns)} veces al año`;
}

/** Los que más rápido se venden en relación con lo que se tiene guardado. */
function fastMovingRanking(products: ProductAnalysis[]): ProductRanking {
  // Un producto que lleva meses sin venderse no pertenece a esta lista aunque
  // el promedio del período le dé una rotación alta.
  const withStock = products.filter(
    (product) => product.unitsSold > 0 && product.currentStock > 0 && !isSlowMoving(product),
  );

  const base = {
    id: "fast_moving" as const,
    title: "Mayor rotación",
    question: "¿Qué productos se venden más rápido de lo que se reponen?",
    emptyMessage:
      "Todavía no hay ventas suficientes para medir qué tan rápido rota cada producto.",
  };

  if (withStock.length >= 3) {
    const items = [...withStock]
      .sort((left, right) => (turnsPerYear(right) ?? 0) - (turnsPerYear(left) ?? 0))
      .slice(0, TOP_N)
      .map((product) =>
        toRanked(
          product,
          turnsPerYear(product) ?? 0,
          `${units(turnsPerYear(product) ?? 0)} veces al año`,
          `Vende ${units(product.averageDailyDemand)} unidades al día y le quedan ${units(product.currentStock)}: ${coverageText(product)}.`,
        ),
      );

    return {
      ...base,
      metric: "turns_per_year",
      metricLabel: "Rotación anual",
      note: "Cuántas veces al año se vendería el inventario que hoy tienes de ese producto, al ritmo del período analizado. Más alto significa que el dinero regresa más rápido.",
      items,
    };
  }

  const items = products
    .filter((product) => product.unitsSold > 0 && !isSlowMoving(product))
    .sort((left, right) => right.averageDailyDemand - left.averageDailyDemand)
    .slice(0, TOP_N)
    .map((product) =>
      toRanked(
        product,
        product.averageDailyDemand,
        `${units(product.averageDailyDemand)} unidades al día`,
        `Vendió ${units(product.unitsSold)} unidades en el período, por ${money(product.revenue)}.`,
      ),
    );

  return {
    ...base,
    metric: "units_per_day",
    metricLabel: "Velocidad de venta",
    note: "No hay suficientes productos con existencia y venta reciente para comparar rotaciones, así que la lista se ordena por unidades vendidas al día.",
    items,
  };
}

/** Los que dejan más ganancia por cada lempira vendido. */
function highMarginRanking(
  products: ProductAnalysis[],
  totalRevenue: number,
): ProductRanking {
  let candidates = products.filter(
    (product) => product.costKnown && product.revenue > 0 && product.unitsSold > 0,
  );

  // Con muchos productos, un margen altísimo sobre una venta mínima es ruido.
  if (candidates.length > 10 && totalRevenue > 0) {
    const relevant = candidates.filter((product) => product.revenue >= totalRevenue * 0.005);
    if (relevant.length >= 5) candidates = relevant;
  }

  const items = candidates
    .sort(
      (left, right) =>
        right.marginPercent - left.marginPercent || right.grossProfit - left.grossProfit,
    )
    .slice(0, TOP_N)
    .map((product) =>
      toRanked(
        product,
        product.marginPercent,
        `${units(product.marginPercent)}% de margen`,
        `Deja ${money(product.unitMargin)} por unidad. En el período aportó ${money(product.grossProfit)} de ganancia.`,
      ),
    );

  return {
    id: "high_margin",
    title: "Mayor margen de ganancia",
    question: "¿Qué productos dejan más ganancia por cada venta?",
    metric: "margin_percent",
    metricLabel: "Margen bruto",
    note: "Porcentaje de la venta que queda como ganancia después del costo de la mercadería. Solo aparecen los productos cuyo costo real venía en los archivos.",
    emptyMessage:
      "Ningún producto trae costo en los archivos cargados, así que no se puede calcular el margen. Agrega la columna de costo o precio de compra.",
    items,
  };
}

/** Donde el dinero lleva más tiempo detenido. */
function slowMovingRanking(products: ProductAnalysis[]): ProductRanking {
  const items = products
    .filter(isSlowMoving)
    .sort((left, right) => right.inventoryValue - left.inventoryValue)
    .slice(0, TOP_N)
    .map((product) => {
      const stale =
        !product.hasSales ||
        (product.daysSinceLastSale !== null && product.daysSinceLastSale >= DEAD_STOCK_DAYS);

      // Con la venta detenida hace meses, la rotación promedio del período ya
      // no describe nada: pesa más decir cuándo fue la última venta.
      const detail = stale
        ? `${units(product.currentStock)} unidades guardadas. ${lastSaleText(product)}`
        : `${units(product.currentStock)} unidades guardadas. ${rotationText(product)}. ${coverageText(product).charAt(0).toUpperCase()}${coverageText(product).slice(1)}.`;

      return toRanked(product, product.inventoryValue, money(product.inventoryValue), detail);
    });

  return {
    id: "slow_moving",
    title: "Baja rotación",
    question: "¿Dónde está el dinero que no se está moviendo?",
    metric: "idle_capital",
    metricLabel: "Capital detenido",
    note: `Productos sin ventas recientes o con más de ${EXCESS_COVERAGE_DAYS} días de inventario encima, ordenados por el dinero que tienen inmovilizado al costo.`,
    emptyMessage:
      "Ningún producto quedó marcado como de baja rotación: el inventario cargado se está moviendo dentro de lo esperado.",
    items,
  };
}

/** Los que sostienen la ganancia del negocio. */
function topProfitRanking(products: ProductAnalysis[]): ProductRanking {
  const items = products
    .filter((product) => product.grossProfit > 0)
    .sort((left, right) => right.grossProfit - left.grossProfit)
    .slice(0, TOP_N)
    .map((product) =>
      toRanked(
        product,
        product.grossProfit,
        money(product.grossProfit),
        `Aporta el ${units(product.profitShare)}% de la ganancia total, con un margen de ${units(product.marginPercent)}%.`,
      ),
    );

  return {
    id: "top_profit",
    title: "Los que más ganancia dejan",
    question: "¿De qué productos vive realmente el negocio?",
    metric: "gross_profit",
    metricLabel: "Ganancia del período",
    note: "Ganancia bruta acumulada en el período analizado. Son los productos que no deberían quedarse sin existencia.",
    emptyMessage:
      "No se registró ganancia positiva en el período. Conviene revisar que los costos cargados sean correctos.",
    items,
  };
}

function startOfWeek(time: number): number {
  const date = new Date(time);
  const weekday = (date.getUTCDay() + 6) % 7;
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - weekday);
}

function startOfMonth(time: number): number {
  const date = new Date(time);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

function startOfDay(time: number): number {
  const date = new Date(time);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function pointLabel(time: number, granularity: SalesTimeline["granularity"]): string {
  const date = new Date(time);
  if (granularity === "month") {
    return date.toLocaleDateString("es-HN", {
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
  }
  return date.toLocaleDateString("es-HN", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  });
}

/** Evolución de las ventas, para poder verla como una línea y no como una tabla. */
export function buildTimeline(sales: SaleRow[], datesDetected: boolean): SalesTimeline {
  if (!datesDetected || sales.length === 0) {
    return { granularity: "day", granularityLabel: "", points: [] };
  }

  const times = sales
    .map((sale) => new Date(sale.sale_date).getTime())
    .filter((time) => Number.isFinite(time));

  if (times.length === 0) {
    return { granularity: "day", granularityLabel: "", points: [] };
  }

  const spanDays = (Math.max(...times) - Math.min(...times)) / 86_400_000;
  const granularity: SalesTimeline["granularity"] =
    spanDays > 420 ? "month" : spanDays > 75 ? "week" : "day";
  const granularityLabel =
    granularity === "month" ? "por mes" : granularity === "week" ? "por semana" : "por día";

  const buckets = new Map<number, { revenue: number; grossProfit: number; units: number }>();

  for (const sale of sales) {
    const time = new Date(sale.sale_date).getTime();
    if (!Number.isFinite(time)) continue;

    const key =
      granularity === "month"
        ? startOfMonth(time)
        : granularity === "week"
          ? startOfWeek(time)
          : startOfDay(time);

    const current = buckets.get(key) ?? { revenue: 0, grossProfit: 0, units: 0 };
    current.revenue += sale.quantity * sale.unit_price;
    current.grossProfit += sale.quantity * (sale.unit_price - sale.unit_cost);
    current.units += sale.quantity;
    buckets.set(key, current);
  }

  const points: TimelinePoint[] = [...buckets.entries()]
    .sort(([left], [right]) => left - right)
    .map(([time, value]) => ({
      date: new Date(time).toISOString().slice(0, 10),
      label: pointLabel(time, granularity),
      revenue: round(value.revenue),
      grossProfit: round(value.grossProfit),
      units: round(value.units),
    }));

  return { granularity, granularityLabel, points };
}

function levelScore(level: HealthLevel): number {
  return level === "good" ? 100 : level === "watch" ? 60 : 25;
}

function buildHealth(
  financial: FinancialAnalysisResult,
  breakdown: InventoryBreakdown,
  inventoryTurns: number | null,
): BusinessHealth {
  const { summary } = financial;
  const points: HealthPoint[] = [];

  const marginLevel: HealthLevel =
    summary.grossMarginPercent >= 25
      ? "good"
      : summary.grossMarginPercent >= 12
        ? "watch"
        : "risk";

  points.push({
    id: "margin",
    label: "Margen de ganancia",
    value: `${units(summary.grossMarginPercent)}%`,
    level: marginLevel,
    message:
      marginLevel === "good"
        ? "De cada 100 lempiras vendidos queda una ganancia sana antes de gastos."
        : marginLevel === "watch"
          ? "El margen deja poco espacio para cubrir gastos fijos. Vale la pena revisar precios y costos de compra."
          : "El margen es muy bajo: casi todo lo que vendes se va en el costo de la mercadería.",
  });

  if (breakdown.total > 0) {
    const idle = breakdown.excess + breakdown.dead;
    const idleShare = (idle / breakdown.total) * 100;
    const idleLevel: HealthLevel = idleShare <= 10 ? "good" : idleShare <= 25 ? "watch" : "risk";

    points.push({
      id: "idle_capital",
      label: "Dinero detenido en inventario",
      value: `${units(idleShare)}% del inventario`,
      level: idleLevel,
      message:
        idleLevel === "good"
          ? "Casi todo el inventario se está moviendo."
          : `Hay ${money(idle)} en mercadería que no rota al ritmo esperado. Ese dinero podría estar comprando lo que sí se vende.`,
    });
  }

  if (inventoryTurns !== null) {
    const turnsLevel: HealthLevel =
      inventoryTurns >= 6 ? "good" : inventoryTurns >= 3 ? "watch" : "risk";

    points.push({
      id: "turns",
      label: "Rotación del inventario",
      value: `${units(inventoryTurns)} veces al año`,
      level: turnsLevel,
      message:
        turnsLevel === "good"
          ? "El inventario se renueva con frecuencia: el dinero invertido regresa rápido."
          : turnsLevel === "watch"
            ? "El inventario tarda en venderse. Cada compra inmoviliza el dinero por varios meses."
            : "El inventario rota muy lento: estás financiando mercadería que tarda en convertirse en efectivo.",
    });
  }

  if (summary.grossProfit > 0) {
    const riskShare = (summary.profitAtRisk / summary.grossProfit) * 100;
    const riskLevel: HealthLevel = riskShare <= 2 ? "good" : riskShare <= 8 ? "watch" : "risk";

    points.push({
      id: "stockout",
      label: "Ganancia expuesta por agotarse",
      value: money(summary.profitAtRisk),
      level: riskLevel,
      message:
        riskLevel === "good"
          ? "Las existencias alcanzan para cubrir el tiempo que tardan en llegar los pedidos."
          : "Hay productos que podrían agotarse antes de que llegue la reposición, y con ellos se pierde la venta.",
    });
  }

  const score = points.length
    ? Math.round(points.reduce((sum, point) => sum + levelScore(point.level), 0) / points.length)
    : 60;
  const level: HealthLevel = score >= 75 ? "good" : score >= 50 ? "watch" : "risk";

  const headline =
    level === "good"
      ? "Tu negocio va bien"
      : level === "watch"
        ? "Tu negocio va, pero hay cosas que atender"
        : "Hay señales que conviene atender pronto";

  const worst = [...points].sort(
    (left, right) => levelScore(left.level) - levelScore(right.level),
  )[0];

  const summaryText =
    level === "good"
      ? "Los indicadores principales están dentro de lo esperado. Abajo tienes las acciones que aun así conviene revisar."
      : worst
        ? `Lo más importante ahora mismo: ${worst.label.toLowerCase()}. ${worst.message}`
        : "Revisa las acciones recomendadas para entender qué mover primero.";

  return { score, level, headline, summary: summaryText, points };
}

function buildBreakdown(products: ProductAnalysis[]): InventoryBreakdown {
  let dead = 0;
  let excess = 0;
  let healthy = 0;

  for (const product of products) {
    if (product.inventoryValue <= 0) continue;

    const withoutRotation =
      !product.hasSales ||
      (product.daysSinceLastSale !== null && product.daysSinceLastSale >= DEAD_STOCK_DAYS);

    if (withoutRotation) {
      dead += product.inventoryValue;
      continue;
    }

    const trapped = Math.min(product.trappedCapital, product.inventoryValue);
    excess += trapped;
    healthy += product.inventoryValue - trapped;
  }

  return {
    healthy: round(healthy),
    excess: round(excess),
    dead: round(dead),
    total: round(healthy + excess + dead),
  };
}

function longDate(value: string): string {
  const time = new Date(`${value}T00:00:00Z`).getTime();
  if (!Number.isFinite(time)) return value;
  return new Date(time).toLocaleDateString("es-HN", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function buildHighlights(
  financial: FinancialAnalysisResult,
  breakdown: InventoryBreakdown,
  inventoryTurns: number | null,
  productsDrivingProfit: number,
  outOfStockCount: number,
): string[] {
  const { summary, period } = financial;
  const highlights: string[] = [];

  highlights.push(
    period.assumed
      ? `Los archivos no traen fechas, así que se leyeron como un período de ${period.days} días: vendiste ${money(summary.revenue)} y te quedaron ${money(summary.grossProfit)} de ganancia bruta.`
      : `Entre el ${longDate(period.from)} y el ${longDate(period.to)} vendiste ${money(summary.revenue)} y te quedaron ${money(summary.grossProfit)} de ganancia bruta, un margen de ${units(summary.grossMarginPercent)}%.`,
  );

  if (breakdown.total > 0) {
    const idle = breakdown.excess + breakdown.dead;
    highlights.push(
      idle > 0
        ? `Tu inventario vale ${money(breakdown.total)} al costo. De ese total, ${money(idle)} está en productos que no se mueven al ritmo esperado.`
        : `Tu inventario vale ${money(breakdown.total)} al costo y todo se está moviendo dentro de lo esperado.`,
    );
  }

  if (inventoryTurns !== null && inventoryTurns > 0) {
    highlights.push(
      `Al ritmo actual el inventario completo se renueva ${units(inventoryTurns)} veces al año: cada compra tarda alrededor de ${Math.round(365 / inventoryTurns)} días en convertirse en venta.`,
    );
  }

  if (productsDrivingProfit > 0 && summary.productsAnalyzed > 0) {
    highlights.push(
      productsDrivingProfit === 1
        ? `1 de ${summary.productsAnalyzed} productos genera el 80% de tu ganancia. Es el que no debería faltar nunca.`
        : `${productsDrivingProfit} de ${summary.productsAnalyzed} productos generan el 80% de tu ganancia. Son los que no deberían faltar nunca.`,
    );
  }

  if (outOfStockCount > 0) {
    highlights.push(
      outOfStockCount === 1
        ? "1 producto que sí se vende está hoy en cero existencias."
        : `${outOfStockCount} productos que sí se venden están hoy en cero existencias.`,
    );
  }

  if (summary.profitAtRisk > 0) {
    highlights.push(
      `Si no repones a tiempo los productos señalados, la venta que dejarías de hacer equivale a ${money(summary.profitAtRisk)} de ganancia.`,
    );
  }

  if (summary.productsWithoutCost > 0) {
    highlights.push(
      `${summary.productsWithoutCost} productos no traían costo en los archivos: su ganancia se reporta como cero para no inventar cifras.`,
    );
  }

  return highlights;
}

export function buildBusinessOverview(
  financial: FinancialAnalysisResult,
  sales: SaleRow[],
  datesDetected: boolean,
): BusinessOverview {
  const { products, summary, period } = financial;

  const breakdown = buildBreakdown(products);
  const costOfGoods = summary.revenue - summary.grossProfit;
  const annualCost = period.days > 0 ? (costOfGoods / period.days) * 365 : 0;
  const inventoryTurns =
    breakdown.total > 0 && annualCost > 0 ? round(annualCost / breakdown.total, 2) : null;

  const productsDrivingProfit = products.filter((product) => product.abcClass === "A").length;
  const outOfStockCount = products.filter(
    (product) => product.unitsSold > 0 && product.currentStock <= 0,
  ).length;

  return {
    health: buildHealth(financial, breakdown, inventoryTurns),
    highlights: buildHighlights(
      financial,
      breakdown,
      inventoryTurns,
      productsDrivingProfit,
      outOfStockCount,
    ),
    inventoryBreakdown: breakdown,
    timeline: buildTimeline(sales, datesDetected),
    rankings: [
      fastMovingRanking(products),
      highMarginRanking(products, summary.revenue),
      slowMovingRanking(products),
      topProfitRanking(products),
    ],
    outOfStockCount,
    inventoryTurnsPerYear: inventoryTurns,
    productsDrivingProfit,
  };
}
