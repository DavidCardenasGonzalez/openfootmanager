# Gestión autónoma de plantillas IA

Implementación y validación del ciclo de plantillas para el universo de 96 clubes.
El código y este informe fueron elaborados con asistencia de IA.

Las reglas y métricas de este documento corresponden a la primera implementación.
El rediseño posterior de cantera se documenta en [YOUTH_ACADEMY_DESIGN.md](YOUTH_ACADEMY_DESIGN.md).

## Diagnóstico del sistema anterior

Los fichajes IA ↔ IA ya existían. Durante una ventana abierta, el mercado elegía
jugadores por interés —lista de transferibles, contrato próximo a vencer, valor,
moral— y podía ejecutar como máximo dos operaciones diarias. Solo participaban
los clubes del ámbito competitivo activo. Había comprobaciones de dinero y
profundidad para el comprador, pero faltaba proteger la cobertura del vendedor y
planificar la renovación completa de su plantilla.

La ventana actual abarca aproximadamente 61 días por temporada: el límite anterior
permitía como máximo 122 fichajes, unos 1,27 por club para 96 clubes, incluso si
existieran suficientes compradores y vendedores compatibles. El límite es un
techo; no implica que se produjeran esos 122 movimientos.

También existían expiración diaria de contratos, entrenamiento, envejecimiento,
retiros y generadores de juveniles. Faltaba conectar esas piezas para que la IA
renovara contratos, incorporara agentes libres, recibiera nuevas promociones de
cantera cada temporada y reemplazara bajas. Los jugadores sin club podían quedarse
en el mundo indefinidamente. No había un plan común para limitar excedentes o
garantizar plantillas funcionales en clubes fuera del ámbito activo.

La revisión detectó otras dependencias relevantes:

- La importación actual proporciona 2.679 jugadores, plantillas de 21–36 y
  reputaciones de 1–96. Su escala de reputación difiere del rango 0–1000 utilizado
  por varias heurísticas; generar juveniles solo por esa reputación degradaría
  artificialmente el nivel del mundo.
- El campo salarial se describe como semanal en algunas partes, pero el motor
  financiero suma esos valores como salarios anuales y divide entre 52 para pagar
  semanalmente. La política nueva utiliza el cálculo financiero existente para
  mantener coherencia contable. La ambigüedad de nombres sigue pendiente.
- El relleno automático de selecciones podía generar muchos agentes libres al
  intentar completar cada país hasta 18 jugadores. Limitar únicamente la cantera
  de clubes no bastaba para estabilizar la población.
- Un observador sin club podía esperar a que terminaran clasificatorias
  internacionales de varios años y bloquear el cierre anual de las ligas.
- Guardar jugadores únicamente mediante inserciones/actualizaciones dejaba en
  SQLite a los perfiles eliminados en memoria, que reaparecían al cargar.

## Reglas implementadas

Se reutilizan los modelos de jugador, movimientos, contratos, transferencias,
contabilidad, entrenamiento, competiciones y guardado. No se introduce una nueva
arquitectura de agentes ni cambios de interfaz.

### Plantillas, renovaciones y salidas

- Se administran todos los clubes IA, incluidos los de competiciones inactivas.
  El club humano conserva sus decisiones de contrato y mercado; también recibe
  cantera anual.
- Mínimo de 22 jugadores, objetivo de 24, máximo ordinario de incorporación de 28.
  Mínimos por grupo: 2 porteros, 6 defensas, 6 mediocampistas y 4 delanteros.
  Objetivos de profundidad: 2/8/8/6; suman 24.
- La reparación diaria exige al menos 11 jugadores sin lesión y cobertura sana
  de 1/3/3/2 por grupo. La venta de un portero sano conserva otro portero sano.
- Una revisión semanal prioriza calidad actual, margen de potencial y edad;
  conserva jugadores útiles, pone excedentes en venta y deja vencer contratos de
  jugadores innecesarios. No hay cancelaciones forzadas de contratos pagados.
- Se renuevan contratos necesarios cuando quedan 180 días o menos, utilizando
  el salario esperado ya existente. Duración: cuatro años hasta los 23, tres años
  en edades intermedias y un año desde los 32.
- Un club que ya supera su presupuesto salarial puede mantener o reducir el
  compromiso existente al renovar. Ninguna decisión nueva puede aumentar ese
  exceso. El presupuesto no se incrementa artificialmente para aprobar fichajes.
- Un juvenil pasa a sénior a los 21, o desde los 18 si está a cinco puntos o menos
  de la calidad mediana del club. Se utiliza el entrenamiento existente; el
  crecimiento técnico estacional deja de añadirse cuando se alcanza el potencial.
- Los contratos IA vencidos no generan mensajes ajenos en el buzón humano.

