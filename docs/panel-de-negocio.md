# Panel de negocio — versión 0.5

Todo lo que se ve en la pestaña **Resumen** sale de este cálculo. Está separado
del motor de decisiones a propósito: aquel responde *qué hacer*, este responde
*cómo va el negocio*.

Código: [`apps/api/src/business.ts`](../apps/api/src/business.ts).

## Rotación por producto

```text
rotación anual = (unidades vendidas / días del período) × 365 / existencia actual
```

Es cuántas veces al año se vendería el inventario que hoy hay de ese producto,
al ritmo del período cargado. Cuando la existencia es cero la rotación no se
calcula: no hay nada que rotar, y el producto aparece en la lista de agotados.

```text
venta sobre lo disponible = unidades vendidas / (unidades vendidas + existencia actual)
```

## Baja rotación

Un producto entra a la lista de baja rotación si tiene inventario valorizado y
cumple al menos una condición:

| Condición | Significado |
|---|---|
| No registró ventas en el período | Nunca se movió |
| Última venta hace 60 días o más | Dejó de moverse |
| Sin demanda para calcular cobertura | No hay ritmo de venta |
| Cobertura mayor a 90 días | Hay más de lo que se venderá en un trimestre |
| Rotación menor a 2 veces al año | Cada compra tarda más de seis meses en venderse |

La lista se ordena por el dinero inmovilizado al costo, no por qué tan lenta es
la rotación: lo accionable es dónde está el capital más grande detenido.

## Mayor rotación

Se ordena por rotación anual, de mayor a menor, entre los productos que tienen
ventas, tienen existencia y **no** califican como de baja rotación. Sin esa
última exclusión un producto estacional que dejó de venderse hace meses
aparecería arriba, porque el promedio del período todavía lo favorece.

Cuando no hay existencias cargadas para al menos tres productos, la lista cambia
de métrica y se ordena por unidades vendidas al día. La respuesta indica cuál de
las dos se usó en el campo `metric`.

## Mayor margen de ganancia

```text
margen bruto % = (ventas - costo de lo vendido) / ventas × 100
```

Solo entran los productos cuyo costo real venía en los archivos. Los productos
sin costo se excluyen en vez de mostrarles margen cero, que se leería como un
producto malísimo cuando en realidad es un dato que falta.

Con más de diez productos candidatos se descartan los que aportan menos del 0,5%
de la venta total, siempre que queden al menos cinco: un margen del 80% sobre una
venta de L 200 no es una oportunidad, es ruido.

## Los que más ganancia dejan

Ganancia bruta acumulada en el período, de mayor a menor. Coincide con la
clasificación ABC del análisis financiero: los primeros de esta lista son los de
clase A.

## Composición del inventario

Cada producto con inventario valorizado cae en una sola categoría:

| Categoría | Regla |
|---|---|
| Detenido | Sin ventas en el período, o última venta hace 60 días o más |
| De más | La parte de la existencia que supera 90 días de demanda |
| Se está moviendo | El resto |

La suma de las tres categorías es igual al valor total del inventario al costo.

## Rotación del inventario completo

```text
costo anualizado = (ventas - ganancia bruta) / días del período × 365
rotación         = costo anualizado / valor del inventario
días de ciclo    = 365 / rotación
```

## Puntaje de salud

Se calculan hasta cuatro indicadores. Cada uno vale 100 si está bien, 60 si hay
que vigilarlo y 25 si es un riesgo. El puntaje es el promedio de los indicadores
que sí pudieron calcularse.

| Indicador | Bien | Vigilar | Riesgo |
|---|---|---|---|
| Margen de ganancia | 25% o más | 12% a 25% | Menos de 12% |
| Dinero detenido sobre el inventario | 10% o menos | 10% a 25% | Más de 25% |
| Rotación del inventario | 6 o más al año | 3 a 6 | Menos de 3 |
| Ganancia expuesta sobre la ganancia bruta | 2% o menos | 2% a 8% | Más de 8% |

El nivel general es *bien* con 75 o más, *hay que atender* con 50 a 74 y *riesgo*
por debajo de 50. La frase que resume el panel toma el indicador peor calificado.

Los indicadores que no se pueden calcular no penalizan. Sin archivo de inventario
no hay rotación ni dinero detenido, y el puntaje sale del margen y de la ganancia
expuesta.

## Evolución de las ventas

Las ventas se agrupan por fecha y la escala se elige según el largo del período:

| Período | Agrupación |
|---|---|
| Hasta 75 días | Por día |
| 76 a 420 días | Por semana, empezando el lunes |
| Más de 420 días | Por mes |

Sin fechas en los archivos no hay línea de tiempo y la interfaz lo dice en vez de
dibujar un gráfico de un solo punto.
