export const AYUDA_GENERAL = `Uso: asu [comando] [opciones]

Sin comando abre el menú interactivo.

Comandos:
  avs-trabajo [dir]       Crea RAW.avs (FFVideoSource + FFAudioSource) para el video del directorio.
  avs-compresion [dir]    Crea el AVS de compresión (spline64Resize + textsub) según un preajuste.
  fuentes [dir]           Verifica que las fuentes usadas por los .ass estén disponibles.
  unir [dir]              Une varios .ass en uno solo, en el orden elegido.
  reescalar [dir]         Cambia el PlayRes de .ass escalando estilos, tags y dibujos.
  corregir-offset [dir]   Remuxea el video a MKV con el primer frame en 0 (como lo ve Aegisub).
  encode [dir]            Encode completo del episodio (MP4 1080, MP4 720, AVI 396...) con las herramientas de MeGUI.
  comparar [dir]          Prueba A/B de ajustes de x264: tramos codificados con cada variante y página para comparar.
  config <subcomando>     Administra preajustes, salidas de encode y rutas.

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
  --serie <nombre>        Serie para el nombre del .avs (por defecto, se deduce del raw
                          "[Grupo] Serie - 04 [...]" o de las carpetas Serie\\04).
  --episodio <número>     Episodio (2 dígitos).
  -o, --salida <nombre>   Nombre del .avs a crear (por defecto "<serie> <ep> <etiqueta>.avs").
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

export const AYUDA_CORREGIR_OFFSET = `Uso: asu corregir-offset [dir] [opciones]

Algunos videos empiezan con el primer frame en un tiempo mayor que 0 (ej. 0.043 s).
Aegisub lo normaliza a 0, pero los reproductores no: los subtítulos se ven corridos
un frame. Este comando remuxea con mkvmerge desplazando solo la pista de video para
que empiece en 0; audio, subtítulos, adjuntos y capítulos quedan igual y en el mismo orden.

Acepta MKV, MP4, AVI, etc. Crea "<nombre> [fixed].mkv" junto al original, que no se toca.
Si el video no tiene offset, no crea nada. Requiere ffprobe (FFmpeg) y mkvmerge
(MKVToolNix) en el PATH.

Opciones:
  --video <archivo>       Video a usar (relativo al directorio o ruta absoluta).
  -o, --salida <nombre>   Nombre del .mkv a crear (por defecto "<nombre> [fixed].mkv").
  -f, --forzar            Sobrescribe el .mkv si ya existe.
  -h, --help              Muestra esta ayuda.`;

export const AYUDA_ENCODE = `Uso: asu encode [dir] [opciones]

[dir] es la carpeta del episodio (raw + .ass). Para cada versión elegida (en el menú se
marcan; por defecto, las salidas activas de asu config salidas: MP4 1080, MP4 720 y AVI):
1. Genera o reutiliza "<serie> <ep> <etiqueta>.avs" junto a los subtítulos.
2. Verifica las fuentes de los .ass usados.
3. Codifica con las herramientas de MeGUI (<MeGUI>\\tools): primero los audios (normalizados,
   como MeGUI) y luego las versiones en paralelo (hasta "paralelo" a la vez, 3 de fábrica),
   cada una con su video y su mux. Si una falla, las demás terminan igual.
   - mp4-x264: ffmpeg | x264 → mp4box con el audio AAC (japonés).
   - avi-xvid: xvid_encraw en 2 pasadas con el bitrate calculado para no superar
     el tamaño máximo → AVI-Mux GUI con el audio MP3.
4. Deja "[<grupo>] <serie> - <ep> (<fuente> <ancho>x<alto>).<ext>" en la carpeta de salida.
5. Borra los temporales si todo terminó bien.

La fuente (HDTV, BD...) se guarda por proyecto en .asu\\asu.json de la carpeta de la serie
(la primera vez se pregunta). Lo elegido en el menú (versiones, subtítulos y orden, serie,
episodio, pista) se recuerda en .asu\\asu.json del episodio y se usa por defecto la próxima vez. Si se corta, los temporales quedan en
<carpeta de salida>\\.asu-encode y se puede retomar con --reanudar.

