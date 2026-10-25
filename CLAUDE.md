# asu-cli

CLI en español para tareas de traducción/fansub. Reimplementa herramientas de Asu (C#/.bat) en TypeScript sobre Bun.

## Stack

- Runtime: Bun. Tests: `bun test`. Lenguaje: TypeScript estricto.
- Subtítulos ASS: `@fs-frost/asu` (JSR, `bunx jsr add @fs-frost/asu`).
- Menú interactivo: `@clack/prompts`. Argumentos: `util.parseArgs`.
- Prompts propios (p. ej. `src/lista-ordenable.ts`) extienden `Prompt` de `@clack/core`, fijado a la misma versión exacta que usa `@clack/prompts` (hoy 1.5.1; al actualizar uno, actualizar el otro). `Prompt` no aplica `initialValue`: asignar `this.value` en el constructor.
- Ordenar archivos en el menú = lista reordenable (espacio agarra/suelta, ↑/↓ mueven, Enter confirma). Usada por `ordenarArchivos` (compresión y unir).
- Binario global: `asu` (vía `bun link`).
- Solo Windows.

## Vocabulario

- **AVS de trabajo**: `RAW.avs` con `FFVideoSource` + `FFAudioSource` + `AudioDub`. Origen: `Asu/Crear AVS de trabajo/Program.cs`.
- **AVS de compresión**: `<archivo del preajuste>.avs` con `FFVideoSource` (sin audio) + `spline64Resize(ancho,alto)` + un `textsub("…")` por `.ass` en el orden elegido. Origen: `Asu/Asu/Recursos/Asu.CrearAVSDeCompresion.bat`.
- **Verificar fuentes**: fuentes usadas por los `.ass` de un directorio vs. fuentes disponibles. Origen: `Asu/Asu.VerificarFuentes/Program.cs`.
- **Unir**: varios `.ass` → uno (`asu unir`). Estilos homónimos distintos se renombran `Nombre (<archivo>)` (líneas y `\r` incluidos); idénticos se deduplican. Cabecera (`[Script Info]`, `[Aegisub Project Garbage]`) del primero, aviso si PlayRes difiere. Líneas por bloques en el orden elegido. Orden propuesto en el menú (no con `-s`): nombre contiene `carteles` → `karaoke` → `subs` → resto (sin mayúsculas, substring, prioridad más alta gana; alfabético dentro de cada grupo). Extradata se descarta (y los prefijos `{=N}`). Salida UTF-8 con BOM + CRLF.
- **Reescalar**: cambiar PlayRes escalando estilos, márgenes, tags (también dentro de `\t`), `\clip` y dibujos `\p` (`asu reescalar`). Modos: `estirar` (defecto; posiciones X·rx/Y·ry, tamaños ·ry, `fscx`·rx/ry) y `bandas` (todo ·min(rx,ry) + centrado). `\be` no se escala; borde/sombra/`\blur` no se escalan si `ScaledBorderAndShadow` ≠ yes. Dibujos `\p` escalan uniforme con la fuente (·ry o ·s); `\clip` vectorial como posiciones. Tags se reescriben a nivel texto (no `contentsToString`). Salida: archivo nuevo `<nombre> - AxB.ass`; el original no se toca. `asu unir` ofrece reescalar en memoria al PlayRes del primero (`--reescalar`).
- **Preajuste**: `{ nombre, ancho, alto, archivo }`. De fábrica: 720p (1280x720, `MP4-720p`), 396p (704x396, `AVI`), 1080p (1920x1080, `MP4-1080p`).

## Reglas

- Los `.avs` se escriben en **Windows-1252** (AviSynth+ 3.5 lee scripts en ANSI; ACP del sistema = 1252). Si una ruta no es representable en 1252: avisar y no escribir.
- Rutas absolutas dentro de los `.avs`.
- FPS fijos: 24000/1001. No se configuran.
- Extensiones de video: sin `.ts` (choca con TypeScript) ni `.m4a` (audio).
- Si el `.avs` destino existe: menú ofrece sobrescribir / otro nombre / cancelar; por args `--forzar` o `--salida <nombre>`.
- Verificar fuentes:
  - Solo líneas `Dialogue`; todos los `\fn` de la línea; estilos usados directamente y vía `\r<Estilo>`.
  - Comparación sin distinguir mayúsculas; quitar prefijo `@`.
  - Disponibles = instaladas (`C:\Windows\Fonts` + `%LOCALAPPDATA%\Microsoft\Windows\Fonts`, nombre de familia parseado del archivo, con cache) + incrustadas en `[Fonts]` + `.ttf/.otf/.ttc` del mismo directorio (no recursivo).
  - Código de salida 1 si falta alguna fuente.
- Configuración en `~/.asu-cli/` (`config.json` solo guarda preajustes; `cache-fuentes.json` aparte). Preajustes editables por menú, por `asu config preajustes …` y a mano.
- Lógica pura en `src/nucleo/` (testeable sin I/O); I/O e interacción en `src/comandos/` y `src/menu.ts`.
- Textos de la CLI en español.
- Dato faltante: con terminal se pregunta; sin terminal es error (`ErrorUsuario`), excepto los subtítulos de compresión (todos los `.ass`, orden alfabético).
- `--subs` se repite por archivo (no se separa por comas: los nombres pueden tener comas).
- Tests: `ASU_CLI_HOME` reemplaza `~/.asu-cli`; `ASU_CLI_DIRECTORIOS_FUENTES` reemplaza los directorios de fuentes del sistema. `tests/fixtures/RAW-original.avs` es salida real del exe original (con la ruta del video reemplazada por una ficticia) y se compara byte a byte (`.gitattributes` lo marca `-text`).

## Particularidades de `@fs-frost/asu` 1.15.0

- `parseASSFile` no quita el BOM (busca el literal `"\\uFEFF"`): usar `leerASS` de `src/nucleo/fuentes-ass.ts`.
- `parseASSFile` devuelve `null` ante una línea de `[Events]` que no sea Dialogue/Comment o un `Style:` que no calce su regex (p. ej. `Spacing` negativo), e imprime el motivo con `console.error`.
- `findFn`/`findTag` solo miran el primer bloque `{...}`: recorrer `parseContent(...)` a mano.
