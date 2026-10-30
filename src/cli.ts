#!/usr/bin/env bun
import * as p from "@clack/prompts";
import { parseArgs, type ParseArgsConfig } from "node:util";
import paquete from "../package.json" with { type: "json" };
import {
    AYUDA_AVS_COMPRESION,
    AYUDA_AVS_TRABAJO,
    AYUDA_COMPARAR,
    AYUDA_CONFIG,
    AYUDA_CORREGIR_OFFSET,
    AYUDA_ENCODE,
    AYUDA_FUENTES,
    AYUDA_GENERAL,
    AYUDA_REESCALAR,
    AYUDA_UNIR,
} from "./ayuda.ts";
import { crearAvsCompresion } from "./comandos/avs-compresion.ts";
import { crearAvsTrabajo } from "./comandos/avs-trabajo.ts";
import {
    activarSalidaComando,
    agregarPreajusteComando,
    configurarCarpetaSalida,
    configurarParalelo,
    configurarRutaMegui,
    listarPreajustes,
    listarSalidas,
    listarVariantes,
    mostrarRutaConfig,
    quitarPreajusteComando,
    restablecerConfig,
    usarVarianteComando,
} from "./comandos/config.ts";
import { abrirComparacion, comparar } from "./comandos/comparar.ts";
import { corregirOffset } from "./comandos/corregir-offset.ts";
import { encode } from "./comandos/encode.ts";
import { reescalarArchivos } from "./comandos/reescalar.ts";
import { unirArchivos } from "./comandos/unir.ts";
import { verificarFuentes } from "./comandos/verificar-fuentes.ts";
import { menu, menuComparar } from "./menu.ts";
import { Cancelado, ErrorUsuario, esInteractivo } from "./ui.ts";

const OPCION_AYUDA = { help: { type: "boolean", short: "h" } } as const;
const OPCIONES_SERIE_EPISODIO = {
    serie: { type: "string" },
    episodio: { type: "string" },
} as const;
const OPCIONES_DESTINO = {
    salida: { type: "string", short: "o" },
    forzar: { type: "boolean", short: "f" },
} as const;

function parsear<T extends NonNullable<ParseArgsConfig["options"]>>(comando: string, args: string[], opciones: T) {
    try {
        return parseArgs({ args, options: { ...OPCION_AYUDA, ...opciones }, allowPositionals: true, strict: true });
    } catch (error) {
        throw new ErrorUsuario(`${(error as Error).message}\nUsa "asu ${comando} --help" para ver las opciones.`);
    }
}

function directorioUnico(comando: string, posicionales: string[]): string | undefined {
    if (posicionales.length > 1) {
        throw new ErrorUsuario(`Demasiados argumentos: ${posicionales.join(" ")}\nUsa "asu ${comando} --help".`);
    }

    return posicionales[0];
}

function ayuda(texto: string): number {
    console.log(texto);
    return 0;
}

