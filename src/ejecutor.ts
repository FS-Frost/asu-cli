import type { Comando } from "./nucleo/encode.ts";

export type ResultadoEjecucion = {
    /** Código del primer proceso de la tubería que falló, o 0. */
    codigo: number;
    /** Con `capturar`: stderr completo. Con `alSalida`: el final de la salida (para mostrar si falla). */
    stderr: string;
    /** Con `capturar`: stdout completo del último proceso (p. ej. `ssim=stats_file=-`). */
    stdout?: string;
};

export type OpcionesEjecucion = {
    /** Devuelve el stderr (y el stdout del último proceso) en vez de mostrarlos. */
    capturar?: boolean;
    /**
     * Recibe la salida a medida que llega (stderr de todos los procesos y stdout del último),
     * en vez de mostrarla en la terminal. Para leer el avance de cada herramienta.
     */
    alSalida?: (texto: string) => void;
};

/** Ejecuta una tubería de procesos (`a | b`). */
export interface Ejecutor {
    ejecutar(comandos: readonly Comando[], opciones?: OpcionesEjecucion): Promise<ResultadoEjecucion>;
}

const LARGO_COLA = 4000;

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

        const leerSalida = Boolean(opciones.capturar || opciones.alSalida);
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

        const lecturas: Promise<string>[] = [];
        for (const proceso of procesos) {
            if (proceso.stderr instanceof ReadableStream) {
                lecturas.push(leer(proceso.stderr, Boolean(opciones.capturar), opciones.alSalida));
            }
        }

        // El stdout del último también se vacía (si no, el proceso se bloquea al llenarse el buffer).
        const ultimo = procesos.at(-1)!;
        const stdout = ultimo.stdout instanceof ReadableStream ? leer(ultimo.stdout, Boolean(opciones.capturar), opciones.alSalida) : Promise.resolve("");

        const [textos, salida] = await Promise.all([Promise.all(lecturas), stdout]);
        const codigos = await Promise.all(procesos.map((proceso) => proceso.exited));
        return {
            codigo: codigos.find((codigo) => codigo !== 0) ?? 0,
            stderr: textos.join("\n"),
            ...(opciones.capturar ? { stdout: salida } : {}),
        };
    },
};
