import * as p from "@clack/prompts";
import { existsSync, readdirSync, renameSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { crc32Archivo } from "../crc.ts";
import type { ElementoMarcable } from "../lista-marcable.ts";
import { buscarCrc, conCrc, crcDelNombre } from "../nucleo/nombres.ts";
import { Cancelado, ErrorUsuario, esInteractivo, marcarLista } from "../ui.ts";

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

export type ArchivoSinCrc = { ruta: string; crc: string };

/**
 * Calcula el CRC32 de cada archivo y lo muestra; si el nombre trae un CRC (ver `buscarCrc`),
 * además lo compara. Código 1 si alguno no coincide; `sinCrc` = los que no traían CRC, con el
 * calculado.
 */
export async function revisarArchivos(archivos: readonly string[]): Promise<{ codigo: number; sinCrc: ArchivoSinCrc[] }> {
    let fallidos = 0;
    const sinCrc: ArchivoSinCrc[] = [];
    for (const archivo of archivos) {
        const nombre = basename(archivo);
        const enNombre = buscarCrc(archivo);
        const esperado = enNombre?.crc ?? null;
        const forma = enNombre && !enNombre.conCorchetes ? " (sin corchetes)" : "";
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
            sinCrc.push({ ruta: archivo, crc: calculado });
        } else if (esperado === calculado) {
            p.log.success(`${calculado}  OK  ${nombre}${forma}`);
        } else {
            p.log.error(`${calculado}  NO COINCIDE  ${nombre}: el nombre dice ${esperado}${forma} (corrupto o modificado).`);
            fallidos++;
        }
    }

    const conCrc = archivos.length - sinCrc.length;
    if (fallidos > 0) {
        p.log.error(`${fallidos} de ${conCrc} no coinciden.`);
        return { codigo: 1, sinCrc };
    }
    if (conCrc > 0) {
        p.log.success(`${conCrc === 1 ? "El archivo con CRC coincide" : `Los ${conCrc} archivos con CRC coinciden`}.`);
    }
    return { codigo: 0, sinCrc };
}

/**
 * Renombra cada archivo a "nombre [XXXXXXXX].ext". Si el nombre nuevo ya existe o no se puede
 * renombrar (p. ej. abierto en otro programa), avisa y sigue. Devuelve cuántos renombró.
 */
export function agregarCrcAlNombre(archivos: readonly ArchivoSinCrc[]): number {
    let renombrados = 0;
    for (const { ruta, crc } of archivos) {
        const destino = conCrc(ruta, crc);
        if (existsSync(destino)) {
            p.log.warn(`${basename(ruta)}: no se renombró, ya existe ${basename(destino)}.`);
            continue;
        }
        try {
            renameSync(ruta, destino);
            p.log.success(`${basename(ruta)} → ${basename(destino)}`);
            renombrados++;
        } catch (error) {
            p.log.warn(`${basename(ruta)}: no se pudo renombrar (${(error as Error).message}).`);
        }
    }
    return renombrados;
}

/**
 * Elementos de la lista de CRC: todos los archivos, en orden; los que tienen CRC en el nombre van
 * marcados y destacados (tecla `c`), con el CRC leído como pista.
 */
export function elementosListaCrc(archivos: readonly string[]): { elementos: ElementoMarcable<string>[]; marcados: string[] } {
    const elementos = archivos.map((ruta) => {
        const enNombre = buscarCrc(ruta);
        return {
            value: ruta,
            label: basename(ruta),
            hint: enNombre ? `CRC ${enNombre.crc}${enNombre.conCorchetes ? "" : ", sin corchetes"}` : undefined,
            destacado: enNombre !== null,
        };
    });
    return { elementos, marcados: elementos.filter((e) => e.destacado).map((e) => e.value) };
}

/**
 * `asu crc` con terminal (menú y menú contextual): lista de los archivos de la carpeta actual con
 * los que tienen CRC marcados (Enter = verificar la carpeta). Calcula el CRC32 de los marcados,
 * compara los que traen CRC y al final ofrece agregar " [XXXXXXXX]" al nombre de los que no lo
 * traían (todos marcados).
 */
export async function elegirYRevisarCrc(dir = process.cwd()): Promise<number> {
    const archivos = archivosDeCarpeta(dir);
    if (archivos.length === 0) {
        p.log.warn(`No hay archivos en ${dir}.`);
        return 1;
    }

    const { elementos, marcados: conCrcEnNombre } = elementosListaCrc(archivos);
    const elegidos = await marcarLista("Archivos para calcular el CRC32 (los que tienen CRC se comparan)", elementos, conCrcEnNombre, "solo con CRC");
    if (elegidos.length === 0) {
        p.log.warn("No elegiste ningún archivo.");
        return 1;
    }

    const { codigo, sinCrc } = await revisarArchivos(elegidos);
    if (sinCrc.length > 0) {
        let marcados: string[];
        try {
            marcados = await marcarLista(
                "Agregar el CRC al nombre de (Enter renombra, Esc no renombra nada)",
                sinCrc.map(({ ruta, crc }) => ({ value: ruta, label: basename(ruta), hint: basename(conCrc(ruta, crc)) })),
                sinCrc.map(({ ruta }) => ruta),
            );
        } catch (error) {
            if (!(error instanceof Cancelado)) {
                throw error;
            }
            marcados = [];
        }
        if (marcados.length > 0) {
            agregarCrcAlNombre(sinCrc.filter(({ ruta }) => marcados.includes(ruta)));
        } else {
            p.log.info("No se renombró ningún archivo.");
        }
    }
    return codigo;
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
    return (await revisarArchivos(archivos)).codigo;
}