function comandoConfig(args: string[]): number {
    const { values, positionals } = parsear("config", args, { etiqueta: { type: "string" } });
    if (values.help) {
        return ayuda(AYUDA_CONFIG);
    }

    const [sub, accion, ...resto] = positionals;
    if (values.etiqueta !== undefined && !(sub === "preajustes" && accion === "agregar")) {
        throw new ErrorUsuario("--etiqueta solo aplica a: asu config preajustes agregar");
    }

    if (sub === "ruta" && positionals.length === 1) {
        return mostrarRutaConfig();
    }

    if (sub === "megui" && positionals.length === 2) {
        return configurarRutaMegui(accion!);
    }

    if (sub === "carpeta-salida" && positionals.length === 2) {
        return configurarCarpetaSalida(accion!);
    }

    if (sub === "variantes" && positionals.length === 1) {
        return listarVariantes();
    }

    if (sub === "paralelo" && positionals.length === 2) {
        return configurarParalelo(accion!);
    }

    if (sub === "salidas") {
        if ((accion === undefined || accion === "listar") && resto.length === 0) {
            return listarSalidas();
        }

        if (accion === "usar-variante" && resto.length === 2) {
            return usarVarianteComando(resto[0]!, resto[1]!);
        }

        if ((accion === "activar" || accion === "desactivar") && resto.length === 1) {
            return activarSalidaComando(resto[0]!, accion === "activar");
        }
    }

    if (sub === "restablecer" && positionals.length === 1) {
        return restablecerConfig();
    }

    if (sub === "preajustes") {
        if ((accion === undefined || accion === "listar") && resto.length === 0) {
            return listarPreajustes();
        }

        if (accion === "agregar" && resto.length === 2) {
            return agregarPreajusteComando(resto[0]!, resto[1]!, values.etiqueta);
        }

        if (accion === "quitar" && resto.length === 1) {
            return quitarPreajusteComando(resto[0]!);
        }
    }

    throw new ErrorUsuario(`Subcomando inválido: config ${positionals.join(" ")}\n\n${AYUDA_CONFIG}`);
}

