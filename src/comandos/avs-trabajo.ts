import * as p from "@clack/prompts";
import { basename } from "node:path";
import { NOMBRE_AVS_TRABAJO, generarAvsTrabajo } from "../nucleo/avs.ts";
import { codificarAvs, elegirVideo, escribirAvs, resolverDestino, resolverDirectorio, type OpcionesDestino } from "./comun.ts";

export type OpcionesAvsTrabajo = OpcionesDestino & {
    dir?: string;
    video?: string;
};

/** Crea RAW.avs (o el nombre indicado) para el video del directorio. Devuelve el código de salida. */
export async function crearAvsTrabajo(opciones: OpcionesAvsTrabajo): Promise<number> {
    const dir = resolverDirectorio(opciones.dir);
    p.log.info(`Directorio: ${dir}`);

    const video = await elegirVideo(dir, opciones.video);
    p.log.info(`Video: ${basename(video)}`);

    const bytes = codificarAvs(generarAvsTrabajo(video));
    const destino = await resolverDestino(dir, NOMBRE_AVS_TRABAJO, opciones);
    if (destino === null) {
        p.log.warn("No se creó el archivo.");
        return 1;
    }

    escribirAvs(destino, bytes);
    return 0;
}
