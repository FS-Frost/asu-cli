import * as p from "@clack/prompts";
import { crearAvsCompresion } from "./comandos/avs-compresion.ts";
import { crearAvsTrabajo } from "./comandos/avs-trabajo.ts";
import {
    activarSalidaComando,
    agregarPreajusteComando,
    configurarCarpetaSalida,
    configurarParalelo,
    configurarRutaMegui,
    describirSalida,
    listarPreajustes,
    listarSalidas,
    listarVariantes,
    mostrarRutaConfig,
    quitarPreajusteComando,
    restablecerConfig,
    usarVarianteComando,
} from "./comandos/config.ts";
import { comparar } from "./comandos/comparar.ts";
import { corregirOffset } from "./comandos/corregir-offset.ts";
import { encode } from "./comandos/encode.ts";
import { reescalarArchivos } from "./comandos/reescalar.ts";
import { unirArchivos } from "./comandos/unir.ts";
import { verificarFuentes } from "./comandos/verificar-fuentes.ts";
import { validarNombreArchivo } from "./nucleo/archivos.ts";
import { cargarConfig, parsearParalelo, parsearResolucion } from "./nucleo/config.ts";
import { Cancelado, ErrorUsuario, confirmar, elegir, elegirVarios, esInteractivo, preguntarTexto } from "./ui.ts";

type Accion = "avs-trabajo" | "avs-compresion" | "fuentes" | "unir" | "reescalar" | "corregir-offset" | "encode" | "comparar" | "config" | "salir";

async function menuConfig(): Promise<void> {
    while (true) {
        const accion = await elegir("Configuración", [
            { value: "listar", label: "Ver preajustes" },
            { value: "agregar", label: "Agregar preajuste" },
            { value: "quitar", label: "Quitar preajuste" },
            { value: "salidas", label: "Ver salidas de encode" },
            { value: "activar", label: "Activar/desactivar salidas de encode" },
            { value: "megui", label: "Carpeta de MeGUI" },
            { value: "carpeta-salida", label: "Carpeta de salida del encode" },
            { value: "paralelo", label: "Versiones a la vez en el encode" },
            { value: "variantes", label: "Ver variantes de x264 (comparar)" },
            { value: "usar-variante", label: "Usar una variante en una salida" },
            { value: "restablecer", label: "Restablecer preajustes y salidas de fábrica" },
            { value: "ruta", label: "Ver ruta de config.json" },
            { value: "volver", label: "Volver" },
        ]);

        switch (accion) {
            case "listar":
                listarPreajustes();
                break;

            case "agregar": {
                const nombre = await preguntarTexto("Nombre del preajuste (ej. 900p)", {
                    validar: (valor) => (valor.trim().length === 0 ? "El nombre no puede estar vacío." : undefined),
                });
                const resolucion = await preguntarTexto("Resolución (<ancho>x<alto>)", {
                    validar: (valor) => (parsearResolucion(valor) ? undefined : "Formato: 1280x720"),
                });
                const etiqueta = await preguntarTexto('Etiqueta del .avs ("<serie> <ep> <etiqueta>.avs")', {
                    inicial: nombre.trim(),
                    validar: validarNombreArchivo,
                });
                agregarPreajusteComando(nombre.trim(), resolucion, etiqueta.trim());
                break;
            }

            case "salidas":
                listarSalidas();
                break;

            case "activar": {
                const config = cargarConfig();
                const activas = await elegirVarios(
                    "Salidas activas en el encode",
                    config.salidas.map((salida) => ({ value: salida.nombre, label: salida.nombre, hint: describirSalida(salida) })),
                    config.salidas.filter((salida) => salida.activa).map((salida) => salida.nombre),
                );
                for (const salida of config.salidas) {
                    if (salida.activa !== activas.includes(salida.nombre)) {
                        activarSalidaComando(salida.nombre, !salida.activa);
                    }
                }
                break;
            }

            case "megui": {
                const ruta = await preguntarTexto("Carpeta de instalación de MeGUI", { inicial: cargarConfig().rutaMegui ?? undefined });
                configurarRutaMegui(ruta.trim());
                break;
            }

            case "variantes":
                listarVariantes();
                break;

            case "usar-variante": {
                const config = cargarConfig();
                const salida = await elegir(
                    "Salida que adopta la variante",
                    config.salidas.filter((x) => x.tipo === "mp4-x264").map((x) => ({ value: x.nombre, label: x.nombre, hint: describirSalida(x) })),
                );
                const variante = await elegir(
                    "Variante",
                    config.variantes.map((v) => ({ value: v.nombre, label: v.nombre, hint: v.descripcion })),
                );
                usarVarianteComando(salida, variante);
                break;
            }

            case "paralelo": {
                const valor = await preguntarTexto("Versiones a codificar a la vez (1 = en secuencia)", {
                    inicial: String(cargarConfig().paralelo),
                    validar: (v) => (parsearParalelo(v) ? undefined : "Debe ser un entero mayor o igual a 1."),
                });
                configurarParalelo(valor);
                break;
            }

            case "carpeta-salida": {
                const ruta = await preguntarTexto("Carpeta de salida del encode", { inicial: cargarConfig().carpetaSalida ?? undefined });
                configurarCarpetaSalida(ruta.trim());
                break;
            }

            case "quitar": {
                const { preajustes } = cargarConfig();
                if (preajustes.length === 0) {
                    p.log.warn("No hay preajustes.");
                    break;
                }

                const nombre = await elegir(
                    "Preajuste a quitar",
                    preajustes.map((x) => ({ value: x.nombre, label: x.nombre, hint: `${x.ancho}x${x.alto}, etiqueta "${x.etiqueta}"` })),
                );
                quitarPreajusteComando(nombre);
                break;
            }

            case "restablecer":
                if (await confirmar("¿Restablecer preajustes y salidas de fábrica? Se pierden los cambios.", false)) {
                    restablecerConfig();
                }
                break;

            case "ruta":
                mostrarRutaConfig();
                break;

            case "volver":
                return;
        }
    }
}

