import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { validarNombreArchivo } from "./archivos.ts";

export type Preajuste = {
    nombre: string;
    ancho: number;
    alto: number;
    /** Nombre del .avs generado, sin extensión. */
    archivo: string;
};

export type Config = {
    preajustes: Preajuste[];
};

export const PREAJUSTES_DE_FABRICA: readonly Preajuste[] = [
    { nombre: "720p", ancho: 1280, alto: 720, archivo: "MP4-720p" },
    { nombre: "396p", ancho: 704, alto: 396, archivo: "AVI" },
    { nombre: "1080p", ancho: 1920, alto: 1080, archivo: "MP4-1080p" },
];

export function configDeFabrica(): Config {
    return { preajustes: PREAJUSTES_DE_FABRICA.map((preajuste) => ({ ...preajuste })) };
}

/** `~/.asu-cli`, o `ASU_CLI_HOME` si está definida (usado por los tests). */
export function directorioConfig(): string {
    return process.env.ASU_CLI_HOME ?? join(homedir(), ".asu-cli");
}

export function rutaConfig(): string {
    return join(directorioConfig(), "config.json");
}

export function rutaCacheFuentes(): string {
    return join(directorioConfig(), "cache-fuentes.json");
}

/** Interpreta "1280x720". Devuelve `null` si el formato o los valores no son válidos. */
export function parsearResolucion(texto: string): { ancho: number; alto: number } | null {
    const coincidencia = texto.trim().match(/^(\d+)\s*[xX×]\s*(\d+)$/);
    if (!coincidencia) {
        return null;
    }

    const ancho = Number(coincidencia[1]);
    const alto = Number(coincidencia[2]);
    if (ancho <= 0 || alto <= 0) {
        return null;
    }

    return { ancho, alto };
}

export function buscarPreajuste(config: Config, nombre: string): Preajuste | undefined {
    const clave = nombre.trim().toLowerCase();
    return config.preajustes.find((preajuste) => preajuste.nombre.toLowerCase() === clave);
}

/** Devuelve el error de validación del preajuste o `undefined`. */
export function validarPreajuste(preajuste: Preajuste): string | undefined {
    if (preajuste.nombre.trim().length === 0) {
        return "El nombre del preajuste no puede estar vacío.";
    }

    if (!Number.isInteger(preajuste.ancho) || !Number.isInteger(preajuste.alto) || preajuste.ancho <= 0 || preajuste.alto <= 0) {
        return "El ancho y el alto deben ser enteros positivos.";
    }

    const errorArchivo = validarNombreArchivo(preajuste.archivo);
    if (errorArchivo) {
        return `Archivo del preajuste: ${errorArchivo}`;
    }

    return undefined;
}

export function agregarPreajuste(config: Config, preajuste: Preajuste): Config {
    const error = validarPreajuste(preajuste);
    if (error) {
        throw new Error(error);
    }

    if (buscarPreajuste(config, preajuste.nombre)) {
        throw new Error(`Ya existe un preajuste llamado "${preajuste.nombre}".`);
    }

    return { ...config, preajustes: [...config.preajustes, { ...preajuste, nombre: preajuste.nombre.trim(), archivo: preajuste.archivo.trim() }] };
}

export function quitarPreajuste(config: Config, nombre: string): Config {
    const existente = buscarPreajuste(config, nombre);
    if (!existente) {
        throw new Error(`No existe un preajuste llamado "${nombre}".`);
    }

    return { ...config, preajustes: config.preajustes.filter((preajuste) => preajuste !== existente) };
}

function validarConfig(datos: unknown): Config {
    const preajustes = (datos as Partial<Config> | null)?.preajustes;
    if (!Array.isArray(preajustes)) {
        throw new Error('Falta la lista "preajustes".');
    }

    for (const preajuste of preajustes) {
        const error = validarPreajuste(preajuste as Preajuste);
        if (error) {
            throw new Error(`Preajuste ${JSON.stringify(preajuste)}: ${error}`);
        }
    }

    return { preajustes: preajustes as Preajuste[] };
}

/** Lee la configuración. Si no existe, devuelve la de fábrica sin escribirla. */
export function cargarConfig(): Config {
    const ruta = rutaConfig();
    if (!existsSync(ruta)) {
        return configDeFabrica();
    }

    try {
        return validarConfig(JSON.parse(readFileSync(ruta, "utf8")));
    } catch (error) {
        throw new Error(`Configuración inválida en ${ruta}: ${(error as Error).message}`);
    }
}

export function guardarConfig(config: Config): void {
    mkdirSync(directorioConfig(), { recursive: true });
    writeFileSync(rutaConfig(), `${JSON.stringify(config, null, 2)}\n`);
}
