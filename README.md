# asu-cli

CLI en español para tareas de traducción con subtítulos ASS. Reimplementa herramientas de Asu:

- **Crear AVS de trabajo**: `RAW.avs` con video y audio (`FFVideoSource` + `FFAudioSource`).
- **Crear AVS de compresión**: video redimensionado (`spline64Resize`) con los subtítulos quemados (`textsub`).
- **Verificar fuentes**: revisa que las fuentes usadas por los `.ass` estén disponibles.
- **Unir archivos .ass**: junta varios `.ass` en uno, en el orden elegido.
- **Reescalar resolución**: cambia el PlayRes de `.ass` escalando estilos, tags y dibujos.

Solo Windows. Usa [Bun](https://bun.com) y [`@fs-frost/asu`](https://jsr.io/@fs-frost/asu).

## Instalación

Requisitos: [Bun](https://bun.com) 1.4 o superior.

```powershell
git clone <repo> asu-cli
cd asu-cli
bun install
bun link
```

`bun link` deja el comando `asu` en `%USERPROFILE%\.bun\bin`, que el instalador de Bun agrega al `PATH`. Comprueba con:

```powershell
asu --version
```

Como el comando apunta al código del repo, los cambios se usan al instante, sin reinstalar. Si mueves o borras la carpeta del repo, `asu` deja de funcionar.

Para desinstalar, desde la carpeta del repo:

```powershell
bun unlink
```

## Uso

Sin argumentos, `asu` abre un menú interactivo. Cada herramienta también se puede invocar directo; `[dir]` es el directorio a procesar (por defecto, el actual).

```powershell
asu                                   # menú interactivo
asu avs-trabajo [dir]                 # crea RAW.avs
asu avs-compresion [dir] -p 720p      # crea MP4-720p.avs
asu fuentes [dir]                     # verifica fuentes
asu unir [dir] -s a.ass -s b.ass      # une .ass en Unificado.ass
asu reescalar [dir] -s a.ass -r 1920x1080   # crea "a - 1920x1080.ass"
asu config preajustes                 # lista preajustes
asu --help                            # ayuda general
asu <comando> --help                  # ayuda de un comando
```

Cuando hay que ordenar archivos (textsub de compresión, unión) aparece una lista con el orden propuesto: ↑/↓ navegan, **espacio agarra** el archivo y ↑/↓ lo mueven, espacio de nuevo lo suelta, **Enter** confirma (sin mover nada acepta el orden propuesto) y Esc cancela.

Si falta un dato (qué video usar, qué preajuste, qué subtítulos) y hay terminal, se pregunta. Sin terminal (scripts), es un error, salvo los subtítulos: se usan todos los `.ass` en orden alfabético.

### avs-trabajo

```powershell
asu avs-trabajo [dir] [--video <archivo>] [-o|--salida <nombre>] [-f|--forzar]
```

Crea `RAW.avs` con el video del directorio. Si hay uno solo se usa directo. El archivo es idéntico al que generaba `Asu.CrearAVSDeTrabajo.exe`.

### avs-compresion

```powershell
asu avs-compresion [dir] [--video <archivo>] [-p|--preajuste <nombre>] [-s|--subs <archivo>]... [-o|--salida <nombre>] [-f|--forzar]
```

Crea el AVS con `FFVideoSource` (sin audio), `spline64Resize` según el preajuste y un `textsub` por subtítulo. `--subs` se repite para varios archivos, en orden; el último se dibuja encima.

```powershell
asu avs-compresion . -p 1080p -s "Ep01 - Diálogos.ass" -s "Ep01 - Carteles.ass"
```

### fuentes

```powershell
asu fuentes [dir]
```

Para cada `.ass`, junta las fuentes usadas por las líneas `Dialogue`: las de los estilos usados (directo o con `\r<Estilo>`) y todos los `\fn`. Una fuente está disponible si:

- está instalada en Windows (sistema o usuario),
- está suelta en el directorio (`.ttf`, `.otf`, `.ttc`, `.otc`), o
- está incrustada en la sección `[Fonts]` del `.ass`.

La comparación ignora mayúsculas y el `@` de las fuentes verticales. Termina con código 1 si falta alguna fuente o algún `.ass` no se pudo leer.

La primera ejecución lee todas las fuentes instaladas (unos segundos). Después usa un cache que solo vuelve a leer archivos nuevos o modificados.

### unir

```powershell
asu unir [dir] [-s|--subs <archivo>]... [-o|--salida <nombre>] [-f|--forzar]
```

En el menú se listan los `.ass` del directorio sin ninguno marcado; se eligen al menos 2 y luego el orden. El orden propuesto agrupa por nombre: primero los que contienen `carteles`, luego `karaoke`, luego `subs` y al final el resto (sin distinguir mayúsculas; alfabético dentro de cada grupo; si un nombre calza con varias, gana la primera). Por argumentos, `-s` se repite en orden (sin terminal interactiva es obligatorio). El nombre de salida se pregunta (sugerencia `Unificado`); por argumentos es `-o`, o `Unificado.ass` si no se indica.

```powershell
asu unir . -s "Ep01 - Diálogos.ass" -s "Ep01 - Carteles.ass" -o "Ep01 - Final"
```

Cómo se une:

- **Líneas**: por bloques de archivo, en el orden elegido. Dentro de una misma capa (layer), lo que va después se dibuja encima. Se conservan los `Comment`.
- **Estilos**: si dos archivos tienen un estilo con el mismo nombre e idéntico, queda uno. Si difieren, el del archivo posterior se renombra `Nombre (archivo)`, y sus líneas y `\r` se actualizan.
- **Cabecera**: `[Script Info]` y `[Aegisub Project Garbage]` (video, audio) salen del primer archivo.
- **PlayRes distinto**: si un archivo tiene otro `PlayResX`/`PlayResY` que el primero, en el menú se ofrece reescalarlo a la resolución del primero (solo en memoria; el original no se toca). Por argumentos se hace con `--reescalar` (y `-m/--modo`); sin él, se avisa y se sugiere el comando `asu reescalar` correspondiente.
- **Adjuntos**: fuentes y gráficos de `[Fonts]`/`[Graphics]` sin repetir por nombre.
- **`[Aegisub Extradata]`**: se descarta, junto con las referencias `{=N}` de las líneas (los ids chocarían entre archivos).
- **Formato**: UTF-8 con BOM y CRLF, como guarda Aegisub. El archivo se reescribe con `@fs-frost/asu`, así que pueden cambiar detalles de formato (orden de comentarios en `[Script Info]`, secciones vacías), no el contenido de las líneas.

Si algún archivo no se puede leer, no se une nada.

### reescalar

```powershell
asu reescalar [dir] [-s|--subs <archivo>]... [-r|--resolucion <AxB>] [-m|--modo estirar|bandas] [-o|--salida <nombre>] [-f|--forzar]
```

Equivalente a *Resample Resolution* de Aegisub. Crea `<nombre> - <ancho>x<alto>.ass` junto al original, que no se modifica; `-o` solo con un archivo. Los archivos que ya tienen la resolución pedida se omiten. En el menú se eligen los archivos (ninguno marcado) y la resolución (1920x1080, 1280x720 u otra).

Qué se escala:

- **Estilos**: Fontsize (entero), Outline, Shadow, Spacing, márgenes; ScaleX si cambia la proporción.
- **Líneas**: márgenes distintos de 0 (0 significa "usar el del estilo").
- **Tags** (también dentro de `\t`): `\pos`, `\move` (no sus tiempos), `\org`, `\clip`/`\iclip` rectangular y vectorial, `\fs`, `\fsp`, `\fscx`, `\bord`, `\xbord`, `\ybord`, `\shad`, `\xshad`, `\yshad`, `\blur`, `\pbo`.
- **Dibujos** `\p`.
- **`[Script Info]`**: `PlayResX`/`PlayResY`, y `LayoutResX`/`LayoutResY` si existen.

No se escala `\be` (es una cantidad de pasadas, no un tamaño). Si `ScaledBorderAndShadow` no es `yes`, el borde, la sombra y `\blur` tampoco: en ese modo se miden en píxeles del video, no del script. Si falta el PlayRes se usa el de ASS por defecto (384x288, o el que se deduce del que sí esté).

Modos, que solo importan si cambia la proporción (por ejemplo 640x480 → 1920x1080):

- **`estirar`** (por defecto): conserva cómo se ve sobre el video. Las posiciones en X escalan por el ancho y en Y por el alto; la letra, los bordes y los dibujos crecen con el alto, y `\fscx` compensa el ancho. Es el caso típico de un script 4:3 que se ve estirado sobre un video 16:9. El `\bord`/`\shad` uniforme escala por el alto, así que el borde horizontal puede quedar levemente distinto.
- **`bandas`**: escala todo parejo con el factor menor y centra (bandas a los lados o arriba y abajo). Sirve si el video también tiene bandas.

En el menú, el modo se pregunta solo si cambia la proporción.

### config

```powershell
asu config preajustes                                         # listar
asu config preajustes agregar 900p 1600x900 --archivo MP4-900p
asu config preajustes quitar 900p
asu config restablecer                                        # vuelve a los de fábrica
asu config ruta                                               # ruta de config.json
```

Preajustes de fábrica:

| Nombre | Resolución | Archivo         |
| ------ | ---------- | --------------- |
| 720p   | 1280x720   | `MP4-720p.avs`  |
| 396p   | 704x396    | `AVI.avs`       |
| 1080p  | 1920x1080  | `MP4-1080p.avs` |

## Archivos `.avs`

- Se escriben en **Windows-1252**: AviSynth+ 3.5 lee los scripts en la codificación ANSI del sistema. Si una ruta tiene caracteres que no existen en esa codificación (por ejemplo, japonés), la CLI avisa y no crea el archivo.
- Las rutas dentro del `.avs` son absolutas.
- FPS fijos: 24000/1001.
- Si el `.avs` ya existe, el menú ofrece sobrescribir, usar otro nombre o cancelar. Por argumentos: `--forzar` o `--salida <nombre>`.

## Configuración

Vive en `%USERPROFILE%\.asu-cli\`:

- `config.json`: preajustes. Se crea al modificar un preajuste; mientras no exista se usan los de fábrica. Se puede editar a mano.
- `cache-fuentes.json`: nombres de las fuentes instaladas. Se puede borrar sin problema; se reconstruye.

## Desarrollo

```powershell
bun install
bun test          # tests
bun check         # typecheck
bun src/cli.ts    # ejecutar sin bun link
```

Variables de entorno usadas por los tests:

- `ASU_CLI_HOME`: reemplaza `~/.asu-cli`.
- `ASU_CLI_DIRECTORIOS_FUENTES`: reemplaza los directorios de fuentes del sistema (separados por `;`).

Estructura:

```
src/
  cli.ts            entrada: parseo de argumentos y despacho
  menu.ts           menú interactivo
  ayuda.ts          textos de --help
  ui.ts             prompts (@clack/prompts) y errores
  lista-ordenable.ts  prompt propio de lista reordenable (@clack/core)
  comandos/         cada herramienta (I/O e interacción)
  nucleo/           lógica pura: generación de AVS, fuentes, unión y reescalado de .ass, config, Windows-1252
tests/              bun test; fixtures/ se compara byte a byte
```
