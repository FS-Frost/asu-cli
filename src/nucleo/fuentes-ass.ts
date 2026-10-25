import {
    LINE_TYPE_DIALOGUE,
    TagName,
    parseASSFile,
    parseContent,
    type ASSFile,
    type Tags,
} from "@fs-frost/asu";

/** Parsea el texto de un .ass. La librería no quita el BOM, así que se quita acá. */
export function leerASS(texto: string): ASSFile | null {
    return parseASSFile(texto.replace(/^﻿/, ""));
}

/** Clave de comparación de nombres de fuente: sin "@" inicial (fuente vertical) y sin distinguir mayúsculas. */
export function normalizarNombreFuente(nombre: string): string {
    return nombre.trim().replace(/^@/, "").toLowerCase();
}

/**
 * Fuentes usadas por las líneas Dialogue: las de los estilos usados (directo o vía `\r<Estilo>`)
 * y todos los `\fn` de cada línea. Sin repetir; conserva el nombre tal como aparece primero.
 */
export function fuentesUsadas(ass: ASSFile): string[] {
    const estilosUsados = new Set<string>();
    const fuentes = new Map<string, string>();

    const agregarFuente = (nombre: string) => {
        const clave = normalizarNombreFuente(nombre);
        if (clave.length > 0 && !fuentes.has(clave)) {
            fuentes.set(clave, nombre.trim());
        }
    };

    const recorrerTags = (tags: readonly Tags[]) => {
        for (const tag of tags) {
            if (tag.name === TagName.fn) {
                agregarFuente(tag.font);
            } else if (tag.name === TagName.r) {
                if (tag.style.length > 0) {
                    estilosUsados.add(tag.style);
                }
            } else if (tag.name === TagName.t) {
                recorrerTags(tag.tags);
            }
        }
    };

    for (const linea of ass.events.lines) {
        if (linea.type !== LINE_TYPE_DIALOGUE) {
            continue;
        }

        estilosUsados.add(linea.style);
        for (const item of parseContent(linea.content)) {
            if (item.name === "effect") {
                recorrerTags(item.tags);
            }
        }
    }

    for (const estilo of ass.styles.styles) {
        if (estilosUsados.has(estilo.name)) {
            agregarFuente(estilo.fontName);
        }
    }

    return [...fuentes.values()];
}

/** Fuentes de `usadas` que no están en `disponibles` (claves normalizadas). */
export function fuentesFaltantes(usadas: readonly string[], disponibles: ReadonlySet<string>): string[] {
    return usadas.filter((nombre) => !disponibles.has(normalizarNombreFuente(nombre)));
}
