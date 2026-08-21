from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.metrics import mean_absolute_error

from .schemas import ForecastRequest, ForecastResponse, ModelEvaluation, ProductForecast

FORECAST_DAYS = 30
MINIMUM_HISTORY_DAYS = 120
SHORT_HISTORY_DAYS = 21
MEDIUM_EVALUATION_DAYS = 60
HOLDOUT_DAYS = 30
SAFETY_STOCK_DAYS = 7
INTERVAL_QUANTILE = 0.80
TREND_DAMPING = 0.5
MAXIMUM_TREND = 0.30

FEATURES = [
    "product_code",
    "units_today",
    "lag_1",
    "lag_7",
    "lag_14",
    "lag_28",
    "mean_7",
    "mean_14",
    "mean_28",
    "std_28",
    "day_of_week",
    "month",
]


@dataclass(frozen=True)
class PreparedData:
    frame: pd.DataFrame
    history_days: int
    min_date: pd.Timestamp
    max_date: pd.Timestamp
    product_names: dict[str, str]
    product_codes: dict[str, int]


def _round(value: float, decimals: int = 2) -> float:
    if not np.isfinite(value):
        return 0.0
    return round(float(value), decimals)


def _future_sum(series: pd.Series, days: int) -> pd.Series:
    target = pd.Series(0.0, index=series.index)
    valid = pd.Series(True, index=series.index)
    for offset in range(1, days + 1):
        shifted = series.shift(-offset)
        valid &= shifted.notna()
        target += shifted.fillna(0)
    return target.where(valid)


def _weighted_price_stats(request: ForecastRequest) -> dict[str, dict[str, float]]:
    sales = pd.DataFrame([row.model_dump() for row in request.sales])
    sales["positive_quantity"] = sales["quantity"].clip(lower=0)
    sales["weighted_price"] = sales["positive_quantity"] * sales["unit_price"]

    stats: dict[str, dict[str, float]] = {}
    for product_id, group in sales.groupby("product_id"):
        units = float(group["positive_quantity"].sum())
        average_price = (
            float(group["weighted_price"].sum()) / units
            if units > 0
            else float(group["unit_price"].mean())
        )
        stats[str(product_id)] = {"average_unit_price": max(0.0, average_price)}
    return stats


def prepare_daily_data(request: ForecastRequest) -> PreparedData:
    if not request.sales:
        raise ValueError("No se recibieron ventas para generar el pronóstico.")

    sales = pd.DataFrame([row.model_dump() for row in request.sales])
    sales["sale_date"] = pd.to_datetime(sales["sale_date"], errors="coerce")
    if sales["sale_date"].isna().any():
        raise ValueError("Existen fechas de venta inválidas.")

    sales["quantity"] = pd.to_numeric(sales["quantity"], errors="coerce")
    if sales["quantity"].isna().any():
        raise ValueError("Existen cantidades de venta inválidas.")

    sales["quantity_for_forecast"] = sales["quantity"].clip(lower=0)

    daily = (
        sales.groupby(["product_id", "product_name", "sale_date"], as_index=False)[
            "quantity_for_forecast"
        ]
        .sum()
        .rename(columns={"quantity_for_forecast": "units_today"})
    )

    min_date = daily["sale_date"].min().normalize()
    max_date = daily["sale_date"].max().normalize()
    all_dates = pd.date_range(min_date, max_date, freq="D")
    history_days = len(all_dates)

    product_names = (
        daily.drop_duplicates("product_id")
        .set_index("product_id")["product_name"]
        .to_dict()
    )
    product_ids = sorted(product_names)
    product_codes = {product_id: index for index, product_id in enumerate(product_ids)}

    completed: list[pd.DataFrame] = []
    for product_id in product_ids:
        product = daily[daily["product_id"] == product_id].set_index("sale_date")
        product_daily = product["units_today"].reindex(all_dates, fill_value=0).astype(float)
        frame = pd.DataFrame(
            {
                "sale_date": all_dates,
                "product_id": product_id,
                "product_name": product_names[product_id],
                "product_code": product_codes[product_id],
                "units_today": product_daily.to_numpy(),
            }
        )

        frame["lag_1"] = frame["units_today"].shift(1)
        frame["lag_7"] = frame["units_today"].shift(7)
        frame["lag_14"] = frame["units_today"].shift(14)
        frame["lag_28"] = frame["units_today"].shift(28)
        frame["mean_7"] = frame["units_today"].rolling(7, min_periods=7).mean()
        frame["mean_14"] = frame["units_today"].rolling(14, min_periods=14).mean()
        frame["mean_28"] = frame["units_today"].rolling(28, min_periods=28).mean()
        frame["std_28"] = (
            frame["units_today"].rolling(28, min_periods=28).std().fillna(0)
        )
        frame["day_of_week"] = frame["sale_date"].dt.dayofweek
        frame["month"] = frame["sale_date"].dt.month
        frame["target_30"] = _future_sum(frame["units_today"], FORECAST_DAYS)
        frame["baseline_30"] = frame["mean_28"] * FORECAST_DAYS
        completed.append(frame)

    return PreparedData(
        frame=pd.concat(completed, ignore_index=True),
        history_days=history_days,
        min_date=min_date,
        max_date=max_date,
        product_names=product_names,
        product_codes=product_codes,
    )


