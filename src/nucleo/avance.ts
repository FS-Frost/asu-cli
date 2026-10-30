// Lectura del avance que imprimen las herramientas mientras codifican.

/**
 * Último número de frame en la salida que va llegando, por trozos:
 * - x264:        "1234 frames: 52.10 fps, 2681.12 kb/s" (separado por \r)
 * - xvid_encraw: "  1234: key=0, time= ..." (una línea por frame)
 * Guarda el final incompleto de cada trozo para no leer números cortados.
 */
export class LectorAvance {
    frames: number | null = null;
    private resto = "";

    leer(trozo: string): void {
        const texto = this.resto + trozo;
        const corte = Math.max(texto.lastIndexOf("\n"), texto.lastIndexOf("\r"));
        if (corte === -1) {
            this.resto = texto.slice(-200);
            return;
        }

        this.resto = texto.slice(corte + 1);
        const completo = texto.slice(0, corte);
        const patron = /(?:^|[\r\n])\s*(?:\[[\d.]+%\]\s*)?(\d+)(?:\/\d+)?(?: frames[,:]|: key=)/g;
        for (const coincidencia of completo.matchAll(patron)) {
            this.frames = Number(coincidencia[1]);
        }
    }
}

/** Frames aproximados de un video de `duracion` segundos a 24000/1001 (solo para mostrar %). */
export function framesAproximados(duracion: number): number {
    return Math.round((duracion * 24000) / 1001);
}

/** Últimas `n` líneas no vacías (para mostrar por qué falló una herramienta). */
export function ultimasLineas(texto: string, n = 8): string {
    return texto
        .split(/[\r\n]+/)
        .map((linea) => linea.trimEnd())
        .filter((linea) => linea.trim().length > 0)
        .slice(-n)
        .join("\n");
}

/**
 * Ejecuta `tareas` con hasta `limite` a la vez. Si una falla, las demás siguen hasta terminar.
 * Devuelve los errores (vacío si todas terminaron bien).
 */
export async function ejecutarConLimite(tareas: readonly (() => Promise<void>)[], limite: number): Promise<unknown[]> {
    const errores: unknown[] = [];
    let siguiente = 0;

    const trabajador = async () => {
        while (siguiente < tareas.length) {
            const tarea = tareas[siguiente++]!;
            try {
                await tarea();
            } catch (error) {
                errores.push(error);
            }
        }
    };

    await Promise.all(Array.from({ length: Math.max(1, Math.min(limite, tareas.length)) }, trabajador));
    return errores;
}
