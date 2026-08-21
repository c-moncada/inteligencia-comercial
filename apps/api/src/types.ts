export interface SaleRow {
  sale_id: string;
  sale_date: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  unit_cost: number;
  customer_id?: string;
}

export interface InventoryRow {
  product_id: string;
  product_name: string;
  current_stock: number;
  unit_cost: number;
  lead_time_days: number;
  unit_price?: number;
  min_stock?: number;
  category?: string;
}

export type InsightType =
  | "excess_inventory"
  | "stockout_risk"
  | "low_margin"
  | "profitable_product"
  | "dead_stock"
  | "demand_drop"
  | "demand_growth";

export interface ProductAnalysis {
  productId: string;
  productName: string;
  unitsSold: number;
  revenue: number;
  grossProfit: number;
  marginPercent: number;
  averageDailyDemand: number;
  predictedDemand30Days: number;
  currentStock: number;
  coverageDays: number | null;
  suggestedPurchase: number;
  trappedCapital: number;
  profitAtRisk: number;

  /** Días de reposición usados para este producto. */
  leadTimeDays: number;
  /** Costo unitario vigente tomado del inventario o de las ventas. */
  unitCost: number;
  /** Ganancia bruta por unidad observada en el período. */
  unitMargin: number;
  /** Precio promedio ponderado por unidades vendidas. */
  averageUnitPrice: number;
  /** Valor del inventario actual al costo. */
  inventoryValue: number;
  /** Variación porcentual entre la última mitad del período y la anterior. */
  trendPercent: number | null;
  trend: "creciendo" | "estable" | "cayendo" | "sin datos";
  /** Días transcurridos desde la última venta registrada. */
  daysSinceLastSale: number | null;
  /** Clasificación ABC por aporte a la ganancia bruta acumulada. */
  abcClass: "A" | "B" | "C";
  /** Participación en la ganancia bruta total. */
  profitShare: number;
  /** Falso cuando el costo se asumió porque no venía en los archivos. */
  costKnown: boolean;
  /** Falso cuando el producto existe en inventario pero no registró ventas. */
  hasSales: boolean;
}

export interface Insight {
  type: InsightType;
  priority: "high" | "medium" | "low";
  title: string;
  explanation: string;
  recommendedAction: string;
  impactAmount: number;
  productId: string;
  productName: string;
}

export interface FinancialAnalysisResult {
  period: {
    from: string;
    to: string;
    days: number;
    /** Verdadero cuando el período se asumió porque los datos no traen fechas. */
    assumed: boolean;
  };
  summary: {
    revenue: number;
    grossProfit: number;
    grossMarginPercent: number;
    trappedCapital: number;
    profitAtRisk: number;
    productsAnalyzed: number;
    /** Valor total del inventario al costo. */
    inventoryValue: number;
    /** Inventario sin ventas en el período, valorado al costo. */
    deadStockValue: number;
    productsWithoutSales: number;
    productsWithoutCost: number;
  };
  insights: Insight[];
  products: ProductAnalysis[];
  assumptions: string[];
}

export interface ModelEvaluation {
  model_name: string;
  training_rows: number;
  training_from: string;
  training_to: string;
  evaluation_from: string;
  evaluation_to: string;
  mae: number;
  baseline_mae: number;
  improvement_percent: number;
  wape_percent: number | null;
  selected_method: ForecastMethod;
}

export type ForecastMethod =
  | "machine_learning"
  | "historical_baseline"
  | "hybrid_blend"
  | "moving_average"
  | "simple_average"
  | "rules_only";

export interface ProductForecast {
  product_id: string;
  product_name: string;
  forecast_30_days: number;
  forecast_min_30_days: number;
  forecast_max_30_days: number;
  model_forecast_30_days: number;
  baseline_forecast_30_days: number;
  confidence: "high" | "medium" | "low";

  current_stock: number;
  lead_time_days: number;
  days_of_coverage: number | null;
  expected_daily_demand: number;
  demand_during_lead_time: number;
  safety_stock_units: number;
  suggested_purchase: number;
  projected_shortage_units: number;
  decision_deadline_days: number | null;

