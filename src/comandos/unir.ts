import * as p from "@clack/prompts";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { EXTENSIONES_ASS, listarArchivos, validarNombreArchivo } from "../nucleo/archivos.ts";
import type { ASSFile } from "@fs-frost/asu";
import { leerASS } from "../nucleo/fuentes-ass.ts";
import { mismaResolucion, playResDe, reescalarASS, resolucionATexto } from "../nucleo/reescalar-ass.ts";
import { assATexto, ordenUnionPorDefecto, unirASS } from "../nucleo/unir-ass.ts";
import { ErrorUsuario, confirmar, elegirVarios, esInteractivo, preguntarTexto } from "../ui.ts";
import { ordenarArchivos, resolverArchivosAss, resolverDestino, resolverDirectorio, type OpcionesDestino } from "./comun.ts";
import { elegirModo, parsearModo } from "./reescalar.ts";

export const NOMBRE_UNIDO_POR_DEFECTO = "Unificado";

export type OpcionesUnir = OpcionesDestino & {
    dir?: string;
    /** Archivos a unir, en orden. Sin indicar: se eligen interactivamente. */
    subs?: string[];
    /** Reescala sin preguntar los que tengan otro PlayRes que el primero. */
    reescalar?: boolean;
    modo?: string;
};

async function elegirArchivos(dir: string, subs: string[] | undefined): Promise<string[]> {
    if (subs !== undefined) {
        return resolverArchivosAss(dir, subs);
    }

    if (!esInteractivo()) {
        throw new ErrorUsuario("Indica los archivos a unir con -s, en orden (mínimo 2).");
    }

    const disponibles = listarArchivos(dir, EXTENSIONES_ASS);
    if (disponibles.length < 2) {
        throw new ErrorUsuario(`Se necesitan al menos 2 archivos .ass en el directorio (hay ${disponibles.length}).`);
    }

    let elegidos: string[] = [];
    while (elegidos.length < 2) {
        elegidos = await elegirVarios(
            "Archivos a unir (espacio para marcar)",
            disponibles.map((ruta) => ({ value: ruta, label: basename(ruta) })),
            [],
        );

        if (elegidos.length < 2) {
            p.log.warn("Elige al menos 2 archivos.");
        }
    }

    return ordenarArchivos(ordenUnionPorDefecto(disponibles.filter((ruta) => elegidos.includes(ruta))), "Orden de unión");
}

type Entrada = {
    nombre: string;
    ruta: string;
    ass: ASSFile;
};

/**
 * Reescala en memoria (los originales no se tocan) las entradas cuyo PlayRes difiere del primero:
 * en el menú se confirma por archivo; por argumentos, solo con --reescalar.
 * Devuelve las rutas que quedaron con otro PlayRes.
 */
async function reescalarAlPrimero(entradas: Entrada[], opciones: OpcionesUnir): Promise<string[]> {
    const modo = parsearModo(opciones.modo);
    const destino = playResDe(entradas[0]!.ass);
    const sinReescalar: string[] = [];

    for (const entrada of entradas.slice(1)) {
        const origen = playResDe(entrada.ass);
        if (mismaResolucion(origen, destino)) {
            continue;
        }

        const reescalar = opciones.reescalar
            || (esInteractivo() && await confirmar(
                `"${entrada.nombre}" es ${resolucionATexto(origen)} y "${entradas[0]!.nombre}" es ${resolucionATexto(destino)}. ¿Reescalarlo antes de unir? (el original no se modifica)`,
            ));

        if (!reescalar) {
            sinReescalar.push(entrada.ruta);
            continue;
        }

        const modoArchivo = await elegirModo(origen, destino, modo, entrada.nombre);
        entrada.ass = reescalarASS(entrada.ass, destino, modoArchivo).ass;
        p.log.info(`"${entrada.nombre}" reescalado ${resolucionATexto(origen)} → ${resolucionATexto(destino)} (${modoArchivo}).`);
    }

    return sinReescalar;
}

/** Une varios .ass del directorio en uno. Devuelve el código de salida. */
export async function unirArchivos(opciones: OpcionesUnir): Promise<number> {
    const dir = resolverDirectorio(opciones.dir);
    p.log.info(`Directorio: ${dir}`);

    const rutas = await elegirArchivos(dir, opciones.subs);
    if (rutas.length < 2) {
        throw new ErrorUsuario("Se necesitan al menos 2 archivos para unir.");
    }

    p.log.info(`Orden:\n${rutas.map((ruta, i) => `  ${i + 1}. ${basename(ruta)}`).join("\n")}`);

    const entradas = rutas.map((ruta) => {
        const ass = leerASS(readFileSync(ruta, "utf8"));
        if (ass === null) {
            throw new ErrorUsuario(`No se pudo leer ${basename(ruta)}; no se unió nada.`);
        }

        return { nombre: basename(ruta, extname(ruta)), ruta, ass };
    });

    const sinReescalar = await reescalarAlPrimero(entradas, opciones);

    const { ass, renombrados, avisos } = unirASS(entradas);
    for (const { archivo, original, nuevo } of renombrados) {
        p.log.warn(`Estilo "${original}" de "${archivo}" choca con otro distinto: renombrado a "${nuevo}".`);
    }
    for (const aviso of avisos) {
        p.log.warn(aviso);
    }

    if (sinReescalar.length > 0) {
        const destino = resolucionATexto(playResDe(entradas[0]!.ass));
        const archivos = sinReescalar.map((ruta) => `-s "${basename(ruta)}"`).join(" ");
        p.note(
            `Une con --reescalar para ajustarlos al PlayRes de "${entradas[0]!.nombre}" (${destino}),\n` +
            `o crea copias reescaladas con:\n  asu reescalar "${dir}" ${archivos} -r ${destino}`,
            "Sugerencia",
        );
    }

    let salida = opciones.salida;
    if (salida === undefined && esInteractivo()) {
        salida = await preguntarTexto("Nombre del archivo unido", { inicial: NOMBRE_UNIDO_POR_DEFECTO, validar: validarNombreArchivo });
    }

    const destino = await resolverDestino(dir, NOMBRE_UNIDO_POR_DEFECTO, { ...opciones, salida }, ".ass");
    if (destino === null) {
        p.log.warn("No se creó el archivo.");
        return 1;
    }

    writeFileSync(destino, assATexto(ass), "utf8");
    p.log.success(`Archivo unido: ${destino} (${ass.events.lines.length} líneas, ${ass.styles.styles.length} estilos)`);
    return 0;
}
