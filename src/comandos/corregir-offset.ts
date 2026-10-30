import * as p from "@clack/prompts";
import { rmSync } from "node:fs";
import { basename } from "node:path";
import {
    argumentosMkvmerge,
    desplazamientoMs,
    nombreCorregido,
    parsearInicioVideo,
    parsearPistasVideo,
} from "../nucleo/offset.ts";
import { ErrorUsuario } from "../ui.ts";
import { elegirVideo, resolverDestino, resolverDirectorio, type OpcionesDestino } from "./comun.ts";

export type OpcionesCorregirOffset = OpcionesDestino & {
    dir?: string;
    video?: string;
};

function ejecutable(nombre: string, paquete: string): string {
    const ruta = Bun.which(nombre);
    if (!ruta) {
        throw new ErrorUsuario(`No se encontró ${nombre} en el PATH (viene con ${paquete}).`);
    }

    return ruta;
}

async function correr(comando: string[]): Promise<{ codigo: number; salida: string }> {
    const proceso = Bun.spawn(comando, { stdout: "pipe", stderr: "pipe" });
    const [salida, error] = await Promise.all([new Response(proceso.stdout).text(), new Response(proceso.stderr).text()]);
    return { codigo: await proceso.exited, salida: salida + error };
}

/**
 * Remuxea el video a "<nombre> [fixed].mkv" desplazando solo la pista de video para que su
 * primer frame quede en 0 (como lo muestra Aegisub). Devuelve el código de salida.
 */
export async function corregirOffset(opciones: OpcionesCorregirOffset): Promise<number> {
    const dir = resolverDirectorio(opciones.dir);
    p.log.info(`Directorio: ${dir}`);

    const video = await elegirVideo(dir, opciones.video);
    p.log.info(`Video: ${basename(video)}`);

    const ffprobe = ejecutable("ffprobe", "FFmpeg");
    const mkvmerge = ejecutable("mkvmerge", "MKVToolNix");

    const sonda = await correr([ffprobe, "-v", "error", "-select_streams", "V", "-show_entries", "stream=start_time", "-of", "json", video]);
    if (sonda.codigo !== 0) {
        throw new ErrorUsuario(`ffprobe no pudo leer el video:\n${sonda.salida.trim()}`);
    }

    const inicio = parsearInicioVideo(sonda.salida);
    if (inicio === undefined) {
        throw new ErrorUsuario("ffprobe no informó el inicio de la pista de video.");
    }

    const ms = desplazamientoMs(inicio);
    if (ms === 0) {
        p.log.success(`El video no tiene offset (empieza en ${inicio} s). No se creó ningún archivo.`);
        return 0;
    }

    const identificacion = await correr([mkvmerge, "--identify", video]);
    const pistas = parsearPistasVideo(identificacion.salida);
    if (identificacion.codigo !== 0 || pistas.length === 0) {
        throw new ErrorUsuario(`mkvmerge no pudo identificar la pista de video:\n${identificacion.salida.trim()}`);
    }

    if (pistas.length > 1) {
        throw new ErrorUsuario(`El archivo tiene ${pistas.length} pistas de video; solo se soporta una.`);
    }

    p.log.info(`Offset del video: ${inicio} s → desplazamiento ${ms} ms (pista ${pistas[0]}).`);

    const destino = await resolverDestino(dir, nombreCorregido(video), opciones, ".mkv");
    if (destino === null) {
        p.log.warn("No se creó el archivo.");
        return 1;
    }

    if (destino.toLowerCase() === video.toLowerCase()) {
        throw new ErrorUsuario("El archivo de salida no puede ser el mismo video.");
    }

    p.log.step("Remuxeando con mkvmerge...");
    const remux = await correr([mkvmerge, ...argumentosMkvmerge(video, destino, pistas[0]!, ms)]);

    // mkvmerge: 0 = bien, 1 = terminó con advertencias, 2 = error.
    if (remux.codigo >= 2) {
        rmSync(destino, { force: true });
        throw new ErrorUsuario(`mkvmerge falló:\n${remux.salida.trim()}`);
    }

    if (remux.codigo === 1) {
        p.log.warn(`mkvmerge terminó con advertencias:\n${remux.salida.trim()}`);
    }

    p.log.success(`Archivo creado: ${destino}`);
    return 0;
}
