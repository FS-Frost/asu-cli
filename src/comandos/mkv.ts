import * as p from "@clack/prompts";
import { existsSync } from "node:fs";
import { basename } from "node:path";
import { ejecutorReal, type Ejecutor } from "../ejecutor.ts";
import { ultimasLineas } from "../nucleo/avance.ts";
import { EXTENSIONES_MATROSKA } from "../nucleo/archivos.ts";
import {
    argumentosIdentificar,
    comandoMkvextract,
    describirAdjunto,
    describirPista,
    parsearIdentificacionJson,
    parsearIdentificacionTexto,
    parsearVersionMkvmerge,
    planificarExtraccion,
    usaJson,
    type ContenidoMkv,
    type Extraccion,
} from "../nucleo/mkv.ts";
import { ErrorUsuario, elegir, esInteractivo, marcarLista } from "../ui.ts";
import { contextoDeConfig, exigirHerramientas } from "../herramientas.ts";
import { cargarConfig } from "../nucleo/config.ts";
import { elegirVideo, resolverDirectorio } from "./comun.ts";

export type OpcionesMkv = {
    dir?: string;
    video?: string;
    /** IDs de pista (los de `--listar`). */
    pistas?: string[];
    /** Todos los adjuntos. */
    adjuntos?: boolean;
    listar?: boolean;
    forzar?: boolean;
};

export type DependenciasMkv = {
    ejecutor?: Ejecutor;
    /** Rutas de mkvmerge y mkvextract (por defecto, las del PATH). */
    herramientas?: { mkvmerge: string; mkvextract: string };
};

/** Lo que tiene el MKV, identificado con `-J` (MKVToolNix ≥ 9.6) o `--identify-verbose` (7.x). */
async function identificar(ejecutor: Ejecutor, mkvmerge: string, mkv: string): Promise<ContenidoMkv> {
    const version = await ejecutor.ejecutar([{ exe: mkvmerge, args: ["--version"] }], { capturar: true });
    const json = usaJson(parsearVersionMkvmerge(`${version.stdout ?? ""}${version.stderr}`));
    const { codigo, stdout, stderr } = await ejecutor.ejecutar([{ exe: mkvmerge, args: argumentosIdentificar(mkv, json) }], { capturar: true });
    if (codigo !== 0) {
        throw new ErrorUsuario(`mkvmerge no pudo leer ${basename(mkv)}:\n${ultimasLineas(`${stdout ?? ""}\n${stderr}`)}`);
    }
    return json ? parsearIdentificacionJson(stdout ?? "") : parsearIdentificacionTexto(stdout ?? "");
}

function listado(contenido: ContenidoMkv): string {
    return [
        ...contenido.pistas.map(describirPista),
        ...contenido.adjuntos.map(describirAdjunto),
    ].join("\n") || "(sin pistas ni adjuntos)";
}

/** IDs elegidos: por argumentos (validados) o en la lista (nada marcado). `null` = no eligió nada. */
async function elegirElementos(contenido: ContenidoMkv, opciones: OpcionesMkv): Promise<{ pistas: number[]; adjuntos: number[] } | null> {
    if (opciones.pistas !== undefined || opciones.adjuntos) {
        const pistas = (opciones.pistas ?? []).map((texto) => {
            const id = Number(texto);
            if (!/^\d+$/.test(texto.trim()) || !contenido.pistas.some((pista) => pista.id === id)) {
                throw new ErrorUsuario(`--pista ${texto}: no existe en el MKV. Pistas:\n${listado(contenido)}`);
            }
            return id;
        });
        if (opciones.adjuntos && contenido.adjuntos.length === 0) {
            p.log.warn("El MKV no tiene adjuntos.");
        }
        return { pistas, adjuntos: opciones.adjuntos ? contenido.adjuntos.map((adjunto) => adjunto.id) : [] };
    }

    if (!esInteractivo()) {
        throw new ErrorUsuario(`Indica qué extraer con --pista <id> (repetible) o --adjuntos. Contenido:\n${listado(contenido)}`);
    }

    const elegidos = await marcarLista(
        "Elementos a extraer (se guardan junto al MKV)",
        [
            ...contenido.pistas.map((pista) => ({ value: `p${pista.id}`, label: describirPista(pista), hint: pista.codecId })),
            ...contenido.adjuntos.map((adjunto) => ({ value: `a${adjunto.id}`, label: describirAdjunto(adjunto), hint: adjunto.tipoMime })),
        ],
        [],
    );
    if (elegidos.length === 0) {
        return null;
    }
    const ids = (prefijo: string) => elegidos.filter((v) => v.startsWith(prefijo)).map((v) => Number(v.slice(1)));
    return { pistas: ids("p"), adjuntos: ids("a") };
}

/**
 * Destinos que ya existen: con `forzar` se sobrescriben; con terminal se pregunta una vez para todos
 * (sobrescribir / saltar esos / cancelar); sin terminal es un error. `null` = cancelado.
 */
