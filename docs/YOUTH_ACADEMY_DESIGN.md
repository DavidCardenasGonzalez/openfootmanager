# Cantera como progresión del club

Modelo, implementación y comprobaciones del rediseño. Trabajo asistido por IA.
Este documento sustituye las reglas de cantera del informe anterior de gestión IA.

## Qué cambió y por qué

El sistema anterior incorporaba automáticamente hasta dos juveniles por club y
tomaba la calidad de los mejores once como referencia para calidad y potencial.
Eso daba pocas decisiones al jugador y podía realimentar el talento del mundo:
mejor plantilla → mejores juveniles → potenciales mayores → todavía mejor plantilla.
El entrenamiento también permitía alcanzar los techos demasiado rápido.

La revisión incluyó las altas anuales, generadores y normalización del mundo,
plantillas y contratos, ojeadores juveniles, instalaciones, entrenamiento,
cesiones, transferencias, envejecimiento, retiros y persistencia.
Había además una vía independiente de ojeadores que generaba nuevos candidatos
en cada búsqueda y permitía firmarlos sin compartir un cupo anual.

La importación actual asigna entrenamiento de nivel 5 a los 96 clubes. Por ello se
introduce una instalación **juvenil independiente**, inicialmente de nivel 1 en
partidas antiguas y mundos que no la especifiquen. Las instalaciones de entrenamiento
del primer equipo siguen ayudando al desarrollo diario. La academia controla las
oportunidades y la consistencia de nuevas generaciones.

## 1. Candidatos e incorporaciones por nivel

| Academia juvenil | Candidatos anuales del jugador | Máximo de firmas | Probabilidad de potencial 90–95 por candidato |
| ---: | ---: | ---: | ---: |
| 1 | 6 | 2 | 0,40 % |
| 2 | 8 | 2 | 0,50 % |
| 3 | 10 | 3 | 0,65 % |
| 4 | 12 | 3 | 0,80 % |
| 5 | 14 | 4 | 1,00 % |

La primera generación está disponible al comenzar la carrera o abrir la cantera
en una partida existente. Las siguientes llegan con el cambio anual de ciclo.
Una notificación del buzón permite abrir directamente la pantalla de cantera.

Los candidatos son un grupo temporal guardado por club, fuera de `game.players`.
No entrenan, cobran ni participan hasta firmar. Así se ofrecen hasta siete veces
más oportunidades que las dos incorporaciones IA sin multiplicar la población.

## 2. Ojeadores y suministro finito

Los ojeadores pueden descubrir **tres candidatos adicionales en total por club y
temporada**, con posición y procedencia configurables. Comparten el mismo máximo
de dos a cuatro firmas de la academia. La búsqueda no crea un suministro ilimitado
de potenciales altos, y cambiar de club o cargar la partida no reinicia el cupo.

Los informes existentes de ojeadores siguen ofreciendo su información detallada.
Las incorporaciones por el buzón pasan por la misma validación de dinero,
salarios, espacio, expiración y cupo que las de la nueva pantalla. Los candidatos
rechazados o de una generación anterior no pueden volver a firmarse mediante una
copia antigua del informe. Los informes anteriores al rediseño conservan soporte,
pero utilizan los límites y costes actuales.

## 3. Calidad inicial y nivel del club

La referencia `C` es la media de los mejores once jugadores actuales, acotada a
45–76; un club vacío utiliza 55. La calidad inicial objetivo es:

```text
OVR objetivo = C − 18 + 2 × nivel de academia + variación
variación uniforme = −(8 − nivel) … +(8 − nivel)
límites objetivo = 35 … 72, y cuatro puntos por debajo del potencial
```

Los atributos se ajustan usando el cálculo posicional existente. Se comprueba el
resultado después del ajuste porque los límites y las penalizaciones posicionales
podían producir un resultado diferente del objetivo. Se admite un punto de
redondeo y se conserva el límite absoluto de 35–72.