  average_unit_price: number;
  unit_cost: number;
  unit_margin: number;
  investment_required: number;
  expected_revenue_from_purchase: number;
  expected_gross_profit_from_purchase: number;
  estimated_return_percentage: number;
  estimated_payback_days: number | null;
  profit_at_risk: number;
}

export interface DemandForecastResult {
  status: "trained" | "estimated" | "insufficient_data" | "unavailable" | "rules_only";
  message: string;
  history_days: number;
  minimum_history_days: number;
  evaluation: ModelEvaluation | null;
  forecasts: ProductForecast[];
  assumptions: string[];
  /** Método realmente usado para las cifras que se muestran. */
  method?: ForecastMethod;
  method_label?: string;
}

export type DecisionType =
  | "restock"
  | "pause_purchases"
  | "review_margin"
  | "liquidate_dead_stock";

/** Origen de un resultado: modelo, regla financiera o combinación de ambos. */
export type ResultSource = "ml" | "rules" | "hybrid" | "baseline";

export interface BusinessDecision {
  id: string;
  type: DecisionType;
  priority: "high" | "medium" | "low";
  confidence: "high" | "medium" | "low";
  source: ResultSource;
  /** Motivos concretos que sustentan la prioridad asignada. */
  reasons: string[];
  daysSinceLastSale: number | null;
  trend: "creciendo" | "estable" | "cayendo" | "sin datos";
  productId: string;
  productName: string;
  title: string;
  explanation: string;
  recommendedAction: string;
  impactLabel: string;
  impactAmount: number;

  forecastExpectedUnits: number | null;
  forecastMinimumUnits: number | null;
  forecastMaximumUnits: number | null;
  currentStock: number;
  suggestedPurchase: number;
  leadTimeDays: number;
  daysOfCoverage: number | null;
  decisionDeadlineDays: number | null;

  investmentRequired: number;
  expectedRevenue: number;
  expectedGrossProfit: number;
  estimatedReturnPercentage: number;
  estimatedPaybackDays: number | null;
  profitAtRisk: number;
  trappedCapital: number;
  marginOpportunity: number;
}

export interface DecisionSummary {
  /** Inventario sin rotación, valorado al costo. */
  deadStockValue: number;
  capitalToRelease: number;
  profitProtected: number;
  recommendedInvestment: number;
  marginOpportunity: number;
  urgentActions: number;
  totalActions: number;
}

export interface IngestColumnMapping {
  field: string;
  fieldLabel: string;
  column: string;
  /** Certeza del reconocimiento, de 0 a 1. */
  confidence: number;
  method: string;
  note?: string;
}

export interface IngestIssue {
  level: "info" | "warning";
  message: string;
  count: number;
}

export interface IngestTableReport {
  source: string;
  sheet?: string;
  role: "sales" | "inventory" | "catalog" | "both" | "ignored";
  format: string;
  encoding: string;
  delimiter: string;
  headerLine: number;
  columns: string[];
  mappings: IngestColumnMapping[];
  unmappedColumns: string[];
  rowsRead: number;
  rowsUsed: number;
  rowsDiscarded: number;
  issues: IngestIssue[];
  notes: string[];
}

export interface IngestReport {
  files: { name: string; sizeBytes: number; tables: number; format: string }[];
  tables: IngestTableReport[];
  salesRows: number;
  inventoryRows: number;
  productsWithSales: number;
  productsWithInventory: number;
  productsMatched: number;
  catalogProducts: number;
  inventoryProvided: boolean;
  /** Proporción de productos con costo real disponible. */
  costCoverage: number;
  datesDetected: boolean;
  assumedPeriodDays: number | null;
  warnings: string[];
  notes: string[];
  errors: string[];
}

export interface AnalysisResult extends FinancialAnalysisResult {
  forecast: DemandForecastResult;
  decisions: BusinessDecision[];
  decisionSummary: DecisionSummary;
  ingest: IngestReport;
}
