# Instrucciones individuales en Unity

El panel del partido permite seleccionar a un jugador en cancha y elegir un rol compatible con su puesto actual. La elección de la previa se aplica desde el saque inicial. Las órdenes que das en el panel rigen durante el partido observado. Si el jugador cambia a un puesto incompatible, su instrucción queda en pausa y vuelve a activarse si regresa a un puesto compatible. Un suplente entra en Estándar.

La tabla cubre las 27 opciones de OpenFoot, incluido Estándar. Las filas agrupan los lados izquierdo y derecho cuando comparten el mismo comportamiento. Las categorías antiguas «Defensa», «Mediocampista» y «Delantero» se resuelven por el puesto que el jugador ocupa en Unity. El asset no tiene un puesto independiente de carrilero, así que la instrucción Carrilero se aplica al lateral del lado correspondiente.

| Posición | Instrucción | Efecto en el simulador | Estado |
| --- | --- | --- | --- |
| Todas | Estándar | Usa el posicionamiento y las decisiones originales del puesto. | Implementado |
| Portero | Portero jugador | Busca un apoyo libre a 5–22 m. Los centrales a izquierda y derecha se abren para apoyar cuando asegura la pelota. Prioriza la salida corta en el saque de meta o la entrega a un apoyo tras la atajada. Bajo presión usa la distribución habitual. | Implementado |
| Portero | Portero libre | Sale hacia balones libres detrás de la defensa cuando calcula que llega antes que el rival. Si la ventaja se pierde o la trayectoria apunta a portería, retoma la decisión habitual del portero. | Implementado |
| Central izquierdo, derecho o centro | Stopper | Adelanta su posición de referencia sin balón para acortar la distancia al rival. | Implementado |
| Central izquierdo, derecho o centro | Cobertura | Retrasa su posición de referencia sin balón para proteger el espacio a la espalda de la línea. | Implementado |
| Central izquierdo, derecho o centro | Central jugador | Prueba antes el pase disponible en lugar de iniciar una conducción. Cerca de su portería conserva las decisiones habituales de emergencia. | Implementado |
| Lateral o carrilero izquierdo y derecho | Lateral ofensivo | Se coloca más arriba con posesión para dar una salida por su lado. | Implementado |
| Lateral o carrilero izquierdo y derecho | Lateral defensivo | Se queda más atrás con posesión para cubrir la pérdida. | Implementado |
| Lateral o carrilero izquierdo y derecho | Lateral invertido | Se adelanta unos metros y se acerca al centro con posesión. | Implementado |
| Lateral o carrilero izquierdo y derecho | Carrilero | Gana más altura y amplitud que el lateral ofensivo. Con balón, prueba el centro del simulador cuando es viable. | Implementado |
| Mediocentro defensivo | Pivote defensivo | Se mantiene más bajo y centrado, también cuando su equipo ataca. | Implementado |
| Mediocentro defensivo | Recuperador | Con posesión rival, recorta distancias hacia el balón cuando está cerca de su zona. El motor conserva el control de cuándo intentar la entrada. | Implementado |
| Mediocentro defensivo | Organizador retrasado | Ofrece apoyo por detrás y prueba antes el pase disponible. | Implementado |
| Mediocentro central | Box-to-box | Gana altura con posesión y baja al perderla. El desplazamiento usa la velocidad y el movimiento del jugador. | Implementado |
| Mediocentro central | Carrilero de mediocampo | Desplaza su posición hacia el carril del balón y ofrece cobertura lateral. | Implementado |
| Mediocentro central | Mezzala | Con posesión, avanza hacia el espacio entre el centro y la banda sin ocupar la línea del extremo. | Implementado |
| Mediapunta | Organizador adelantado | Se ofrece algo más atrás y por dentro para recibir. Con balón, prueba antes el pase disponible. | Implementado |
| Mediapunta | Segunda punta | Pisa zonas más altas y centrales, y prioriza rematar cuando el motor detecta una opción válida. | Implementado |
| Medio de banda o extremo izquierdo y derecho | Extremo abierto | Se abre hacia la banda y gana altura con posesión. Con balón, considera antes el centro. | Implementado |
| Medio de banda o extremo izquierdo y derecho | Interior ofensivo | Busca una posición más alta y central. Con balón, intenta conducir por dentro o rematar si está en zona avanzada. | Implementado |
| Medio de banda o extremo izquierdo y derecho | Extremo invertido | Se acerca al espacio interior desde su banda e intenta conducir hacia portería. Se queda a menor altura que el interior ofensivo. | Implementado |
| Delantero centro, izquierdo o derecho | Delantero de área | Se acerca a la última línea y al centro del área. Al recibir cerca de la portería, considera antes el remate. | Implementado |
| Delantero centro, izquierdo o derecho | Delantero de referencia | Se ofrece por dentro. Los compañeros lo buscan si hay un apoyo cercano y el motor valida el pase. Una marca físicamente superior reduce esa preferencia. Al recibir, considera antes la descarga. | Implementado |
| Delantero centro, izquierdo o derecho | Delantero de apoyo | Retrocede para enlazar con el mediocampo y prueba antes el pase al recibir. Corresponde a `DeepLyingForward` en el código. | Implementado |
| Delantero centro, izquierdo o derecho | Falso nueve | Baja entre líneas cuando un compañero habilitado puede atacar el hueco. Sin una ruptura viable mantiene el posicionamiento normal de delantero. | Implementado |
| Delantero centro, izquierdo o derecho | Delantero de presión | Se acerca al poseedor rival cuando está dentro de su zona de presión. Recupera su posición normal si el balón sale de esa zona. | Implementado |
| Delantero centro, izquierdo o derecho | Delantero completo | Ofrece apoyo si la jugada está aislada o gana altura cuando tiene respaldo. Con balón, considera remate arriba, pase bajo presión o conducción con espacio. Tras perder la pelota, presiona dentro de su zona. | Implementado |

