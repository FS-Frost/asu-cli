import * as p from "@clack/prompts";
import { basename } from "node:path";
import { EXTENSIONES_ASS, listarArchivos } from "../nucleo/archivos.ts";
import { generarAvsCompresion } from "../nucleo/avs.ts";
import { buscarPreajuste, cargarConfig, type Preajuste } from "../nucleo/config.ts";
import { nombreAvs } from "../nucleo/nombres.ts";
import { ErrorUsuario, elegir, elegirVarios, esInteractivo } from "../ui.ts";
import {
    codificarAvs,
    elegirVideo,
    escribirAvs,
    ordenarArchivos,
    resolverArchivosAss,
    resolverDestino,
    resolverDirectorio,
    resolverSerieEpisodio,
    type OpcionesDestino,
    type OpcionesSerieEpisodio,
} from "./comun.ts";

export type OpcionesAvsCompresion = OpcionesDestino & OpcionesSerieEpisodio & {
    dir?: string;
    video?: string;
    preajuste?: string;
    /** Subtítulos en el orden de los `textsub`. Sin indicar: se eligen interactivamente o se usan todos. */
    subs?: string[];
};

function describirPreajuste(preajuste: Preajuste): string {
    return `${preajuste.ancho}x${preajuste.alto} → "<serie> <ep> ${preajuste.etiqueta}.avs"`;
}

async function elegirPreajuste(nombre: string | undefined): Promise<Preajuste> {
    const { preajustes } = cargarConfig();
    if (preajustes.length === 0) {
        throw new ErrorUsuario('No hay preajustes. Agrega uno con "asu config preajustes agregar".');
    }

    if (nombre !== undefined) {
        const preajuste = buscarPreajuste({ preajustes }, nombre);
        if (!preajuste) {
            throw new ErrorUsuario(`No existe el preajuste "${nombre}". Disponibles: ${preajustes.map((x) => x.nombre).join(", ")}`);
        }

        return preajuste;
    }

    if (!esInteractivo()) {
        throw new ErrorUsuario(`Indica el preajuste con --preajuste. Disponibles: ${preajustes.map((x) => x.nombre).join(", ")}`);
    }

    return elegir(
        "Elige la resolución (spline64Resize)",
        preajustes.map((preajuste) => ({ value: preajuste, label: preajuste.nombre, hint: describirPreajuste(preajuste) })),
    );
}

/** Subtítulos indicados, o elegidos y ordenados en el menú; sin terminal, todos en orden alfabético. */
export async function elegirSubtitulos(dir: string, subs: string[] | undefined): Promise<string[]> {
    if (subs !== undefined) {
        return resolverArchivosAss(dir, subs);
    }

    const disponibles = listarArchivos(dir, EXTENSIONES_ASS);
    if (disponibles.length === 0 || !esInteractivo()) {
        return disponibles;
    }

    const elegidos = await elegirVarios(
        "Subtítulos a incluir",
        disponibles.map((ruta) => ({ value: ruta, label: basename(ruta) })),
        disponibles,
    );

    // multiselect devuelve en el orden de la lista, no en el de selección.
    return ordenarArchivos(disponibles.filter((ruta) => elegidos.includes(ruta)), "Orden de los textsub");
}

/** Crea el AVS de compresión del preajuste elegido. Devuelve el código de salida. */
export async function crearAvsCompresion(opciones: OpcionesAvsCompresion): Promise<number> {
    const dir = resolverDirectorio(opciones.dir);
    p.log.info(`Directorio: ${dir}`);

    const video = await elegirVideo(dir, opciones.video);
    p.log.info(`Video: ${basename(video)}`);

    const serieEpisodio = await resolverSerieEpisodio(dir, video, opciones);
    const preajuste = await elegirPreajuste(opciones.preajuste);
    p.log.info(`Preajuste: ${preajuste.nombre} (${describirPreajuste(preajuste)})`);

    const subtitulos = await elegirSubtitulos(dir, opciones.subs);
    if (subtitulos.length === 0) {
        p.log.warn("Sin subtítulos: el AVS no tendrá textsub.");
    } else {
        p.log.info(`Subtítulos:\n${subtitulos.map((ruta, i) => `  ${i + 1}. ${basename(ruta)}`).join("\n")}`);
    }

    const bytes = codificarAvs(generarAvsCompresion(video, preajuste.ancho, preajuste.alto, subtitulos));
    const destino = await resolverDestino(dir, nombreAvs(serieEpisodio, preajuste.etiqueta), opciones);
    if (destino === null) {
        p.log.warn("No se creó el archivo.");
        return 1;
    }

    escribirAvs(destino, bytes);
    return 0;
}
