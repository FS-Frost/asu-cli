import * as p from "@clack/prompts";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { validarNombreArchivo } from "../nucleo/archivos.ts";
import {
    activarSalida,
    agregarPreajuste,
    cargarConfig,
    configDeFabrica,
    guardarConfig,
    parsearParalelo,
    parsearResolucion,
    quitarPreajuste,
    rutaConfig,
    usarVariante,
    type Salida,
} from "../nucleo/config.ts";
import { ErrorUsuario } from "../ui.ts";

export function listarPreajustes(): number {
    const { preajustes } = cargarConfig();
    if (preajustes.length === 0) {
        p.log.warn("No hay preajustes.");
        return 0;
    }

    p.note(
        preajustes.map((x) => `${x.nombre.padEnd(10)} ${`${x.ancho}x${x.alto}`.padEnd(10)} → "<serie> <ep> ${x.etiqueta}.avs"`).join("\n"),
        "Preajustes",
    );
    return 0;
}

/** Agrega un preajuste. `etiqueta` por defecto es el nombre del preajuste. */
export function agregarPreajusteComando(nombre: string, resolucion: string, etiqueta: string | undefined): number {
    const dimensiones = parsearResolucion(resolucion);
    if (!dimensiones) {
        throw new ErrorUsuario(`Resolución inválida: "${resolucion}". Formato: <ancho>x<alto>, por ejemplo 1280x720.`);
    }

    const valorEtiqueta = (etiqueta ?? nombre).replace(/\.avs$/i, "");
    const errorEtiqueta = validarNombreArchivo(valorEtiqueta);
    if (errorEtiqueta) {
        throw new ErrorUsuario(`--etiqueta: ${errorEtiqueta}`);
    }

    try {
        guardarConfig(agregarPreajuste(cargarConfig(), { nombre, ...dimensiones, etiqueta: valorEtiqueta }));
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

export function describirSalida(salida: Salida): string {
    const audio = `${salida.audio.codec.toUpperCase()} ${salida.audio.kbps} kbps`;
    const video = salida.tipo === "mp4-x264"
        ? `x264 ${salida.x264.preset} CRF ${salida.x264.crf} (${salida.x264.tune || "sin tune"}, keyint ${salida.x264.keyint}, level ${salida.x264.level}, VBV ${salida.x264.vbvBufsize}/${salida.x264.vbvMaxrate}${salida.x264.extra?.length ? `, ${salida.x264.extra.join(" ")}` : ""})`
        : `XviD 2 pasadas, máx. ${salida.tamanoMB} MB`;
    return `${salida.activa ? "[x]" : "[ ]"} ${salida.nombre.padEnd(6)} ${salida.tipo.padEnd(9)} ${salida.preajuste.padEnd(6)} ${video} + ${audio}`;
}

export function listarSalidas(): number {
    const config = cargarConfig();
    p.note(
        [
            ...config.salidas.map(describirSalida),
            "",
            `Grupo:            ${config.grupo}`,
            `MeGUI:            ${config.rutaMegui ?? "(sin configurar)"}`,
            `Carpeta salida:   ${config.carpetaSalida ?? "(sin configurar)"}`,
            `En paralelo:      ${config.paralelo} ${config.paralelo === 1 ? "versión" : "versiones"} a la vez`,
            "",
            `Los ajustes de x264, XviD y audio se editan en ${rutaConfig()}`,
        ].join("\n"),
        "Salidas de encode",
    );
    return 0;
}

export function activarSalidaComando(nombre: string, activa: boolean): number {
    try {
        guardarConfig(activarSalida(cargarConfig(), nombre, activa));
    } catch (error) {
        throw new ErrorUsuario((error as Error).message);
    }

    p.log.success(`Salida "${nombre}" ${activa ? "activada" : "desactivada"}.`);
    return 0;
}

export function configurarRutaMegui(ruta: string): number {
    const absoluta = resolve(ruta);
    if (!existsSync(join(absoluta, "tools"))) {
        throw new ErrorUsuario(`No parece una instalación de MeGUI (falta ${join(absoluta, "tools")}).`);
    }

    guardarConfig({ ...cargarConfig(), rutaMegui: absoluta });
    p.log.success(`MeGUI: ${absoluta}`);
    return 0;
}

export function listarVariantes(): number {
    const { variantes } = cargarConfig();
    p.note(
        [
            ...variantes.map((v) => {
                const { tune, extra, ...resto } = v.x264;
                const ajustes = [
                    tune === undefined ? "" : tune === "" ? "sin --tune" : `--tune ${tune}`,
                    ...Object.entries(resto).map(([clave, valor]) => `${clave}=${valor}`),
                    ...(extra ?? []),
                ].filter(Boolean).join(" ") || "(sin cambios)";
                return `${v.nombre.padEnd(12)} ${v.descripcion}\n${" ".repeat(13)}${ajustes}`;
            }),
            "",
            `Se editan en ${rutaConfig()} (lista "variantes").`,
        ].join("\n"),
        "Variantes de x264 (asu comparar)",
    );
    return 0;
}

export function usarVarianteComando(salida: string, variante: string): number {
    let config;
    try {
        config = usarVariante(cargarConfig(), salida, variante);
    } catch (error) {
        throw new ErrorUsuario((error as Error).message);
    }

    guardarConfig(config);
    const actualizada = config.salidas.find((x) => x.nombre.toLowerCase() === salida.trim().toLowerCase())!;
    p.log.success(`Salida "${actualizada.nombre}" usa ahora la variante "${variante}":\n${describirSalida(actualizada)}`);
    return 0;
}

export function configurarParalelo(valor: string): number {
    const paralelo = parsearParalelo(valor);
    if (paralelo === null) {
        throw new ErrorUsuario(`"${valor}" no es válido: debe ser un entero mayor o igual a 1.`);
    }

    guardarConfig({ ...cargarConfig(), paralelo });
    p.log.success(`Versiones a la vez en asu encode: ${paralelo}`);
    return 0;
}

export function configurarCarpetaSalida(ruta: string): number {
    const absoluta = resolve(ruta);
    guardarConfig({ ...cargarConfig(), carpetaSalida: absoluta });
    p.log.success(`Carpeta de salida: ${absoluta}`);
    return 0;
}

/** Vuelve preajustes y salidas a los de fábrica; conserva rutas y grupo. */
export function restablecerConfig(): number {
    const actual = cargarConfig();
    const fabrica = configDeFabrica();
    guardarConfig({ ...actual, preajustes: fabrica.preajustes, salidas: fabrica.salidas });
    p.log.success("Preajustes y salidas restablecidos a los de fábrica.");
    return 0;
}

export function mostrarRutaConfig(): number {
    console.log(rutaConfig());
    return 0;
}
