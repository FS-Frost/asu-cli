import * as p from "@clack/prompts";
import { styleText } from "node:util";
import { esInteractivo } from "./ui.ts";

export type EstadoFila = "esperando" | "trabajando" | "listo" | "error";

type Fila = {
    nombre: string;
    estado: EstadoFila;
    paso: string;
    frames: number | null;
    total: number | null;
    /** Inicio del paso actual (para calcular fps de herramientas que no lo informan). */
    inicio: number;
    framesInicio: number;
};

const INTERVALO_MS = 500;

/**
 * Una línea por cadena (versión) con su paso, frames, % y fps. En una terminal se redibuja en el
 * lugar; sin terminal (tests, scripts) solo registra el inicio y el fin de cada paso.
 */
export class PanelAvance {
    private filas = new Map<string, Fila>();
    private dibujadas = 0;
    private temporizador: ReturnType<typeof setInterval> | null = null;
    private readonly vivo = esInteractivo();

    constructor(nombres: readonly string[]) {
        for (const nombre of nombres) {
            this.filas.set(nombre, { nombre, estado: "esperando", paso: "", frames: null, total: null, inicio: 0, framesInicio: 0 });
        }
    }

    iniciar(): void {
        if (this.vivo) {
            process.stdout.write("\x1b[?25l");
            this.dibujar();
            this.temporizador = setInterval(() => this.dibujar(), INTERVALO_MS);
        }
    }

    detener(): void {
        if (this.temporizador) {
            clearInterval(this.temporizador);
            this.temporizador = null;
        }
        if (this.vivo) {
            this.dibujar();
            process.stdout.write("\x1b[?25h");
        }
    }

    paso(nombre: string, paso: string, total: number | null = null): void {
        const fila = this.filas.get(nombre)!;
        Object.assign(fila, { estado: "trabajando", paso, frames: null, total, inicio: Date.now(), framesInicio: 0 });
        if (!this.vivo) {
            p.log.step(`${nombre}: ${paso}`);
        }
    }

    frames(nombre: string, frames: number): void {
        this.filas.get(nombre)!.frames = frames;
    }

    terminar(nombre: string, estado: "listo" | "error", detalle = ""): void {
        const fila = this.filas.get(nombre)!;
        fila.estado = estado;
        fila.paso = detalle || (estado === "listo" ? "listo" : "falló");
        if (!this.vivo) {
            (estado === "listo" ? p.log.success : p.log.error)(`${nombre}: ${fila.paso}`);
        }
    }

    /** Texto de una fila (exportado para tests a través de `texto()`). */
    private linea(fila: Fila): string {
        const icono = {
            esperando: styleText("dim", "○"),
            trabajando: styleText("cyan", "◐"),
            listo: styleText("green", "◆"),
            error: styleText("red", "■"),
        }[fila.estado];

        let detalle = fila.paso;
        if (fila.estado === "trabajando" && fila.frames !== null) {
            const segundos = (Date.now() - fila.inicio) / 1000;
            const fps = segundos > 0 ? (fila.frames - fila.framesInicio) / segundos : 0;
            const porcentaje = fila.total ? ` ${Math.min(99, Math.floor((fila.frames / fila.total) * 100))}%` : "";
            detalle += styleText("dim", `  ${fila.frames}${fila.total ? `/${fila.total}` : ""} frames${porcentaje}  ${fps.toFixed(1)} fps`);
        }

        return `${styleText("gray", "│")}  ${icono} ${fila.nombre.padEnd(10)} ${detalle}`;
    }

    texto(): string {
        return [...this.filas.values()].map((fila) => this.linea(fila)).join("\n");
    }

    private dibujar(): void {
        const lineas = this.texto().split("\n");
        let salida = this.dibujadas > 0 ? `\x1b[${this.dibujadas}A` : "";
        for (const linea of lineas) {
            salida += `\x1b[2K${linea}\n`;
        }
        process.stdout.write(salida);
        this.dibujadas = lineas.length;
    }
}
