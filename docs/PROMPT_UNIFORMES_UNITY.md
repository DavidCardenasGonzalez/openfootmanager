# Prompt para investigar los uniformes de Open Manager

Adjunta `data/open-manager/world.json` o una lista extraída de `teams` que incluya `id`, `name`, `country` y `kits`. Si tienes capturas o el JSON de la primera versión, adjúntalos también. Puedes usar este prompt para toda la base o enviar los clubes en lotes.

> Completa las equipaciones de campo local y visitante de los clubes incluidos en el archivo adjunto. El objetivo es recuperar los diseños que usaba nuestra primera versión de Open Manager. Usa primero sus datos y capturas. Si falta un diseño y hay una temporada indicada, usa esa misma temporada y verifica la equipación con el club, su fabricante o fotos de partidos. Si el material del proyecto tampoco identifica la temporada, conserva la equipación existente y marca el slot como pendiente.
>
> Identifica cada club por su `id` exacto. Usa su nombre y país para encontrar las referencias. Si el club tiene una equipación alternativa y una tercera, elige la visitante oficial. Estima los colores a partir de las referencias en formato `#RRGGBB`. `primary` es el color base y `secondary` el que ocupa la segunda zona de la máscara. Mira camiseta, shorts y medias antes de elegir el patrón más cercano. Para camisetas lisas puedes omitir `unity_mask`. Si hay elementos que las plantillas no reproducen, anota la diferencia en el informe.
>
> Los valores de `pattern` son `Solid` (liso), `Stripes` (rayas verticales), `Hoops` (rayas horizontales), `HalfAndHalf` (dos zonas de color) y `Diagonal` (banda o rayas diagonales). Este campo es obligatorio y también lo usa la vista 2D. `unity_mask` es opcional y permite que Unity use una de estas diez plantillas:
>
> | `unity_mask` | Diseño |
> | --- | --- |
> | 1 | Franja vertical central y ribetes |
> | 2 | Rayas horizontales |
> | 3 | Rayas verticales finas y shorts en el color secundario |
> | 4 | Banda horizontal ancha en el pecho |
> | 5 | Franjas laterales o diseño a dos tonos |
> | 6 | Franjas diagonales |
> | 7 | Canesú, hombros y mangas en el color secundario |
> | 8 | Degradado entre los dos colores |
> | 9 | Rayas verticales anchas |
> | 10 | Gráfico en el pecho |
>
> Entrega `kits-unity.json` como JSON válido, con una fila por club solicitado, sin comentarios y sin texto dentro del archivo aparte del JSON. Usa `null` para un slot pendiente de evidencia. Ejemplo ficticio (reemplaza el ID por el ID literal del archivo):
>
> ```json
> {
>   "teams": [
>     {
>       "id": "id-del-club-en-el-archivo",
>       "kits": {
>         "home": {
>           "pattern": "Stripes",
>           "colors": { "primary": "#192A68", "secondary": "#F5BBC7" },
>           "unity_mask": 3
>         },
>         "away": {
>           "pattern": "Solid",
>           "colors": { "primary": "#F3F1E8", "secondary": "#F3F1E8" }
>         }
>       }
>     }
>   ]
> }
> ```
>
> En un informe aparte, indica por club y slot la temporada, la fuente, qué colores son estimados y qué detalles requirieron una aproximación. Si hay un pendiente, di qué referencia falta. Limita la entrega a uniformes local y visitante de jugadores de campo.

## Aplicar el resultado

Desde la raíz de Open Manager, fusiona el JSON validado con la base:

```powershell
node scripts/apply-world-kits.mjs data/open-manager/world.json kits-unity.json data/open-manager/world.with-kits.json
```

Cada slot `null` conserva el valor de la base. Para usar la base resultante con **Open Manager** en desarrollo, revisa el diff y reemplaza `data/open-manager/world.json` por la versión fusionada. Esto alimenta las carreras nuevas. Las carreras existentes exportan a Unity los uniformes que ya guardaron.