Los clubes importados con más de 28 jugadores reducen excedentes mediante ventas,
retiros y expiraciones. Una crisis de lesiones puede superar temporalmente ese
límite para garantizar cobertura. El límite de incorporación no justifica romper
contratos ni dejar una posición sin jugadores sanos.

### Compras, agentes libres y cobertura de emergencia

- Las compras de pago siguen restringidas a las ventanas existentes. Se buscan
  posiciones deficitarias o mejoras de al menos cinco puntos respecto a la media
  del grupo; se descartan jugadores más de diez puntos inferiores a esa media.
- No se compra a jugadores lesionados ni de 33 años o más. Se comprueba otra vez
  la plantilla del vendedor después de cada operación.
- Cada operación utiliza como máximo la mitad del presupuesto restante de
  transferencias y conserva en caja seis meses de masa salarial. También debe
  caber en el presupuesto salarial. La ejecución existente mantiene los asientos
  de caja, presupuestos, noticias y movimientos del jugador.
- Límite global diario: `ceil(clubes_IA / 16)`, entre 2 y 12. Para 96 clubes son
  seis operaciones: techo de aproximadamente 366 por ventana de 61 días.
- Por comprador: una operación en una jornada, hasta dos en siete días y seis en
  365 días. La revisión rota el orden de clubes para repartir oportunidades.
- Un fichaje reciente permanece protegido de venta durante 180 días. También se
  protegen cesiones activas y operaciones pendientes de inscripción.
- Un fichaje de pago recibe un nuevo contrato de tres años, o dos desde los 30.
  Se cierran ofertas competidoras pendientes y se evita mover dos veces al mismo
  jugador en una jornada.
- Las carencias duras se reparan primero con agentes libres sanos, menores de 34,
  de calidad relativa suficiente y salario asumible. Si no existe candidato, se
  genera un juvenil de emergencia en la posición necesaria, sin coste de traspaso.
  Su estipendio respeta el margen disponible y puede ser cero en un club sin
  presupuesto. Esta es una garantía de continuidad deliberada, no un rescate de caja.

### Cantera y equilibrio de población

- Cada ciclo anual incorpora hasta dos juveniles por club, con prioridad por
  posiciones débiles o cohortes de mayor edad, respetando el límite de 28.
- El techo de población activa ordinaria de clubes es 29 jugadores por club.
  Una reserva internacional protegida y acotada se cuenta aparte. Las reparaciones
  de emergencia pueden exceder el techo cuando sea imprescindible dar cobertura.
- La calidad depende del nivel real de los mejores once del equipo, reputación,
  instalaciones de entrenamiento y variación aleatoria. El nivel real actúa como
  aproximación de la división, evitando errores por escalas de reputación importada.
- No existe un atributo específico de academia: se reutiliza la instalación de
  entrenamiento. La calidad inicial objetivo se limita a 30–75; el potencial suele
  superar ese nivel entre 8 y 22 puntos. Hay un 2 % de probabilidad de potencial
  excepcional de 90–99, también en clubes pequeños.
- La generación de cantera es determinista por identificador. El calendario se
  guarda y se comprueban además los identificadores existentes para evitar
  duplicaciones al cargar partidas antiguas sin ese calendario.
- Un agente libre sin destino abandona el fútbol después de un año, o dos si
  tiene hasta 21. Las selecciones pueden proteger como máximo dos agentes libres
  por club del mundo; no convierten a todos los liberados en reservas permanentes.
- El generador de selecciones solo rellena hasta ese cupo global de agentes libres
  en mundos con clubes, distribuyendo plazas entre países. Los mundos exclusivamente
  internacionales mantienen el comportamiento anterior.
- Los perfiles retirados se conservan durante dos años. Después se eliminan salvo
  los 48 perfiles con carrera más destacada, conservados para el Salón de la Fama.
  Los resúmenes históricos de premios y competiciones se conservan por separado.

## Persistencia y alcance de los archivos

Archivos añadidos:

| Archivo | Función |
| --- | --- |
| `src-tauri/crates/ofm_core/src/ai_squad/mod.rs` | Coordinación diaria/semanal, estado persistido, constantes y límite dinámico. |
| `src-tauri/crates/ofm_core/src/ai_squad/policy.rs` | Perfiles de plantilla, necesidades, conservación, presupuestos y seguridad de venta. |
| `src-tauri/crates/ofm_core/src/ai_squad/lifecycle.rs` | Renovación, promoción, libres, cantera, emergencias y limpieza de población. |
| `src-tauri/crates/ofm_core/src/ai_squad/market.rs` | Mercado de pago para todo el mundo IA. |
| `src-tauri/crates/ofm_core/src/ai_squad/tests.rs` | Pruebas de reglas, límites, población y recuperación de partidas antiguas. |
| `src-tauri/crates/ofm_core/src/end_of_season/tests.rs` | Regresión del cierre anual con clasificatorias internacionales pendientes. |
| `src-tauri/crates/ofm_core/examples/squad_lifecycle.rs` | Simulación automática de temporadas y métricas. |
| `src-tauri/crates/db/src/sql/v045_squad_management.sql` | Migración con calendario/contadores y valor predeterminado `{}`. |
| `docs/AI_SQUAD_MANAGEMENT.md` | Este informe. |
| `docs/validation/ai-squad-20-seasons.jsonl` | Resultados de la ejecución final. |