async function ejecutarAccion(accion: Exclude<Accion, "salir">): Promise<void> {
    switch (accion) {
        case "avs-trabajo":
            await crearAvsTrabajo({});
            break;
        case "avs-compresion":
            await crearAvsCompresion({});
            break;
        case "fuentes":
            await verificarFuentes({});
            break;
        case "unir":
            await unirArchivos({});
            break;
        case "reescalar":
            await reescalarArchivos({});
            break;
        case "corregir-offset":
            await corregirOffset({});
            break;
        case "encode":
            await encode({});
            break;
        case "comparar":
            await comparar({});
            break;
        case "config":
            await menuConfig();
            break;
    }
}

/** Menú interactivo. Vuelve al menú después de cada herramienta hasta elegir "Salir". */
export async function menu(version: string): Promise<number> {
    if (!esInteractivo()) {
        throw new ErrorUsuario('El menú necesita una terminal interactiva. Usa "asu --help" para ver los comandos.');
    }

    p.intro(`asu ${version}`);

    while (true) {
        let accion: Accion;
        try {
            accion = await elegir<Accion>("¿Qué quieres hacer?", [
                { value: "avs-trabajo", label: "Crear AVS de trabajo" },
                { value: "avs-compresion", label: "Crear AVS de compresión" },
                { value: "fuentes", label: "Verificar fuentes" },
                { value: "unir", label: "Unir archivos .ass" },
                { value: "reescalar", label: "Reescalar resolución" },
                { value: "corregir-offset", label: "Corregir offset del video" },
                { value: "encode", label: "Encode de episodio" },
                { value: "comparar", label: "Comparar ajustes de x264" },
                { value: "config", label: "Configuración" },
                { value: "salir", label: "Salir" },
            ]);
        } catch (error) {
            if (error instanceof Cancelado) {
                break;
            }
            throw error;
        }

        if (accion === "salir") {
            break;
        }

        try {
            await ejecutarAccion(accion);
        } catch (error) {
            if (error instanceof Cancelado) {
                p.log.warn(error.message);
            } else if (error instanceof ErrorUsuario) {
                p.log.error(error.message);
            } else {
                throw error;
            }
        }
    }

    p.outro("¡Hasta luego!");
    return 0;
}