Las academias superiores aumentan el punto de partida y reducen dispersión:
nivel 1 tiene una variación de ±7; nivel 5, ±3. El nivel del club ayuda a producir
juveniles más preparados para su competición, pero se acota para impedir que una
plantilla de 90 empiece a generar rutinariamente juveniles de 80.

La reputación importada no se utiliza directamente: su escala actual 1–96 no
coincide con otras reglas de reputación 0–1000. El nivel real de la plantilla sirve
como aproximación de la división. Un club grande ofrece más preparación inmediata;
no obtiene automáticamente todos los potenciales más altos. El sorteo combina el
identificador de la carrera con club, ciclo y candidato: cargar no lo cambia,
pero otra carrera sí produce generaciones distintas.

## 4. Potencial, variabilidad y grandes talentos

El potencial tiene una distribución propia, en lugar de ser siempre OVR +8–22.
Tras comprobar la probabilidad excepcional, el sorteo ordinario usa:

| Sorteo ordinario | Probabilidad | Potencial base |
| --- | ---: | --- |
| Profundidad, proyecto o rotación | 65 % | 60–75 |
| Prometedor | 27 % | 73–81 |
| Destacado | 8 % | 82–87 |

Al potencial ordinario se añade `nivel − 1` y un ajuste pequeño del nivel del club
`(C − 60) / 10`, con división entera y límite ±2. El resultado ordinario se limita
a 55–89 y tiene un suelo del club acotado a 55–65. El sorteo excepcional genera
90–95, sin depender del tamaño del club. Una academia máxima mejora oportunidades
y consistencia, pero cada candidato conserva un 99 % de probabilidad de no ser
excepcional.

Para 14 candidatos independientes, la probabilidad teórica de encontrar al menos
un potencial 90+ es aproximadamente **13,1 % por generación**, antes de ojeadores.
Es potencial, no calidad actual ni garantía de alcanzar ese nivel. A nivel 1 es
aproximadamente 2,4 % para sus seis candidatos: un club pequeño también puede
encontrar una futura estrella mundial.

## 5. Generaciones mediocres y decisiones útiles

Cada generación ofrece al menos un proyecto con potencial de 65 o más. También
se asegura una opción práctica con calidad inicial próxima a `C − 10`, dentro de
40–66. Si hay que elevar esa opción, su potencial permite al menos seis puntos de
crecimiento; esta garantía nunca crea un potencial élite.

Ese suelo protege la utilidad de una mala generación: profundidad para un club
pequeño, proyecto para el primer equipo o futura venta. No garantiza que la
plantilla gane valoración cada año independientemente de las decisiones.

La pantalla muestra calidad actual, **rango estimado de potencial**, coste y
salario. El informe utiliza un centro con error de hasta ±3 y un radio de
`10 − nivel`: las academias superiores dan una estimación más precisa.
El potencial real se mantiene en el modelo de jugador para el desarrollo; el
contrato de lectura de la academia entrega el rango y omite ese valor exacto.

## 6. Costes, contratos, rechazos y límite de plantilla

```text
Coste de formación = 10.000 + 5 × OVR² + 250 × (potencial − OVR)
Salario anual = 2.000 + 100 × OVR
Contrato juvenil = 3 años
```

Un candidato de OVR 60 y potencial 78 cuesta 32.500 de formación y 8.000 anuales.
La firma se registra en el diario de caja existente, incorpora un jugador de rol
juvenil, asigna dorsal y consume una plaza real. Debe haber caja para el coste y
margen salarial para el contrato. No se descuenta automáticamente a otro jugador.

Todos los jugadores contratados, juveniles incluidos, cuentan para las **28 plazas**.
El usuario decide cuándo vender, liberar o ceder para crear espacio. Candidatos
rechazados o no firmados desaparecen del grupo temporal; no se convierten en
agentes libres. El plazo de decisión es de 180 días y las nuevas generaciones
reemplazan el grupo anterior. El cupo consumido no se recupera al vender o liberar
a un juvenil, ni al rechazar otro candidato.

No se agrega una segunda plantilla juvenil persistente ni un segundo sistema de
contratos. Se reutilizan entrenamiento, promociones, ventas y cesiones existentes.

