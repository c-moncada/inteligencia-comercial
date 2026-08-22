# Motor de decisiones financieras — versión 0.5

## Flujo

```text
Pronóstico de demanda
        +
Inventario, costo, precio y tiempo de entrega
        ↓
Cálculos financieros
        ↓
Decisión priorizada y explicada
```

## Reposición

### Demanda diaria esperada

```text
demanda diaria = pronóstico de 30 días / 30
```

### Demanda durante la reposición

```text
demanda de reposición = demanda diaria × días de entrega
```

### Inventario de seguridad

```text
inventario de seguridad = demanda diaria × 7 días
```

### Compra sugerida

```text
compra sugerida =
  demanda durante la reposición
  + inventario de seguridad
  - inventario actual
```

El resultado nunca es menor que cero y se redondea hacia arriba.

### Inversión requerida

```text
inversión = compra sugerida × costo unitario actual
```

### Unidades de la compra que podrían venderse en 30 días

```text
unidades vendibles = mínimo(
  compra sugerida,
  demanda esperada - inventario actual
)
```

### Ganancia bruta esperada

```text
ganancia esperada = unidades vendibles × (precio promedio - costo)
```

### Rentabilidad bruta estimada

```text
rentabilidad = ganancia esperada / inversión × 100
```

No representa utilidad neta ni incorpora impuestos, flete, financiamiento o costos operativos.

### Recuperación estimada

```text
recuperación en días = inversión / ganancia bruta diaria esperada
```

### Plazo para decidir

```text
plazo = días de cobertura - días de entrega
```

Un resultado negativo indica que el inventario ya no alcanza para cubrir el tiempo de reposición.

## Pausa de compras

Se utiliza una cobertura objetivo inicial de 90 días.

```text
unidades excesivas = inventario actual - demanda diaria × 90
capital detenido = unidades excesivas × costo unitario
```

La acción recomendada es revisar pedidos abiertos, promoción, redistribución o devolución.

## Liberación de inventario sin rotación

Se genera cuando un producto tiene existencia y:

- No registró ninguna venta en el período analizado, o
- Su última venta ocurrió hace 60 días o más.

```text
capital inmovilizado = existencia × costo unitario
```

Es urgente cuando el capital inmovilizado supera L 10,000. A diferencia de la pausa de compras, aquí el problema no es comprar de más sino inventario que dejó de moverse: la acción recomendada es confirmar la vigencia del producto y decidir liquidación, promoción, traslado o devolución.

Los productos que aparecen en el inventario pero nunca en las ventas también entran aquí. En la versión anterior quedaban invisibles.

## Revisión de margen

La primera versión usa un margen objetivo configurable conceptualmente, fijado en 10% en el código.

```text
oportunidad = venta esperada 30 días × (10% - margen actual)
```

Solo se calcula cuando el margen actual es inferior al objetivo y el costo del producto viene en los archivos. Si el costo se asumió, no se afirma que el margen sea bajo.

## Priorización

Una reposición se clasifica como urgente cuando:

- El plazo para decidir es cero o negativo, o
- La ganancia expuesta supera L 5,000.

El exceso de inventario es urgente cuando:

- La cobertura supera 180 días, o
- El capital detenido supera L 25,000.

Cada decisión incluye además los motivos concretos que sustentan su prioridad: plazo vencido, ganancia expuesta, clase ABC del producto y tendencia de la demanda. Una reposición marcada como urgente baja a importante cuando la demanda del producto viene cayendo.

## Contexto por producto

Junto a cada decisión se calcula:

| Indicador | Cómo se obtiene |
|---|---|
| Clase ABC | Aporte acumulado a la ganancia bruta: A hasta 80%, B hasta 95%, C el resto |
| Tendencia | Unidades de la segunda mitad del período contra la primera mitad |
| Días desde la última venta | Diferencia entre la última venta del producto y la fecha más reciente del archivo |
| Valor del inventario | Existencia × costo unitario |

## Cuando no hay pronóstico del modelo

Si el servicio de machine learning no responde, o el historial no permite entrenarlo, el motor calcula las mismas decisiones con el promedio del período y las marca como cálculo por reglas, con confianza baja y un rango probable más amplio (±35%). La plataforma nunca se queda sin responder.

## Limitaciones actuales

Todavía no se consideran automáticamente:

- Pedidos pendientes.
- Cantidades mínimas o múltiplos de empaque.
- Flete e impuestos.
- Presupuesto máximo de compra.
- Restricciones de almacenamiento.
- Promociones futuras.
- Productos sustitutos.
- Variaciones futuras de precio o costo.

Estos datos serán necesarios antes de permitir recomendaciones automáticas de compra.


## Transparencia del origen

La interfaz distingue el origen de cada resultado:

| Etiqueta | Significado | Ejemplos |
|---|---|---|
| Usa machine learning | El valor fue estimado por el modelo seleccionado | Demanda esperada y rango probable |
| No usa ML | El valor sale de datos reales, reglas o fórmulas | Ventas históricas, margen y capital detenido |
| ML + reglas | El cálculo combina una predicción con datos y reglas de negocio | Compra sugerida, inversión y ganancia protegida |
| No usa ML · promedio | Se usó el promedio histórico en lugar del modelo | Demanda estimada cuando la línea base resulta más confiable |

La etiqueta describe el origen del cálculo, no garantiza que la recomendación sea correcta. Toda acción sigue requiriendo revisión empresarial.
