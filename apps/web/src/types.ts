/** Espejo de los tipos que devuelve la API (apps/api/src/types.ts). */

export type InsightType =
  | "excess_inventory"
  | "stockout_risk"
  | "low_margin"
  | "profitable_product"
  | "dead_stock"
  | "demand_drop"
  | "demand_growth";

export type ResultSource = "ml" | "rules" | "hybrid" | "baseline";

export type ForecastMethod =
  | "machine_learning"
  | "historical_baseline"
  | "hybrid_blend"
  | "moving_average"
  | "simple_average"
  | "rules_only";

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
  leadTimeDays: number;
  unitCost: number;
  unitMargin: number;
  averageUnitPrice: number;
  inventoryValue: number;
  trendPercent: number | null;
  trend: "creciendo" | "estable" | "cayendo" | "sin datos";
  daysSinceLastSale: number | null;
  abcClass: "A" | "B" | "C";
  profitShare: number;
  costKnown: boolean;
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
  method?: ForecastMethod;
  method_label?: string;
}

export type DecisionType =
  | "restock"
  | "pause_purchases"
  | "review_margin"
  | "liquidate_dead_stock";

export interface BusinessDecision {
  id: string;
  type: DecisionType;
  priority: "high" | "medium" | "low";
  confidence: "high" | "medium" | "low";
  source: ResultSource;
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
  costCoverage: number;
  datesDetected: boolean;
  assumedPeriodDays: number | null;
  warnings: string[];
  notes: string[];
  errors: string[];
}

export type RankingMetric =
  | "turns_per_year"
  | "units_per_day"
  | "margin_percent"
  | "gross_profit"
  | "idle_capital";

export type RankingId = "fast_moving" | "high_margin" | "slow_moving" | "top_profit";

export interface RankedProduct {
  productId: string;
  productName: string;
  value: number;
  valueLabel: string;
  detail: string;
  unitsSold: number;
  revenue: number;
  grossProfit: number;
  marginPercent: number;
  currentStock: number;
  inventoryValue: number;
  coverageDays: number | null;
  daysSinceLastSale: number | null;
  turnsPerYear: number | null;
  sellThroughPercent: number | null;
  abcClass: "A" | "B" | "C";
  trend: ProductAnalysis["trend"];
}

export interface ProductRanking {
  id: RankingId;
  title: string;
  question: string;
  metric: RankingMetric;
  metricLabel: string;
  note: string;
  emptyMessage: string;
  items: RankedProduct[];
}

export interface TimelinePoint {
  date: string;
  label: string;
  revenue: number;
  grossProfit: number;
  units: number;
}

export interface SalesTimeline {
  granularity: "day" | "week" | "month";
  granularityLabel: string;
  points: TimelinePoint[];
}

export interface InventoryBreakdown {
  healthy: number;
  excess: number;
  dead: number;
  total: number;
}

export type HealthLevel = "good" | "watch" | "risk";

export interface HealthPoint {
  id: string;
  label: string;
  value: string;
  level: HealthLevel;
  message: string;
}

export interface BusinessHealth {
  score: number;
  level: HealthLevel;
  headline: string;
  summary: string;
  points: HealthPoint[];
}

export interface BusinessOverview {
  health: BusinessHealth;
  highlights: string[];
  inventoryBreakdown: InventoryBreakdown;
  timeline: SalesTimeline;
  rankings: ProductRanking[];
  outOfStockCount: number;
  inventoryTurnsPerYear: number | null;
  productsDrivingProfit: number;
}

export interface AnalysisResult {
  period: { from: string; to: string; days: number; assumed: boolean };
  summary: {
    revenue: number;
    grossProfit: number;
    grossMarginPercent: number;
    trappedCapital: number;
    profitAtRisk: number;
    productsAnalyzed: number;
    inventoryValue: number;
    deadStockValue: number;
    productsWithoutSales: number;
    productsWithoutCost: number;
  };
  insights: Insight[];
  products: ProductAnalysis[];
  assumptions: string[];
  forecast: DemandForecastResult;
  decisions: BusinessDecision[];
  decisionSummary: DecisionSummary;
  ingest: IngestReport;
  overview: BusinessOverview;
}
