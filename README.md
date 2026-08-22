# Inteligencia comercial — 0.5

**Demostración en línea: https://inteligencia-comercial-flame.vercel.app**

Carga las exportaciones de ventas e inventario tal como salen de tu sistema y
obtén una lectura del negocio: cuánto ganas de verdad, dónde está detenido tu
dinero, qué productos mandan y qué conviene hacer primero.

## Qué vas a ver

La versión 0.5 reorganiza toda la interfaz alrededor de las preguntas que se hace
quien maneja el negocio, no alrededor de cómo se calculó cada número.

### Resumen

- **Cómo va tu negocio**, con un puntaje de 0 a 100 y la razón detrás: margen,
  dinero detenido, rotación del inventario y ganancia expuesta por agotamiento.
- **Lo que conviene saber**, en frases normales: *"Tu inventario vale L 102,720 al
  costo. De ese total, L 59,998 está en productos que no se mueven al ritmo
  esperado."*
- **Evolución de las ventas y la ganancia** en el tiempo, por día, semana o mes
  según el largo del período.
- **En qué está tu inventario**: cuánto se mueve, cuánto sobra y cuánto lleva
  meses parado.
- **Cuatro listas de productos**, ordenadas por lo que importa:

| Lista | Responde |
|---|---|
| Mayor rotación | ¿Qué se vende más rápido de lo que se repone? |
| Mayor margen de ganancia | ¿Qué deja más ganancia por cada venta? |
| Baja rotación | ¿Dónde está el dinero que no se mueve? |
| Los que más ganancia dejan | ¿De qué productos vive realmente el negocio? |

Cada producto de las listas se puede tocar para verlo en el detalle completo, y
cada lista explica cómo se ordenó.

### Qué hacer

El plan de acción, ordenado por el dinero en juego: qué comprar y cuánto, qué
dejar de comprar, qué liquidar y qué margen revisar. Se puede filtrar por tipo de
acción, ver solo lo urgente, marcar cada punto como resuelto, descargar el plan
en CSV para llevarlo a una reunión o imprimirlo.

### Productos

Tabla completa con búsqueda, filtros y ordenamiento por cualquier columna, con el
estado de cada producto: *hay que reponer*, *sin existencia*, *de más*,
*detenido* o *en orden*. También se descarga en CSV.

### Tus datos

Qué archivo se usó para qué, qué columna se interpretó como qué campo y con
cuánta certeza, qué filas se descartaron y por qué, cómo se estimó la demanda y
qué supuestos se aplicaron. Todo lo técnico vive aquí y no estorba mientras miras
tus números.

## Acepta cualquier entrada

Un solo punto de carga acepta varios archivos a la vez, en cualquier orden y
formato:

| Entrada | Ejemplos que ya funcionan |
|---|---|
| CSV, TXT, TSV | Coma, punto y coma, tabulador, barra vertical o columnas alineadas |
| Excel | `.xlsx` y `.xlsm`, todas las hojas, fechas guardadas como número de serie |
| JSON | Lista de objetos, objeto con listas, matriz con encabezados o NDJSON |
| HTML y XML | Archivos `.xls` que en realidad son tablas HTML, exportaciones XML |
| Texto pegado | Copiar y pegar directamente en la interfaz |

También reconoce exportaciones de varias tablas relacionadas: si cargas ventas,
existencias y catálogo por separado, identifica el papel de cada una y las cruza
por el código de producto.

La lectura resuelve por su cuenta:

- Codificación UTF-8, UTF-16 o Windows-1252 (acentos y ñ).
- Membretes, filas vacías y totales al final del reporte.
- Archivos sin fila de encabezados: las columnas se deducen por su contenido.
- Nombres de columna en español o inglés: `FC_CODIGO`, `Cantidad`,
  `Existencia actual`, `qty`, `on hand`.
- Números como `1,234.56`, `1.234,56`, `L 1,234.56`, `(450)` o `12%`.
- Columnas ambiguas: `cantidad` es existencia en un archivo de inventario y
  unidades vendidas en uno de ventas; `fecha_vencimiento` no se confunde con la
  fecha de venta; el `id` correlativo de la base de datos no se confunde con el
  código del producto.
- Fechas como `01/03/2026`, `2026-03-01`, `20260301` o `1 de marzo de 2026`.

## Funciona con datos incompletos