async function resolverExistentes(extracciones: Extraccion[], forzar: boolean): Promise<Extraccion[] | null> {
    const existentes = extracciones.filter((e) => existsSync(e.destino));
    if (existentes.length === 0 || forzar) {
        return extracciones;
    }

    const lista = existentes.map((e) => `  ${basename(e.destino)}`).join("\n");
    if (!esInteractivo()) {
        throw new ErrorUsuario(`Ya existen:\n${lista}\nUsa --forzar para sobrescribirlos.`);
    }

    p.log.warn(`Ya existen:\n${lista}`);
    const accion = await elegir(`${existentes.length === 1 ? "Ese archivo ya existe" : `Esos ${existentes.length} archivos ya existen`}. ¿Qué hago?`, [
        { value: "sobrescribir", label: "Sobrescribirlos" },
        { value: "saltar", label: "Saltarlos", hint: "extraer solo lo demás" },
        { value: "cancelar", label: "Cancelar" },
    ]);
    if (accion === "cancelar") {
        return null;
    }
    return accion === "saltar" ? extracciones.filter((e) => !existentes.includes(e)) : extracciones;
}

async function extraer(ejecutor: Ejecutor, mkvextract: string, modo: "tracks" | "attachments", mkv: string, extracciones: Extraccion[]): Promise<void> {
    if (extracciones.length === 0) {
        return;
    }
    const spinner = esInteractivo() ? p.spinner() : null;
    spinner?.start(modo === "tracks" ? `Extrayendo ${extracciones.length === 1 ? "1 pista" : `${extracciones.length} pistas`}...` : "Extrayendo adjuntos...");
    const { codigo, stdout, stderr } = await ejecutor.ejecutar([comandoMkvextract(mkvextract, modo, mkv, extracciones)], { capturar: true });
    spinner?.clear();

    // mkvextract: 0 = bien, 1 = terminó con advertencias, 2 = error.
    const salida = ultimasLineas(`${stdout ?? ""}\n${stderr}`.replace(/^Progress: \d+%\s*$/gm, ""));
    if (codigo >= 2) {
        throw new ErrorUsuario(`mkvextract falló:\n${salida}`);
    }
    if (codigo === 1) {
        p.log.warn(`mkvextract terminó con advertencias:\n${salida}`);
    }
}

/** `asu mkv [dir]`: extrae pistas y adjuntos de un MKV de la carpeta, junto al MKV. */
export async function extraerMkv(opciones: OpcionesMkv, dependencias: DependenciasMkv = {}): Promise<number> {
    const ejecutor = dependencias.ejecutor ?? ejecutorReal;
    const dir = resolverDirectorio(opciones.dir);
    // Antes de elegir nada: si falta MKVToolNix, no tiene sentido preguntar.
    const { mkvmerge, mkvextract } = dependencias.herramientas ?? exigirHerramientas(["mkvmerge", "mkvextract"], contextoDeConfig(cargarConfig()), "asu mkv");
    const mkv = await elegirVideo(dir, opciones.video, EXTENSIONES_MATROSKA);
    p.log.info(`MKV: ${basename(mkv)}`);
    const contenido = await identificar(ejecutor, mkvmerge, mkv);

    if (opciones.listar) {
        p.note(listado(contenido), basename(mkv));
        return 0;
    }
    if (contenido.pistas.length === 0 && contenido.adjuntos.length === 0) {
        p.log.warn("El MKV no tiene pistas ni adjuntos que extraer.");
        return 1;
    }

    const elegidos = await elegirElementos(contenido, opciones);
    if (!elegidos || elegidos.pistas.length + elegidos.adjuntos.length === 0) {
        p.log.warn("No elegiste nada para extraer.");
        return 1;
    }

    const { extracciones, saltadas } = planificarExtraccion(mkv, contenido, elegidos.pistas, elegidos.adjuntos);
    for (const pista of saltadas) {
        p.log.warn(`Pista ${describirPista(pista)}: codec ${pista.codecId || "desconocido"} no soportado; se salta.`);
    }

    const finales = await resolverExistentes(extracciones, opciones.forzar ?? false);
    if (finales === null) {
        p.log.warn("Extracción cancelada.");
        return 1;
    }
    if (finales.length === 0) {
        p.log.warn("No quedó nada para extraer.");
        return saltadas.length > 0 ? 1 : 0;
    }

    await extraer(ejecutor, mkvextract, "tracks", mkv, finales.filter((e) => e.tipo === "pista"));
    await extraer(ejecutor, mkvextract, "attachments", mkv, finales.filter((e) => e.tipo === "adjunto"));

    let faltantes = 0;
    for (const extraccion of finales) {
        if (existsSync(extraccion.destino)) {
            p.log.success(`${basename(extraccion.destino)}  (${extraccion.etiqueta})`);
        } else {
            p.log.error(`No se creó ${basename(extraccion.destino)} (${extraccion.etiqueta}).`);
            faltantes++;
        }
    }
    return faltantes > 0 || saltadas.length > 0 ? 1 : 0;
}
