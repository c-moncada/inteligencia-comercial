from pathlib import Path

import pandas as pd

from app.forecast import forecast_demand
from app.schemas import ForecastRequest

ROOT = Path(__file__).resolve().parents[3]


def _request_from_samples() -> ForecastRequest:
    sales = pd.read_csv(ROOT / "sample-data" / "sales.csv").to_dict(orient="records")
    inventory = pd.read_csv(ROOT / "sample-data" / "inventory.csv").to_dict(orient="records")
    return ForecastRequest(sales=sales, inventory=inventory)


def _request_until(limit: str) -> ForecastRequest:
    request = _request_from_samples()
    sales = [sale for sale in request.sales if sale.sale_date <= limit]
    return ForecastRequest(sales=sales, inventory=request.inventory)


def test_entrena_y_genera_decisiones_financieras() -> None:
    result = forecast_demand(_request_from_samples())

    assert result.status == "trained"
    assert result.evaluation is not None
    assert len(result.forecasts) >= 4
    assert result.evaluation.training_rows > 0
    assert all(item.forecast_min_30_days <= item.forecast_30_days for item in result.forecasts)
    assert all(item.forecast_max_30_days >= item.forecast_30_days for item in result.forecasts)
    assert all(item.confidence in {"high", "medium", "low"} for item in result.forecasts)
    assert any(item.suggested_purchase > 0 for item in result.forecasts)
    assert any(item.investment_required > 0 for item in result.forecasts)
    assert any(item.expected_gross_profit_from_purchase > 0 for item in result.forecasts)


def test_selecciona_el_metodo_con_menor_error() -> None:
    result = forecast_demand(_request_from_samples())
    assert result.evaluation is not None
    assert result.evaluation.selected_method in {
        "machine_learning",
        "historical_baseline",
        "hybrid_blend",
    }
    assert result.method == result.evaluation.selected_method
    assert result.method_label

    # El método elegido nunca puede tener más error que la línea base sola.
    if result.evaluation.selected_method == "machine_learning":
        assert result.evaluation.mae <= result.evaluation.baseline_mae


def test_usa_promedio_movil_con_historial_medio() -> None:
    result = forecast_demand(_request_until("2026-02-15"))

    assert result.status == "estimated"
    assert result.method == "moving_average"
    assert len(result.forecasts) >= 4
    assert all(item.forecast_30_days >= 0 for item in result.forecasts)
    # Con más de 60 días el método se evalúa contra los últimos 30 días reales.
    assert result.evaluation is not None
    assert result.evaluation.selected_method == "moving_average"


def test_usa_promedio_simple_con_historial_muy_corto() -> None:
    result = forecast_demand(_request_until("2025-12-14"))

    assert result.status == "insufficient_data"
    assert result.method == "simple_average"
    assert result.evaluation is None
    assert all(item.confidence == "low" for item in result.forecasts)


def test_rango_probable_siempre_contiene_al_pronostico() -> None:
    for limit in ("2025-12-14", "2026-02-15", "2026-07-31"):
        result = forecast_demand(_request_until(limit))
        for item in result.forecasts:
            assert item.forecast_min_30_days <= item.forecast_30_days <= item.forecast_max_30_days
            assert item.suggested_purchase >= 0
            assert item.investment_required >= 0
