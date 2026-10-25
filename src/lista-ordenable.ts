import { Prompt } from "@clack/core";
import { S_BAR, S_BAR_END, S_RADIO_ACTIVE, S_RADIO_INACTIVE, symbol, unicodeOr } from "@clack/prompts";
import type { Readable, Writable } from "node:stream";
import { styleText } from "node:util";

const S_MOVIENDO = unicodeOr("↕", "=");

export type ElementoLista<T> = {
    value: T;
    label: string;
};

export type OpcionesListaOrdenable<T> = {
    mensaje: string;
    elementos: ElementoLista<T>[];
    input?: Readable;
    output?: Writable;
};

/**
 * Lista reordenable: ↑/↓ mueven el cursor; espacio agarra/suelta el elemento y, agarrado,
 * ↑/↓ lo mueven. Enter confirma el orden (aunque haya uno agarrado); Esc / Ctrl+C cancela.
 */
export class ListaOrdenablePrompt<T> extends Prompt<T[]> {
    elementos: ElementoLista<T>[];
    cursor = 0;
    agarrado = false;

    constructor(opciones: OpcionesListaOrdenable<T>) {
        super(
            {
                input: opciones.input,
                output: opciones.output,
                render() {
                    return (this as unknown as ListaOrdenablePrompt<T>).dibujar(opciones.mensaje);
                },
            },
            false,
        );

        this.elementos = [...opciones.elementos];
        // Prompt no aplica `initialValue`: cada subclase asigna su valor inicial.
        this.value = this.elementos.map((elemento) => elemento.value);
        this.on("cursor", (accion) => this.alPresionar(accion));
    }

    private alPresionar(accion: string | undefined): void {
        if (accion === "space") {
            this.agarrado = !this.agarrado;
            return;
        }

        const delta = accion === "up" ? -1 : accion === "down" ? 1 : 0;
        if (delta === 0) {
            return;
        }

        const total = this.elementos.length;
        if (!this.agarrado) {
            this.cursor = (this.cursor + delta + total) % total;
            return;
        }

        // Agarrado no da la vuelta: mover el primero "hacia arriba" no lo manda al final.
        const destino = this.cursor + delta;
        if (destino < 0 || destino >= total) {
            return;
        }

        [this.elementos[this.cursor], this.elementos[destino]] = [this.elementos[destino]!, this.elementos[this.cursor]!];
        this.cursor = destino;
        this._setValue(this.elementos.map((elemento) => elemento.value));
    }

    dibujar(mensaje: string): string {
        const encabezado = `${styleText("gray", S_BAR)}\n${symbol(this.state)}  ${mensaje}\n`;
        const etiquetas = this.elementos.map((elemento, i) => `${i + 1}. ${elemento.label}`);

        if (this.state === "submit") {
            return `${encabezado}${styleText("gray", S_BAR)}  ${styleText("dim", etiquetas.join(" → "))}`;
        }

        if (this.state === "cancel") {
            return `${encabezado}${styleText("gray", S_BAR)}  ${styleText(["strikethrough", "dim"], etiquetas.join(" → "))}`;
        }

        const barra = styleText("cyan", S_BAR);
        const filas = etiquetas.map((etiqueta, i) => {
            if (i !== this.cursor) {
                return `${barra}  ${styleText("dim", S_RADIO_INACTIVE)} ${styleText("dim", etiqueta)}`;
            }

            return this.agarrado
                ? `${barra}  ${styleText("cyan", S_MOVIENDO)} ${styleText(["cyan", "bold"], etiqueta)}`
                : `${barra}  ${styleText("green", S_RADIO_ACTIVE)} ${etiqueta}`;
        });

        const ayuda = this.agarrado
            ? "↑/↓: mover · espacio: soltar · enter: confirmar"
            : "↑/↓: navegar · espacio: agarrar · enter: confirmar";

        return `${encabezado}${filas.join("\n")}\n${barra}  ${styleText("dim", ayuda)}\n${styleText("cyan", S_BAR_END)}\n`;
    }
}
