# Completar los clubes con un modelo mini

`enrich-world-openai.mjs` hace una llamada por club usando `gpt-5.6-luna` con razonamiento desactivado,
sin herramientas ni búsquedas en internet. Usa el conocimiento del modelo y
estimaciones útiles para el juego. Necesita Node.js 20 o posterior y ninguna
dependencia adicional.

## Uso

Desde la raíz del proyecto:

```sh
export OPENAI_API_KEY='tu-clave-de-OpenAI'
node scripts/enrich-world-openai.mjs --limit 2 --as-of 2026-09-27
```

Genera `data/open-manager/world.enriched.mini.local.json` y su informe
`world.enriched.mini.local.json.report.json`. Para continuar con el resto:

```sh
node scripts/enrich-world-openai.mjs --as-of 2026-09-27
```

Repite la misma fecha, modelo, modo y original para reanudar. Los clubes
terminados no se vuelven a consultar. Sin `--as-of` se utiliza el día UTC
actual; fija una fecha si vas a continuar en días diferentes.

El original `world.json` y los resultados de la versión anterior
`world.enriched.local.json` se conservan. Los informes antiguos de búsqueda
web no se mezclan con los de la versión mini. Los informes mini con uniformes
de la versión 3 se actualizan automáticamente: se conservan los datos del
modelo y se recalculan las finanzas sin repetir sus llamadas. Las propuestas
financieras anteriores quedan en `model_financial_proposal` para revisión.
Para usar la copia en la app,
revísala y después sustituye el original. Una nueva importación Top 5 vuelve
a generar el original; conserva tu copia enriquecida.

## Velocidad y consumo

La solicitud envía únicamente ID, nombre y país del club. La respuesta es
un JSON compacto con 9 campos (incluidos los dos uniformes), sin fuentes, explicaciones ni metadatos
repetidos por campo. El límite predeterminado es **512 tokens de salida**;
el esquema y las instrucciones también consumen tokens de entrada.

`gpt-5.6-luna` es la variante de menor costo de la familia GPT-5.6. OpenAI
la describe como equivalente a la categoría nano de las familias anteriores;
no existe un modelo llamado GPT-5.6 Mini. Admite la API Responses y respuestas
JSON con esquema. El script fija `reasoning.effort` en `none` para reducir
razonamiento y tokens. El tiempo real depende del servicio y de la red; no
se garantiza una respuesta instantánea. Cada intento tiene un máximo de 30 segundos; los
errores temporales se reintentan hasta tres veces adicionales.

El script imprime duración y consumo por club y los guarda en el informe.
Si una respuesta llega incompleta por el límite de salida, el club se
marca fallido y conserva sus datos. Puedes reintentar con un límite mayor:

```sh
node scripts/enrich-world-openai.mjs --as-of 2026-09-27 --max-output-tokens 768
```

El modelo por defecto es siempre `gpt-5.6-luna`, incluso si quedó una
variable `OPENAI_MODEL` de la versión anterior. Para las llamadas anteriores
usa la misma fecha. Los resultados terminados de las versiones 3 y 4 se
conservan con el modelo que los produjo; solo las llamadas pendientes usan
GPT-5.6 Luna. El informe registra el cambio de modelo. Usa `--model` para cambiarlo.
La clave sigue leyendo `OPENAI_API_KEY` y no se guarda en archivos.

## Datos e incertidumbre

- Identidad: nombre corto, ciudad, estadio, capacidad aproximada y fundación.
- Apariencia: uniforme local y visitante, con un patrón y dos colores
  elegidos de la paleta. El local actualiza también los campos anteriores
  `colors` y `kit_pattern` para conservar la compatibilidad.
- Juego: instalaciones (1–10), formación y estilo solicitados al modelo.
- Finanzas: efectivo, presupuesto de fichajes y presupuesto salarial
  **anual**, todos en euros, calculados localmente desde las plantillas.

Los campos del modelo se etiquetan `model_knowledge`, sin verificación externa.
Las finanzas se identifican aparte mediante `calibration`, con su fórmula y
la nómina anual de referencia. Los presupuestos, instalaciones, táctica,
uniformes, colores y capacidad son estimaciones o aproximaciones.
Los valores desconocidos del modelo son `null` y
conservan el dato anterior. Se rechazan estructuras incompletas, colores
inválidos y valores fuera de los rangos admitidos.