Archivos existentes modificados por esta implementación:

- En `src-tauri/crates/ofm_core/src/`: `lib.rs`, `game.rs`, `aging.rs`,
  `generator/mod.rs`, `contracts/expiry.rs`, `turn/mod.rs`,
  `end_of_season/mod.rs`, `world_cup.rs`, `transfers/mod.rs`,
  `transfers/consts.rs`, `transfers/market.rs`, `transfers/execution.rs`.
- `src-tauri/crates/ofm_core/tests/transfers_tests.rs`: los vendedores de pruebas
  tienen plantillas reales suficientes para ejercer las nuevas garantías de venta.
- En `src-tauri/crates/db/src/`: `migrations.rs`, `game_persistence.rs`,
  `repositories/meta_repo.rs`, `repositories/player_repo.rs`, `save_index.rs`.

Los nuevos campos serializados usan valores predeterminados para partidas antiguas.
La migración 45 agrega el estado al guardar en SQLite. La población se reemplaza
dentro de la transacción de guardado, para que los perfiles archivados no vuelvan
a aparecer al cargar. Una prueba verifica conjuntamente calendario, contadores y
eliminación persistente. Los cambios de datos, interfaz y simulación de partidos
que ya había en el espacio de trabajo no forman parte de este listado.

## Reproducir la validación

Desde la raíz del proyecto:

```bash
cargo run --manifest-path src-tauri/Cargo.toml -p ofm_core \
  --example squad_lifecycle -- 20
```

También admite `1`, `5` o `10`, y un segundo argumento con la ruta a otro mundo.
La ejecución de 20 años captura todos los hitos solicitados en una misma carrera.

La herramienta normaliza el archivo real de 96 clubes y organiza cinco divisiones
con ascensos/descensos. Utiliza turnos diarios, entrenamiento, finanzas, mercado,
selecciones y cierre anual de producción, con un observador sin club. No inyecta
dinero ni repara plantillas desde el propio simulador. Los partidos utilizan la
ruta existente de resultados simplificados de competiciones inactivas; no se
ejecuta el motor completo de cada partido. Sus resultados y el entrenamiento
tienen aleatoriedad, por lo que otra ejecución puede variar en cifras.

Cada día comprueba tamaño mínimo, profundidad, cobertura sana, contratos,
identificadores únicos, movimientos únicos y límites de compras/salarios.
Las renovaciones y canteras sobreviven a guardado/carga en pruebas específicas.
La simulación larga no realiza un guardado SQLite cada jornada.

## Resultados de 1, 5, 10 y 20 temporadas

Ejecución final sobre 96 clubes, desde julio de 2026 hasta abril de 2046,
completada en 140.9 segundos. Los contadores son acumulados.

| Temporadas | Total de perfiles | Activos | Libres | Retirados conservados | Plantilla mín./máx./media | Edad media |
| ---: | ---: | ---: | ---: | ---: | --- | ---: |
| 0 | 2,679 | 2,679 | 0 | 0 | 21/36/27.91 | 26.15 |
| 1 | 2,822 | 2,633 | 0 | 189 | 22/34/27.43 | 25.81 |
| 5 | 3,295 | 2,739 | 283 | 556 | 22/28/25.58 | 26.37 |
| 10 | 3,238 | 2,649 | 191 | 589 | 22/28/25.60 | 25.54 |
| 20 | 3,263 | 2,842 | 217 | 421 | 25/28/27.34 | 25.80 |

| Temporadas | Juveniles anuales | Emergencias | Altas internacionales | Retiros naturales | Abandonos sin club | Fichajes de pago | Fichajes libres | Renovaciones |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 123 | 20 | 0 | 189 | 0 | 0 | 0 | 444 |
| 5 | 715 | 20 | 190 | 727 | 138 | 24 | 38 | 3477 |
| 10 | 1655 | 20 | 264 | 1574 | 395 | 101 | 67 | 7819 |
| 20 | 3448 | 20 | 379 | 2850 | 834 | 235 | 70 | 16388 |

| Temporadas | OVR medio | Caja media, millones | Presupuesto de fichajes medio, millones | Clubes con caja negativa |
| ---: | ---: | ---: | ---: | ---: |
| 0 | 72.10 | 16.19 | 5.26 | 0 |
| 1 | 77.15 | 14.85 | 2.23 | 0 |
| 5 | 79.16 | 10.88 | 2.00 | 26 |
| 10 | 82.30 | 17.43 | 3.76 | 34 |
| 20 | 86.77 | 140.87 | 21.17 | 5 |

