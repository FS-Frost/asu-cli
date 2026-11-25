import type { Salida } from "./config.ts";

/** De dónde viene cada herramienta. */
export type GrupoHerramienta = "megui" | "avisynth" | "ffmpeg" | "mkvtoolnix";

/** Las de MeGUI usan las mismas claves que `Herramientas` (src/nucleo/encode.ts). */
export type ClaveHerramienta =
    | "ffmpeg" | "x264" | "xvid" | "neroAac" | "lame" | "mp4box" | "avimux"
    | "avisynth" | "ffms2" | "vsfilter"
    | "ffprobe"
    | "mkvmerge" | "mkvextract";

export type DefinicionHerramienta = {
    clave: ClaveHerramienta;
    /** Archivo que se busca. */
    archivo: string;
    grupo: GrupoHerramienta;
    /** Comandos de asu que la usan. */
    usadaPor: string[];
    /** Argumentos para que informe su versión; sin ellos no se ejecuta (p. ej. AVI-Mux GUI abre una ventana). */
    argsVersion?: string[];
};

/** Carpeta configurable de cada grupo que no es de MeGUI (`herramientas` en config.json). */
export type CarpetasHerramientas = {
    ffmpeg?: string | null;
    mkvtoolnix?: string | null;
    avisynthPlugins?: string | null;
};

/** Nombre de cada carpeta configurable en `asu config herramienta <nombre> <carpeta>`. */
export const NOMBRES_CARPETAS: Record<string, keyof CarpetasHerramientas> = {
    ffmpeg: "ffmpeg",
    mkvtoolnix: "mkvtoolnix",
    "avisynth-plugins": "avisynthPlugins",
};

export const GRUPOS: Record<GrupoHerramienta, { nombre: string; instalar: string }> = {
    megui: {
        nombre: "MeGUI",
        instalar: 'Instala MeGUI (https://sourceforge.net/projects/megui/) y configura su carpeta: asu config megui "<carpeta>"',
    },
    avisynth: {
        nombre: "AviSynth 2.60 (32 bits) y plugins",
        instalar:
            "Instala AviSynth 2.60 de 32 bits (https://sourceforge.net/projects/avisynth2/) y copia ffms2.dll y VSFilter.dll a su carpeta de plugins. " +
            'Si los plugins están en otra carpeta: asu config herramienta avisynth-plugins "<carpeta>"',
    },
    ffmpeg: {
        nombre: "FFmpeg",
        instalar: 'winget install Gyan.FFmpeg  (o indica su carpeta: asu config herramienta ffmpeg "<carpeta>")',
    },
    mkvtoolnix: {
        nombre: "MKVToolNix",
        instalar: 'winget install MoritzBunkus.MKVToolNix  (o indica su carpeta: asu config herramienta mkvtoolnix "<carpeta>")',
    },
};

export const CATALOGO: readonly DefinicionHerramienta[] = [
    { clave: "ffmpeg", archivo: "ffmpeg.exe", grupo: "megui", usadaPor: ["encode", "comparar"], argsVersion: ["-version"] },
    { clave: "x264", archivo: "x264.exe", grupo: "megui", usadaPor: ["encode", "comparar"], argsVersion: ["--version"] },
    { clave: "mp4box", archivo: "mp4box.exe", grupo: "megui", usadaPor: ["encode", "comparar"], argsVersion: ["-version"] },
    { clave: "neroAac", archivo: "neroAacEnc.exe", grupo: "megui", usadaPor: ["encode (audio AAC recodificado)"], argsVersion: ["-help"] },
    { clave: "xvid", archivo: "xvid_encraw.exe", grupo: "megui", usadaPor: ["encode (AVI)"] },
    { clave: "lame", archivo: "lame.exe", grupo: "megui", usadaPor: ["encode (AVI)"], argsVersion: ["--version"] },
    { clave: "avimux", archivo: "AVIMux_GUI.exe", grupo: "megui", usadaPor: ["encode (AVI)"] },
    { clave: "avisynth", archivo: "avisynth.dll", grupo: "avisynth", usadaPor: ["encode", "comparar"] },
    { clave: "ffms2", archivo: "ffms2.dll", grupo: "avisynth", usadaPor: ["encode", "comparar"] },
    { clave: "vsfilter", archivo: "VSFilter.dll", grupo: "avisynth", usadaPor: ["encode", "comparar"] },
    { clave: "ffprobe", archivo: "ffprobe.exe", grupo: "ffmpeg", usadaPor: ["corregir-offset"], argsVersion: ["-version"] },
    { clave: "mkvmerge", archivo: "mkvmerge.exe", grupo: "mkvtoolnix", usadaPor: ["corregir-offset", "mkv"], argsVersion: ["--version"] },
    { clave: "mkvextract", archivo: "mkvextract.exe", grupo: "mkvtoolnix", usadaPor: ["mkv"], argsVersion: ["--version"] },
];

