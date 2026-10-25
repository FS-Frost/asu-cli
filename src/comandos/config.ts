import * as p from "@clack/prompts";
import { validarNombreArchivo } from "../nucleo/archivos.ts";
import {
    agregarPreajuste,
    cargarConfig,
    configDeFabrica,
    guardarConfig,
    parsearResolucion,
    quitarPreajuste,
    rutaConfig,
} from "../nucleo/config.ts";
import { ErrorUsuario } from "../ui.ts";

export function listarPreajustes(): number {
    const { preajustes } = cargarConfig();
    if (preajustes.length === 0) {
        p.log.warn("No hay preajustes.");
        return 0;
    }

    p.note(
        preajustes.map((x) => `${x.nombre.padEnd(10)} ${`${x.ancho}x${x.alto}`.padEnd(10)} → ${x.archivo}.avs`).join("\n"),
        "Preajustes",
    );
    return 0;
}

/** Agrega un preajuste. `archivo` por defecto es el nombre del preajuste. */
export function agregarPreajusteComando(nombre: string, resolucion: string, archivo: string | undefined): number {
    const dimensiones = parsearResolucion(resolucion);
    if (!dimensiones) {
        throw new ErrorUsuario(`Resolución inválida: "${resolucion}". Formato: <ancho>x<alto>, por ejemplo 1280x720.`);
    }

    const nombreArchivo = (archivo ?? nombre).replace(/\.avs$/i, "");
    const errorArchivo = validarNombreArchivo(nombreArchivo);
    if (errorArchivo) {
        throw new ErrorUsuario(`--archivo: ${errorArchivo}`);
    }

    try {
        guardarConfig(agregarPreajuste(cargarConfig(), { nombre, ...dimensiones, archivo: nombreArchivo }));
    } catch (error) {
        throw new ErrorUsuario((error as Error).message);
    }

    p.log.success(`Preajuste "${nombre}" agregado.`);
    return 0;
}

export function quitarPreajusteComando(nombre: string): number {
    try {
        guardarConfig(quitarPreajuste(cargarConfig(), nombre));
    } catch (error) {
        throw new ErrorUsuario((error as Error).message);
    }

    p.log.success(`Preajuste "${nombre}" quitado.`);
    return 0;
}

export function restablecerConfig(): number {
    guardarConfig(configDeFabrica());
    p.log.success("Preajustes restablecidos a los de fábrica.");
    return 0;
}

export function mostrarRutaConfig(): number {
    console.log(rutaConfig());
    return 0;
}
