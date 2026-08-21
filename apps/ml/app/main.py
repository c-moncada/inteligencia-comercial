from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .forecast import forecast_demand
from .schemas import ForecastRequest, ForecastResponse

app = FastAPI(
    title="Inteligencia Comercial ML",
    version="0.4.0",
    description="Pronóstico de demanda convertido en decisiones financieras para el MVP.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/api/ml/health")
def health() -> dict[str, bool | str]:
    return {"ok": True, "version": "0.4.0"}


@app.post("/api/ml/forecast", response_model=ForecastResponse)
def forecast(request: ForecastRequest) -> ForecastResponse:
    try:
        return forecast_demand(request)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