export function definicion(clave: ClaveHerramienta): DefinicionHerramienta {
    return CATALOGO.find((d) => d.clave === clave)!;
}

export const AVISYNTH: readonly ClaveHerramienta[] = ["avisynth", "ffms2", "vsfilter"];

/**
 * Herramientas que necesita codificar `salidas`. Con `audio` = null solo las de video (antes de
 * conocer la pista); con `{ copiarAac }` solo las de audio: neroAacEnc si un MP4 recodifica a AAC,
 * lame si hay AVI.
 */
export function necesariasEncode(salidas: readonly Salida[], audio: { copiarAac: boolean } | null): ClaveHerramienta[] {
    const mp4 = salidas.some((s) => s.tipo === "mp4-x264");
    const avi = salidas.some((s) => s.tipo === "avi-xvid");
    if (audio) {
        return [...(mp4 && !audio.copiarAac ? ["neroAac" as const] : []), ...(avi ? ["lame" as const] : [])];
    }
    return ["ffmpeg", ...(mp4 ? ["x264", "mp4box"] as const : []), ...(avi ? ["xvid", "avimux"] as const : []), ...AVISYNTH];
}

/** Las de `asu comparar`: sin audio. */
export const NECESARIAS_COMPARAR: readonly ClaveHerramienta[] = ["ffmpeg", "x264", "mp4box", ...AVISYNTH];

/**
 * Herramientas de cada opción del menú, para avisar antes de elegirla. Encode: las de video de las
 * salidas activas y lame si hay AVI; neroAacEnc no, porque depende del audio del raw.
 */
export function necesariasMenu(accion: string, salidasActivas: readonly Salida[]): ClaveHerramienta[] {
    switch (accion) {
        case "encode":
            return [...necesariasEncode(salidasActivas, null), ...(salidasActivas.some((s) => s.tipo === "avi-xvid") ? ["lame" as const] : [])];
        case "comparar":
            return [...NECESARIAS_COMPARAR];
        case "mkv":
            return ["mkvmerge", "mkvextract"];
        case "corregir-offset":
            return ["ffprobe", "mkvmerge"];
        default:
            return [];
    }
}

export type Faltante = { definicion: DefinicionHerramienta; buscadaEn: string[] };

/** Mensaje único de herramientas faltantes: qué falta, dónde se buscó, para qué y cómo instalarlo. */
export function mensajeFaltan(faltantes: readonly Faltante[], comando: string): string {
    const lineas = faltantes.map(({ definicion: d, buscadaEn }) =>
        `  ${d.archivo} (${GRUPOS[d.grupo].nombre})${buscadaEn.length > 0 ? ` — buscado en: ${buscadaEn.join(", ")}` : ""}`);
    const grupos = [...new Set(faltantes.map((f) => f.definicion.grupo))];
    return [
        `Faltan herramientas para ${comando}:`,
        ...lineas,
        "Cómo instalarlas:",
        ...grupos.map((g) => `  ${GRUPOS[g].nombre}: ${GRUPOS[g].instalar}`),
        "Detalle de todas las herramientas: asu herramientas",
    ].join("\n");
}

/** Pista corta para el menú: "falta mkvextract.exe" / "faltan x264.exe, mp4box.exe…". */
export function pistaFaltantes(faltantes: readonly Faltante[]): string | undefined {
    if (faltantes.length === 0) {
        return undefined;
    }
    const nombres = faltantes.map((f) => f.definicion.archivo);
    const lista = nombres.length > 2 ? `${nombres.slice(0, 2).join(", ")}…` : nombres.join(", ");
    return `${nombres.length === 1 ? "falta" : "faltan"} ${lista}`;
}

/** Primera línea con letras de la salida de `--version` y similares (recortada); salta banners de "*****". */
export function lineaVersion(salida: string): string | null {
    const linea = salida
        .split(/\r?\n/)
        .map((l) => l.replace(/^[*\s]+|[*\s]+$/g, "").replace(/\s+/g, " "))
        .find((l) => /[A-Za-z]/.test(l));
    return linea ? (linea.length > 90 ? `${linea.slice(0, 89)}…` : linea) : null;
}
