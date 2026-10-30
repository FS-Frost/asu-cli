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

/** "[SyncRajo] Magic Knight Rayearth (2026) - 04 (HDTV 1920x1080)" (sin extensión). */
export function nombreFinal(datos: SerieEpisodio & { grupo: string; fuente: string; ancho: number; alto: number }): string {
    return `[${datos.grupo}] ${datos.serie} - ${datos.episodio} (${datos.fuente} ${datos.ancho}x${datos.alto})`;
}
