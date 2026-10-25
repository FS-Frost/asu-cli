import * as p from "@clack/prompts";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { EXTENSIONES_ASS, listarArchivos } from "../nucleo/archivos.ts";
import { parsearResolucion } from "../nucleo/config.ts";
import { leerASS } from "../nucleo/fuentes-ass.ts";
import {
    MODOS_REESCALADO,
    mismaProporcion,
    mismaResolucion,
    playResDe,
    reescalarASS,
    resolucionATexto,
    type ModoReescalado,
    type Resolucion,
} from "../nucleo/reescalar-ass.ts";
import { assATexto } from "../nucleo/unir-ass.ts";
import { ErrorUsuario, elegir, elegirVarios, esInteractivo, preguntarTexto } from "../ui.ts";
import { resolverArchivosAss, resolverDestino, resolverDirectorio, type OpcionesDestino } from "./comun.ts";

export type OpcionesReescalar = OpcionesDestino & {
    dir?: string;
    subs?: string[];
    /** "<ancho>x<alto>". */
    resolucion?: string;
    modo?: string;
};

const RESOLUCIONES_SUGERIDAS = ["1920x1080", "1280x720"];

/** Valida `--modo`. `undefined` si no se indicó. */
export function parsearModo(modo: string | undefined): ModoReescalado | undefined {
    if (modo === undefined) {
        return undefined;
    }

    const normalizado = modo.trim().toLowerCase();
    if (!MODOS_REESCALADO.includes(normalizado as ModoReescalado)) {
        throw new ErrorUsuario(`Modo inválido: "${modo}". Usa: ${MODOS_REESCALADO.join(", ")}.`);
    }

    return normalizado as ModoReescalado;
}

/**
 * Modo para pasar de `origen` a `destino`. Con la misma proporción da igual (se usa "estirar").
 * Si difiere y no se indicó, en el menú se pregunta; sin terminal, "estirar".
 */
export async function elegirModo(origen: Resolucion, destino: Resolucion, modo: ModoReescalado | undefined, archivo: string): Promise<ModoReescalado> {
    if (modo !== undefined) {
        return modo;
    }

    if (mismaProporcion(origen, destino) || !esInteractivo()) {
        return "estirar";
    }

    return elegir<ModoReescalado>(`"${archivo}": la proporción cambia (${resolucionATexto(origen)} → ${resolucionATexto(destino)}). ¿Cómo reescalo?`, [
        { value: "estirar", label: "Estirar", hint: "conserva cómo se ve sobre el video (script 4:3 sobre video 16:9)" },
        { value: "bandas", label: "Bandas", hint: "escala parejo y centra (el video también tiene bandas)" },
    ]);
}

async function elegirResolucion(texto: string | undefined): Promise<Resolucion> {
    if (texto !== undefined) {
        const resolucion = parsearResolucion(texto);
        if (!resolucion) {
            throw new ErrorUsuario(`Resolución inválida: "${texto}". Formato: <ancho>x<alto>, por ejemplo 1920x1080.`);
        }

        return resolucion;
    }

    if (!esInteractivo()) {
        throw new ErrorUsuario("Indica la resolución destino con -r, por ejemplo -r 1920x1080.");
    }

    const elegida = await elegir("Resolución destino", [
        ...RESOLUCIONES_SUGERIDAS.map((valor) => ({ value: valor, label: valor })),
        { value: "otra", label: "Otra..." },
    ]);

    const valor = elegida === "otra"
        ? await preguntarTexto("Resolución (<ancho>x<alto>)", { validar: (v) => (parsearResolucion(v) ? undefined : "Formato: 1920x1080") })
        : elegida;
    return parsearResolucion(valor)!;
}

async function elegirArchivos(dir: string, subs: string[] | undefined): Promise<string[]> {
    if (subs !== undefined) {
        return resolverArchivosAss(dir, subs);
    }

    if (!esInteractivo()) {
        throw new ErrorUsuario("Indica los archivos a reescalar con -s.");
    }

    const disponibles = listarArchivos(dir, EXTENSIONES_ASS);
    if (disponibles.length === 0) {
        throw new ErrorUsuario("No hay archivos .ass en el directorio.");
    }

    let elegidos: string[] = [];
    while (elegidos.length === 0) {
        elegidos = await elegirVarios(
            "Archivos a reescalar (espacio para marcar)",
            disponibles.map((ruta) => ({ value: ruta, label: basename(ruta) })),
            [],
        );

        if (elegidos.length === 0) {
            p.log.warn("Elige al menos 1 archivo.");
        }
    }

    return elegidos;
}

/** Reescala cada .ass a la resolución indicada en un archivo nuevo. Devuelve el código de salida. */
export async function reescalarArchivos(opciones: OpcionesReescalar): Promise<number> {
    const dir = resolverDirectorio(opciones.dir);
    const modo = parsearModo(opciones.modo);
    p.log.info(`Directorio: ${dir}`);

    const rutas = await elegirArchivos(dir, opciones.subs);
    if (rutas.length === 0) {
        throw new ErrorUsuario("Indica al menos un archivo.");
    }

    if (opciones.salida !== undefined && rutas.length > 1) {
        throw new ErrorUsuario("-o/--salida solo se puede usar con un archivo.");
    }

    const destino = await elegirResolucion(opciones.resolucion);
    let errores = 0;

    for (const ruta of rutas) {
        const nombre = basename(ruta, extname(ruta));
        const ass = leerASS(readFileSync(ruta, "utf8"));
        if (ass === null) {
            p.log.error(`${basename(ruta)}: no se pudo leer el archivo.`);
            errores++;
            continue;
        }

        const origen = playResDe(ass);
        if (mismaResolucion(origen, destino)) {
            p.log.info(`${basename(ruta)}: ya es ${resolucionATexto(destino)}, se omite.`);
            continue;
        }

        const modoArchivo = await elegirModo(origen, destino, modo, basename(ruta));
        const resultado = reescalarASS(ass, destino, modoArchivo);
        const salida = await resolverDestino(dir, `${nombre} - ${resolucionATexto(destino)}`, opciones, ".ass");
        if (salida === null) {
            p.log.warn(`${basename(ruta)}: no se creó el archivo.`);
            continue;
        }

        writeFileSync(salida, assATexto(resultado.ass), "utf8");
        const detalleModo = mismaProporcion(origen, destino) ? "" : `, modo ${modoArchivo}`;
        p.log.success(`${basename(ruta)}: ${resolucionATexto(origen)} → ${resolucionATexto(destino)}${detalleModo} → ${basename(salida)}`);
    }

    return errores > 0 ? 1 : 0;
}
