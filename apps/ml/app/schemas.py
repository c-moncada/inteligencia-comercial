from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class SaleRow(BaseModel):
    sale_id: str
    sale_date: str
    product_id: str
    product_name: str
    quantity: float
    unit_price: float
    unit_cost: float
    customer_id: str | None = None


class InventoryRow(BaseModel):
    product_id: str
    product_name: str
    current_stock: float
    unit_cost: float
    lead_time_days: float


class ForecastRequest(BaseModel):
    sales: list[SaleRow]
    inventory: list[InventoryRow]


class ModelEvaluation(BaseModel):
    model_name: str
    training_rows: int
    training_from: str
    training_to: str
    evaluation_from: str
    evaluation_to: str
    mae: float
    baseline_mae: float
    improvement_percent: float
    wape_percent: float | None
    selected_method: Literal[
        "machine_learning",
        "historical_baseline",
        "hybrid_blend",
        "moving_average",
        "simple_average",
    ]


class ProductForecast(BaseModel):
    product_id: str
    product_name: str

    forecast_30_days: float = Field(ge=0)
    forecast_min_30_days: float = Field(ge=0)
    forecast_max_30_days: float = Field(ge=0)
    model_forecast_30_days: float = Field(ge=0)
    baseline_forecast_30_days: float = Field(ge=0)
    confidence: Literal["high", "medium", "low"]

    current_stock: float
    lead_time_days: float
    days_of_coverage: float | None
    expected_daily_demand: float = Field(ge=0)
    demand_during_lead_time: float = Field(ge=0)
    safety_stock_units: float = Field(ge=0)
    suggested_purchase: int = Field(ge=0)
    projected_shortage_units: float = Field(ge=0)
    decision_deadline_days: int | None

    average_unit_price: float = Field(ge=0)
    unit_cost: float = Field(ge=0)
    unit_margin: float = Field(ge=0)
    investment_required: float = Field(ge=0)
    expected_revenue_from_purchase: float = Field(ge=0)
    expected_gross_profit_from_purchase: float = Field(ge=0)
    estimated_return_percentage: float = Field(ge=0)
    estimated_payback_days: float | None
    profit_at_risk: float = Field(ge=0)


class ForecastResponse(BaseModel):
    status: Literal["trained", "estimated", "insufficient_data"]
    message: str
    history_days: int
    minimum_history_days: int
    evaluation: ModelEvaluation | None
    forecasts: list[ProductForecast]
    assumptions: list[str]
    method: str | None = None
    method_label: str | None = None
