import { basename } from "node:path";
import type { Comando } from "./nucleo/encode.ts";

export type ResultadoEjecucion = {
    /** Código del primer proceso de la tubería que falló, o 0 (-1 si el vigilante la cortó). */
    codigo: number;
    /** Código de cada proceso, en orden. */
    codigos?: number[];
    /** Con `capturar`: stderr completo. Con `alSalida`: el final de la salida (para mostrar si falla). */
    stderr: string;
    /** Con `capturar`: stdout completo del último proceso (p. ej. `ssim=stats_file=-`). */
    stdout?: string;
    /** El vigilante la cortó: nadie escribió nada en el plazo. `vivos` = ejecutables que seguían corriendo. */
    colgado?: { vivos: string[] };
};

export type OpcionesEjecucion = {
    /** Devuelve el stderr (y el stdout del último proceso) en vez de mostrarlos. */
    capturar?: boolean;
    /**
     * Recibe la salida a medida que llega (stderr de todos los procesos y stdout del último),
     * en vez de mostrarla en la terminal. Para leer el avance de cada herramienta.
     */
    alSalida?: (texto: string) => void;
    /**
     * Si ningún proceso escribe nada en `segundos`, se matan todos y el resultado trae `colgado`.
     * Implica leer la salida (no se muestra en la terminal).
     */
    vigilar?: { segundos: number };
};

/** Ejecuta una tubería de procesos (`a | b`). */
export interface Ejecutor {
    ejecutar(comandos: readonly Comando[], opciones?: OpcionesEjecucion): Promise<ResultadoEjecucion>;
}

const LARGO_COLA = 8000;

/** Lee un stream entero; pasa cada trozo a `alTrozo` y conserva todo o solo la cola. */
async function leer(stream: ReadableStream<Uint8Array>, completo: boolean, alTrozo?: (texto: string) => void): Promise<string> {
    const decodificador = new TextDecoder();
    let texto = "";
    for await (const trozo of stream) {
        const parte = decodificador.decode(trozo, { stream: true });
        alTrozo?.(parte);
        texto += parte;
        if (!completo && texto.length > LARGO_COLA * 2) {
            texto = texto.slice(-LARGO_COLA);
        }
    }

    return completo ? texto : texto.slice(-LARGO_COLA);
}

export const ejecutorReal: Ejecutor = {
    async ejecutar(comandos, opciones = {}) {
        if (comandos.length === 0) {
            throw new Error("Tubería vacía.");
        }

        const leerSalida = Boolean(opciones.capturar || opciones.alSalida || opciones.vigilar);
        const procesos: Bun.Subprocess[] = [];
        let entrada: ReadableStream<Uint8Array> | "ignore" = "ignore";

        for (const [i, comando] of comandos.entries()) {
            const ultimo = i === comandos.length - 1;
            const proceso = Bun.spawn([comando.exe, ...comando.args], {
                stdin: entrada,
                stdout: ultimo && !leerSalida ? "inherit" : "pipe",
                stderr: leerSalida ? "pipe" : "inherit",
                windowsHide: true,
            });
            procesos.push(proceso);
            if (!ultimo) {
                entrada = proceso.stdout as ReadableStream<Uint8Array>;
            }
        }

        // Vigilante: cualquier byte de salida cuenta como actividad.
        let ultimaActividad = Date.now();
        let colgado: { vivos: string[] } | undefined;
        const alTrozo = (texto: string) => {
            ultimaActividad = Date.now();
            opciones.alSalida?.(texto);
        };
        const temporizador = opciones.vigilar
            ? setInterval(() => {
                if (colgado || Date.now() - ultimaActividad < opciones.vigilar!.segundos * 1000) {
                    return;
                }
                colgado = {
                    vivos: procesos
                        .map((proceso, i) => (proceso.exitCode === null ? basename(comandos[i]!.exe) : null))
                        .filter((nombre): nombre is string => nombre !== null),
                };
                for (const proceso of procesos) {
                    proceso.kill();
                }
            }, Math.min(1000, opciones.vigilar.segundos * 250))
            : null;

        try {
            const lecturas: Promise<string>[] = [];
            for (const proceso of procesos) {
                if (proceso.stderr instanceof ReadableStream) {
                    lecturas.push(leer(proceso.stderr, Boolean(opciones.capturar), alTrozo));
                }
            }

            // El stdout del último también se vacía (si no, el proceso se bloquea al llenarse el buffer).
            const ultimo = procesos.at(-1)!;
            const stdout = ultimo.stdout instanceof ReadableStream ? leer(ultimo.stdout, Boolean(opciones.capturar), alTrozo) : Promise.resolve("");

            const [textos, salida] = await Promise.all([Promise.all(lecturas), stdout]);
            const codigos = await Promise.all(procesos.map((proceso) => proceso.exited));
            return {
                codigo: colgado ? -1 : (codigos.find((codigo) => codigo !== 0) ?? 0),
                codigos,
                stderr: textos.join("\n"),
                ...(opciones.capturar ? { stdout: salida } : {}),
                ...(colgado ? { colgado } : {}),
            };
        } finally {
            if (temporizador) {
                clearInterval(temporizador);
            }
        }
    },
};
