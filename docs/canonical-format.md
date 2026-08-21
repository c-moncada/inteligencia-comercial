# Entrada de datos — versión 0.4

Ya no hace falta transformar la exportación del sistema a un formato fijo. La plataforma lee el archivo como venga y explica cómo lo interpretó.

## Formatos de archivo aceptados

| Formato | Detalles |
|---|---|
| CSV, TXT, TSV | Separador detectado automáticamente: coma, punto y coma, tabulador, barra vertical, dos puntos o columnas alineadas por espacios |
| Excel `.xlsx` / `.xlsm` | Se leen todas las hojas con datos, incluidas fechas guardadas como número de serie |
| JSON | Lista de objetos, objeto con listas (`{"ventas": [...], "inventario": [...]}`), matriz con encabezados o JSON por líneas (NDJSON) |
| HTML | Archivos `.xls` que en realidad son tablas HTML, y páginas con `<table>` |
| XML | Exportaciones con una etiqueta por registro y hojas de Excel 2003 (SpreadsheetML) |
| Texto pegado | El mismo contenido copiado directamente en la interfaz |

Formatos que se rechazan con un mensaje claro: PDF, bases SQLite y Excel binario antiguo (`.xls` real). En esos casos se pide exportar a Excel, CSV o texto.

## Codificación, separadores y encabezados

- Codificación: UTF-8, UTF-8 con BOM, UTF-16 y Windows-1252 (la más común en sistemas administrativos locales).
- Membretes: se ignoran las líneas de título, nombre de empresa o filas vacías antes de la tabla.
- Encabezados: se busca la fila que los contiene. Si el archivo no los trae, las columnas se deducen por su contenido.
- Filas de totales al final del reporte: se descartan y se informan.

## Reconocimiento de columnas

Primero se compara el nombre del encabezado con un diccionario de equivalencias. Ejemplos reconocidos para el mismo campo:

| Campo canónico | Nombres que se reconocen |
|---|---|
| `product_id` | codigo, cod_articulo, sku, referencia, clave, item code, upc, ean, material |
| `product_name` | producto, descripcion, articulo, detalle, nombre del producto, description |
| `sale_date` | fecha, fecha de venta, fechaemision, fecha factura, invoice date, periodo |
| `quantity` | cantidad, cant, unidades vendidas, qty, piezas, salidas, vendidos |
| `unit_price` | precio, precio unitario, precio de venta, pvp, valor unitario, unit price |
| `unit_cost` | costo, costo unitario, costo promedio, costo de compra, unit cost |
| `current_stock` | existencia, stock actual, saldo, disponible, inventario, on hand |
| `lead_time_days` | dias de reposicion, tiempo de entrega, lead time, plazo de entrega |

Se ignoran acentos, mayúsculas, guiones y espacios: `FC_CODIGO`, `fc codigo` y `Fc-Código` se tratan igual.

Cuando el nombre no dice nada, se decide por el contenido de la columna:

- La columna con fechas válidas se toma como fecha de venta.
- La columna de enteros pequeños, junto a una fecha, se toma como cantidad.
- Entre dos columnas monetarias, la de valores mayores es el precio y la menor el costo.
- La columna con texto descriptivo es el nombre del producto.
- Una columna corta con la misma variedad de valores que el nombre del producto se toma como código. Un número de factura, que cambia en cada fila, no se confunde con un código de producto.

Si el costo aparece por encima del precio en la mayoría de las filas, las columnas se intercambian y se informa el cambio.

## Interpretación de valores

- Números: `1,234.56`, `1.234,56`, `L 1,234.56`, `1 234,56`, `(450)` como negativo, `450-` como negativo y `12%`.
- El estilo decimal se decide observando la columna completa, no valor por valor.
- Fechas: `2026-03-01`, `01/03/2026`, `03-01-2026`, `20260301`, `1 de marzo de 2026`, número de serie de Excel y marcas de tiempo.
- Entre día y mes ambiguos se busca evidencia en la columna; si no la hay, se asume día primero (`dd/mm/aaaa`).
- Un texto como `Aceite 500g` no se interpreta como el número 500, y un código como `P-001` no se interpreta como cantidad.

## Qué se necesita como mínimo

Para producir decisiones se necesita, por línea de venta:

