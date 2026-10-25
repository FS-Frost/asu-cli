#!/usr/bin/env bun
import * as p from "@clack/prompts";
import { parseArgs, type ParseArgsConfig } from "node:util";
import paquete from "../package.json" with { type: "json" };
import {
    AYUDA_AVS_COMPRESION,
    AYUDA_AVS_TRABAJO,
    AYUDA_CONFIG,
    AYUDA_FUENTES,
    AYUDA_GENERAL,
    AYUDA_REESCALAR,
    AYUDA_UNIR,
} from "./ayuda.ts";
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
import { menu } from "./menu.ts";
import { Cancelado, ErrorUsuario } from "./ui.ts";

const OPCION_AYUDA = { help: { type: "boolean", short: "h" } } as const;
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
    const { values, positionals } = parsear("config", args, { archivo: { type: "string" } });
    if (values.help) {
        return ayuda(AYUDA_CONFIG);
    }

    const [sub, accion, ...resto] = positionals;
    if (values.archivo !== undefined && !(sub === "preajustes" && accion === "agregar")) {
        throw new ErrorUsuario("--archivo solo aplica a: asu config preajustes agregar");
    }

    if (sub === "ruta" && positionals.length === 1) {
        return mostrarRutaConfig();
    }

    if (sub === "restablecer" && positionals.length === 1) {
        return restablecerConfig();
    }

    if (sub === "preajustes") {
        if ((accion === undefined || accion === "listar") && resto.length === 0) {
            return listarPreajustes();
        }

        if (accion === "agregar" && resto.length === 2) {
            return agregarPreajusteComando(resto[0]!, resto[1]!, values.archivo);
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
