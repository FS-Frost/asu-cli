import { ASSFileToString, styleToString, type ASSFile, type Style } from "@fs-frost/asu";
import { basename, extname } from "node:path";
import { playResDe, resolucionATexto } from "./reescalar-ass.ts";

export type EntradaUnion = {
    /** Nombre del archivo sin extensión: se usa en avisos y como sufijo de estilos renombrados. */
    nombre: string;
    ass: ASSFile;
};

export type EstiloRenombrado = {
    archivo: string;
    original: string;
    nuevo: string;
};

export type ResultadoUnion = {
    ass: ASSFile;
    renombrados: EstiloRenombrado[];
    avisos: string[];
};

/** Palabras clave del orden de unión por defecto, de mayor a menor prioridad. */
export const PALABRAS_ORDEN_UNION: readonly string[] = ["carteles", "karaoke", "subs"];

function grupoOrdenUnion(ruta: string): number {
    const nombre = basename(ruta, extname(ruta)).toLowerCase();
    const indice = PALABRAS_ORDEN_UNION.findIndex((palabra) => nombre.includes(palabra));
    return indice === -1 ? PALABRAS_ORDEN_UNION.length : indice;
}

/**
 * Orden propuesto para unir: primero los que contienen "carteles", luego "karaoke", luego "subs"
 * (sin distinguir mayúsculas; si calza con varias, gana la de mayor prioridad) y al final el resto.
 * Alfabético dentro de cada grupo.
 */
export function ordenUnionPorDefecto(rutas: readonly string[]): string[] {
    return [...rutas].sort((a, b) =>
        grupoOrdenUnion(a) - grupoOrdenUnion(b)
        || basename(a).localeCompare(basename(b), "es", { numeric: true, sensitivity: "base" }),
    );
}

/** Quita la referencia a extradata de Aegisub (`{=1=2}`) al inicio del texto de una línea. */
export function quitarReferenciaExtradata(contenido: string): string {
    return contenido.replace(/^\{=\d+(?:=\d+)*\}/, "");
}

/** Cambia los `\r<Estilo>` de los bloques `{...}` según `renombres` (original → nuevo). */
export function renombrarResets(contenido: string, renombres: ReadonlyMap<string, string>): string {
    if (renombres.size === 0) {
        return contenido;
    }

    return contenido.replace(/\{[^}]*\}/g, (bloque) =>
        bloque.replace(/\\r([^\\}]*)/g, (tag, estilo: string) => {
            const nuevo = renombres.get(estilo);
            return nuevo === undefined ? tag : `\\r${nuevo}`;
        }),
    );
}

function playRes(ass: ASSFile): string {
    return resolucionATexto(playResDe(ass));
}

function nombreLibre(base: string, ocupados: ReadonlySet<string>): string {
    let nombre = base;
    for (let i = 2; ocupados.has(nombre); i++) {
        nombre = `${base} ${i}`;
    }

    return nombre;
}

/**
 * Une varios .ass en uno, en el orden dado:
 * - Cabecera ([Script Info], [Aegisub Project Garbage]) del primero; aviso si el PlayRes de otro difiere.
 * - Estilos: los homónimos idénticos se dejan una vez; los distintos se renombran "Nombre (archivo)"
 *   junto con las líneas y `\r` que los usan.
 * - Líneas por bloques de archivo, conservando su orden interno.
 * - Fuentes y gráficos adjuntos sin repetir por nombre. Extradata se descarta.
 */
export function unirASS(entradas: readonly EntradaUnion[]): ResultadoUnion {
    const [primera] = entradas;
    if (!primera) {
        throw new Error("No hay archivos para unir.");
    }

    const resultado: ASSFile = {
        scriptInfo: {
            comments: [...primera.ass.scriptInfo.comments],
            properties: new Map(primera.ass.scriptInfo.properties),
        },
        aegisubProjectGarbage: {
            comments: [...primera.ass.aegisubProjectGarbage.comments],
            properties: new Map(primera.ass.aegisubProjectGarbage.properties),
        },
        styles: { format: primera.ass.styles.format, styles: [] },
        fonts: { files: [] },
        graphics: { files: [] },
        events: { format: primera.ass.events.format, lines: [] },
        extraData: { data: [] },
    };

    const estilos = new Map<string, Style>();
    const renombrados: EstiloRenombrado[] = [];
    const avisos: string[] = [];
    const playResBase = playRes(primera.ass);

    for (const { nombre, ass } of entradas) {
        if (playRes(ass) !== playResBase) {
            avisos.push(
                `"${nombre}" tiene PlayRes ${playRes(ass)}, distinto de ${playResBase} ("${primera.nombre}"): sus posiciones y tamaños pueden verse mal.`,
            );
        }

        const renombres = new Map<string, string>();
        for (const estilo of ass.styles.styles) {
            const existente = estilos.get(estilo.name);
            if (!existente) {
                estilos.set(estilo.name, estilo);
                continue;
            }

            if (renombres.has(estilo.name) || styleToString(existente) === styleToString(estilo)) {
                continue;
            }

            // La coma separa campos en "Style:", no puede ir en el nombre.
            const nuevo = nombreLibre(`${estilo.name} (${nombre.replaceAll(",", " ")})`, new Set(estilos.keys()));
            estilos.set(nuevo, { ...estilo, name: nuevo });
            renombres.set(estilo.name, nuevo);
            renombrados.push({ archivo: nombre, original: estilo.name, nuevo });
        }

        for (const linea of ass.events.lines) {
            resultado.events.lines.push({
                ...linea,
                start: { ...linea.start },
                end: { ...linea.end },
                style: renombres.get(linea.style) ?? linea.style,
                content: renombrarResets(quitarReferenciaExtradata(linea.content), renombres),
            });
        }

        for (const fuente of ass.fonts.files) {
            if (!resultado.fonts.files.some((x) => x.name === fuente.name)) {
                resultado.fonts.files.push({ name: fuente.name, data: [...fuente.data] });
            }
        }

        for (const grafico of ass.graphics.files) {
            if (!resultado.graphics.files.some((x) => x.name === grafico.name)) {
                resultado.graphics.files.push({ name: grafico.name, data: [...grafico.data] });
            }
        }
    }

    resultado.styles.styles = [...estilos.values()];
    return { ass: resultado, renombrados, avisos };
}

/** Texto del .ass como lo guarda Aegisub: UTF-8 con BOM (el BOM va acá) y CRLF. */
export function assATexto(ass: ASSFile): string {
    return `﻿${ASSFileToString(ass).replace(/\r?\n/g, "\r\n")}`;
}
