import * as p from "@clack/prompts";
import { readFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { decodificarAdjunto } from "../nucleo/adjuntos-ass.ts";
import { EXTENSIONES_ASS, EXTENSIONES_FUENTE, listarArchivos } from "../nucleo/archivos.ts";
import { rutaCacheFuentes } from "../nucleo/config.ts";
import { fuentesFaltantes, fuentesUsadas, leerASS } from "../nucleo/fuentes-ass.ts";
import { nombresDeFuente } from "../nucleo/fuentes-archivo.ts";
import { nombresDeArchivosFuente, obtenerFuentesInstaladas } from "../nucleo/fuentes-sistema.ts";
import type { ASSFile } from "@fs-frost/asu";
import { resolverDirectorio } from "./comun.ts";

export type OpcionesVerificarFuentes = {
    dir?: string;
};

function fuentesIncrustadas(ass: ASSFile): Set<string> {
    const nombres = new Set<string>();
    for (const adjunto of ass.fonts.files) {
        try {
            for (const nombre of nombresDeFuente(decodificarAdjunto(adjunto.data))) {
                nombres.add(nombre);
            }
        } catch {
            p.log.warn(`No se pudo leer la fuente incrustada ${adjunto.name}.`);
        }
    }

    return nombres;
}

export type RevisionFuentes = {
    /** Archivo → fuentes faltantes (solo los que tienen alguna). */
    faltantes: Map<string, string[]>;
    /** Archivos que no se pudieron leer. */
    errores: string[];
};

/**
 * Fuentes faltantes de una lista de .ass (de cualquier carpeta). Disponibles: instaladas,
 * sueltas junto a cada .ass e incrustadas en él. No muestra nada.
 */
export function revisarFuentes(rutas: readonly string[]): RevisionFuentes {
    const resultado: RevisionFuentes = { faltantes: new Map(), errores: [] };
    if (rutas.length === 0) {
        return resultado;
    }

    const instaladas = obtenerFuentesInstaladas(rutaCacheFuentes());
    const localesPorDir = new Map<string, Set<string>>();

    for (const ruta of rutas) {
        const ass = leerASS(readFileSync(ruta, "utf8"));
        if (ass === null) {
            resultado.errores.push(ruta);
            continue;
        }

        const dir = dirname(ruta);
        if (!localesPorDir.has(dir)) {
            localesPorDir.set(dir, nombresDeArchivosFuente(listarArchivos(dir, EXTENSIONES_FUENTE)));
        }

        const disponibles = new Set([...instaladas, ...localesPorDir.get(dir)!, ...fuentesIncrustadas(ass)]);
        const faltantes = fuentesFaltantes(fuentesUsadas(ass), disponibles);
        if (faltantes.length > 0) {
            resultado.faltantes.set(ruta, faltantes);
        }
    }

    return resultado;
}

/**
 * Revisa que las fuentes usadas por los .ass del directorio estén disponibles: instaladas,
 * sueltas en el directorio o incrustadas en el propio .ass. Devuelve 1 si falta alguna o no se pudo leer un archivo.
 */
export async function verificarFuentes(opciones: OpcionesVerificarFuentes): Promise<number> {
    const dir = resolverDirectorio(opciones.dir);
    p.log.info(`Directorio: ${dir}`);

    const rutas = listarArchivos(dir, EXTENSIONES_ASS);
    if (rutas.length === 0) {
        p.log.warn("No hay archivos .ass en el directorio.");
        return 0;
    }

    p.log.step("Obteniendo fuentes instaladas (la primera vez puede tardar)...");
    const instaladas = obtenerFuentesInstaladas(rutaCacheFuentes());
    const locales = nombresDeArchivosFuente(listarArchivos(dir, EXTENSIONES_FUENTE));
    p.log.step(`${rutas.length === 1 ? "1 archivo encontrado" : `${rutas.length} archivos encontrados`}. Verificando...`);

    const faltantesResumen = new Map<string, string>();
    const archivosConFaltantes: string[] = [];
    const archivosConError: string[] = [];

    for (const ruta of rutas) {
        const nombre = basename(ruta);
        const ass = leerASS(readFileSync(ruta, "utf8"));
        if (ass === null) {
            p.log.error(`${nombre}: no se pudo leer el archivo.`);
            archivosConError.push(nombre);
            continue;
        }

        const disponibles = new Set([...instaladas, ...locales, ...fuentesIncrustadas(ass)]);
        const faltantes = fuentesFaltantes(fuentesUsadas(ass), disponibles);
        if (faltantes.length === 0) {
            p.log.success(nombre);
            continue;
        }

        p.log.error(`${nombre}: faltan ${faltantes.join(", ")}`);
        archivosConFaltantes.push(nombre);
        for (const fuente of faltantes) {
            faltantesResumen.set(fuente.toLowerCase(), fuente);
        }
    }

    if (faltantesResumen.size > 0) {
        p.note(
            `Fuentes faltantes:\n${[...faltantesResumen.values()].map((f) => `  > ${f}`).join("\n")}\n\n` +
            `En archivos:\n${archivosConFaltantes.map((a) => `  > ${a}`).join("\n")}`,
            "Resumen",
        );
    } else if (archivosConError.length === 0) {
        p.log.success("¡Todas las fuentes encontradas!");
    }

    return faltantesResumen.size > 0 || archivosConError.length > 0 ? 1 : 0;
}