def _confidence_from_error(relative_error: float | None) -> str:
    if relative_error is None or not np.isfinite(relative_error):
        return "low"
    if relative_error <= 0.15:
        return "high"
    if relative_error <= 0.30:
        return "medium"
    return "low"


def _build_product_forecast(
    *,
    product_id: str,
    product_name: str,
    model_forecast: float,
    baseline_forecast: float,
    selected_forecast: float,
    error_band: float,
    relative_error: float | None,
    current_stock: float,
    lead_time_days: float,
    average_unit_price: float,
    unit_cost: float,
) -> ProductForecast:
    expected_daily = selected_forecast / FORECAST_DAYS
    forecast_min = max(0.0, selected_forecast - max(0.0, error_band))
    forecast_max = max(forecast_min, selected_forecast + max(0.0, error_band))

    demand_during_lead_time = expected_daily * max(0.0, lead_time_days)
    safety_stock = expected_daily * SAFETY_STOCK_DAYS
    reorder_target = demand_during_lead_time + safety_stock
    suggested_purchase = max(0, int(np.ceil(reorder_target - current_stock)))
    projected_shortage = max(0.0, demand_during_lead_time - current_stock)

    unit_margin = max(0.0, average_unit_price - unit_cost)
    profit_at_risk = projected_shortage * unit_margin
    investment_required = suggested_purchase * max(0.0, unit_cost)

    units_from_purchase_expected_to_sell = min(
        float(suggested_purchase),
        max(0.0, selected_forecast - current_stock),
    )
    expected_revenue = units_from_purchase_expected_to_sell * average_unit_price
    expected_gross_profit = units_from_purchase_expected_to_sell * unit_margin
    estimated_return = (
        (expected_gross_profit / investment_required) * 100
        if investment_required > 0
        else 0.0
    )

    daily_gross_profit = expected_daily * unit_margin
    payback_days = (
        investment_required / daily_gross_profit
        if investment_required > 0 and daily_gross_profit > 0
        else None
    )

    days_of_coverage = current_stock / expected_daily if expected_daily > 0 else None
    decision_deadline_days = (
        int(np.floor(days_of_coverage - lead_time_days))
        if days_of_coverage is not None
        else None
    )

    return ProductForecast(
        product_id=product_id,
        product_name=product_name,
        forecast_30_days=_round(selected_forecast),
        forecast_min_30_days=_round(forecast_min),
        forecast_max_30_days=_round(forecast_max),
        model_forecast_30_days=_round(model_forecast),
        baseline_forecast_30_days=_round(baseline_forecast),
        confidence=_confidence_from_error(relative_error),
        current_stock=_round(current_stock),
        lead_time_days=_round(lead_time_days),
        days_of_coverage=None if days_of_coverage is None else _round(days_of_coverage),
        expected_daily_demand=_round(expected_daily, 4),
        demand_during_lead_time=_round(demand_during_lead_time),
        safety_stock_units=_round(safety_stock),
        suggested_purchase=suggested_purchase,
        projected_shortage_units=_round(projected_shortage),
        decision_deadline_days=decision_deadline_days,
        average_unit_price=_round(average_unit_price),
        unit_cost=_round(unit_cost),
        unit_margin=_round(unit_margin),
        investment_required=_round(investment_required),
        expected_revenue_from_purchase=_round(expected_revenue),
        expected_gross_profit_from_purchase=_round(expected_gross_profit),
        estimated_return_percentage=_round(estimated_return),
        estimated_payback_days=None if payback_days is None else _round(payback_days, 1),
        profit_at_risk=_round(profit_at_risk),
    )


