# Inteligencia comercial — MVP 0.4

Plataforma para transformar ventas e inventario en decisiones financieras priorizadas.

La versión 0.4 elimina el requisito de preparar los archivos. Carga la exportación tal como sale de tu sistema y la plataforma reconoce las columnas, cruza ventas con inventario y responde:

- Qué producto debe reponerse, cuántas unidades y cuánto dinero requiere.
- Cuánta ganancia puede protegerse y cuándo debe tomarse la decisión.
- Qué compras deben pausarse por exceso de inventario.
- Qué inventario dejó de rotar y cuánto capital tiene inmovilizado.
- Qué margen debería revisarse.

## Novedades de la versión 0.4

### 1. Acepta cualquier entrada

Un solo punto de carga acepta varios archivos a la vez, en cualquier orden y formato:

| Entrada | Ejemplos que ya funcionan |
|---|---|
| CSV, TXT, TSV | Coma, punto y coma, tabulador, barra vertical o columnas alineadas |
| Excel | `.xlsx` y `.xlsm`, todas las hojas, fechas guardadas como número de serie |
| JSON | Lista de objetos, objeto con listas, matriz con encabezados o NDJSON |
| HTML y XML | Archivos `.xls` que en realidad son tablas HTML, exportaciones XML, Excel 2003 |
| Texto pegado | Copiar y pegar directamente en la interfaz |

También reconoce exportaciones de varias tablas relacionadas: si cargas ventas, existencias y catálogo de productos por separado, identifica el papel de cada una y las cruza por el código de producto. El costo puede venir solo en el catálogo (`precio_compra`) y aun así el margen se calcula bien.

La lectura resuelve por su cuenta:

- Codificación UTF-8, UTF-16 o Windows-1252 (acentos y ñ).
- Membretes, filas vacías y totales al final del reporte.
- Archivos sin fila de encabezados: las columnas se deducen por su contenido.
- Nombres de columna en español o inglés: `FC_CODIGO`, `Cantidad`, `Existencia actual`, `qty`, `on hand`.
- Números como `1,234.56`, `1.234,56`, `L 1,234.56`, `(450)` o `12%`.
- Columnas ambiguas: `cantidad` es existencia en un archivo de inventario y unidades vendidas en uno de ventas; `fecha_vencimiento` no se confunde con la fecha de venta; el `id` correlativo de la base de datos no se confunde con el código del producto.
- Fechas como `01/03/2026`, `2026-03-01`, `20260301` o `1 de marzo de 2026`.

Cada análisis muestra un reporte de lectura: qué archivo se usó para qué, qué columna se interpretó como qué campo, con cuánta certeza, qué filas se descartaron y por qué.

### 2. Funciona con datos incompletos

| Falta | Qué hace la plataforma |
|---|---|
| El código del producto | Lo genera a partir del nombre |
| El precio unitario | Lo calcula desde el importe de la línea |
| El costo | Lo busca en el costo total, el margen, el inventario u otras ventas |
| El costo en todas las fuentes | Asume margen cero y lo advierte, en vez de inventar ganancias |
| Los días de reposición | Asume 7 días y lo informa |
| El archivo de inventario | Asume existencia cero y advierte que la compra sugerida es un máximo teórico |
| Las fechas de venta | Analiza el archivo como el total de un período de 30 días |

### 3. Análisis más inteligente

- **Inventario sin rotación:** productos con existencia y sin ventas recientes, con el capital que tienen detenido. Los productos que están en el inventario pero nunca en las ventas ya no quedan invisibles.
- **Clasificación ABC:** qué productos concentran la ganancia y cuáles aportan poco.
- **Tendencia de la demanda:** comparación entre la segunda y la primera mitad del período. Una reposición urgente baja de prioridad si la demanda viene cayendo.
- **Motivos explícitos:** cada decisión lista por qué tiene la prioridad que tiene.

### 4. Pronóstico graduado según el historial

| Historial | Método |
|---|---|
| Menos de 21 días | Promedio del período |
| 21 a 119 días | Promedio móvil ponderado con tendencia amortiguada, evaluado desde 60 días |
| 120 días o más | Modelo entrenado, comparado contra el promedio histórico y contra la mezcla de ambos |

Ya no se responde "datos insuficientes" y se detiene: siempre hay una estimación con el método indicado.

### 5. Sigue funcionando sin el servicio de machine learning

