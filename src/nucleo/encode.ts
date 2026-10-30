import { join } from "node:path";
import { FPS_DENOMINADOR, FPS_NUMERADOR } from "./avs.ts";
import type { AjustesX264, AudioSalida, Salida } from "./config.ts";

// Líneas de comando equivalentes a las que genera MeGUI (ver su log). Funciones puras: no ejecutan nada.

export type Comando = {
    exe: string;
    args: string[];
};

/** Ejecutables dentro de `<MeGUI>\tools`. */
export type Herramientas = {
    ffmpeg: string;
    x264: string;
    xvid: string;
    neroAac: string;
    lame: string;
    mp4box: string;
    avimux: string;
};

export function herramientasDeMegui(rutaMegui: string): Herramientas {
    const tools = join(rutaMegui, "tools");
    return {
        ffmpeg: join(tools, "ffmpeg", "ffmpeg.exe"),
        x264: join(tools, "x264", "x264.exe"),
        xvid: join(tools, "xvid_encraw", "xvid_encraw.exe"),
        neroAac: join(tools, "eac3to", "neroAacEnc.exe"),
        lame: join(tools, "lame", "lame.exe"),
        mp4box: join(tools, "mp4box", "mp4box.exe"),
        avimux: join(tools, "avimux_gui", "AVIMux_GUI.exe"),
    };
}

const FPS_TEXTO = `${FPS_NUMERADOR}/${FPS_DENOMINADOR}`;
const FPS_DECIMAL = "23.976";

// ---- Lectura de la salida de ffmpeg ----

export type PistaAudio = {
    /** Índice entre las pistas de audio (para `-map 0:a:N`). */
    indice: number;
    idioma: string | null;
    descripcion: string;
};

/** Pistas de audio según `ffmpeg -i <archivo>` (stderr). */
export function parsearPistasAudio(salidaFfmpeg: string): PistaAudio[] {
    const pistas: PistaAudio[] = [];
    const patron = /Stream #\d+:\d+(?:\[[^\]]*\])?(?:\(([A-Za-z]{2,3})\))?(?:\[[^\]]*\])?: Audio: ([^\r\n]*)/g;
    for (const coincidencia of salidaFfmpeg.matchAll(patron)) {
        pistas.push({ indice: pistas.length, idioma: coincidencia[1]?.toLowerCase() ?? null, descripcion: coincidencia[2]!.trim() });
    }

    return pistas;
}

/**
 * Pista a usar: la única; o la única en japonés; `null` si hay que preguntar.
 * Lanza error si no hay pistas de audio.
 */
export function elegirPistaAudio(pistas: readonly PistaAudio[]): PistaAudio | null {
    if (pistas.length === 0) {
        throw new Error("El video no tiene pistas de audio.");
    }

    if (pistas.length === 1) {
        return pistas[0]!;
    }

    const japonesas = pistas.filter((pista) => pista.idioma === "jpn" || pista.idioma === "ja");
    return japonesas.length === 1 ? japonesas[0]! : null;
}

/** Duración en segundos según `ffmpeg -i` ("Duration: 00:23:40.08"). */
export function parsearDuracion(salidaFfmpeg: string): number | null {
    const coincidencia = salidaFfmpeg.match(/Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/);
    if (!coincidencia) {
        return null;
    }

    return Number(coincidencia[1]) * 3600 + Number(coincidencia[2]) * 60 + Number(coincidencia[3]);
}

/** `max_volume` de `-af volumedetect`, en dB. */
export function parsearVolumenMaximo(salidaFfmpeg: string): number | null {
    const coincidencia = salidaFfmpeg.match(/max_volume:\s*(-?\d+(?:\.\d+)?) dB/);
    return coincidencia ? Number(coincidencia[1]) : null;
}

/**
 * Ganancia para llevar el pico a 0 dBFS (equivale a `Normalize()` de MeGUI).
 * Se redondea hacia abajo a 0,1 dB para no saturar; nunca negativa.
 */
export function gananciaNormalizacion(volumenMaximo: number): number {
    return Math.max(0, Math.floor(-volumenMaximo * 10) / 10);
}

// ---- Comandos ----

export function comandoInfo(h: Herramientas, archivo: string): Comando {
    return { exe: h.ffmpeg, args: ["-hide_banner", "-i", archivo] };
}

export function comandoDetectarVolumen(h: Herramientas, raw: string, pista: number): Comando {
    return { exe: h.ffmpeg, args: ["-hide_banner", "-nostats", "-i", raw, "-map", `0:a:${pista}`, "-af", "volumedetect", "-f", "null", "-"] };
}

/**
 * Clave de un audio: las salidas con el mismo códec y bitrate comparten archivo. Si el AAC se
 * copia del raw, todas las salidas AAC comparten la copia (el bitrate configurado no aplica).
 */