def _baseline_forecasts(
    prepared: PreparedData,
    request: ForecastRequest,
) -> list[ProductForecast]:
    """Promedio observado por producto, usando los días que existan.

    Con historiales muy cortos no hay ventana de 28 días, así que se promedia
    todo lo disponible: es preferible una estimación modesta a devolver cero.
    """
    inventory = {row.product_id: row for row in request.inventory}
    price_stats = _weighted_price_stats(request)

    forecasts: list[ProductForecast] = []
    for product_id, values in _daily_series(prepared).items():
        stock = inventory.get(product_id)
        if stock is None:
            continue

        history = values.to_numpy(dtype=float)
        window = history[-28:] if history.size >= 28 else history
        baseline = max(0.0, float(window.mean()) * FORECAST_DAYS) if window.size else 0.0
        daily_std = float(window.std()) if window.size > 1 else 0.0
        error_band = max(2.0, daily_std * np.sqrt(FORECAST_DAYS) * 1.28)
        average_price = price_stats.get(product_id, {}).get("average_unit_price", 0.0)

        forecasts.append(
            _build_product_forecast(
                product_id=product_id,
                product_name=prepared.product_names.get(product_id, product_id),
                model_forecast=baseline,
                baseline_forecast=baseline,
                selected_forecast=baseline,
                error_band=error_band,
                relative_error=None,
                current_stock=stock.current_stock,
                lead_time_days=stock.lead_time_days,
                average_unit_price=average_price,
                unit_cost=stock.unit_cost,
            )
        )
    return sorted(forecasts, key=lambda item: item.profit_at_risk, reverse=True)


def _daily_series(prepared: PreparedData) -> dict[str, pd.Series]:
    """Serie diaria completa de cada producto, con ceros en los días sin venta."""
    series: dict[str, pd.Series] = {}
    for product_id, group in prepared.frame.groupby("product_id"):
        ordered = group.sort_values("sale_date")
        series[str(product_id)] = pd.Series(
            ordered["units_today"].to_numpy(dtype=float),
            index=pd.DatetimeIndex(ordered["sale_date"]),
        )
    return series


def _weighted_daily(values: np.ndarray) -> float:
    """Promedio diario dando más peso a las semanas recientes."""
    if values.size == 0:
        return 0.0

    means: list[float] = []
    weights: list[float] = []
    for window, weight in ((7, 0.5), (14, 0.3), (28, 0.2)):
        if values.size >= window:
            means.append(float(values[-window:].mean()))
            weights.append(weight)

    if not means:
        return float(values.mean())
    return float(np.average(means, weights=weights))


def _damped_trend(values: np.ndarray) -> float:
    """Tendencia reciente amortiguada para no extrapolar de más."""
    if values.size < 28:
        return 0.0

    recent = float(values[-14:].mean())
    previous = float(values[-28:-14].mean())
    if previous <= 0:
        return 0.0

    change = (recent - previous) / previous
    return float(np.clip(change * TREND_DAMPING, -MAXIMUM_TREND, MAXIMUM_TREND))


def _moving_average_forecast(values: np.ndarray) -> tuple[float, float, float]:
    """Devuelve pronóstico a 30 días, banda de error y coeficiente de variación."""
    daily = _weighted_daily(values)
    trend = _damped_trend(values)
    forecast = max(0.0, daily * FORECAST_DAYS * (1 + trend))

    window = values[-28:] if values.size >= 28 else values
    deviation = float(window.std()) if window.size > 1 else 0.0
    band = max(2.0, deviation * np.sqrt(FORECAST_DAYS) * 1.28)
    variation = deviation / daily if daily > 0 else float("inf")
    return forecast, band, variation


def _confidence_from_variation(variation: float) -> str:
    if not np.isfinite(variation):
        return "low"
    if variation <= 0.6:
        return "medium"
    return "low"