Opciones:
  --solo <salida>            Genera solo esa versión (1080, 720, 396...); repetir para varias.
                             Puede ser una salida desactivada. Sin --solo: las activas.
  --video <archivo>          Raw a usar (si hay varios videos).
  -s, --subs <archivo>       Subtítulos para los .avs a generar; repetir, en orden.
  --serie <nombre>           Serie (por defecto, del raw o de las carpetas).
  --episodio <número>        Episodio (2 dígitos).
  --fuente <texto>           Fuente del nombre final (HDTV, BD...); no se guarda.
  --pista-audio <n>          Pista de audio del raw, desde 1 (por defecto la única o la japonesa).
  --paralelo <n>             Versiones a la vez solo para este encode (1 = en secuencia).
  --carpeta-salida <ruta>    Carpeta de salida solo para este encode.
  --regenerar-avs            Regenera los .avs aunque existan (por defecto se reutilizan).
  --ignorar-fuentes          Sigue aunque falten fuentes.
  --reanudar                 Retoma un encode incompleto desde el paso que faltaba.
  --reiniciar                Descarta un encode incompleto y empieza de cero.
  --conservar                No borra los temporales al terminar.
  -f, --forzar               Sobrescribe los archivos finales si ya existen.
  -h, --help                 Muestra esta ayuda.`;

export const AYUDA_COMPARAR = `Uso: asu comparar [dir] [opciones]
       asu comparar abrir [carpeta] [--no-abrir]

Prueba A/B de ajustes de x264 sobre una versión MP4 del episodio ([dir], como en encode).
1. Elige 3 tramos de 20 s analizando el raw: el más oscuro, el de más movimiento y el de más detalle.
2. Codifica cada tramo con cada variante (asu config variantes): "actual" con el CRF de la salida y
   las demás igualadas a ella (2 pasadas al mismo bitrate, o con --igualar crf, el CRF que pesa igual).
   Los clips ya codificados se reutilizan (caché en Comparaciones\.cache).
3. Mide la SSIM de cada frame y captura los que más distinguen a las variantes.
4. Deja resultados.json (todos los datos) e index.html en
   <carpeta de salida>\Comparaciones\<serie> - <ep> - <fecha>\
5. Abre la página servida por asu (http://127.0.0.1, con token): votación a ciegas primero, luego
   capturas (alternar, cortina, diferencia, zoom), clips sincronizados y gráfico de SSIM. Desde la
   página se vota, se adopta la variante ganadora y se abren archivos. Ctrl+C para cerrar.

"asu comparar abrir" vuelve a abrir una comparación (por defecto, la última).
index.html abierto como archivo funciona en solo lectura.

Opciones:
  --salida <nombre>          Versión a comparar (por defecto, la primera MP4: 1080).
  --variante <nombre>        Variante a comparar con "actual"; repetir para varias (por defecto, todas).
  --tramo <mm:ss-mm:ss>      Tramo a codificar; repetir para varios (reemplaza a los automáticos).
  --tramos-fijos             Tramos al 25, 50 y 75 % en vez de analizar el contenido.
  --capturas <n>             Capturas por tramo (por defecto 4: 2 de mayor diferencia, 2 de peor SSIM).
  --igualar <modo>           bitrate (por defecto, 2 pasadas) o crf (CRF que pesa ±2 % de "actual").
  --sin-cache                Recodifica todo aunque esté en la caché.
  --no-abrir                 No levanta el servidor ni abre el navegador al terminar.
  --paralelo <n>             Codificaciones a la vez (por defecto, el de la config).
  --video <archivo>          Raw a usar (si hay varios videos).
  -s, --subs <archivo>       Subtítulos si hay que generar el .avs; repetir, en orden.
  --serie <nombre>           Serie (por defecto, del raw o de las carpetas).
  --episodio <número>        Episodio.
  --carpeta-salida <ruta>    Carpeta de salida solo para esta comparación.
  -h, --help                 Muestra esta ayuda.`;

export const AYUDA_CONFIG = `Uso: asu config <subcomando>

Subcomandos:
  preajustes                                   Lista los preajustes.
  preajustes agregar <nombre> <ancho>x<alto> [--etiqueta <texto>]
                                               Agrega un preajuste. --etiqueta es la parte final
                                               del .avs: "<serie> <ep> <etiqueta>.avs"
                                               (por defecto, el nombre del preajuste).
  preajustes quitar <nombre>                   Quita un preajuste.
  salidas                                      Lista las salidas de encode, MeGUI y carpeta de salida.
  salidas activar <nombre>                     Incluye la salida en asu encode.
  salidas desactivar <nombre>                  La excluye.
  salidas usar-variante <salida> <variante>    Copia los ajustes x264 de una variante a esa salida.
  variantes                                    Lista las variantes de x264 de asu comparar.
  megui <ruta>                                 Carpeta de instalación de MeGUI.
  carpeta-salida <ruta>                        Carpeta de los archivos finales de asu encode.
  paralelo <n>                                 Versiones que asu encode codifica a la vez (3 de fábrica).
  restablecer                                  Vuelve preajustes y salidas a los de fábrica.
  ruta                                         Muestra la ruta de config.json.

Los ajustes de x264, XviD, audio, tamaño del AVI y grupo se editan a mano en config.json.

Opciones:
  -h, --help                                   Muestra esta ayuda.`;
