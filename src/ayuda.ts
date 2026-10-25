export const AYUDA_GENERAL = `Uso: asu [comando] [opciones]

Sin comando abre el menú interactivo.

Comandos:
  avs-trabajo [dir]       Crea RAW.avs (FFVideoSource + FFAudioSource) para el video del directorio.
  avs-compresion [dir]    Crea el AVS de compresión (spline64Resize + textsub) según un preajuste.
  fuentes [dir]           Verifica que las fuentes usadas por los .ass estén disponibles.
  unir [dir]              Une varios .ass en uno solo, en el orden elegido.
  reescalar [dir]         Cambia el PlayRes de .ass escalando estilos, tags y dibujos.
  config <subcomando>     Administra los preajustes de resolución.

Opciones globales:
  -h, --help              Muestra esta ayuda (o la de un comando: asu <comando> --help).
  -v, --version           Muestra la versión.

[dir] es el directorio a procesar; por defecto, el actual.`;

export const AYUDA_AVS_TRABAJO = `Uso: asu avs-trabajo [dir] [opciones]

Crea RAW.avs para el video del directorio. Si hay un solo video se usa directo;
si hay varios, se pregunta (o se indica con --video).

Opciones:
  --video <archivo>       Video a usar (relativo al directorio o ruta absoluta).
  -o, --salida <nombre>   Nombre del .avs a crear (por defecto RAW.avs).
  -f, --forzar            Sobrescribe el .avs si ya existe.
  -h, --help              Muestra esta ayuda.`;

export const AYUDA_AVS_COMPRESION = `Uso: asu avs-compresion [dir] [opciones]

Crea el AVS de compresión: FFVideoSource (sin audio), spline64Resize según el preajuste
y un textsub por cada subtítulo, en orden (el último se dibuja encima).

Opciones:
  --video <archivo>       Video a usar (relativo al directorio o ruta absoluta).
  -p, --preajuste <nombre> Preajuste de resolución (ver: asu config preajustes).
  -s, --subs <archivo>    Subtítulo a incluir; repetir para varios, en orden.
                          Sin --subs: se eligen en el menú, o se usan todos los .ass
                          en orden alfabético si no hay terminal interactiva.
  -o, --salida <nombre>   Nombre del .avs a crear (por defecto, el del preajuste).
  -f, --forzar            Sobrescribe el .avs si ya existe.
  -h, --help              Muestra esta ayuda.`;

export const AYUDA_FUENTES = `Uso: asu fuentes [dir]

Revisa las fuentes usadas por las líneas Dialogue de cada .ass del directorio
(estilos usados, \\r<Estilo> y todos los \\fn) contra las disponibles:
instaladas en Windows, sueltas en el directorio (.ttf/.otf/.ttc/.otc) e incrustadas en [Fonts].

Termina con código 1 si falta alguna fuente o algún .ass no se pudo leer.

Opciones:
  -h, --help              Muestra esta ayuda.`;

export const AYUDA_UNIR = `Uso: asu unir [dir] [opciones]

Une varios .ass en uno. Las líneas quedan por bloques en el orden indicado
(en una misma capa, lo que va después se dibuja encima).

- [Script Info] y [Aegisub Project Garbage] se toman del primero; avisa si el PlayRes difiere.
- Estilos con el mismo nombre: si son idénticos quedan una vez; si difieren, el del archivo
  posterior se renombra "Nombre (archivo)", junto con sus líneas y \\r.
- Fuentes y gráficos adjuntos sin repetir. [Aegisub Extradata] se descarta.
- Se guarda en UTF-8 con BOM y CRLF, como Aegisub.
- Si un archivo tiene otro PlayRes que el primero, en el menú se ofrece reescalarlo
  (solo en memoria, el original no se toca); por argumentos, con --reescalar.

Opciones:
  -s, --subs <archivo>    Archivo a unir; repetir para cada uno, en orden (mínimo 2).
                          Sin --subs se eligen en el menú (requiere terminal interactiva).
  --reescalar             Reescala al PlayRes del primero los que difieran.
  -m, --modo <modo>       estirar (defecto) o bandas, si la proporción cambia. Ver: asu reescalar --help.
  -o, --salida <nombre>   Nombre del archivo unido (por defecto Unificado.ass;
                          en terminal interactiva se pregunta).
  -f, --forzar            Sobrescribe el archivo si ya existe.
  -h, --help              Muestra esta ayuda.`;

export const AYUDA_REESCALAR = `Uso: asu reescalar [dir] -s <archivo>... -r <ancho>x<alto> [opciones]

Cambia el PlayRes de cada .ass y escala lo que depende de él, como "Resample Resolution"
de Aegisub: estilos (Fontsize, Outline, Shadow, Spacing, márgenes), márgenes de línea,
\\pos \\move \\org \\clip \\iclip \\fs \\fsp \\bord \\shad \\blur \\pbo (también dentro de \\t)
y dibujos \\p. \\be no se escala. Borde, sombra y \\blur no se escalan si
ScaledBorderAndShadow no es "yes" (en ese modo dependen del video, no del script).

Crea "<nombre> - <ancho>x<alto>.ass" junto al original, que no se modifica.

Modos (solo importan si cambia la proporción, ej. 640x480 → 1920x1080):
  estirar   Conserva cómo se ve sobre el video: X por ancho, Y por alto,
            la letra crece con el alto y \\fscx compensa el ancho. Por defecto.
  bandas    Escala parejo con el factor menor y centra con bandas.

Opciones:
  -s, --subs <archivo>       Archivo a reescalar; repetir para varios.
                             Sin --subs se eligen en el menú (requiere terminal interactiva).
  -r, --resolucion <AxB>     Resolución destino, ej. 1920x1080.
  -m, --modo <modo>          estirar o bandas (en el menú se pregunta si la proporción cambia).
  -o, --salida <nombre>      Nombre del archivo nuevo (solo con un archivo).
  -f, --forzar               Sobrescribe el archivo nuevo si ya existe.
  -h, --help                 Muestra esta ayuda.`;

export const AYUDA_CONFIG = `Uso: asu config <subcomando>

Subcomandos:
  preajustes                                   Lista los preajustes.
  preajustes agregar <nombre> <ancho>x<alto> [--archivo <nombre>]
                                               Agrega un preajuste. --archivo es el nombre
                                               del .avs (por defecto, el nombre del preajuste).
  preajustes quitar <nombre>                   Quita un preajuste.
  restablecer                                  Vuelve a los preajustes de fábrica.
  ruta                                         Muestra la ruta de config.json.

Opciones:
  -h, --help                                   Muestra esta ayuda.`;
