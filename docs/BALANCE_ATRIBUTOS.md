# Balance de atributos de jugador

El overall de la ficha se calcula por posición natural. Para elegir el once, OpenFoot también evalúa el puesto de destino, la familiaridad y la condición. En los partidos, los atributos intervienen en las acciones que les corresponden. Un extremo gana opciones para desbordar con velocidad, y necesita regate para aprovecharlas y finalización para convertirlas.

| Atributo | Simulación Rust | Partido Unity 3D |
| --- | --- | --- |
| Velocidad | Desborde y presión, al 12 % y 10 % de esas acciones respectivamente | Punta y parte de la aceleración, con un rango reducido porque ambas influyen en quién llega al balón |
| Resistencia | Intensidad de la presión, disputa del medio y conservación de condición en el partido en vivo | Ritmo de desgaste por minuto |
| Fuerza | Disputas aéreas y defensa del regate | Contacto, protección del balón y parte del salto |
| Agilidad | Desborde y paradas | Giros, aceleración, carrera con balón y alcance del portero |
| Juego aéreo | Disputas de centros | Salto |
| Pase | Salida y avance en el medio | Pase corto y largo |
| Tiro | Remates y penales | Precisión y potencia de tiro |
| Entradas | Recuperaciones en el medio, defensa del regate y presión | Éxito de la entrada |
| Regate | Avance en el medio y desborde | Control, protección del balón y carrera con balón |
| Defensa | Contención del regate | Colocación defensiva y éxito de la entrada |
| Colocación | Defensa, desborde, remate, juego aéreo y paradas | Colocación de campo y portería |
| Visión | Avance en el medio y elección del centro, con más peso que el pase al buscar al rematador | Pase corto y largo |
| Decisiones | Disputa del medio, presión, desborde, remate y penales | Colocación de campo, pase largo y precisión de tiro |
| Compostura | Salida, desborde, remates y penales | Precisión de tiro, control y protección del balón |
| Agresividad | Pequeña ventaja en defensa del regate, con más riesgo de faltas y tarjetas | Pequeña ventaja en las entradas y mayor riesgo de falta |
| Trabajo en equipo | Salida, avance, recuperación en el medio y presión | Precisión del pase corto |
| Liderazgo | Aporte acotado a la disputa por la posesión. En vivo cuenta el capitán activo y, si falta, el líder disponible. | El mejor liderazgo en cancha ayuda a reducir el riesgo de falta. |
| Blocaje | Paradas, penales y probabilidad de atrapar un remate en vez de despejarlo | Control del balón del portero y dificultad para batirlo |
| Reflejos | Paradas y penales | Reacción del portero en las estiradas y dificultad para batirlo |

El peso de la velocidad en el overall del extremo baja del 22 % al 14 %. El regate pesa 24 %, el pase 16 % y la agilidad 9 %. Los perfiles de banda pueden compensar una velocidad baja con sus atributos técnicos. Un central aporta en función de su defensa y entradas, y el portero se valora principalmente por blocaje, reflejos y colocación.

## Prueba reproducible

```powershell
cargo run --manifest-path src-tauri/Cargo.toml -p sim-bench --release -- --attribute-sweep --games 12000 --seed 20261122
```

La referencia enfrenta dos equipos 4-3-3 con los mismos atributos. Cada escenario sube un atributo de 70 a 99 en el equipo probado y alterna el lado de inicio. El blocaje y los reflejos se prueban en el portero. La velocidad se prueba con el rasgo Velocista. La última fila enfrenta ese equipo veloz a uno con regate 90 y pase 82. La salida incluye victorias, goles, posesión y faltas para detectar efectos que el marcador por sí solo puede ocultar.

| Escenario | Victorias | Goles a favor | Goles en contra |
| --- | ---: | ---: | ---: |
| Plantillas iguales | 38,95 % | 1,758 | 1,761 |
| Velocidad 99 y rasgo Velocista | 39,96 % | 1,804 | 1,751 |
| Regate 99 | 42,58 % | 1,913 | 1,736 |
| Tiro 99 | 49,50 % | 2,251 | 1,760 |
| Blocaje 99 del portero | 43,62 % | 1,763 | 1,550 |
| Equipo veloz frente al equipo técnico | 35,38 % | 1,747 | 1,917 |

Subir la agresividad a 99 añadió 2,39 faltas por partido. Con liderazgo 99, la posesión media subió de 49,90 % a 50,64 %. En otra muestra de 12 000 partidos con perfiles distintos por posición, el promedio global pasó de 3,79 a 3,83 goles por partido.
