# Modelo de machine learning — versión 0.4

## Objetivo

Estimar las unidades que se venderán por producto durante los próximos 30 días.

El modelo no toma por sí solo la decisión de comprar. Su pronóstico es una entrada para el motor financiero.

## Variables

- Unidades del día actual.
- Ventas de hace 1, 7, 14 y 28 días.
- Promedios móviles de 7, 14 y 28 días.
- Desviación de los últimos 28 días.
- Día de la semana.
- Mes.
- Código interno del producto.

## Modelo

```text
GradientBoostingRegressor
Pérdida: Huber
```

La pérdida Huber reduce la influencia de observaciones extremadamente altas o bajas.

## Método según el historial disponible

La plataforma elige el método por la cantidad de días cargados. Ya no responde "datos insuficientes" y se detiene: siempre entrega una estimación, indicando con qué método se calculó.

| Historial | Método | Etiqueta mostrada |
|---|---|---|
| Menos de 21 días | Promedio diario observado × 30 | Promedio simple del período |
| 21 a 119 días | Promedio móvil ponderado (1, 2 y 4 semanas) con tendencia amortiguada | Promedio móvil con tendencia |
| 120 días o más | Modelo entrenado y evaluado contra la línea base | Machine learning, Promedio histórico o Mezcla |

El promedio móvil pondera las últimas semanas dando más peso a lo reciente:

```text
promedio diario = 0.5 × media(7 días) + 0.3 × media(14 días) + 0.2 × media(28 días)
tendencia = (media(últimos 14) - media(14 anteriores)) / media(14 anteriores)
pronóstico = promedio diario × 30 × (1 + tendencia × 0.5)
```

La tendencia se amortiza a la mitad y se limita a ±30% para no extrapolar de más. Con 60 días o más, este método también se evalúa contra los últimos 30 días reales.

## Evaluación

La separación es cronológica:

```text
Fechas antiguas → entrenamiento
Fechas posteriores → evaluación
```

Con historial completo se comparan tres candidatos sobre los mismos 30 días de evaluación:

```text
1. Modelo entrenado
2. Línea base: promedio diario de 28 días × 30
3. Mezcla: promedio de los dos anteriores
```

Se usa el de menor MAE. La mezcla suele ganar cuando ninguno de los dos domina con claridad, y el resultado se reporta como "Mezcla de modelo y promedio".

## Rango probable

Para cada producto se mide el error absoluto durante la evaluación. El rango mostrado usa el percentil 80 de esos errores:

```text
mínimo = pronóstico - banda de error
máximo = pronóstico + banda de error
```

El rango es una aproximación operativa, no un intervalo estadístico de garantía contractual.

## Confianza

Se compara el error promedio del producto contra su demanda real promedio:

- Alta: error relativo de hasta 15%.
- Media: más de 15% y hasta 30%.
- Baja: más de 30% o historial insuficiente.

## Cuando no hay fechas o el servicio no está disponible

- Si los archivos no traen fechas de venta, no se entrena ningún modelo: la demanda se estima con el promedio del período asumido y todo queda marcado como cálculo por reglas.
- Si el servicio de machine learning no responde, la API calcula las mismas decisiones con reglas de inventario sobre el historial cargado. La plataforma sigue funcionando, con confianza baja y la etiqueta correspondiente.

## Campos financieros derivados

Por producto se generan:

- Demanda esperada y rango probable.
- Días de cobertura.
- Demanda durante el tiempo de reposición.
- Inventario de seguridad.
- Compra sugerida.
- Inversión requerida.
- Ingreso y ganancia bruta esperados de la compra.
- Rentabilidad bruta estimada.
- Días estimados para recuperar la inversión mediante margen bruto.
- Ganancia expuesta antes de que llegue la reposición.
- Días restantes para decidir.

Consulta [Motor de decisiones](business-decisions.md) para las fórmulas y limitaciones.