## 7. Mejoras de academia y desarrollo

La academia puede subir **un nivel por temporada**, hasta el nivel 5. Los costes
de subir de 1→2, 2→3, 3→4 y 4→5 son 250.000, 500.000, 750.000 y 1.000.000.
Se aplican las comprobaciones financieras existentes del club. El límite por
temporada y el nivel quedan guardados. No se cobra por una mejora al nivel máximo.

Las mejoras no vuelven a sortear la generación actual ni amplían sus firmas
restantes. La pantalla muestra el número de candidatos y plazas de la siguiente
generación, haciendo visible lo que compra la inversión.

El entrenamiento diario reduce su probabilidad base de mejora por atributo de
0,15 a 0,045. Conserva edad, intensidad, entrenadores y especializaciones, y añade:

- Instalaciones de entrenamiento: multiplicador 1,00–1,32, niveles 1–5.
- Hasta los 23 años: multiplicador por minutos de 0,80 sin minutos hasta 1,20
  con 1.800 minutos de la temporada. Los suplentes también progresan; jugar acelera
  el desarrollo. La cesión conserva los minutos y mejoras de su sistema existente.
- Entrenamiento y envejecimiento comprueban que las ganancias no eleven el techo
  de potencial mediante redondeo de la valoración.

Ejemplo de trayectoria: invertir una vez al año permite pasar de seis candidatos
iniciales a diez en la tercera generación y catorce en la quinta. Las primeras
firmas ya han acumulado temporadas de formación mientras llegan nuevos proyectos.
La venta de jugadores que no entran en el primer equipo continúa siendo una
decisión económica disponible, con un máximo anual acotado de nueva producción.

## 8. IA y equilibrio del mundo

La IA recibe hasta dos juveniles anuales directamente, con necesidades de posición,
límites de plantilla y población ya existentes. Utiliza la nueva distribución de
calidad y potencial; no elige los mejores entre catorce candidatos. El club humano
recibe más opciones y puede firmar hasta cuatro, pero deja de recibir dos jugadores
automáticos adicionales.

Se mantienen retiros, abandonos de agentes libres, archivo acotado de retirados,
reserva internacional limitada y reparaciones de emergencia. Estas últimas usan
el mismo generador equilibrado y no imprimen estrellas para solventar una carencia.
El número de candidatos no cuenta como población activa.

Incluso firmando cuatro candidatos durante veinte temporadas, un único club
humano incorporaría como máximo 80 jugadores antes de descontar retiros y salidas:
menos del 3 % de la población inicial del mundo de referencia. La selección cambia
mucho la experiencia de ese club, pero su cupo impide multiplicar el mundo.

## 9. Persistencia y archivos

El nivel juvenil se guarda en el JSON de instalaciones de cada equipo. La migración
46 agrega nivel 1 a instalaciones antiguas sin esa propiedad. Los grupos de
candidatos, plazos, firmas y mejoras por temporada usan el estado persistente de
gestión de plantillas introducido en la migración 45. Todos los campos nuevos
tienen valores predeterminados. Las pruebas cubren tanto JSON como SQLite.

Principales archivos añadidos:

- `src-tauri/crates/ofm_core/src/academy/{mod,generation,tests}.rs`.
- `src-tauri/crates/ofm_core/examples/academy_balance.rs`.
- `src-tauri/crates/db/src/sql/v046_youth_facilities.sql`.
- `src/services/academyService.ts` y su prueba.
- `src/components/youthAcademy/AcademyIntakePanel.tsx` y su prueba.

Integraciones modificadas: `domain/src/team.rs`, `ofm_core/src/{lib,club,scouting,
training,aging}.rs`, `ai_squad/{mod,lifecycle,tests}.rs`, la herramienta
`examples/squad_lifecycle.rs`, comandos `club.rs` y su registro, persistencia y
pruebas de instalaciones/guardado, tipos de frontend, la pantalla de cantera y
su prueba, el botón de instalaciones máximas y las doce traducciones.

## 10. Reproducir las comprobaciones

