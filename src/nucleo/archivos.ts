import { readdirSync } from "node:fs";
import { extname, join } from "node:path";

// Sin ".ts" (choca con TypeScript) ni ".m4a" (es solo audio).
export const EXTENSIONES_VIDEO: readonly string[] = [
    ".mkv", ".mp4", ".avi", ".wmv", ".flv", ".3gp", ".mov",
    ".m4v", ".mpg", ".rm", ".vob", ".ogm", ".m2ts",
];

export const EXTENSIONES_ASS: readonly string[] = [".ass"];

export const EXTENSIONES_FUENTE: readonly string[] = [".ttf", ".otf", ".ttc", ".otc"];

/** Rutas absolutas de los archivos de `dir` (no recursivo) cuya extensión está en `extensiones`, ordenadas por nombre. */
export function listarArchivos(dir: string, extensiones: readonly string[]): string[] {
    return readdirSync(dir, { withFileTypes: true })
        .filter((entrada) => entrada.isFile() && extensiones.includes(extname(entrada.name).toLowerCase()))
        .map((entrada) => join(dir, entrada.name))
        .sort((a, b) => a.localeCompare(b, "es", { numeric: true, sensitivity: "base" }));
}

const CARACTERES_INVALIDOS_NOMBRE = /[\\/:*?"<>|]/;

/** Valida un nombre de archivo de Windows (sin ruta). Devuelve el error o `undefined`. */
export function validarNombreArchivo(nombre: string): string | undefined {
    if (nombre.trim().length === 0) {
        return "El nombre no puede estar vacío.";
    }

    if (CARACTERES_INVALIDOS_NOMBRE.test(nombre)) {
        return 'El nombre no puede contener \\ / : * ? " < > |';
    }

    return undefined;
}

/** Agrega `extension` (ej. ".avs") si el nombre no la trae. */
export function conExtension(nombre: string, extension: string): string {
    const limpio = nombre.trim();
    return limpio.toLowerCase().endsWith(extension.toLowerCase()) ? limpio : `${limpio}${extension}`;
}
