import * as p from "@clack/prompts";
import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { crc32Archivo } from "../crc.ts";
import { crcDelNombre } from "../nucleo/nombres.ts";
import { ErrorUsuario, elegirVarios, esInteractivo } from "../ui.ts";

export type OpcionesCrc = {
    /** Carpetas o archivos; sin indicar, la carpeta actual. */
    rutas?: string[];
};

/**
 * Archivos a revisar: de cada carpeta, los que tienen "[XXXXXXXX]" al final del nombre (no
 * recursivo, orden alfabético); los archivos indicados van siempre (sin CRC en el nombre, solo
 * se informa el calculado).
 */
function archivosARevisar(rutas: readonly string[]): string[] {
    const archivos: string[] = [];
    for (const ruta of rutas) {
        const absoluta = resolve(ruta);
        if (!existsSync(absoluta)) {
            throw new ErrorUsuario(`No existe: ${absoluta}`);
        }
        if (statSync(absoluta).isDirectory()) {
            archivos.push(...archivosDeCarpeta(absoluta).filter((archivo) => crcDelNombre(archivo) !== null));
        } else {
            archivos.push(absoluta);
        }
    }
    return archivos;
}

/** Archivos de una carpeta (no recursivo), en orden alfabético. */
export function archivosDeCarpeta(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isFile())
        .map((e) => join(dir, e.name))
        .sort((a, b) => a.localeCompare(b));
}

/**
 * Calcula el CRC32 de cada archivo y lo muestra; si el nombre trae "[XXXXXXXX]", además lo compara.
 * Código 1 si alguno no coincide.
 */
export async function revisarArchivos(archivos: readonly string[]): Promise<number> {
    let fallidos = 0;
    for (const archivo of archivos) {
        const nombre = basename(archivo);
        const esperado = crcDelNombre(archivo);
        const total = statSync(archivo).size;
        const spinner = esInteractivo() ? p.spinner() : null;
        spinner?.start(`${nombre}...`);
        let ultimo = 0;
        const calculado = await crc32Archivo(archivo, (bytes) => {
            const ahora = Date.now();
            if (spinner && ahora - ultimo >= 250) {
                ultimo = ahora;
                spinner.message(`${nombre}: ${total > 0 ? Math.floor((bytes / total) * 100) : 100} %`);
            }
        });
        spinner?.clear();

        if (esperado === null) {
            p.log.info(`${calculado}  ${nombre}`);
        } else if (esperado === calculado) {
            p.log.success(`${calculado}  OK  ${nombre}`);
        } else {
            p.log.error(`${calculado}  NO COINCIDE  ${nombre}: el nombre dice ${esperado} (corrupto o modificado).`);
            fallidos++;
        }
    }

    const conCrc = archivos.filter((archivo) => crcDelNombre(archivo) !== null).length;
    if (fallidos > 0) {
        p.log.error(`${fallidos} de ${conCrc} no coinciden.`);
        return 1;
    }
    if (conCrc > 0) {
        p.log.success(`${conCrc === 1 ? "El archivo con CRC coincide" : `Los ${conCrc} archivos con CRC coinciden`}.`);
    }
    return 0;
}

/**
 * Opción por defecto del submenú de CRC: elegir archivos de la carpeta actual (ninguno marcado) y
 * calcular su CRC32; los que traen CRC en el nombre además se comparan.
 */
export async function calcularCrcElegidos(dir = process.cwd()): Promise<number> {
    const archivos = archivosDeCarpeta(dir);
    if (archivos.length === 0) {
        p.log.warn(`No hay archivos en ${dir}.`);
        return 1;
    }

    const elegidos = await elegirVarios(
        "Archivos para calcular el CRC32 (espacio marca, Enter confirma)",
        archivos.map((ruta) => ({ value: ruta, label: basename(ruta), hint: crcDelNombre(ruta) ? "tiene CRC: se compara" : undefined })),
        [],
    );
    if (elegidos.length === 0) {
        p.log.warn("No elegiste ningún archivo.");
        return 1;
    }
    return revisarArchivos(elegidos);
}

/**
 * `asu crc [carpeta | archivo]...`: recalcula el CRC32 de cada archivo y lo compara con el del
 * nombre. Código 1 si alguno no coincide o no hay nada que revisar.
 */
export async function verificarCrc(opciones: OpcionesCrc): Promise<number> {
    const rutas = opciones.rutas && opciones.rutas.length > 0 ? opciones.rutas : [process.cwd()];
    const archivos = archivosARevisar(rutas);
    if (archivos.length === 0) {
        p.log.warn(`No hay archivos con CRC en el nombre ("… [ABCD1234].mp4") en ${rutas.map((r) => resolve(r)).join(", ")}.`);
        return 1;
    }
    return revisarArchivos(archivos);
}
