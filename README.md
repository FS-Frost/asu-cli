# asu-cli

CLI en español para tareas de traducción con subtítulos ASS. Reimplementa herramientas de Asu:

- **Crear AVS de trabajo**: `RAW.avs` con video y audio (`FFVideoSource` + `FFAudioSource`).
- **Crear AVS de compresión**: video redimensionado (`spline64Resize`) con los subtítulos quemados (`textsub`).
- **Verificar fuentes**: revisa que las fuentes usadas por los `.ass` estén disponibles.
- **Unir archivos .ass**: junta varios `.ass` en uno, en el orden elegido.
- **Reescalar resolución**: cambia el PlayRes de `.ass` escalando estilos, tags y dibujos.
- **Encode de episodio**: produce las versiones finales (MP4 1080, MP4 720, AVI 396) con las herramientas de MeGUI, con su nombre definitivo.
- **Comparar ajustes de x264**: prueba A/B de variantes de x264 sobre tramos del episodio, con una página local para comparar frame a frame.

Solo Windows. Usa [Bun](https://bun.com) y [`@fs-frost/asu`](https://jsr.io/@fs-frost/asu).

## Instalación

Requisitos: [Bun](https://bun.com) 1.4 o superior. Algunas herramientas usan programas externos; solo hacen falta los de las que uses:

| Programa | Lo usan | Cómo instalarlo |
|---|---|---|
| [MeGUI](https://sourceforge.net/projects/megui/) (ffmpeg, x264, mp4box, neroAacEnc, xvid_encraw, lame, AVI-Mux GUI) | `encode`, `comparar` | Instalarlo y `asu config megui "<carpeta>"` (se pregunta la primera vez) |
| [AviSynth 2.60](https://sourceforge.net/projects/avisynth2/) de 32 bits + plugins ffms2 y VSFilter | `encode`, `comparar` | Instalarlo y copiar `ffms2.dll` y `VSFilter.dll` a su carpeta de plugins |
| FFmpeg (ffprobe) | `corregir-offset` | `winget install Gyan.FFmpeg` |
| [MKVToolNix](https://mkvtoolnix.download/) (mkvmerge, mkvextract), desde la 7.2 | `corregir-offset`, `mkv` | `winget install MoritzBunkus.MKVToolNix` |

`asu herramientas` muestra cuáles están, dónde y en qué versión. Cada comando revisa las suyas antes de empezar y, si falta alguna, dice qué falta y cómo instalarla.

```powershell
git clone https://github.com/FS-Frost/asu-cli.git asu-cli
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

### Menú contextual del Explorador (opcional)

Agrega "Asu" al clic derecho sobre una carpeta y sobre el fondo de una carpeta abierta, con subopciones: Menú…, Encode, Comparar, Verificar fuentes, CRC, AVS de trabajo, AVS de compresión, Unir subtítulos, Corregir offset y Extraer de MKV. Cada una abre Windows Terminal maximizado (o cmd si no está) en esa carpeta y ejecuta `asu`; al terminar, queda abierta una consola `cmd` en esa carpeta para seguir escribiendo comandos (de asu o cualquier otro; `exit` la cierra). "Comparar" abre el submenú Nueva comparación / Abrir una comparación. No pide administrador (escribe en `HKCU`).

```powershell
powershell -ExecutionPolicy Bypass -File scripts\menu-contextual.ps1
powershell -ExecutionPolicy Bypass -File scripts\menu-contextual.ps1 -Desinstalar
```

En Windows 11 aparece en "Mostrar más opciones" (o Shift + clic derecho). Los comandos del registro llevan la ruta absoluta de `asu` y el script deja en `~/.asu-cli` el ícono `asu.ico` (armado desde `recursos/asu.png`). Si cambia la ruta de `asu`, o si lo instalaste con una versión anterior (que usaba el lanzador `asu-menu.cmd` y pedía una tecla al terminar), vuelve a ejecutarlo: el lanzador viejo se borra.

## Uso

Sin argumentos, `asu` abre un menú interactivo, que trabaja sobre la carpeta desde donde se abrió la terminal (no la pregunta). Cada herramienta también se puede invocar directo; `[dir]` es el directorio a procesar (por defecto, el actual).

```powershell
asu                                   # menú interactivo
asu avs-trabajo [dir]                 # crea RAW.avs
asu avs-compresion [dir] -p 720p      # crea "<serie> <ep> MP4 720.avs"
asu fuentes [dir]                     # verifica fuentes
asu unir [dir] -s a.ass -s b.ass      # une .ass en Unificado.ass
asu reescalar [dir] -s a.ass -r 1920x1080   # crea "a - 1920x1080.ass"
asu encode [dir]                      # encode completo del episodio
asu comparar [dir]                    # prueba A/B de ajustes de x264
asu crc [carpeta|archivo]             # calcula el CRC32 y lo compara con el del nombre
asu mkv [dir]                         # extrae pistas y adjuntos de un MKV
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
asu avs-compresion [dir] [--video <archivo>] [-p|--preajuste <nombre>] [-s|--subs <archivo>]... [--serie <nombre>] [--episodio <n>] [-o|--salida <nombre>] [-f|--forzar]
```

Crea el AVS con `FFVideoSource` (sin audio), `spline64Resize` según el preajuste y un `textsub` por subtítulo. `--subs` se repite para varios archivos, en orden; el último se dibuja encima.

El archivo se llama `<serie> <ep> <etiqueta>.avs`, por ejemplo `Serie (2026) 04 MP4 1080.avs`. La serie y el episodio se deducen del raw (`[Grupo] Serie (2026) - 04 [1080p ...].mkv`) o, si no calza, de las carpetas (`...\Serie (2026)\04\`). En el menú se muestran como sugerencia editable; por argumentos se pueden fijar con `--serie` y `--episodio` (siempre con 2 dígitos).

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

### herramientas

```powershell
asu herramientas
```

Muestra cada programa externo que usa asu, agrupado (MeGUI, AviSynth, FFmpeg, MKVToolNix): si está, su ruta y de dónde salió, su versión cuando la informa y, si falta, qué comandos la usan y dónde se buscó. Al final, cómo instalar lo que falta. Termina con código 1 si falta alguno. También está en el menú ("Revisar herramientas externas").

Dónde se busca cada uno:

- **MeGUI:** en `<carpeta de MeGUI>\tools` (`asu config megui`).
- **AviSynth:** `C:\Windows\SysWOW64\avisynth.dll`, más `ffms2.dll` y `VSFilter.dll` en `C:\Program Files (x86)\AviSynth\plugins`. Si tus plugins están en otra carpeta: `asu config herramienta avisynth-plugins "<carpeta>"`. Se comprueba que estén los archivos, no que carguen.
- **FFmpeg y MKVToolNix:** primero la carpeta configurada (`asu config herramienta ffmpeg|mkvtoolnix "<carpeta>"`), después el `PATH` y por último las ubicaciones típicas (`C:\ffmpeg\bin`, `C:\Program Files\MKVToolNix` y los accesos de WinGet).

Cada comando revisa solo lo que va a usar, antes de empezar o de preguntar nada. Por ejemplo, el encode pide `neroAacEnc` solo si el audio del raw no es AAC (si es AAC, se copia), y `lame` solo si hay AVI. En el menú, las opciones a las que les falta algo muestran "falta …"; al elegirlas se explica qué instalar y se vuelve al menú. Si MeGUI aún no está configurado, no se bloquea: el comando lo pregunta.

### mkv

```powershell
asu mkv [dir] [--video <archivo>] [--listar] [--pista <id>]... [--adjuntos] [-f|--forzar]
```

Extrae pistas (video, audio, subtítulos) y adjuntos (fuentes y otros) de **un** MKV de la carpeta (`.mkv`, `.mka`, `.mks` o `.webm`; si hay varios, se elige o se indica con `--video`). Usa `mkvextract` y `mkvmerge` de [MKVToolNix](https://mkvtoolnix.download/) (ver `asu herramientas`); funciona desde la 7.2. No usa ffmpeg porque al copiar un `.ass` lo reescribe y pierde partes, como `[Aegisub Project Garbage]`.

- **Menú:** una lista con todas las pistas (`2 subs · ASS · eng · Signs`) y adjuntos (`adjunto 1 · Arial.ttf · 1021 KB`), sin nada marcado. Espacio marca, `a` todos, `n` ninguno, `i` invierte, Enter extrae.
- **Por argumentos:** `--listar` muestra los IDs; `--pista <id>` se repite por pista y `--adjuntos` extrae todos los adjuntos. Sin terminal y sin elegir nada, es un error que muestra el contenido.
- **Destino**, junto al MKV:
  - pistas: `<nombre del mkv> - <id> <video|audio|subs> [<idioma>] [<nombre de pista>].<ext>`, por ejemplo `[G] Serie - 04 [1080p] - 2 subs eng Signs.ass`. La extensión sale del codec (`.h264`, `.h265`, `.aac`, `.flac`, `.ac3`, `.opus`, `.ass`, `.srt`, `.sup`…); el idioma `und` no se pone; los caracteres que Windows no admite pasan a `_`. Los subtítulos de texto salen en UTF-8.
  - adjuntos: con su nombre original. Así `asu fuentes` y el encode ven las fuentes sin instalarlas.
- **Si algo ya existe:** se pregunta una vez para todos (sobrescribir, saltar esos o cancelar); por argumentos, error salvo `-f`.
- **Codecs que no reconoce:** se saltan con aviso, y termina con código 1.
- No extrae capítulos, tags, timecodes ni cuesheet, y procesa un MKV por vez.

### crc

```powershell
asu crc [carpeta | archivo]...
```

`asu crc` solo, en una terminal (y en el menú o el menú contextual), muestra la lista de archivos de la carpeta actual (sin subcarpetas, en orden alfabético). **Los que tienen CRC en el nombre vienen marcados**, con el CRC leído como pista (`CRC 22A92BA7` o `CRC 22A92BA7, sin corchetes`): Enter sin tocar nada verifica la carpeta; para calcular el CRC de otros, márcalos.

| Tecla | Acción |
|---|---|
| ↑ / ↓ | navegar |
| espacio | marcar / desmarcar el archivo del cursor |
| `a` | marcar todos |
| `n` | desmarcar todos (ninguno) |
| `c` | marcar solo los que tienen CRC |
| `i` | invertir la selección |
| Enter / Esc | confirmar / cancelar |

Se muestra `ABCD1234  nombre` para cada marcado; si el nombre trae un CRC, además dice `OK` o `NO COINCIDE`. Al final, si alguno no traía CRC, aparece "Agregar el CRC al nombre de" con todos marcados (mismas teclas, sin `c`): Enter los renombra a `nombre [ABCD1234].ext` y Esc no renombra nada. Si el nombre nuevo ya existe o el archivo no se puede renombrar (por ejemplo, porque está abierto), ese se salta con un aviso. A los que traen un CRC que no coincide no se les ofrece.

Con argumentos (o sin terminal), recalcula el CRC32 de cada archivo y lo compara con el que lleva en el nombre (`[SyncRajo] Serie - 01 (HDTV 1920x1080) [ABCD1234].mp4`, el formato habitual de los grupos de fansub). Si no coincide, el archivo está corrupto o fue modificado, por ejemplo por una descarga cortada o un disco dañado. Detecta daños accidentales, no manipulación intencional.

**Qué cuenta como CRC en el nombre** (en cualquier parte, sin contar el `[Grupo]` del inicio ni la extensión):

- `[XXXXXXXX]`, en mayúsculas o minúsculas: `… [1080p][22a92ba7].mkv`.
- `XXXXXXXX` sin corchetes: solo en mayúsculas, con al menos una letra A–F y sin una letra o número pegado: `…_(22A92BA7).mkv`, `… - 01 22A92BA7.mkv`. Una fecha como `20261120` no cuenta (con corchetes sí).
- Si hay varios, gana uno con corchetes y, entre los del mismo tipo, el último. La línea dice "(sin corchetes)" cuando lo leyó así.

- Carpeta (por defecto, la actual): revisa los archivos con CRC en el nombre, sin entrar en subcarpetas. Sirve también para releases de otros grupos.
- Archivo sin CRC en el nombre: solo muestra el CRC32 calculado.
- Termina con código 1 si alguno no coincide o no hay archivos con CRC.

Lee por trozos, sin cargar el archivo entero en memoria. También está en el menú ("CRC de archivos") y en el menú contextual ("CRC").

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

### encode

```powershell
asu encode [dir] [--solo <salida>]... [--video <raw>] [-s|--subs <archivo>]... [--serie <nombre>] [--episodio <n>] [--fuente HDTV|BD|...]
           [--pista-audio <n>] [--paralelo <n>] [--carpeta-salida <ruta>] [--regenerar-avs] [--ignorar-fuentes]
           [--reanudar | --reiniciar] [--conservar] [-f|--forzar]
```

Reemplaza el flujo manual de MeGUI. `[dir]` es la carpeta del episodio (raw + `.ass`).

**Versiones a generar:** en el menú se marcan en una lista (MP4 1080, MP4 720, AVI); vienen marcadas las salidas activas de la config, que de fábrica son las tres. Por argumentos, `--solo` se repite por versión (`--solo 1080 --solo 396`) y puede incluir una salida desactivada; sin `--solo` se generan las activas. Solo se codifican los audios y se crean los `.avs` que necesitan las versiones elegidas.

Para cada versión elegida:

1. Genera `<serie> <ep> <etiqueta>.avs` junto a los subtítulos, o reutiliza los que ya existan (en el menú se pregunta; por argumentos se reutilizan salvo `--regenerar-avs`). Los subtítulos se eligen y ordenan una vez para todas las salidas.
2. Verifica las fuentes de los `.ass` usados (incluidos los `textsub` de `.avs` reutilizados). Si falta alguna, en el menú se pregunta si seguir; por argumentos se aborta salvo `--ignorar-fuentes`.
3. Elige la pista de audio del raw: la única, o la japonesa si hay varias; si no, se pregunta o se usa `--pista-audio N` (desde 1).
4. Codifica primero los audios (segundos) y después las versiones **en paralelo**, hasta `paralelo` a la vez (3 de fábrica). Cada versión es una cadena: su video y luego su mux; en el AVI, pasada 1 → pasada 2 → mux. Usa directamente los ejecutables de `<MeGUI>\tools`, con las mismas líneas de comando que genera MeGUI:
   - Audio de los MP4: si el raw ya trae AAC (lo habitual en WEB-DL), se **copia tal cual** a un `.m4a` (sin pérdida por recodificar y en segundos); los dos MP4 usan la misma copia. Si el raw trae otro códec, `ffmpeg` lo decodifica, normaliza el pico a 0 dB (como el `Normalize()` de MeGUI) y lo pasa a `neroAacEnc`.
   - Audio del AVI: siempre MP3 con `lame`, normalizado igual.
   - MP4: `ffmpeg | x264` y `mp4box` con el audio marcado en japonés.
   - AVI: `xvid_encraw` en 2 pasadas, con el bitrate calculado para no superar el tamaño máximo (descuenta el audio real y la sobrecarga del AVI, con 1 % de margen), y `AVI-Mux GUI` con el MP3.
5. Calcula el CRC32 de cada archivo terminado y lo deja como `[<grupo>] <serie> - <ep> (<fuente> <ancho>x<alto>) [<CRC32>].<ext>` en la carpeta de salida, por ejemplo `[SyncRajo] Serie (2026) - 04 (HDTV 1920x1080) [ABCD1234].mp4`. Con el CRC en el nombre se puede comprobar después que el archivo no esté corrupto (`asu crc`). Para no ponerlo: `"crcEnNombre": false` en `config.json`.
6. Verifica que el AVI no supere el tamaño máximo (si lo supera, termina con error y no vuelve a codificar) y borra los temporales.

Detalles:

- **Elecciones recordadas**: lo que eliges en el menú (versiones, subtítulos y su orden, serie, episodio y pista de audio) se guarda apenas lo confirmas en `.asu/asu.json` dentro de la carpeta del episodio, en la sección `encode`. Así, un error o una cancelación no lo pierden. Al volver a abrir el encode en esa carpeta aparece un resumen y "¿Usar las mismas?": con sí no se vuelve a preguntar; con no se pregunta todo, con lo recordado ya marcado. Por argumentos, lo recordado se usa cuando no pasas la opción correspondiente; lo que pases por argumento manda y no se guarda. Si un `.ass` recordado ya no existe, esa parte se descarta con aviso. No se recuerdan las decisiones de cada vez: usar o regenerar los `.avs`, seguir con fuentes faltantes, sobrescribir archivos finales y reanudar.
- **Fuente** (`HDTV`, `BD`...): se guarda por proyecto en `.asu/asu.json` dentro de la carpeta de la serie (la padre del episodio), y se busca ahí o en cualquier carpeta superior. El `.asu/asu.json` del episodio, sin `fuente`, no la tapa. Un `asu.json` suelto (la ubicación de versiones anteriores) se ignora: muévelo a `.asu/`. La carpeta `.asu` queda visible. La primera vez se pregunta. `--fuente` la reemplaza solo para ese encode.
- **Carpeta de MeGUI y carpeta de salida**: se piden la primera vez y se guardan en la config (`asu config megui`, `asu config carpeta-salida`). `--carpeta-salida` la cambia solo para ese encode.
- **Temporales**: van en `<carpeta de salida>\.asu-encode\<serie> - <ep>\`. Se borran solo si todo terminó bien, salvo `--conservar`.
- **Si se corta**: los pasos terminados quedan registrados. Con `--reanudar` se retoma desde el que faltaba; con `--reiniciar` se empieza de cero. En el menú se pregunta. No se puede reanudar si cambiaron el raw, la pista, los `.avs` o las versiones elegidas.
- **Archivo final existente**: cuenta cualquier final del mismo episodio y versión, con cualquier CRC o sin él (así no quedan dos con distinto CRC). En el menú se ofrece sobrescribir / otro nombre / cancelar; por argumentos es un error salvo `-f`. Se resuelve antes de empezar a codificar; los anteriores se borran recién al mover el nuevo.
- **En paralelo**: x264 no ocupa toda la CPU (lo frena la entrada del `.avs`, que decodifica, dibuja subtítulos y redimensiona en un hilo) y XviD usa un hilo. Con las 3 versiones a la vez, una muestra de 60 s tardó 33 s contra 70 s en secuencia. Se cambia con `asu config paralelo N` o, para un encode, `--paralelo N`; `1` = en secuencia.
- **Pantalla**: una línea por versión con su paso, frames, % aproximado (según la duración del `.avs`) y fps. La salida de las herramientas no se muestra mientras corren; si una falla, el error trae sus últimas líneas.
- **Si una versión falla**, las demás siguen hasta terminar (su trabajo queda registrado), no se mueve ningún archivo final y `--reanudar` hace solo lo que faltó.
- **Registro**: cada encode deja `<episodio>\.asu\registros\encode-<AAAA-MM-DD HHmmss>.log` con las opciones, cada comando (línea completa), su duración, código y final de stderr. Si algo falla, el error muestra la ruta.
- **Cuelgues**: si x264 o XviD pasan 120 s sin escribir nada, se considera colgado: se matan los procesos de esa tubería, se anota cuáles seguían vivos y se reintenta una vez. Si se vuelve a colgar, error.
- Un episodio por ejecución.

### comparar

```powershell
asu comparar [dir] [--salida 1080] [--variante <nombre>]... [--tramo mm:ss-mm:ss]... [--tramos-fijos]
             [--capturas 4] [--igualar bitrate|crf] [--sin-cache] [--no-abrir] [--paralelo <n>]
asu comparar abrir [carpeta] [--no-abrir]
```

Prueba A/B de ajustes de x264 sobre una versión MP4 del episodio (por defecto la primera, 1080). Usa el mismo raw, `.avs` y elecciones recordadas que `encode` (serie, episodio y subtítulos; las versiones recordadas no, porque comparar elige la suya).

`asu comparar` solo, sin ninguna opción y en una terminal, muestra primero el submenú Nueva comparación / Abrir una comparación (como el menú). Con cualquier opción o argumento (p. ej. `asu comparar .`) o sin terminal, compara directo.

1. **Tramos por contenido:** ffmpeg analiza el raw completo a baja resolución (~2 min, con avance: %, velocidad y tiempo restante) y elige 3 tramos de 20 s que no se superponen: el **más oscuro** (sin contar negros ni fundidos), el de **más movimiento** y el de **más detalle** (entropía; puede caer en créditos o carteles). `--tramo` los reemplaza por los que indiques y `--tramos-fijos` usa el 25/50/75 % del episodio.
2. **Variantes** (`asu config variantes`), aplicadas sobre los ajustes de la salida:

   | Variante | Ajustes |
   |---|---|
   | `actual` | Los de la salida, sin cambios (referencia) |
   | `anime` | Sin `--tune`; `--deblock -1:-1 --psy-rd 0.7:0 --aq-mode 3 --aq-strength 0.8 --bframes 8 --merange 24 --no-fast-pskip` |
   | `intermedia` | `--tune animation --deblock -1:-1 --aq-mode 3` |

3. **Comparación justa:** `actual` se codifica con el CRF de la salida y las demás se igualan a ella en cada tramo:
   - por defecto, **2 pasadas al mismo bitrate**;
   - con `--igualar crf`, el **CRF que pesa ±2 %** igual (búsqueda de hasta 6 pruebas por variante y tramo; más parecido al encode real, ~3x más lento).

   En ambos casos se informa cuánto pesaría cada variante con el CRF de la salida.
4. **Caché:** cada clip se guarda en `Comparaciones\.cache` según el `.avs`, el tramo, los ajustes y el objetivo. Si repites una comparación o agregas una variante, solo se codifica lo nuevo. `--sin-cache` recodifica todo. Se puede borrar sin problema.
5. **SSIM por frame y capturas:** se mide la SSIM de cada frame contra el `.avs` y, de 4 capturas por tramo, 2 van donde las variantes **más se diferencian** y 2 donde alguna **cae más**, separadas al menos 1 s. Es el mismo frame en cada variante y en el `.avs` (la fuente, con subtítulos), convertido con la matriz BT.709.
6. **Resultado** en `<carpeta de salida>\Comparaciones\<serie> - <ep> - <fecha>\` (con sufijo `(2)`, `(3)`… si se repite en el mismo minuto):
   - `resultados.json`: todos los datos, para analizar con otras herramientas. Incluye tramos y motivo, ajustes completos de cada variante, kbps, kbps con CRF, CRF usado, fps, SSIM y PSNR por tramo, SSIM de cada frame, capturas con su motivo y SSIM, y votos.
   - `index.html`, `capturas\*.png` y `clips\*.mp4` (sin audio).
   - `registro.log`: opciones, variantes y cada comando con su duración, código y final de stderr. Las codificaciones y el análisis de tramos tienen el mismo vigilante de cuelgues que `encode` (120 s sin salida: se reintenta una vez).

**La página.** Al terminar, asu la sirve en `http://127.0.0.1:<puerto>` y abre el navegador; la terminal queda esperando hasta Ctrl+C o el botón "Cerrar servidor". `asu comparar abrir` reabre una comparación (por defecto, la última). En el menú, "Comparar ajustes de x264" ofrece **Nueva comparación** o **Abrir una comparación**: lista las de `<carpeta de salida>\Comparaciones` (la más reciente primero, con versión, variantes, tramos y votos); al cerrar el servidor se vuelve al menú. Pestañas:

- **A ciegas** (se abre primero): las variantes aparecen como A, B, C, en un orden aleatorio distinto en cada captura, y la tabla y los nombres quedan ocultos. Votas cuál se ve mejor (o empate) y al terminar, o con "Revelar", se ven los nombres y el conteo. Los votos se guardan en `resultados.json`.
- **Capturas:** tres modos.
  - **Alternar:** teclas `0` fuente, `1`..`N` variantes.
  - **Cortina:** dos versiones con un divisor que sigue al mouse; clic lo fija.
  - **Diferencia:** |variante − fuente| amplificada ×1–16; lo que brilla es lo que se perdió.

  Además: zoom Ajustar/1x/2x/4x de píxeles exactos que se mantiene al cambiar de versión (se arrastra para mover), miniaturas con la SSIM mínima de cada captura y la caja **Adoptar** (marcas las salidas, confirmas y asu cambia tu config).
- **Tamaño de la imagen** (A ciegas y Capturas): el visor llega hasta el borde inferior de la ventana (lo demás queda al bajar) y la tabla de resultados va plegada. **Pantalla completa** con el botón o la tecla `F` (Esc sale): solo quedan los controles, el visor y, en A ciegas, los votos; las teclas siguen funcionando. "Ajustar" no agranda más de 1x, para no deformar los píxeles; para ampliar, 2x/4x.
- **Clips:** dos videos lado a lado y sincronizados (los controles del izquierdo mueven ambos), con botón para abrirlos en tu reproductor.
- **Gráfico:** SSIM de cada frame por variante y tramo, con las capturas marcadas (clic para verlas).

Abierta como archivo (sin asu), la página funciona en solo lectura: no se vota ni se adopta (se muestra el comando para copiar), y la diferencia avisa que necesita el servidor.

**Seguridad del servidor:** solo escucha en `127.0.0.1`; cada acción exige el token aleatorio de la sesión (va en la URL que abre asu) y se rechazan peticiones con otro `Origin` o `Host`, para que ninguna página web pueda cambiar tu config.

Las métricas son orientativas: los ajustes psicovisuales bajan SSIM y PSNR a propósito para verse mejor, así que la decisión es visual. Los fps medidos en paralelo también lo son.

Para **adoptar** fuera de la página (copia los ajustes de x264 de la variante a esa salida, sin tocar CRF, preset ni level salvo que la variante los defina):

```powershell
asu config salidas usar-variante 1080 anime
```

Las variantes se editan o agregan en `config.json` (lista `variantes`): `{ "nombre", "descripcion", "x264": { ...cualquier ajuste x264, "tune": "" para sin tune, "extra": [argumentos] } }`.

### config

```powershell
asu config preajustes                                         # listar
asu config preajustes agregar 900p 1600x900 --etiqueta "MP4 900"
asu config preajustes quitar 900p
asu config salidas                                            # salidas de encode, MeGUI y carpeta de salida
asu config salidas desactivar 396                             # no generar el AVI
asu config salidas activar 396
asu config salidas usar-variante 1080 anime                   # adopta una variante de asu comparar
asu config variantes                                          # lista las variantes de x264
asu config megui "C:\ruta\a\MeGUI"
asu config carpeta-salida "C:\ruta\a\Encode"
asu config herramienta mkvtoolnix "C:\ruta\a\MKVToolNix"        # también ffmpeg y avisynth-plugins; "" la quita
asu config paralelo 3                                         # versiones a la vez en asu encode
asu config restablecer                                        # preajustes y salidas de fábrica (conserva rutas)
asu config ruta                                               # ruta de config.json
```

Preajustes de fábrica:

| Nombre | Resolución | Etiqueta   | `.avs`                   |
| ------ | ---------- | ---------- | ------------------------ |
| 720p   | 1280x720   | `MP4 720`  | `<serie> <ep> MP4 720.avs`  |
| 396p   | 704x396    | `AVI`      | `<serie> <ep> AVI.avs`      |
| 1080p  | 1920x1080  | `MP4 1080` | `<serie> <ep> MP4 1080.avs` |

Salidas de encode de fábrica:

| Nombre | Tipo       | Preajuste | Video                                                                 | Audio        |
| ------ | ---------- | --------- | --------------------------------------------------------------------- | ------------ |
| 1080   | `mp4-x264` | 1080p     | x264 preset slow, CRF 18, tune animation, keyint 240, level 4.1, VBV 78125/62500 | AAC del raw (o 192 kbps) |
| 720    | `mp4-x264` | 720p      | igual que 1080                                                        | AAC del raw (o 192 kbps) |
| 396    | `avi-xvid` | 396p      | XviD 2 pasadas, máximo 180 MB (perfil "SyncRajo AVI" sin `-turbo`, `-threads 4`) | MP3 192 kbps |

Por qué estos valores (medido sobre 60 s de un episodio):

- `--preset slow` frente a `medium`: 3,5 % menos de bitrate con CRF 18, por 5 % menos de velocidad. `slower` costaba un 32 % de velocidad.
- XviD sin `-turbo` y con 4 hilos: misma calidad (SSIM 0,9884) y algo más rápido. `-vhqmode 4` daba +0,12 dB de PSNR por un 30 % más de tiempo, así que queda en 1.
- Los `.avs` de compresión usan `FFVideoSource(threads=-1)`: la entrada del 720 pasó de 71 a 141 fps con frames idénticos.

Si tu `config.json` es de una versión anterior, se migra solo la primera vez que corres `asu`: x264 recibe `preset: "slow"` y las banderas de XviD viejas de fábrica pasan a las nuevas (si las editaste a mano, no se tocan y se avisa); desde la versión 3 se agrega `crcEnNombre: true` (con aviso).

Los ajustes de x264 (incluido `extra`, una lista de argumentos adicionales, y `tune: ""` para no usar `--tune`), XviD, audio, tamaño máximo, el grupo (`SyncRajo`) y `crcEnNombre` (CRC32 en el nombre final, `true` de fábrica) se editan a mano en `config.json`. Se pueden agregar salidas nuevas copiando una existente (con otro `nombre` y un `preajuste` existente).

## Archivos `.avs`

- Se escriben en **Windows-1252**: AviSynth lee los scripts en la codificación ANSI del sistema. (Las herramientas de MeGUI que lee asu, ffmpeg y xvid_encraw, son de 32 bits y usan el AviSynth 2.60 instalado en Windows, no el AviSynth+ 3.5 portátil de MeGUI.) Si una ruta tiene caracteres que no existen en esa codificación (por ejemplo, japonés), la CLI avisa y no crea el archivo.
- Las rutas dentro del `.avs` son absolutas.
- FPS fijos: 24000/1001.
- Si el `.avs` ya existe, el menú ofrece sobrescribir, usar otro nombre o cancelar. Por argumentos: `--forzar` o `--salida <nombre>`.

## Configuración

Vive en `%USERPROFILE%\.asu-cli\`:

- `config.json`: preajustes, salidas de encode, variantes de x264, carpeta de MeGUI, carpeta de salida, grupo, `paralelo`, `crcEnNombre` y `herramientas` (carpetas de FFmpeg, MKVToolNix y plugins de AviSynth, opcionales). Se crea al modificar algo; mientras no exista se usan los valores de fábrica, y las claves que falten se completan con ellos. Se puede editar a mano.
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
- `ASU_CLI_NO_INTERACTIVO`: fuerza el modo sin terminal aunque `bun test` corra en una.

Los tests del encode no ejecutan las herramientas reales: usan un ejecutor falso que crea los archivos que dejaría cada una. Las líneas de comando se comparan con las del log de MeGUI.

Estructura:

```
src/
  cli.ts            entrada: parseo de argumentos y despacho
  menu.ts           menú interactivo
  ayuda.ts          textos de --help
  ui.ts             prompts (@clack/prompts) y errores
  lista-ordenable.ts  prompt propio de lista reordenable (@clack/core)
  lista-marcable.ts   prompt propio de lista para marcar con atajos a/n/c/i (@clack/core)
  ejecutor.ts       ejecución de procesos y tuberías (encode, comparar, mkv), con vigilante de cuelgues
  registro.ts       registro de comandos (encode y comparar) y reintento ante cuelgues
  crc.ts            CRC32 de un archivo, leído por trozos
  herramientas.ts   búsqueda de programas externos (MeGUI, AviSynth, PATH, ubicaciones típicas)
  servidor-comparacion.ts  servidor local de asu comparar (127.0.0.1 + token)
  comandos/         cada herramienta (I/O e interacción)
  nucleo/           lógica pura: generación de AVS, fuentes, unión y reescalado de .ass, nombres,
                    líneas de comando y plan del encode, comparación A/B (tramos por contenido,
                    capturas, CRF igualado, caché, resultados.json, página), config, Windows-1252
tests/              bun test; fixtures/ se compara byte a byte
```