export function claveAudio(audio: AudioSalida, copiarAac = false): string {
    return copiarAac && audio.codec === "aac" ? "aac-copia" : `${audio.codec}-${audio.kbps}`;
}

export function archivoAudio(dirTemporal: string, audio: AudioSalida, copiarAac = false): string {
    return join(dirTemporal, `audio-${claveAudio(audio, copiarAac)}.${audio.codec === "aac" ? "m4a" : "mp3"}`);
}

/** La pista ya es AAC: los MP4 la usan tal cual, sin recodificar. */
export function esAac(pista: PistaAudio): boolean {
    return /^aac\b/i.test(pista.descripcion);
}

/** ffmpeg copia la pista de audio del raw (sin recodificar) a un .m4a. */
export function comandoCopiarAudio(h: Herramientas, raw: string, pista: number, salida: string): Comando {
    return { exe: h.ffmpeg, args: ["-y", "-loglevel", "level+error", "-i", raw, "-map", `0:a:${pista}`, "-vn", "-c:a", "copy", salida] };
}

/** ffmpeg decodifica y normaliza el audio del raw → WAV por tubería → neroAacEnc / lame. */
export function comandosAudio(h: Herramientas, raw: string, pista: number, ganancia: number, audio: AudioSalida, salida: string): Comando[] {
    const decodificar: Comando = {
        exe: h.ffmpeg,
        args: [
            "-loglevel", "level+error", "-i", raw, "-map", `0:a:${pista}`, "-vn",
            ...(ganancia > 0 ? ["-af", `volume=${ganancia}dB`] : []),
            "-c:a", "pcm_s16le", "-f", "wav", "-",
        ],
    };

    const codificar: Comando = audio.codec === "aac"
        ? { exe: h.neroAac, args: ["-ignorelength", "-br", String(audio.kbps * 1000), "-if", "-", "-of", salida] }
        : { exe: h.lame, args: ["--abr", String(audio.kbps), "-h", "-", salida] };

    return [decodificar, codificar];
}

export type OpcionesX264 = {
    /** Solo un tramo del .avs, en segundos (para `asu comparar`). */
    tramo?: { inicio: number; duracion: number };
    /** 2 pasadas a un bitrate (kbps) en vez de CRF. */
    pasada?: { numero: 1 | 2; bitrate: number; stats: string };
};

/** Segundos con 3 decimales, como los acepta ffmpeg en -ss / -t. */
export function segundosFfmpeg(segundos: number): string {
    return segundos.toFixed(3);
}

/**
 * `-ss`/`-t` como opciones de **entrada** (antes de `-i`): limitan lo que se lee del .avs. Como
 * opción de salida, `-t` no corta si un filtro (p. ej. `select`) descarta frames: ffmpeg seguiría
 * leyendo el resto del episodio.
 */
export function argumentosTramo(tramo: { inicio: number; duracion: number } | undefined): string[] {
    return tramo ? ["-ss", segundosFfmpeg(tramo.inicio), "-t", segundosFfmpeg(tramo.duracion)] : [];
}

/** ffmpeg lee el .avs → y4m por tubería → x264. */
export function comandosX264(h: Herramientas, avs: string, x264: AjustesX264, salida: string, opciones: OpcionesX264 = {}): Comando[] {
    const { tramo, pasada } = opciones;
    const control = pasada
        ? ["--bitrate", String(pasada.bitrate), "--pass", String(pasada.numero), "--stats", pasada.stats]
        : ["--crf", x264.crf.toFixed(1)];

    return [
        {
            exe: h.ffmpeg,
            args: [
                "-loglevel", "level+error",
                ...argumentosTramo(tramo),
                "-i", avs,
                "-strict", "-1", "-f", "yuv4mpegpipe", "-",
            ],
        },
        {
            exe: h.x264,
            args: [
                "--preset", x264.preset, "--level", x264.level,
                ...(x264.tune ? ["--tune", x264.tune] : []),
                ...control,
                "--keyint", String(x264.keyint),
                "--vbv-bufsize", String(x264.vbvBufsize), "--vbv-maxrate", String(x264.vbvMaxrate), "--sar", "1:1",
                ...(x264.extra ?? []),
                "--output", salida, "--stdin", "y4m", "-",
            ],
        },
    ];
}

/** mp4box: .264 → .mp4 solo con video. */
export function comandoMp4Video(h: Herramientas, video264: string, dirTemporal: string, salida: string): Comando {
    return { exe: h.mp4box, args: ["-add", `${video264}#trackID=1:fps=${FPS_TEXTO}:par=1:1:name=`, "-tmp", dirTemporal, "-new", salida] };
}

