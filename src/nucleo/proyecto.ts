import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** Carpeta de datos de asu dentro de una carpeta del proyecto (serie o episodio). */
export const CARPETA_PROYECTO = ".asu";
export const NOMBRE_ARCHIVO_PROYECTO = "asu.json";

/** Elecciones del último `asu encode` en una carpeta de episodio. */
export type EleccionesEncode = {
    /** Nombres de las salidas. */
    versiones?: string[];
    /** Nombres de los .ass (sin ruta), en el orden de los textsub. */
    subtitulos?: string[];
    serie?: string;
    episodio?: string;
    /** Pista de audio, desde 1. */
    pistaAudio?: number;
};

export type ConfigProyecto = {
    /** "HDTV", "BD", ... Aparece en el nombre final: "(HDTV 1920x1080)". */
    fuente?: string;
    encode?: EleccionesEncode;
};

export type ProyectoEncontrado = {
    ruta: string;
    datos: ConfigProyecto;
};

/** `<dir>\.asu\asu.json`. Un `asu.json` suelto en `<dir>` (ubicación vieja) se ignora. */
export function rutaArchivoProyecto(dir: string): string {
    return join(dir, CARPETA_PROYECTO, NOMBRE_ARCHIVO_PROYECTO);
}

function leer(ruta: string): ConfigProyecto {
    try {
        return JSON.parse(readFileSync(ruta, "utf8")) as ConfigProyecto;
    } catch (error) {
        throw new Error(`${ruta} no es un JSON válido: ${(error as Error).message}`);
    }
}

function escribir(ruta: string, datos: ConfigProyecto): void {
    mkdirSync(dirname(ruta), { recursive: true });
    writeFileSync(ruta, `${JSON.stringify(datos, null, 2)}\n`);
}

/**
 * Busca, en `dir` y sus carpetas superiores, el `.asu\asu.json` más cercano que defina la fuente.
 * Los de episodio que solo guardan elecciones del encode no tapan al de la serie.
 */
export function buscarProyecto(dir: string): ProyectoEncontrado | null {
    let actual = resolve(dir);
    while (true) {
        const ruta = rutaArchivoProyecto(actual);
        if (existsSync(ruta)) {
            const datos = leer(ruta);
            if (datos.fuente) {
                return { ruta, datos };
            }
        }

        const padre = dirname(actual);
        if (padre === actual) {
            return null;
        }
        actual = padre;
    }
}

/** Guarda `datos` (mezclados con lo que ya hubiera) en `<dir>\.asu\asu.json`. */
export function guardarProyecto(dir: string, datos: ConfigProyecto): string {
    const ruta = rutaArchivoProyecto(dir);
    const previo = existsSync(ruta) ? leer(ruta) : {};
    escribir(ruta, { ...previo, ...datos });
    return ruta;
}

/** Elecciones recordadas en `<dir>\.asu\asu.json` (solo esa carpeta). Vacío si no hay o el archivo está dañado. */
export function leerEleccionesEncode(dir: string): EleccionesEncode {
    const ruta = rutaArchivoProyecto(dir);
    if (!existsSync(ruta)) {
        return {};
    }

    try {
        const encode = leer(ruta).encode;
        return encode && typeof encode === "object" ? encode : {};
    } catch {
        return {};
    }
}

/** Agrega o reemplaza campos de la sección `encode` de `<dir>\.asu\asu.json`, conservando el resto. */
export function guardarEleccionesEncode(dir: string, cambios: EleccionesEncode): void {
    const ruta = rutaArchivoProyecto(dir);
    const previo = existsSync(ruta) ? leer(ruta) : {};
    escribir(ruta, { ...previo, encode: { ...(previo.encode ?? {}), ...cambios } });
}
