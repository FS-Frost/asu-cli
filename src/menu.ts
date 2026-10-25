import * as p from "@clack/prompts";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { crearAvsCompresion } from "./comandos/avs-compresion.ts";
import { crearAvsTrabajo } from "./comandos/avs-trabajo.ts";
import {
    agregarPreajusteComando,
    listarPreajustes,
    mostrarRutaConfig,
    quitarPreajusteComando,
    restablecerConfig,
} from "./comandos/config.ts";
import { reescalarArchivos } from "./comandos/reescalar.ts";
import { unirArchivos } from "./comandos/unir.ts";
import { verificarFuentes } from "./comandos/verificar-fuentes.ts";
import { validarNombreArchivo } from "./nucleo/archivos.ts";
import { cargarConfig, parsearResolucion } from "./nucleo/config.ts";
import { Cancelado, ErrorUsuario, confirmar, elegir, esInteractivo, preguntarTexto } from "./ui.ts";

type Accion = "avs-trabajo" | "avs-compresion" | "fuentes" | "unir" | "reescalar" | "config" | "salir";

async function preguntarDirectorio(): Promise<string> {
    return preguntarTexto("Directorio", {
        inicial: process.cwd(),
        validar: (valor) => {
            const ruta = resolve(valor.trim());
            return existsSync(ruta) && statSync(ruta).isDirectory() ? undefined : "El directorio no existe.";
        },
    }).then((valor) => resolve(valor.trim()));
}

async function menuConfig(): Promise<void> {
    while (true) {
        const accion = await elegir("Configuración", [
            { value: "listar", label: "Ver preajustes" },
            { value: "agregar", label: "Agregar preajuste" },
            { value: "quitar", label: "Quitar preajuste" },
            { value: "restablecer", label: "Restablecer preajustes de fábrica" },
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
                const archivo = await preguntarTexto("Nombre del .avs (sin extensión)", {
                    inicial: nombre.trim(),
                    validar: validarNombreArchivo,
                });
                agregarPreajusteComando(nombre.trim(), resolucion, archivo.trim());
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
                    preajustes.map((x) => ({ value: x.nombre, label: x.nombre, hint: `${x.ancho}x${x.alto} → ${x.archivo}.avs` })),
                );
                quitarPreajusteComando(nombre);
                break;
            }

            case "restablecer":
                if (await confirmar("¿Restablecer los preajustes de fábrica? Se pierden los agregados.", false)) {
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
            await crearAvsTrabajo({ dir: await preguntarDirectorio() });
            break;
        case "avs-compresion":
            await crearAvsCompresion({ dir: await preguntarDirectorio() });
            break;
        case "fuentes":
            await verificarFuentes({ dir: await preguntarDirectorio() });
            break;
        case "unir":
            await unirArchivos({ dir: await preguntarDirectorio() });
            break;
        case "reescalar":
            await reescalarArchivos({ dir: await preguntarDirectorio() });
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
