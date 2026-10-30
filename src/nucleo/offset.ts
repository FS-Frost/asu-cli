import { basename, extname } from "node:path";

export const SUFIJO_CORREGIDO = " [fixed]";

/** Nombre (sin extensión) del MKV corregido: el del video más " [fixed]". */
export function nombreCorregido(video: string): string {
    return `${basename(video, extname(video))}${SUFIJO_CORREGIDO}`;
}

/**
 * Inicio en segundos del primer video, según la salida JSON de
 * `ffprobe -select_streams V -show_entries stream=start_time -of json`. `undefined` si no hay.
 */
export function parsearInicioVideo(json: string): number | undefined {
    const datos = JSON.parse(json) as { streams?: { start_time?: string }[] };
    const inicio = Number(datos.streams?.[0]?.start_time);
    return Number.isFinite(inicio) ? inicio : undefined;
}

/** IDs de las pistas de video según `mkvmerge --identify` (formato texto). */
export function parsearPistasVideo(salida: string): number[] {
    return [...salida.matchAll(/^Track ID (\d+): video\b/gm)].map((m) => Number(m[1]));
}

/**
 * Desplazamiento en ms (para `--sync`) que deja el primer frame en 0. Se trunca hacia cero:
 * pasarse dejaría el primer frame con tiempo negativo y mkvmerge lo descartaría.
 */
export function desplazamientoMs(inicio: number): number {
    // Redondear a microsegundos antes de truncar: 0.029 * 1000 = 28.999999999999996.
    const ms = Math.trunc(Math.round(inicio * 1e6) / 1e3);
    return ms === 0 ? 0 : -ms;
}

/** Argumentos de mkvmerge: copia todo (mismo orden de pistas) y desplaza solo la pista de video. */
export function argumentosMkvmerge(entrada: string, salida: string, pistaVideo: number, ms: number): string[] {
    return ["-o", salida, "--sync", `${pistaVideo}:${ms}`, entrada];
}