| Falta | Qué hace la plataforma |
|---|---|
| El código del producto | Lo genera a partir del nombre |
| El precio unitario | Lo calcula desde el importe de la línea |
| El costo | Lo busca en el costo total, el margen, el inventario u otras ventas |
| El costo en todas las fuentes | Asume margen cero y lo advierte, en vez de inventar ganancias |
| Los días de reposición | Usa el valor que indiques en la pantalla de carga |
| El archivo de inventario | Asume existencia cero y advierte que la compra sugerida es un máximo teórico |
| Las fechas de venta | Analiza el archivo como el total de un período de 30 días |

## Requisitos

- Node.js y npm.
- Python 3.11 o superior, **opcional**: solo afina el pronóstico de demanda. Sin
  Python la plataforma entrega el análisis completo estimando la demanda con el
  promedio de ventas del período.

## Instalación

Desde la raíz:

```bash
npm install
```

Eso deja lista la interfaz y la API. Para agregar el servicio de pronóstico:

```powershell
cd apps/ml
python -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
cd ../..
```

En CMD de Windows la línea de activación es `.venv\Scripts\activate.bat`. No
copies el `.venv` de otra computadora: créalo localmente.

## Ejecutar

Un solo comando desde la raíz:

```bash
npm run dev
```

Levanta la API en `http://localhost:3001`, la interfaz en
`http://localhost:5173` y, si el entorno de Python está instalado, el servicio de
pronóstico en `http://localhost:8000`. Si no lo está, lo dice y sigue adelante.

Para levantar cada parte por separado están `npm run dev:api`, `npm run dev:web`
y `npm run dev:ml`.

Abre `http://localhost:5173`, presiona **Ver una demostración** o arrastra tus
archivos. En `sample-data` hay ejemplos desordenados a propósito:

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

Parámetros opcionales de consulta: `leadTime` (días de reposición asumidos) y
`periodDays` (período asumido cuando no hay fechas).

La respuesta incluye `overview` con el puntaje de salud, las listas de productos,
la composición del inventario y la evolución de las ventas; `decisions` con el
plan de acción; `products` con el detalle; e `ingest` con el reporte de lectura.

## Pruebas

```bash
npm test
```

Solo la API (lectura de archivos, análisis, decisiones y panel de negocio):

```bash
npm run test:api
```

Solo el servicio de pronóstico:

```bash
npm run test:ml
```

## Desplegar en Vercel

El repositorio ya trae la configuración lista (`vercel.json` y `api/index.ts`).
Desde la raíz:

```bash
npx vercel --prod
```

Si prefieres importarlo desde el panel de Vercel, hay un detalle importante:
Vercel detecta Express y propone `apps/api` como **Root Directory**. Hay que
dejarlo en la raíz del repositorio (`./`), porque desde `apps/api` no se lee
`vercel.json`, el build falla con `No workspaces found` y la interfaz no se
publica. Se corrige en **Settings → General → Root Directory**.

Qué queda publicado:

| Parte | Cómo se despliega |
|---|---|
| Interfaz web | Sitio estático compilado desde `apps/web` |
| API | Función serverless en `/api`, la misma aplicación de Express |
| Servicio de pronóstico | No se despliega: pandas y scikit-learn no caben cómodamente en una función serverless |

Sin el servicio de Python la plataforma funciona igual: estima la demanda con el
promedio de ventas del período y lo indica en la pestaña **Tus datos**. Si más
adelante lo publicas en otro lado (Render, Railway, Fly, una máquina propia),
basta con agregar la variable de entorno `ML_SERVICE_URL` en Vercel apuntando a
esa dirección.

Límites del entorno en línea:

- El plan gratuito de Vercel acepta cargas de hasta 4.5 MB por solicitud. La
  interfaz avisa antes de intentarlo; para archivos más grandes conviene usar la
  instalación local.
- La función tiene 60 segundos de tiempo máximo, suficiente para los cálculos.

## Advertencias financieras

Las cifras son estimaciones de apoyo, no órdenes automáticas de compra. Antes de
actuar deben considerarse pedidos pendientes de recibir, cantidades mínimas del
proveedor, descuentos por volumen, impuestos, flete y comisiones, capacidad de
almacenamiento, capital disponible, productos sustitutos y cambios de precio o
promociones futuras.

Cuando la plataforma asume un dato que faltaba, lo dice en la pestaña **Tus
datos**. Revisa esas advertencias antes de usar las cifras.

## Documentación

- [Panel de negocio](docs/panel-de-negocio.md): salud, listas de productos y rotación.
- [Motor de decisiones](docs/business-decisions.md): cómo se calcula cada acción.
- [Entrada de datos](docs/canonical-format.md): qué columnas se reconocen.
- [Pronóstico de demanda](docs/machine-learning.md): el modelo opcional.