Si el servicio de Python no está disponible, la API calcula las decisiones con reglas de inventario y las marca como tales. La plataforma nunca se queda sin responder.

## Etiquetas de origen de resultados

Cada indicador muestra de dónde proviene:

- **Usa machine learning:** estimación generada por el modelo con el historial de ventas.
- **No usa ML:** cálculo exacto, dato observado o regla financiera.
- **ML + reglas:** combina el pronóstico con inventario, costo, margen o tiempo de reposición.
- **No usa ML · promedio:** el sistema seleccionó el promedio histórico porque superó o sustituyó al modelo.

## Arquitectura

```text
React + TypeScript
        ↓
Express + TypeScript
        ↓
Lectura universal de archivos  →  Motor de decisiones financieras
        ↓
FastAPI + pandas + scikit-learn
```

La lectura de archivos no usa dependencias externas: el lector de Excel descomprime el `.xlsx` con la biblioteca `zlib` incluida en Node.

## Requisitos

- Node.js y npm.
- Python 3.11 o superior.

## Instalación

### Dependencias web y API

Desde la raíz:

```bash
npm install
```

### Dependencias de machine learning

En CMD de Windows:

```cmd
cd apps\ml
python -m venv .venv
.venv\Scripts\activate.bat
python -m pip install -r requirements.txt
cd ..\..
```

En PowerShell:

```powershell
cd apps/ml
python -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
cd ../..
```

No copies el `.venv` de otra computadora. Créalo localmente.

## Ejecutar

Usa tres terminales desde la raíz.

### Terminal 1: machine learning

```bash
npm run dev:ml
```

Disponible en `http://localhost:8000`. Es opcional: sin este servicio la plataforma sigue entregando decisiones calculadas con reglas.

### Terminal 2: API

```bash
npm run dev:api
```

Disponible en `http://localhost:3001`.

### Terminal 3: interfaz web

```bash
npm run dev:web
```

Abre la dirección que muestre Vite, normalmente `http://localhost:5173`.

Presiona **Ver demostración** o arrastra tus propios archivos. Para probar la lectura automática hay ejemplos desordenados a propósito en `sample-data`:

- `ventas_sistema.csv`: membrete, punto y coma, fechas `dd/mm/aaaa` y montos con `L`.
- `inventario_sistema.xlsx`: hoja de Excel.
- `inventario_sistema.json`: el mismo inventario en JSON con claves en español.
- `sales.csv` e `inventory.csv`: formato canónico.

Regenerar los ejemplos:

```bash
python sample-data/generate_demo.py
```

## API

| Ruta | Método | Descripción |
|---|---|---|
| `/api/health` | GET | Estado del servicio |
| `/api/analysis/demo` | GET | Análisis con los datos de demostración |
| `/api/analysis/ingest` | POST | Punto de entrada universal: archivos, texto pegado o JSON |
| `/api/analysis/upload` | POST | Alias de la ruta anterior, por compatibilidad |

Ejemplo con varios archivos:

```bash
curl -X POST http://localhost:3001/api/analysis/ingest -F "files=@ventas.xlsx" -F "files=@existencias.csv"
```

Parámetros opcionales de consulta: `leadTime` (días de reposición asumidos) y `periodDays` (período asumido cuando no hay fechas).

## Pruebas

Todo:

```bash
npm test
```

Solo la API (lectura de archivos, análisis y decisiones):

```bash
npm --workspace apps/api test
```

Solo el servicio de ML:

```bash
npm run test:ml
```

## Actualizar desde la versión 0.3

La versión 0.4 cambia la API y el formato de respuesta, así que conviene actualizar el proyecto completo en vez de reemplazar archivos sueltos. Conserva la carpeta anterior como respaldo y vuelve a ejecutar `npm install`.

## Advertencias financieras

Las cifras son estimaciones de apoyo, no órdenes automáticas de compra. Antes de actuar deben considerarse:

- Pedidos pendientes de recibir.
- Cantidades mínimas del proveedor.
- Descuentos por volumen.
- Impuestos, flete y comisiones.
- Capacidad de almacenamiento.
- Capital disponible.
- Productos sustitutos.
- Cambios de precio o promociones futuras.

Cuando la plataforma asume un dato que faltaba, lo dice en el reporte de lectura. Revisa esas advertencias antes de usar las cifras.

Consulta:

- [Entrada de datos](docs/canonical-format.md)
- [Modelo de machine learning](docs/machine-learning.md)
- [Motor de decisiones](docs/business-decisions.md)
