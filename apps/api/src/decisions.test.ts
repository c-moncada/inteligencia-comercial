import assert from "node:assert/strict";
import test from "node:test";
import { analyzeBusinessData } from "./analyze.js";
import { buildBusinessDecisions } from "./decisions.js";
import { demoInventory, demoSales } from "./demo.js";
import type { DemandForecastResult } from "./types.js";

const forecast: DemandForecastResult = {
  status: "trained",
  message: "Modelo evaluado",
  history_days: 243,
  minimum_history_days: 120,
  evaluation: {
    model_name: "test",
    training_rows: 620,
    training_from: "2025-12-29",
    training_to: "2026-06-01",
    evaluation_from: "2026-06-02",
    evaluation_to: "2026-07-01",
    mae: 10,
    baseline_mae: 12,
    improvement_percent: 16.67,
    wape_percent: 4,
    selected_method: "machine_learning",
  },
  assumptions: [],
  forecasts: [
    {
      product_id: "P-004",
      product_name: "Producto por agotarse",
      forecast_30_days: 393,
      forecast_min_30_days: 370,
      forecast_max_30_days: 416,
      model_forecast_30_days: 393,
      baseline_forecast_30_days: 426,
      confidence: "high",
      current_stock: 20,
      lead_time_days: 15,
      days_of_coverage: 1.53,
      expected_daily_demand: 13.1,
      demand_during_lead_time: 196.5,
      safety_stock_units: 91.7,
      suggested_purchase: 269,
      projected_shortage_units: 176.5,
      decision_deadline_days: -14,
      average_unit_price: 160,
      unit_cost: 105,
      unit_margin: 55,
      investment_required: 28_245,
      expected_revenue_from_purchase: 43_040,
      expected_gross_profit_from_purchase: 14_795,
      estimated_return_percentage: 52.38,
      estimated_payback_days: 39.2,
      profit_at_risk: 9_707.5,
    },
  ],
};

test("convierte el pronóstico en decisiones económicas", () => {
  const financial = analyzeBusinessData(demoSales, demoInventory);
  const { decisions, summary } = buildBusinessDecisions(financial, forecast);

  const restock = decisions.find((item) => item.type === "restock");
  assert.ok(restock);
  assert.equal(restock.priority, "high");
  assert.equal(restock.suggestedPurchase, 269);
  assert.equal(restock.investmentRequired, 28_245);
  assert.ok(restock.expectedGrossProfit > 0);
  assert.ok(summary.recommendedInvestment > 0);
  assert.ok(summary.profitProtected > 0);
  assert.ok(decisions.some((item) => item.type === "pause_purchases"));
  assert.ok(decisions.some((item) => item.type === "review_margin"));
});

test("genera decisiones aunque el servicio de machine learning no responda", () => {
  const financial = analyzeBusinessData(demoSales, demoInventory);
  const { decisions, summary } = buildBusinessDecisions(financial, {
    status: "unavailable",
    message: "servicio no disponible",
    history_days: 0,
    minimum_history_days: 120,
    evaluation: null,
    forecasts: [],
    assumptions: [],
  });

  const restock = decisions.find((item) => item.type === "restock");
  assert.ok(restock, "debe existir al menos una reposición calculada con reglas");
  assert.equal(restock.source, "rules");
  assert.equal(restock.confidence, "low");
  assert.ok(restock.suggestedPurchase > 0);
  assert.ok(restock.investmentRequired > 0);
  assert.ok(summary.recommendedInvestment > 0);
  assert.ok(decisions.every((item) => item.reasons.length > 0));
});

test("propone liberar el inventario que dejó de rotar", () => {
  const financial = analyzeBusinessData(demoSales, demoInventory);
  const { decisions, summary } = buildBusinessDecisions(financial, forecast);

  const dead = decisions.filter((item) => item.type === "liquidate_dead_stock");
  assert.ok(dead.length >= 2);
  assert.ok(dead.some((item) => item.productId === "P-005"));
  assert.ok(dead.some((item) => item.productId === "P-006"));
  assert.ok(summary.deadStockValue > 0);
  assert.ok(dead.every((item) => item.suggestedPurchase === 0));
});
