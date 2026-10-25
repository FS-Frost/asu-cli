import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { EXTENSIONES_FUENTE, listarArchivos } from "./archivos.ts";
import { nombresDeFuente } from "./fuentes-archivo.ts";

const VERSION_CACHE = 1;

type EntradaCache = {
    tamano: number;
    modificado: number;
    nombres: string[];
};

type CacheFuentes = {
    version: number;
    archivos: Record<string, EntradaCache>;
};

/** Directorios de fuentes instaladas de Windows: del sistema y del usuario. */
export function directoriosFuentesSistema(): string[] {
    // Solo para tests: reemplaza los directorios del sistema (separados por ";").
    const reemplazo = process.env.ASU_CLI_DIRECTORIOS_FUENTES;
    if (reemplazo !== undefined) {
        return reemplazo.split(";").filter((dir) => dir.length > 0);
    }

    const directorios = [join(process.env.WINDIR ?? "C:\\Windows", "Fonts")];
    if (process.env.LOCALAPPDATA) {
        directorios.push(join(process.env.LOCALAPPDATA, "Microsoft", "Windows", "Fonts"));
    }

    return directorios;
}

function cargarCache(ruta: string): CacheFuentes {
    try {
        const cache = JSON.parse(readFileSync(ruta, "utf8")) as CacheFuentes;
        if (cache.version === VERSION_CACHE && typeof cache.archivos === "object") {
            return cache;
        }
    } catch {
        // Cache inexistente o corrupto: se reconstruye.
    }

    return { version: VERSION_CACHE, archivos: {} };
}

/** Nombres normalizados de las fuentes de los archivos indicados. Ignora los archivos que no son fuentes legibles. */
export function nombresDeArchivosFuente(rutas: readonly string[]): Set<string> {
    const nombres = new Set<string>();
    for (const ruta of rutas) {
        try {
            for (const nombre of nombresDeFuente(readFileSync(ruta))) {
                nombres.add(nombre);
            }
        } catch {
            // Archivo dañado o formato no soportado.
        }
    }

    return nombres;
}

/**
 * Nombres normalizados de todas las fuentes instaladas. Usa un cache por archivo
 * (tamaño + fecha de modificación) para no volver a parsear lo que no cambió.
 */
export function obtenerFuentesInstaladas(rutaCache: string, directorios = directoriosFuentesSistema()): Set<string> {
    const anterior = cargarCache(rutaCache);
    const nuevo: CacheFuentes = { version: VERSION_CACHE, archivos: {} };
    const nombres = new Set<string>();

    for (const directorio of directorios) {
        if (!existsSync(directorio)) {
            continue;
        }

        for (const ruta of listarArchivos(directorio, EXTENSIONES_FUENTE)) {
            const { size, mtimeMs } = statSync(ruta);
            let entrada = anterior.archivos[ruta];

            if (!entrada || entrada.tamano !== size || entrada.modificado !== mtimeMs) {
                entrada = { tamano: size, modificado: mtimeMs, nombres: [...nombresDeArchivosFuente([ruta])] };
            }

            nuevo.archivos[ruta] = entrada;
            for (const nombre of entrada.nombres) {
                nombres.add(nombre);
            }
        }
    }

    mkdirSync(dirname(rutaCache), { recursive: true });
    writeFileSync(rutaCache, JSON.stringify(nuevo));
    return nombres;
}