/** mp4box: video .mp4 + audio .m4a (japonés) → .mp4 final. */
export function comandoMp4Mux(h: Herramientas, videoMp4: string, audioM4a: string, dirTemporal: string, salida: string): Comando {
    return {
        exe: h.mp4box,
        args: [
            "-add", `${videoMp4}#trackID=1:fps=${FPS_TEXTO}:par=1:1:name=`,
            "-add", `${audioM4a}#trackID=1:lang=jpn:name=`,
            "-tmp", dirTemporal, "-new", salida,
        ],
    };
}

export function comandoXvid(h: Herramientas, avs: string, pasada: 1 | 2, stats: string, bitrate: number, banderas: readonly string[], salida: string): Comando {
    const pasadaArgs = pasada === 1 ? ["-pass1", stats] : ["-o", salida, "-pass2", stats];
    return { exe: h.xvid, args: ["-i", avs, ...pasadaArgs, "-bitrate", String(bitrate), ...banderas] };
}

/** ffmpeg: .m4v (XviD crudo) → .avi solo con video. */
export function comandoAviVideo(h: Herramientas, m4v: string, salida: string): Comando {
    return { exe: h.ffmpeg, args: ["-y", "-loglevel", "level+error", "-i", m4v, "-vcodec", "copy", "-vtag", "XVID", "-r", FPS_DECIMAL, salida] };
}

/** Script de AVI-Mux GUI para unir video .avi + audio .mp3 (mismo que arma MeGUI en AMGMuxer.cs). */
export function scriptAvimux(audioMp3: string, videoAvi: string, salida: string): string {
    return [
        "CLEAR",
        `LOAD ${audioMp3}`,
        "SET OUTPUT OPTIONS",
        `LOAD ${videoAvi}`,
        "SELECT FILE 2",
        "ADD VIDEOSOURCE",
        "DESELECT FILE 2",
        "SET OUTPUT OPTIONS",
        "SET OPTION NUMBERING ON",
        "SET OPTION MAXFILESIZE ON",
        "SET OPTION MAXFILESIZE 2000",
        "SET INPUT OPTIONS",
        "SET OPTION MP3 VERIFY CBR ALWAYS",
        "SET OPTION MP3 VERIFY RESDLG OFF",
        "SET OPTION AVI FIXDX50 1",
        "SET OPTION CHAPTERS IMPORT 1",
        "SET OUTPUT OPTIONS",
        "SET OPTION ALL SUBTITLES 1",
        "SET OPTION ALL AUDIO 1",
        "SET OPTION CLOSEAPP 1",
        "SET OPTION DONEDLG 0",
        "SET OPTION OVERWRITEDLG 0",
        "SET OPTION PRELOAD 200",
        "SET OPTION OPENDML 0",
        "SET OPTION RECLISTS 0",
        "SET OPTION AVI ADDJUNKBEFOREHEADERS 0",
        "SET OPTION AUDIO INTERLEAVE 4 FR",
        `START ${salida}`,
        "",
    ].join("\r\n");
}

export function comandoAvimux(h: Herramientas, script: string): Comando {
    return { exe: h.avimux, args: [script] };
}

// ---- Bitrate ----

const BYTES_POR_MIB = 1024 * 1024;

/**
 * Bitrate de video (kbps) para que el AVI no supere `tamanoMB`.
 * Descuenta el audio real, la sobrecarga del contenedor (cabeceras + 24 bytes por chunk de
 * video y de audio intercalado cada 4 frames) y un margen del 1 % para el desvío del 2-pass.
 */
export function calcularBitrateXvid(datos: { tamanoMB: number; bytesAudio: number; duracion: number }): number {
    const frames = Math.ceil((datos.duracion * FPS_NUMERADOR) / FPS_DENOMINADOR);
    const sobrecarga = 64 * 1024 + frames * 24 + Math.ceil(frames / 4) * 24;
    const bytesVideo = (datos.tamanoMB * BYTES_POR_MIB - datos.bytesAudio - sobrecarga) * 0.99;
    const kbps = Math.floor((bytesVideo * 8) / datos.duracion / 1000);
    if (kbps <= 0) {
        throw new Error(`No cabe el video en ${datos.tamanoMB} MB: el audio ya ocupa ${(datos.bytesAudio / BYTES_POR_MIB).toFixed(1)} MB.`);
    }

    return kbps;
}

export function superaTamano(bytes: number, tamanoMB: number): boolean {
    return bytes > tamanoMB * BYTES_POR_MIB;
}

// ---- Plan ----

export type ArchivosSalida = {
    salida: Salida;
    avs: string;
    /** Ruta final (en la carpeta de salida). */
    final: string;
    /** Archivo terminado dentro de la carpeta temporal, antes de moverlo. */
    temporal: string;
};