def _rule_based_response(
    prepared: PreparedData,
    request: ForecastRequest,
    *,
    method: str,
    method_label: str,
    message: str,
    assumptions: list[str],
) -> ForecastResponse:
    """Pronóstico sin modelo entrenado, usando promedios con tendencia."""
    series = _daily_series(prepared)
    inventory = {row.product_id: row for row in request.inventory}
    price_stats = _weighted_price_stats(request)

    evaluate = prepared.history_days >= MEDIUM_EVALUATION_DAYS
    errors: dict[str, float] = {}
    relative_errors: dict[str, float | None] = {}
    method_absolute: list[float] = []
    baseline_absolute: list[float] = []

    if evaluate:
        for product_id, values in series.items():
            history = values.to_numpy(dtype=float)
            train = history[:-HOLDOUT_DAYS]
            actual = float(history[-HOLDOUT_DAYS:].sum())
            if train.size < 14:
                continue

            predicted, _, _ = _moving_average_forecast(train)
            baseline = float(train[-28:].mean() if train.size >= 28 else train.mean()) * FORECAST_DAYS

            errors[product_id] = abs(actual - predicted)
            relative_errors[product_id] = (
                abs(actual - predicted) / actual if actual > 0 else None
            )
            method_absolute.append(abs(actual - predicted))
            baseline_absolute.append(abs(actual - baseline))

    forecasts: list[ProductForecast] = []
    for product_id, values in series.items():
        stock = inventory.get(product_id)
        if stock is None:
            continue

        history = values.to_numpy(dtype=float)
        forecast, band, variation = _moving_average_forecast(history)
        baseline = float(history[-28:].mean() if history.size >= 28 else history.mean()) * FORECAST_DAYS
        measured = errors.get(product_id)
        relative = relative_errors.get(product_id)

        forecasts.append(
            _build_product_forecast(
                product_id=product_id,
                product_name=prepared.product_names.get(product_id, product_id),
                model_forecast=forecast,
                baseline_forecast=max(0.0, baseline),
                selected_forecast=forecast,
                error_band=max(band, measured) if measured is not None else band,
                relative_error=relative,
                current_stock=stock.current_stock,
                lead_time_days=stock.lead_time_days,
                average_unit_price=price_stats.get(product_id, {}).get("average_unit_price", 0.0),
                unit_cost=stock.unit_cost,
            )
        )

        if relative is None:
            forecasts[-1].confidence = _confidence_from_variation(variation)

    evaluation: ModelEvaluation | None = None
    if method_absolute:
        mae = float(np.mean(method_absolute))
        baseline_mae = float(np.mean(baseline_absolute))
        split = prepared.max_date - pd.Timedelta(HOLDOUT_DAYS - 1, unit="D")
        evaluation = ModelEvaluation(
            model_name="Promedio móvil ponderado con tendencia amortiguada",
            training_rows=int(sum(len(item) for item in series.values())),
            training_from=prepared.min_date.date().isoformat(),
            training_to=(split - pd.Timedelta(1, unit="D")).date().isoformat(),
            evaluation_from=split.date().isoformat(),
            evaluation_to=prepared.max_date.date().isoformat(),
            mae=_round(mae),
            baseline_mae=_round(baseline_mae),
            improvement_percent=_round(
                ((baseline_mae - mae) / baseline_mae) * 100 if baseline_mae > 0 else 0.0
            ),
            wape_percent=None,
            selected_method="moving_average",
        )

    return ForecastResponse(
        status="estimated",
        message=message,
        history_days=prepared.history_days,
        minimum_history_days=MINIMUM_HISTORY_DAYS,
        evaluation=evaluation,
        forecasts=sorted(forecasts, key=lambda item: item.profit_at_risk, reverse=True),
        assumptions=assumptions,
        method=method,
        method_label=method_label,
    )