1. Un producto (código o nombre).
2. La cantidad vendida, o el importe junto con el precio.

Todo lo demás es opcional y se completa así:

| Falta | Qué hace la plataforma |
|---|---|
| Código de producto | Lo genera a partir del nombre |
| Precio unitario | Lo calcula dividiendo el importe entre la cantidad |
| Costo unitario | Lo toma del costo total de la línea, del margen informado, del inventario o de otras ventas del mismo producto |
| Costo en cualquier fuente | Asume margen cero y lo marca, para no reportar ganancias que no se pueden comprobar |
| Días de reposición | Asume 7 días y lo informa |
| Archivo de inventario | Asume existencia cero y advierte que las compras sugeridas son un máximo teórico |
| Fechas de venta | Trata el archivo como el total de un período de 30 días y no entrena el modelo de demanda |
| Producto vendido que no está en el inventario | Lo registra con existencia cero y lo informa |

## Exportaciones de varias tablas

Los sistemas suelen exportar el modelo relacional completo: un archivo de ventas, uno de existencias y un catálogo de productos. La plataforma reconoce los tres papeles y los cruza por el código de producto.

| Tabla | Cómo se reconoce | Qué aporta |
|---|---|---|
| Ventas | Tiene fecha y cantidad, o importe | Movimientos, precios y período |
| Existencias | Tiene existencia, o cantidad junto a stock mínimo, lote o vencimiento | Inventario actual y días de reposición |
| Catálogo | Tiene producto con costo o precio, sin existencias ni movimientos | Nombre, categoría, costo de compra y precio de venta |

Decisiones específicas de este caso:

- La columna `cantidad` significa cosas distintas según la tabla. Si el archivo trae stock mínimo, lote o vencimiento y no trae fecha de venta, `cantidad` es la existencia actual, no lo vendido.
- Una `fecha_vencimiento` o `caducidad` nunca se toma como fecha de venta.
- El correlativo de la base de datos (`id` con valores 1, 2, 3…) se descarta como código de producto: se usa el código alfanumérico (`MED-0001`, `SKU-A`), que es el que aparece igual en todos los archivos.
- Si el costo solo existe en el catálogo (`precio_compra`), desde ahí se completa el costo de las ventas y del inventario, y el margen deja de aparecer como cero.

## Varios archivos y varias bodegas

- Se pueden cargar varios archivos a la vez, en cualquier orden: la plataforma decide cuál es de ventas y cuál de inventario.
- Un mismo archivo puede contener ambas cosas (por ejemplo, unidades vendidas y existencia por producto).
- Si un producto aparece en varias bodegas, se suman las existencias, el costo se pondera por unidades y se conserva el mayor tiempo de reposición.
- Los códigos se cruzan sin distinguir mayúsculas ni espacios: `p-001` y `P-001` son el mismo producto.

## Formato canónico (sigue siendo válido)

Quien ya tenga sus datos ordenados puede seguir usando estos archivos, que se reconocen sin ambigüedad.

### sales.csv

| Campo | Obligatorio | Descripción |
|---|---|---|
| sale_id | No | Identificador de factura o movimiento |
| sale_date | Sí | Fecha compatible con ISO, por ejemplo 2026-08-02 |
| product_id | Sí | Código estable del producto |
| product_name | Sí | Descripción del producto |
| quantity | Sí | Unidades vendidas |
| unit_price | Sí | Precio unitario neto |
| unit_cost | No | Costo unitario para calcular ganancia bruta |
| customer_id | No | Código de cliente |

### inventory.csv

| Campo | Obligatorio | Descripción |
|---|---|---|
| product_id | Sí | Debe coincidir con sales.csv |
| product_name | Sí | Descripción del producto |
| current_stock | Sí | Existencia actual |
| unit_cost | No | Costo unitario actual |
| lead_time_days | No | Días estimados que tarda la reposición |

## Transparencia

Cada análisis devuelve un reporte de lectura que la interfaz muestra completo: archivos leídos, hoja o tabla usada, separador, codificación, fila de encabezado, columna por columna con su nivel de certeza, columnas ignoradas, filas descartadas con el motivo y los supuestos aplicados.

Si algo se interpretó mal, el reporte lo hace visible antes de que la cifra se convierta en una decisión.