export type Paso =
    | { id: string; tipo: "audio"; descripcion: string; audio: AudioSalida; salida: string; copiar: boolean }
    | { id: string; tipo: "x264"; descripcion: string; archivos: ArchivosSalida; video264: string }
    | { id: string; tipo: "xvid"; descripcion: string; archivos: ArchivosSalida; pasada: 1 | 2; stats: string; m4v: string }
    | { id: string; tipo: "mux-mp4"; descripcion: string; archivos: ArchivosSalida; video264: string; videoMp4: string; audio: string }
    | { id: string; tipo: "mux-avi"; descripcion: string; archivos: ArchivosSalida; m4v: string; aviVideo: string; script: string; audio: string };

export type Cadena = {
    salida: Salida;
    /** Video (x264, o XviD pasada 1 → 2) y su mux, en orden. */
    pasos: Paso[];
};

export type Plan = {
    /** Se codifican primero, en secuencia (tardan segundos y el bitrate del AVI depende del MP3). */
    audios: Paso[];
    /** Una por versión; se pueden ejecutar en paralelo entre sí. */
    cadenas: Cadena[];
};

export type OpcionesPlan = {
    /** El raw ya trae AAC: los MP4 lo copian en vez de recodificarlo. */
    copiarAac?: boolean;
};

/** Audios (compartidos entre salidas iguales) y una cadena por salida. */
export function planificarCadenas(archivos: readonly ArchivosSalida[], dirTemporal: string, opciones: OpcionesPlan = {}): Plan {
    const pasos = planificarPasos(archivos, dirTemporal, opciones);
    return {
        audios: pasos.filter((paso) => paso.tipo === "audio"),
        cadenas: archivos.map((a) => ({
            salida: a.salida,
            pasos: pasos.filter((paso) => paso.tipo !== "audio" && paso.archivos.salida === a.salida),
        })),
    };
}

/** Todos los pasos en orden secuencial: audios → videos (en el orden de las salidas) → muxes. */
export function planificarPasos(archivos: readonly ArchivosSalida[], dirTemporal: string, opciones: OpcionesPlan = {}): Paso[] {
    const copiarAac = opciones.copiarAac ?? false;
    const audios = new Map<string, AudioSalida>();
    for (const { salida } of archivos) {
        audios.set(claveAudio(salida.audio, copiarAac), salida.audio);
    }

    const pasos: Paso[] = [...audios.values()].map((audio) => {
        const copiar = copiarAac && audio.codec === "aac";
        return {
            id: `audio-${claveAudio(audio, copiarAac)}`,
            tipo: "audio",
            descripcion: copiar ? "Audio AAC (copia del raw, sin recodificar)" : `Audio ${audio.codec.toUpperCase()} ${audio.kbps} kbps`,
            audio,
            salida: archivoAudio(dirTemporal, audio, copiarAac),
            copiar,
        };
    });

    const muxes: Paso[] = [];
    for (const a of archivos) {
        const base = join(dirTemporal, a.salida.nombre);
        const audio = archivoAudio(dirTemporal, a.salida.audio, copiarAac);
        if (a.salida.tipo === "mp4-x264") {
            pasos.push({ id: `x264-${a.salida.nombre}`, tipo: "x264", descripcion: `Video ${a.salida.nombre} (x264)`, archivos: a, video264: `${base}.264` });
            muxes.push({
                id: `mux-${a.salida.nombre}`, tipo: "mux-mp4", descripcion: `Mux MP4 ${a.salida.nombre}`, archivos: a,
                video264: `${base}.264`, videoMp4: `${base}-video.mp4`, audio,
            });
        } else {
            for (const pasada of [1, 2] as const) {
                pasos.push({
                    id: `xvid${pasada}-${a.salida.nombre}`, tipo: "xvid", descripcion: `Video ${a.salida.nombre} (XviD, pasada ${pasada}/2)`,
                    archivos: a, pasada, stats: `${base}.stats`, m4v: `${base}.m4v`,
                });
            }
            muxes.push({
                id: `mux-${a.salida.nombre}`, tipo: "mux-avi", descripcion: `Mux AVI ${a.salida.nombre}`, archivos: a,
                m4v: `${base}.m4v`, aviVideo: `${base}-video.avi`, script: `${base}.mux`, audio,
            });
        }
    }

    return [...pasos, ...muxes];
}

// ---- Estado para reanudar ----

export type EstadoEncode = {
    version: 1;
    /** Identifica el trabajo (raw, pista, .avs y salidas): si cambia, no se puede reanudar. */
    firma: string;
    ganancia: number | null;
    /** Bitrate calculado por salida AVI (se fija tras la 1.ª pasada para que la 2.ª use el mismo). */
    bitrates: Record<string, number>;
    completados: string[];
};

export function estadoNuevo(firma: string): EstadoEncode {
    return { version: 1, firma, ganancia: null, bitrates: {}, completados: [] };
}