```bash
# Distribución de candidatos, selección por informes y frecuencia de talentos.
cargo run --manifest-path src-tauri/Cargo.toml -p ofm_core \
  --example academy_balance -- 2000

# Carrera real de 96 clubes con hitos en 1, 5, 10 y 20 temporadas.
cargo run --manifest-path src-tauri/Cargo.toml -p ofm_core \
  --example squad_lifecycle -- 20
```

La primera herramienta examina 2.000 generaciones por combinación de nivel y
nivel de club (50, 65, 76), usando candidatos reales y selección por sus informes
públicos. No estima el éxito deportivo ni supone que todo potencial se alcanza.
La segunda ejecuta turnos, entrenamiento, finanzas y cierre de temporada reales,
sin dinero ni reparaciones añadidas por el simulador. Utiliza resultados de
partidos simplificados y un observador sin club, por lo que mide el equilibrio IA.
Las decisiones humanas y sus vías de firma se verifican en pruebas específicas.
La herramienta falla si detecta duplicados, vacantes, incumplimientos nuevos de
salarios o si los hitos superan márgenes amplios de población, calidad, potencial,
proporción de jugadores 80+/90+ y edad. Los límites de balance corresponden a este
mundo de referencia; no son afirmaciones universales sobre cualquier mundo modificado.

## Resultados de balance y validación

Se ejecutaron **30.000 generaciones y 300.000 candidatos**, junto con una carrera
de **96 clubes durante veinte temporadas**. Son resultados observados de una
muestra; las generaciones usan semillas reproducibles, mientras otros subsistemas
de la carrera conservan aleatoriedad. Los partidos se resuelven por resultados
simplificados. La carrera no incorpora decisiones de contratación humanas.

| Temporada | Activos | Total persistente | OVR medio | Potencial medio | OVR 80+ | OVR 90+ | Edad media |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | 2679 | 2679 | 72.10 | 78.35 | 309 | 4 | 26.15 |
| 1 | 2633 | 2822 | 74.18 | 78.26 | 573 | 16 | 25.74 |
| 5 | 2727 | 3335 | 75.09 | 77.37 | 828 | 19 | 25.87 |
| 10 | 2689 | 3261 | 72.94 | 75.68 | 590 | 13 | 25.01 |
| 20 | 2840 | 3262 | 71.22 | 73.71 | 315 | 3 | 25.04 |

Activos incluye jugadores de club y agentes libres. Total persistente añade los
retirados todavía conservados; el archivo histórico de retirados eliminados se
guarda aparte. Los excedentes de plantillas importadas se resuelven mediante
contratos y salidas, sin borrar jugadores del primer equipo al abrir la partida.

| Temporada | Agentes libres | Plantilla mínima–máxima | Potencial 80+ | Potencial 90+ |
| ---: | ---: | ---: | ---: | ---: |
| 0 | 0 | 21–36 | 1087 | 25 |
| 1 | 0 | 22–34 | 1076 | 25 |
| 5 | 250 | 22–28 | 1040 | 40 |
| 10 | 192 | 22–28 | 840 | 38 |
| 20 | 216 | 23–28 | 567 | 20 |

### Distribución de OVR actual de jugadores activos

| Temporada | <50 | 50–59 | 60–69 | 70–79 | 80–89 | 90+ |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | 2 | 127 | 670 | 1571 | 305 | 4 |
| 1 | 0 | 92 | 485 | 1483 | 557 | 16 |
| 5 | 0 | 107 | 511 | 1281 | 809 | 19 |
| 10 | 0 | 109 | 840 | 1150 | 577 | 13 |
| 20 | 0 | 96 | 1097 | 1332 | 312 | 3 |

### Distribución de potencial de jugadores activos

| Temporada | <50 | 50–59 | 60–69 | 70–79 | 80–89 | 90+ |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | 0 | 1 | 103 | 1488 | 1062 | 25 |
| 1 | 0 | 1 | 129 | 1427 | 1051 | 25 |
| 5 | 0 | 0 | 342 | 1345 | 1000 | 40 |
| 10 | 0 | 2 | 626 | 1221 | 802 | 38 |
| 20 | 0 | 0 | 880 | 1393 | 547 | 20 |