La opción `--facts-only` excluye presupuestos, instalaciones y táctica;
los otros datos también provienen del conocimiento del modelo y no están
verificados. Los IDs, jugadores, relaciones, competiciones, historial,
reputación e imágenes existentes se conservan. El script está centrado en
los clubes; no genera escudos ni solicita URLs de imágenes.

## Finanzas en unidades anuales

El juego guarda salarios y presupuesto salarial en euros por año. La nómina
de referencia suma los salarios anuales de jugadores y personal del club.
Para préstamos, aplica el porcentaje de contribución salarial del equipo
receptor y deja el resto al club de origen, siguiendo el cálculo del juego.

La política `payroll-v1` define estimaciones para iniciar el juego:

- Presupuesto salarial anual: nómina más un 10% de margen.
- Presupuesto de fichajes: 20% de esa nómina.
- Efectivo inicial: reserva de 13 semanas de salarios más el presupuesto de
  fichajes. La reserva equivale a un cuarto de la nómina anual.

El efectivo no se interpreta como ingresos anuales ni como valor del club.
Las cantidades son parámetros de juego calculados, no cifras financieras
verificadas. Esta calibración reduce las cifras arbitrarias del modelo y
garantiza que el presupuesto salarial cubra los contratos actuales.
Si faltan salarios o su suma es cero, conserva las finanzas originales y
registra `missing_payroll`; no inventa una nómina. Salarios inválidos detienen
la ejecución antes de hacer llamadas. `--facts-only` excluye la calibración.

Los dos clubes ya generados se recalibran al ejecutar el comando completo
con la misma fecha y el mismo original. No consumen nuevas llamadas:

```sh
node scripts/enrich-world-openai.mjs --as-of 2026-09-27
```

## Uniformes local y visitante

Cada club guarda los datos nuevos en `teams[].kits`:

```json
{
  "home": {
    "pattern": "Solid",
    "colors": { "primary": "#FFFFFF", "secondary": "#FEBE10" }
  },
  "away": {
    "pattern": "Diagonal",
    "colors": { "primary": "#00205B", "secondary": "#FFFFFF" }
  }
}
```

`KIT_PATTERNS` y `KIT_PALETTE`, al principio del script, definen las opciones:

| Patrón | Diseño |
| --- | --- |
| `Solid` | Liso |
| `Stripes` | Rayas verticales |
| `Hoops` | Franjas horizontales |
| `HalfAndHalf` | Mitades |
| `Diagonal` | Banda diagonal |

La paleta incluye blanco, negro, rojo, granate, azul, azul marino, celeste,
verde, amarillo, dorado, naranja, morado, rosa, crema, gris y marrón. El modelo
elige la aproximación más cercana de esa lista. El visitante debe tener un
color principal diferente al local. Los patrones que usan los dos colores
requieren que sean distintos. Ambos uniformes se solicitan en la misma
llamada, con el mismo límite de 512 tokens. La paleta y el esquema de uniforme
se definen una sola vez en el esquema enviado a la API para ahorrar tokens.

Si el modelo desconoce los uniformes, `kits=null` conserva los datos actuales.
La simulación existente sigue utilizando `colors` y `kit_pattern`; el campo
`kits` queda preparado en el JSON. Aún hace falta incorporarlo a los tipos,
carga y persistencia del juego y a la selección de uniforme en los partidos
para que el visitante se use durante la simulación.

Los informes anteriores sin uniformes no se reutilizan. Si ya generaste una
copia con esa versión, elige otra ruta `--output` para conservarla:

```sh
node scripts/enrich-world-openai.mjs --limit 2 --as-of 2026-09-27 --output /tmp/world-with-kits.json
```

## Otras opciones

```sh
node scripts/enrich-world-openai.mjs --dry-run --limit 2
node scripts/enrich-world-openai.mjs --club 'Real Madrid' --as-of 2026-09-27
node scripts/enrich-world-openai.mjs --help
```

`--club` acepta parte del nombre o del ID y se puede repetir. `--input` y
`--output` cambian las rutas; deben ser distintas. No admite exports divididos:
usa el mundo runtime que contiene directamente `teams[]`.

El informe se escribe después de cada club y permite reconstruir la copia
tras una interrupción. Ctrl+C guarda la llamada actual antes de detenerse.
Si el proceso termina forzosamente, puede quedar `OUTPUT.lock`; comprueba
que el PID registrado ya no esté activo antes de eliminarlo y reanudar.

## Comprobaciones sin API

```sh
node --test scripts/enrich-world-openai.test.mjs
```

Referencias oficiales: [GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna)
y [salida estructurada](https://developers.openai.com/api/docs/guides/structured-outputs).