Los roles implementados ajustan la colocación que calcula el simulador y, cuando corresponde, dan preferencia a pase, conducción, centro o remate con los comportamientos que ya existen. Las instrucciones respetan la dirección de ataque, los límites del campo y la línea de fuera de juego. Los roles de presión cambian la aproximación al rival, mientras que la entrada conserva las reglas del simulador.

## Comprobar las jugadas

| Situación | Qué observar |
| --- | --- |
| Salida de portero con un central libre y luego con la línea de pase cerrada | Salida al apoyo en la primera jugada y distribución habitual en la segunda. |
| Balón largo a espaldas de la defensa, luego un pase dividido que gana el rival | Salida en la primera jugada y repliegue en la segunda. Los disparos en dirección a portería conservan la parada habitual. |
| Referencia con un apoyo al alcance | El pasador puede buscar al delantero cuando la recepción es viable. Si este recibe, se puede ver la descarga a un compañero. |
| Falso nueve con un corredor habilitado | El delantero baja y otro jugador avanza en la misma jugada. La pareja se mantiene mientras el espacio y la posición legal lo permiten. |
| Delantero completo en posesión y tras la pérdida | Alterna entre apoyo, ruptura y presión a medida que cambia la jugada. Conserva la decisión de apoyo o ruptura por hasta dos segundos para suavizar cambios de trayectoria. |

Las distancias, el margen de llegada del portero y la duración de los apoyos son valores iniciales de calibración. El simulador conserva la ejecución y las animaciones de cada acción.

En un partido de prueba con 4-4-2, el falso nueve bajó entre líneas y el segundo delantero se adelantó en la misma posesión alrededor del minuto 27. El delantero completo aplicó ajustes de posición tanto en ataque como en defensa en otro partido. Se comprobaron aparte las decisiones menos frecuentes con situaciones preparadas en Unity, incluyendo la salida corta con el carril libre o cerrado, la carrera del portero ante un pase largo o un remate, y el pase a la referencia con y sin apoyo. Las combinaciones entre esquemas, rivales y estilos forman parte de la calibración del partido.