Resultados de las comprobaciones:

- Cero clubes por debajo de 22, sin profundidad mínima o sin cobertura sana
  en cada jornada procesada. Cero jugadores de club sin contrato, identificadores
  duplicados o transferencias repetidas en una jornada.
- Cero incrementos de compromisos salariales por encima del presupuesto vigente
  o de un exceso heredado. Máximo observado: seis fichajes de pago en una jornada.
- Los activos pasan de 2,679 a 2,842 (+6.1 %).
  La población de clubes pasa de 2,679 a 2,625;
  el resto son agentes libres. El total incluye el archivo temporal de retirados
  y aumenta un 21.8 %, sin crecimiento indefinido observado.
- Al año 20 se han promovido 3,238 juveniles y eliminado 3,263
  perfiles antiguos del archivo vivo. Las cifras detalladas están en el JSONL.
- El mundo inicial tiene un club por debajo del mínimo y 15 con profundidad
  insuficiente. La primera jornada de pretemporada los repara. También hay
  39 plantillas iniciales por encima de 28: quedan 19 al año 1 y cero al año 5.
- El mercado produce 235 fichajes de pago en 20 temporadas (unos 11.8 por año),
  muy por debajo del techo de 366. La simulación muestra que el principal recambio
  proviene de cantera y bajas; el límite diario anterior no era la única restricción.
- Tener caja negativa no significa que la IA compre con dinero inexistente:
  los costes e ingresos operativos pueden producir pérdidas. Se conserva esa
  evolución financiera y se cubren las bajas mediante recursos asumibles.

## Pruebas y comprobaciones

- Backend completo: **1.861 pruebas aprobadas, cero fallos y dos omitidas**.
  Incluye 19 pruebas de la nueva política, pruebas de mercado existentes,
  compatibilidad JSON, persistencia SQLite y regresiones de calendario.
- Compilación de aplicación (`npm run build`): aprobada.
- Análisis Rust (`cargo clippy --workspace --all-targets`): aprobado; queda una
  advertencia de función sin uso en `src-tauri/src/commands/time.rs`
  (`advance_one_day_internal`), fuera de esta implementación.
- Suite de interfaz (`npm test`): **1.528 aprobadas y 61 fallidas** en 36 archivos.
  Muchos fallos son expectativas de nombres completos frente a nombres abreviados;
  también falla la limpieza de un identificador de guardado obsoleto en Dashboard.
  Esta implementación no modifica frontend. No se presenta esa suite como aprobada.
- Las dos últimas protecciones se verificaron primero con pruebas que fallaban:
  duplicación de cantera al perder metadatos y conservación acotada de retirados.
- Formato Rust de los archivos cambiados y comprobación de espacios del diff:
  aprobados.


## Limitaciones y siguientes mejoras

El criterio de continuidad queda cubierto en la carrera de 20 temporadas: todos
los clubes conservan jugadores, contratos, posiciones y vías autónomas de recambio.
Esto no demuestra que la economía o la competitividad estén perfectamente equilibradas.

- El entrenamiento y las finanzas existentes producen inflación de calidad y
  acumulación de caja a largo plazo. Conviene calibrar crecimiento, potencial,
  salarios e ingresos en un trabajo independiente, utilizando estas métricas.
- Los fichajes de pago son conservadores: la mayor parte del recambio llega por
  cantera, retiro, expiraciones y libres. Aumentar el límite diario no obliga a
  comprar ni resuelve por sí solo la liquidez del mercado. Una siguiente mejora
  podría favorecer ventas de excedentes en el tramo final de la ventana.
- Las garantías de cobertura se basan en la posición natural y las lesiones.
  No modelan todas las preferencias tácticas, posiciones alternativas o ausencias
  de cada competición. Una simulación con partidos completos permitiría validar
  mejor lesiones prolongadas, minutos de juveniles y cesiones.
- El tope de reservas internacionales puede dejar selecciones con menos de 18
  jugadores en un mundo de clubes. Es compatible con su simulación actual por
  resultados; un futuro motor completo internacional necesitará otro diseño.
- Conservar 48 retirados mantiene un Salón de la Fama acotado, pero no preserva
  indefinidamente el perfil completo de cada jugador que haya pasado por la partida.
- Las emergencias gratuitas y el salario cero evitan el colapso de clubes insolventes;
  no constituyen un modelo completo de quiebras, administración o contratos reales.
- No se fuerza una edad media fija ni un número de transferencias anual: edad,
  calidad y potencial intervienen en reglas de conservación y contratación.

Las mejoras propuestas no son necesarias para que el ciclo de plantillas funcione,
pero sí para afinar realismo económico y diversidad deportiva.
