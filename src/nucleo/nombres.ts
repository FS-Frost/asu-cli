import { basename, dirname, extname } from "node:path";

export type SerieEpisodio = {
    serie: string;
    episodio: string;
};

/** Episodio siempre con al menos 2 dígitos ("4" → "04"). `null` si no es numérico. */
export function normalizarEpisodio(texto: string): string | null {
    const limpio = texto.trim();
    return /^\d+$/.test(limpio) ? limpio.padStart(2, "0") : null;
}

/**
 * Serie y episodio del nombre de un raw con el formato habitual:
 * "[Grupo] Serie - 04 [1080p ...][...].mkv" → { serie: "Serie", episodio: "04" }.
 * Acepta sufijo de versión ("- 04v2"). `null` si el nombre no calza.
 */
export function serieEpisodioDeRaw(ruta: string): SerieEpisodio | null {
    const nombre = basename(ruta, extname(ruta))
        .replace(/^\s*\[[^\]]*\]\s*/, "")
        .replace(/(\s*[[(][^\])]*[\])])+\s*$/, "")
        .replace(/_/g, " ")
        .trim();

    const coincidencia = nombre.match(/^(.+?)\s+-\s+(\d{1,4})(?:v\d+)?$/i);
    if (!coincidencia) {
        return null;
    }

    return { serie: coincidencia[1]!.trim(), episodio: normalizarEpisodio(coincidencia[2]!)! };
}

/** Serie = carpeta padre, episodio = carpeta del episodio (si es numérica). */
export function serieEpisodioDeCarpetas(dirEpisodio: string): SerieEpisodio | null {
    const episodio = normalizarEpisodio(basename(dirEpisodio));
    const serie = basename(dirname(dirEpisodio)).trim();
    if (episodio === null || serie.length === 0 || dirname(dirEpisodio) === dirEpisodio) {
        return null;
    }

    return { serie, episodio };
}

/** Del raw si calza; si no, de las carpetas. */
export function deducirSerieEpisodio(rutaRaw: string, dirEpisodio: string): SerieEpisodio | null {
    return serieEpisodioDeRaw(rutaRaw) ?? serieEpisodioDeCarpetas(dirEpisodio);
}

/** "Magic Knight Rayearth (2026) 04 MP4 1080.avs" */
export function nombreAvs({ serie, episodio }: SerieEpisodio, etiqueta: string): string {
    return `${serie} ${episodio} ${etiqueta}.avs`;
}

/** "[SyncRajo] Magic Knight Rayearth (2026) - 04 (HDTV 1920x1080)" (sin extensión ni CRC). */
export function nombreFinal(datos: SerieEpisodio & { grupo: string; fuente: string; ancho: number; alto: number }): string {
    return `[${datos.grupo}] ${datos.serie} - ${datos.episodio} (${datos.fuente} ${datos.ancho}x${datos.alto})`;
}

// ---- CRC en el nombre ----

/** CRC32 como lo escriben los grupos: 8 dígitos hexadecimales en mayúsculas. */
export function formatearCrc(crc: number): string {
    return (crc >>> 0).toString(16).toUpperCase().padStart(8, "0");
}

/** "X.mp4" → "X [ABCD1234].mp4" (también con ruta). */
export function conCrc(ruta: string, crc: string): string {
    const extension = extname(ruta);
    return `${ruta.slice(0, ruta.length - extension.length)} [${crc}]${extension}`;
}

/** CRC del final del nombre ("… [ABCD1234].mkv" o "…[abcd1234].mkv") en mayúsculas, o `null`. */
export function crcDelNombre(ruta: string): string | null {
    const coincidencia = basename(ruta, extname(ruta)).match(/\[([0-9a-f]{8})\]\s*$/i);
    return coincidencia ? coincidencia[1]!.toUpperCase() : null;
}

/** ¿`archivo` es el final `nombre` (con extensión, sin CRC), sin CRC o con cualquier CRC? Sin distinguir mayúsculas. */
export function esMismoFinal(archivo: string, nombre: string): boolean {
    const a = basename(archivo).toLowerCase();
    const n = nombre.toLowerCase();
    if (a === n) {
        return true;
    }
    const extension = extname(n);
    const tronco = n.slice(0, n.length - extension.length);
    return a.startsWith(`${tronco} [`) && a.endsWith(extension) && /^ \[[0-9a-f]{8}\]$/.test(a.slice(tronco.length, a.length - extension.length));
}