async function ejecutar(argv: string[]): Promise<number> {
    const [comando, ...args] = argv;

    switch (comando) {
        case undefined:
            return menu(paquete.version);

        case "-h":
        case "--help":
        case "ayuda":
            return ayuda(AYUDA_GENERAL);

        case "-v":
        case "--version":
            console.log(paquete.version);
            return 0;

        case "avs-trabajo": {
            const { values, positionals } = parsear(comando, args, { video: { type: "string" }, ...OPCIONES_DESTINO });
            if (values.help) {
                return ayuda(AYUDA_AVS_TRABAJO);
            }

            return crearAvsTrabajo({ ...values, dir: directorioUnico(comando, positionals) });
        }

        case "avs-compresion": {
            const { values, positionals } = parsear(comando, args, {
                video: { type: "string" },
                preajuste: { type: "string", short: "p" },
                subs: { type: "string", short: "s", multiple: true },
                ...OPCIONES_SERIE_EPISODIO,
                ...OPCIONES_DESTINO,
            });
            if (values.help) {
                return ayuda(AYUDA_AVS_COMPRESION);
            }

            return crearAvsCompresion({ ...values, dir: directorioUnico(comando, positionals) });
        }

        case "fuentes": {
            const { values, positionals } = parsear(comando, args, {});
            if (values.help) {
                return ayuda(AYUDA_FUENTES);
            }

            return verificarFuentes({ dir: directorioUnico(comando, positionals) });
        }

        case "reescalar": {
            const { values, positionals } = parsear(comando, args, {
                subs: { type: "string", short: "s", multiple: true },
                resolucion: { type: "string", short: "r" },
                modo: { type: "string", short: "m" },
                ...OPCIONES_DESTINO,
            });
            if (values.help) {
                return ayuda(AYUDA_REESCALAR);
            }

            return reescalarArchivos({ ...values, dir: directorioUnico(comando, positionals) });
        }

        case "unir": {
            const { values, positionals } = parsear(comando, args, {
                subs: { type: "string", short: "s", multiple: true },
                reescalar: { type: "boolean" },
                modo: { type: "string", short: "m" },
                ...OPCIONES_DESTINO,
            });
            if (values.help) {
                return ayuda(AYUDA_UNIR);
            }

            return unirArchivos({ ...values, dir: directorioUnico(comando, positionals) });
        }

        case "corregir-offset": {
            const { values, positionals } = parsear(comando, args, { video: { type: "string" }, ...OPCIONES_DESTINO });
            if (values.help) {
                return ayuda(AYUDA_CORREGIR_OFFSET);
            }

            return corregirOffset({ ...values, dir: directorioUnico(comando, positionals) });
        }

        case "comparar": {
            // Sin nada más y con terminal: el mismo submenú que el menú (nueva o abrir una hecha).
            if (args.length === 0 && esInteractivo()) {
                return menuComparar();
            }

            if (args[0] === "abrir") {
                const { values, positionals } = parsear("comparar abrir", args.slice(1), {
                    "carpeta-salida": { type: "string" },
                    "no-abrir": { type: "boolean" },
                });
                if (values.help) {
                    return ayuda(AYUDA_COMPARAR);
                }
                return abrirComparacion({
                    carpeta: directorioUnico("comparar abrir", positionals),
                    carpetaSalida: values["carpeta-salida"],
                    noAbrir: values["no-abrir"],
                });
            }

            const { values, positionals } = parsear(comando, args, {
                salida: { type: "string" },
                variante: { type: "string", multiple: true },
                tramo: { type: "string", multiple: true },
                "tramos-fijos": { type: "boolean" },
                capturas: { type: "string" },
                igualar: { type: "string" },
                "sin-cache": { type: "boolean" },
                "no-abrir": { type: "boolean" },
                paralelo: { type: "string" },
                video: { type: "string" },
                subs: { type: "string", short: "s", multiple: true },
                ...OPCIONES_SERIE_EPISODIO,
                "carpeta-salida": { type: "string" },
            });
            if (values.help) {
                return ayuda(AYUDA_COMPARAR);
            }

            return comparar({
                dir: directorioUnico(comando, positionals),
                salida: values.salida,
                variantes: values.variante,
                tramos: values.tramo,
                tramosFijos: values["tramos-fijos"],
                capturas: values.capturas,
                igualar: values.igualar,
                sinCache: values["sin-cache"],
                noAbrir: values["no-abrir"],
                paralelo: values.paralelo,
                video: values.video,
                subs: values.subs,
                serie: values.serie,
                episodio: values.episodio,
                carpetaSalida: values["carpeta-salida"],
            });
        }

        case "encode": {
            const { values, positionals } = parsear(comando, args, {
                solo: { type: "string", multiple: true },
                video: { type: "string" },
                subs: { type: "string", short: "s", multiple: true },
                ...OPCIONES_SERIE_EPISODIO,
                fuente: { type: "string" },
                "pista-audio": { type: "string" },
                paralelo: { type: "string" },
                "carpeta-salida": { type: "string" },
                "regenerar-avs": { type: "boolean" },
                "ignorar-fuentes": { type: "boolean" },
                reanudar: { type: "boolean" },
                reiniciar: { type: "boolean" },
                conservar: { type: "boolean" },
                forzar: { type: "boolean", short: "f" },
            });
            if (values.help) {
                return ayuda(AYUDA_ENCODE);
            }
            if (values.reanudar && values.reiniciar) {
                throw new ErrorUsuario("--reanudar y --reiniciar no se pueden usar juntos.");
            }

            return encode({
                dir: directorioUnico(comando, positionals),
                solo: values.solo,
                video: values.video,
                subs: values.subs,
                serie: values.serie,
                episodio: values.episodio,
                fuente: values.fuente,
                pistaAudio: values["pista-audio"],
                paralelo: values.paralelo,
                carpetaSalida: values["carpeta-salida"],
                regenerarAvs: values["regenerar-avs"],
                ignorarFuentes: values["ignorar-fuentes"],
                reanudar: values.reanudar,
                reiniciar: values.reiniciar,
                conservar: values.conservar,
                forzar: values.forzar,
            });
        }

        case "config":
            return comandoConfig(args);

        default:
            throw new ErrorUsuario(`Comando desconocido: ${comando}\n\n${AYUDA_GENERAL}`);
    }
}

try {
    process.exitCode = await ejecutar(process.argv.slice(2));
} catch (error) {
    if (error instanceof Cancelado) {
        p.cancel(error.message);
    } else if (error instanceof ErrorUsuario) {
        p.log.error(error.message);
    } else {
        console.error(error);
    }

    process.exitCode = 1;
}