def forecast_demand(request: ForecastRequest) -> ForecastResponse:
    prepared = prepare_daily_data(request)

    if prepared.history_days < SHORT_HISTORY_DAYS:
        return ForecastResponse(
            status="insufficient_data",
            message=(
                f"El historial cargado cubre {prepared.history_days} días. Con menos de "
                f"{SHORT_HISTORY_DAYS} solo se proyecta el promedio observado, sin ajuste por tendencia."
            ),
            history_days=prepared.history_days,
            minimum_history_days=MINIMUM_HISTORY_DAYS,
            evaluation=None,
            forecasts=_baseline_forecasts(prepared, request),
            assumptions=[
                "La proyección multiplica por 30 el promedio diario observado.",
                "El rango probable se aproxima con la variabilidad reciente del producto.",
                "Los días sin ventas se completan con cero unidades.",
                "Las devoluciones negativas no se interpretan como demanda negativa.",
                "Con este historial las cifras sirven para ordenar prioridades, no para comprometer compras grandes.",
            ],
            method="simple_average",
            method_label="Promedio simple del período",
        )

    if prepared.history_days < MINIMUM_HISTORY_DAYS:
        return _rule_based_response(
            prepared,
            request,
            method="moving_average",
            method_label="Promedio móvil con tendencia",
            message=(
                f"El historial cubre {prepared.history_days} días, menos de los {MINIMUM_HISTORY_DAYS} "
                "necesarios para entrenar el modelo con evaluación cronológica completa. Se usa un "
                "promedio móvil ponderado con tendencia amortiguada."
            ),
            assumptions=[
                "El promedio diario pondera las últimas 1, 2 y 4 semanas, dando más peso a lo reciente.",
                "La tendencia reciente se amortigua a la mitad y se limita a 30% para no extrapolar de más.",
                f"Con {MEDIUM_EVALUATION_DAYS} días o más, el método se evalúa contra los últimos {HOLDOUT_DAYS} días reales.",
                "Los días sin ventas se completan con cero unidades.",
                "Al aumentar el historial, la plataforma cambia automáticamente al modelo de machine learning si resulta mejor.",
            ],
        )

    dataset = prepared.frame.dropna(subset=FEATURES + ["target_30", "baseline_30"]).copy()
    eligible_dates = sorted(dataset["sale_date"].unique())
    if len(eligible_dates) <= HOLDOUT_DAYS:
        return ForecastResponse(
            status="insufficient_data",
            message=(
                "No hay suficientes fechas utilizables después de crear las variables históricas. "
                "Se usa el promedio histórico reciente."
            ),
            history_days=prepared.history_days,
            minimum_history_days=MINIMUM_HISTORY_DAYS,
            evaluation=None,
            forecasts=_baseline_forecasts(prepared, request),
            assumptions=["Se utiliza temporalmente la línea base histórica."],
            method="historical_baseline",
            method_label="Promedio histórico",
        )

    evaluation_start = pd.Timestamp(eligible_dates[-HOLDOUT_DAYS])
    train = dataset[dataset["sale_date"] < evaluation_start].copy()
    test = dataset[dataset["sale_date"] >= evaluation_start].copy()

    if train.empty or test.empty:
        raise ValueError("No fue posible crear una separación cronológica de entrenamiento y evaluación.")

    model = GradientBoostingRegressor(
        loss="huber",
        learning_rate=0.03,
        n_estimators=300,
        max_depth=3,
        min_samples_leaf=3,
        random_state=42,
    )
    model.fit(train[FEATURES], train["target_30"])

    model_predictions = np.clip(model.predict(test[FEATURES]), 0, None)
    baseline_predictions = np.clip(test["baseline_30"].to_numpy(), 0, None)
    actual = test["target_30"].to_numpy()

    blend_predictions = (model_predictions + baseline_predictions) / 2

    mae = float(mean_absolute_error(actual, model_predictions))
    baseline_mae = float(mean_absolute_error(actual, baseline_predictions))
    blend_mae = float(mean_absolute_error(actual, blend_predictions))
    improvement_percent = (
        ((baseline_mae - mae) / baseline_mae) * 100 if baseline_mae > 0 else 0.0
    )

    # Se compite el modelo contra la línea base y contra la mezcla de ambos:
    # promediarlos suele reducir el error cuando ninguno domina con claridad.
    candidates = {
        "machine_learning": (mae, model_predictions),
        "historical_baseline": (baseline_mae, baseline_predictions),
        "hybrid_blend": (blend_mae, blend_predictions),
    }
    selected_method = min(candidates, key=lambda name: candidates[name][0])
    selected_test_predictions = candidates[selected_method][1]
    absolute_error_sum = float(np.abs(actual - model_predictions).sum())
    actual_sum = float(np.abs(actual).sum())
    wape = (absolute_error_sum / actual_sum) * 100 if actual_sum > 0 else None

    evaluated = test[["product_id", "target_30"]].copy()
    evaluated["selected_prediction"] = selected_test_predictions
    evaluated["absolute_error"] = np.abs(
        evaluated["target_30"] - evaluated["selected_prediction"]
    )

    error_bands = (
        evaluated.groupby("product_id")["absolute_error"]
        .quantile(INTERVAL_QUANTILE)
        .to_dict()
    )
    relative_errors: dict[str, float | None] = {}
    for product_id, group in evaluated.groupby("product_id"):
        actual_mean = float(group["target_30"].abs().mean())
        relative_errors[str(product_id)] = (
            float(group["absolute_error"].mean()) / actual_mean
            if actual_mean > 0
            else None
        )

    latest = (
        prepared.frame.dropna(subset=FEATURES)
        .sort_values("sale_date")
        .groupby("product_id", as_index=False)
        .tail(1)
        .copy()
    )
    latest["model_forecast"] = np.clip(model.predict(latest[FEATURES]), 0, None)

    inventory = {row.product_id: row for row in request.inventory}
    price_stats = _weighted_price_stats(request)

    forecasts: list[ProductForecast] = []
    for row in latest.itertuples(index=False):
        stock = inventory.get(row.product_id)
        if stock is None:
            continue
        model_forecast = max(0.0, float(row.model_forecast))
        baseline_forecast = max(0.0, float(row.baseline_30))
        if selected_method == "machine_learning":
            selected_forecast = model_forecast
        elif selected_method == "historical_baseline":
            selected_forecast = baseline_forecast
        else:
            selected_forecast = (model_forecast + baseline_forecast) / 2
        average_price = price_stats.get(row.product_id, {}).get("average_unit_price", 0.0)
        forecasts.append(
            _build_product_forecast(
                product_id=row.product_id,
                product_name=row.product_name,
                model_forecast=model_forecast,
                baseline_forecast=baseline_forecast,
                selected_forecast=selected_forecast,
                error_band=float(error_bands.get(row.product_id, mae)),
                relative_error=relative_errors.get(str(row.product_id)),
                current_stock=stock.current_stock,
                lead_time_days=stock.lead_time_days,
                average_unit_price=average_price,
                unit_cost=stock.unit_cost,
            )
        )

    evaluation = ModelEvaluation(
        model_name="GradientBoostingRegressor (Huber)",
        training_rows=len(train),
        training_from=train["sale_date"].min().date().isoformat(),
        training_to=train["sale_date"].max().date().isoformat(),
        evaluation_from=test["sale_date"].min().date().isoformat(),
        evaluation_to=test["sale_date"].max().date().isoformat(),
        mae=_round(mae),
        baseline_mae=_round(baseline_mae),
        improvement_percent=_round(improvement_percent),
        wape_percent=None if wape is None else _round(wape),
        selected_method=selected_method,
    )

    method_labels = {
        "machine_learning": "Machine learning",
        "historical_baseline": "Promedio histórico",
        "hybrid_blend": "Mezcla de modelo y promedio",
    }
    selected_descriptions = {
        "machine_learning": "el modelo de machine learning",
        "historical_baseline": "la línea base histórica, porque obtuvo menor error",
        "hybrid_blend": "la mezcla del modelo con la línea base, porque obtuvo el menor error de los tres",
    }
    selected_label = selected_descriptions[selected_method]

    return ForecastResponse(
        status="trained",
        message=(
            f"El modelo fue entrenado y evaluado. Para las decisiones se seleccionó {selected_label}. "
            "Los resultados se expresan como rangos y se convierten en inversión, rentabilidad y urgencia."
        ),
        history_days=prepared.history_days,
        minimum_history_days=MINIMUM_HISTORY_DAYS,
        evaluation=evaluation,
        forecasts=sorted(forecasts, key=lambda item: item.profit_at_risk, reverse=True),
        assumptions=[
            "El objetivo es estimar las unidades que se venderán durante los próximos 30 días.",
            "El rango probable usa el error observado por producto en la evaluación cronológica.",
            "Se comparan tres candidatos (modelo, promedio histórico y la mezcla de ambos) y se usa el de menor error.",
            "La compra sugerida cubre el tiempo de reposición más siete días de inventario de seguridad.",
            "La rentabilidad estimada usa el precio promedio observado y el costo actual del inventario.",
            "Las cifras son apoyo para decidir; deben revisarse junto con pedidos pendientes y efectivo disponible.",
        ],
        method=selected_method,
        method_label=method_labels[selected_method],
    )