### Efecto de la academia en un club de referencia 65

Cada fila utiliza 2.000 generaciones. Selección significa escoger por rango
público y calidad actual hasta el cupo; no se utiliza el potencial oculto para
ordenar. Potencial no equivale a alcanzar esa calidad en una carrera.

| Nivel | OVR inicial medio | Potencial medio | Potencial medio de firmas seleccionadas | Generaciones con potencial 85+ | Generaciones con potencial 90+ |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 49.49 | 71.63 | 77.97 | 23.05 % | 2.00 % |
| 2 | 51.33 | 72.57 | 80.31 | 36.70 % | 3.15 % |
| 3 | 53.29 | 73.58 | 80.89 | 53.05 % | 4.40 % |
| 4 | 55.27 | 74.57 | 82.74 | 66.30 % | 7.55 % |
| 5 | 57.23 | 75.56 | 83.34 | 82.90 % | 10.50 % |

Al cabo de veinte temporadas, los jugadores 80+ representan el 11.09 % y los 90+ el 0.11 % de los activos. La población y la edad conservan valores razonables; no aparece una acumulación general de plantillas 85–95. La calidad media global baja respecto a los primeros años, coherente con academias IA de nivel 1: este modelo favorece que invertir en la cantera humana produzca una ventaja visible. No implica que todo club IA mantenga exactamente su nivel inicial.

La frecuencia de potencial 90+ es la misma para clubes 50, 65 y 76 al compartir
identificadores de la muestra: depende de academia y sorteo, no de poder del club.
La calidad inicial y la consistencia ordinaria sí cambian. Los datos completos
están en [youth-academy-candidates.jsonl](validation/youth-academy-candidates.jsonl)
y [youth-academy-20-seasons.jsonl](validation/youth-academy-20-seasons.jsonl).

### Comprobaciones realizadas

- Backend completo: **1.879 pruebas pasan**, cero fallos, dos ignoradas.
- Cantera, servicios, integración y traducciones: **64 pruebas pasan en ocho archivos**.
- Compilación de frontend y comprobación de tipos: pasa.
- Clippy de todo el workspace y todos los targets: pasa; queda un aviso existente
  sobre `advance_one_day_internal`, fuera del rediseño.
- Suite frontend completa: **1.555 pasan y 50 fallan en otras superficies**.
  Las incidencias incluyen expectativas de nombres visibles y un caso de sesión
  guardada de Dashboard. La suite general todavía no está completamente verde.
- La simulación no detecta duplicados, déficits diarios de posiciones o plantillas,
  ni nuevas violaciones salariales producidas por la política de contratación.
- Se verifican guardado y recarga, expiración, descarte, cupos compartidos con
  ojeadores, cambio de club, límite de 28, cobros, margen salarial, mejora una vez
  por temporada, generaciones distintas entre carreras y techo de desarrollo.


## 11. Límites y mejoras futuras

El sistema garantiza oportunidades útiles y una progresión visible de la academia.
Alcanzar el potencial depende de desarrollo y decisiones; no se promete un éxito
deportivo cada temporada. Una serie mala no cancela la inversión: siguen aumentando
opciones, preparación inicial, precisión y plazas futuras.

Los clubes IA no mejoran automáticamente sus academias en esta entrega. Un mundo
importado puede definir niveles juveniles distintos; las partidas antiguas parten
de 1. La economía de largo plazo todavía conserva los ingresos existentes: el
control de talento no equivale a recalibrar toda la caja del juego.

Los rangos se usan en la pantalla de candidatos; los informes de ojeadores y
jugadores ya contratados mantienen la información detallada existente. No hay
un sistema universal de potencial oculto. El estado interno completo también
conserva los valores reales para guardar y simular.

Las bonificaciones de cantera, cláusulas de futura venta, entrenamientos juveniles
especiales y objetivos de minutos podrían ampliar el sistema posteriormente.
Esta entrega prioriza un ciclo completo de inversión, generación, selección,
contrato y desarrollo, con población y talento acotados.
