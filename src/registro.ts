import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import paquete from "../package.json" with { type: "json" };
import type { Ejecutor, OpcionesEjecucion, ResultadoEjecucion } from "./ejecutor.ts";
import type { Comando } from "./nucleo/encode.ts";
import { CARPETA_PROYECTO } from "./nucleo/proyecto.ts";
import { ErrorUsuario } from "./ui.ts";

/** Segundos sin salida tras los que una codificación (x264/XviD) se considera colgada. */
export const SEGUNDOS_VIGILANTE = 120;

/** Cuánto stderr se anota de un comando que terminó bien (de los que fallan, todo lo leído). */
const COLA_REGISTRO = 2000;

const dos = (n: number) => String(n).padStart(2, "0");

function hora(fecha: Date): string {
    return `${dos(fecha.getHours())}:${dos(fecha.getMinutes())}:${dos(fecha.getSeconds())}.${String(fecha.getMilliseconds()).padStart(3, "0")}`;
}

/** `<episodio>\.asu\registros\encode-AAAA-MM-DD HHmmss.log`. */
export function rutaRegistroEncode(dir: string, fecha = new Date()): string {
    const marca = `${fecha.getFullYear()}-${dos(fecha.getMonth() + 1)}-${dos(fecha.getDate())} ${dos(fecha.getHours())}${dos(fecha.getMinutes())}${dos(fecha.getSeconds())}`;
    return join(dir, CARPETA_PROYECTO, "registros", `encode-${marca}.log`);
}

/** Línea de comandos legible (argumentos con espacios o comillas entre comillas). */
export function lineaComando(comandos: readonly Comando[]): string {
    const citar = (texto: string) => (texto === "" || /[\s"]/.test(texto) ? `"${texto.replace(/"/g, '\\"')}"` : texto);
    return comandos.map((c) => [c.exe, ...c.args].map(citar).join(" ")).join(" | ");
}

/** Archivo de registro de una ejecución de asu (texto UTF-8; se agrega al final). */
export class Registro {
    private siguiente = 1;

    constructor(readonly ruta: string, titulo: string) {
        mkdirSync(dirname(ruta), { recursive: true });
        appendFileSync(ruta, `===== ${titulo} · asu ${paquete.version} · ${new Date().toISOString()} =====\n`);
    }

    escribir(texto: string): void {
        const sangria = " ".repeat(15);
        const lineas = texto.replace(/\r\n?/g, "\n").split("\n");
        appendFileSync(this.ruta, `[${hora(new Date())}] ${lineas.join(`\n${sangria}`)}\n`);
    }

    /** Número para identificar cada comando en el registro. */
    numero(): number {
        return this.siguiente++;
    }
}

/** Ejecutor que anota cada comando: línea completa, duración, códigos, cuelgues y cola de stderr. */
export function ejecutorConRegistro(ejecutor: Ejecutor, registro: Registro): Ejecutor {
    return {
        async ejecutar(comandos, opciones = {}) {
            const id = registro.numero();
            const inicio = Date.now();
            const vigilante = opciones.vigilar ? ` (vigilante: ${opciones.vigilar.segundos} s)` : "";
            registro.escribir(`#${id} inicia${vigilante}: ${lineaComando(comandos)}`);

            let resultado: ResultadoEjecucion;
            try {
                resultado = await ejecutor.ejecutar(comandos, opciones);
            } catch (error) {
                registro.escribir(`#${id} excepción: ${error instanceof Error ? error.message : String(error)}`);
                throw error;
            }

            const segundos = ((Date.now() - inicio) / 1000).toFixed(1);
            const codigos = resultado.codigos && resultado.codigos.length > 1 ? ` (por proceso: ${resultado.codigos.join(", ")})` : "";
            registro.escribir(`#${id} termina: código ${resultado.codigo}${codigos}, ${segundos} s`);
            if (resultado.colgado) {
                const vivos = resultado.colgado.vivos.join(", ") || "ninguno";
                registro.escribir(`#${id} COLGADO: sin salida en ${opciones.vigilar?.segundos} s; seguían vivos: ${vivos}. Se mataron todos.`);
            }

            const stderr = resultado.stderr.trim();
            if (stderr) {
                const falla = resultado.codigo !== 0 || resultado.colgado !== undefined;
                const cola = falla ? stderr : stderr.slice(-COLA_REGISTRO);
                registro.escribir(`#${id} stderr${cola.length < stderr.length ? " (final)" : ""}:\n${cola}`);
            }
            return resultado;
        },
    };
}

/**
 * Ejecuta una codificación con vigilante. Si se cuelga, reintenta una vez; si se vuelve a colgar,
 * error. `alReintentar` se llama antes del reintento.
 */
export async function ejecutarVigilado(
    ejecutor: Ejecutor,
    comandos: readonly Comando[],
    opciones: OpcionesEjecucion,
    descripcion: string,
    alReintentar?: (colgado: { vivos: string[] }) => void,
): Promise<ResultadoEjecucion> {
    const conVigilante = { ...opciones, vigilar: { segundos: SEGUNDOS_VIGILANTE } };
    const primero = await ejecutor.ejecutar(comandos, conVigilante);
    if (!primero.colgado) {
        return primero;
    }

    alReintentar?.(primero.colgado);
    const segundo = await ejecutor.ejecutar(comandos, conVigilante);
    if (segundo.colgado) {
        const vivos = segundo.colgado.vivos.join(", ") || "ninguno";
        throw new ErrorUsuario(`"${descripcion}" se colgó dos veces (sin salida en ${SEGUNDOS_VIGILANTE} s; seguían vivos: ${vivos}).`);
    }
    return segundo;
}

/** Anota el error en el registro y devuelve el error a lanzar (los de usuario, con la ruta del registro). */
export function anotarError(registro: Registro | undefined, error: unknown): unknown {
    if (!registro) {
        return error;
    }

    if (error instanceof ErrorUsuario) {
        registro.escribir(`ERROR: ${error.message}`);
        return new ErrorUsuario(`${error.message}\nRegistro: ${registro.ruta}`);
    }

    registro.escribir(`ERROR inesperado: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    return error;
}
