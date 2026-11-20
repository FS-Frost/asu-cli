import { Prompt } from "@clack/core";
import { S_BAR, S_BAR_END, S_CHECKBOX_ACTIVE, S_CHECKBOX_INACTIVE, S_CHECKBOX_SELECTED, limitOptions, symbol } from "@clack/prompts";
import type { Readable, Writable } from "node:stream";
import { styleText } from "node:util";

export type ElementoMarcable<T> = {
    value: T;
    label: string;
    hint?: string;
    /** Lo marca la tecla `c` ("solo los que tienen CRC"). */
    destacado?: boolean;
};

export type OpcionesListaMarcable<T> = {
    mensaje: string;
    elementos: ElementoMarcable<T>[];
    marcados: T[];
    /** Habilita la tecla `c` (marcar solo los destacados) con este texto de ayuda. */
    teclaDestacados?: string;
    input?: Readable;
    output?: Writable;
};

/**
 * Lista para marcar varios con atajos: ↑/↓ navegan, espacio marca/desmarca, `a` marca todos,
 * `n` desmarca todos, `i` invierte y `c` (si se habilita) marca solo los destacados. Enter confirma
 * (puede quedar vacía); Esc / Ctrl+C cancela. `h/j/k/l` son flechas en clack: no se usan.
 */
export class ListaMarcablePrompt<T> extends Prompt<T[]> {
    elementos: ElementoMarcable<T>[];
    cursor = 0;

    constructor(private readonly opciones: OpcionesListaMarcable<T>) {
        super(
            {
                input: opciones.input,
                output: opciones.output,
                render() {
                    return (this as unknown as ListaMarcablePrompt<T>).dibujar();
                },
            },
            false,
        );

        this.elementos = [...opciones.elementos];
        // Prompt no aplica `initialValue`: cada subclase asigna su valor inicial.
        this.value = this.elementos.filter((e) => opciones.marcados.includes(e.value)).map((e) => e.value);
        this.on("cursor", (accion) => this.alMover(accion));
        this.on("key", (_caracter, tecla) => this.alTecla(tecla?.name));
    }

    private marcar(valores: T[]): void {
        this._setValue(valores);
    }

    private alMover(accion: string | undefined): void {
        const total = this.elementos.length;
        if (accion === "up" || accion === "left") {
            this.cursor = (this.cursor - 1 + total) % total;
        } else if (accion === "down" || accion === "right") {
            this.cursor = (this.cursor + 1) % total;
        } else if (accion === "space") {
            const valor = this.elementos[this.cursor]!.value;
            const actuales = this.value ?? [];
            this.marcar(actuales.includes(valor) ? actuales.filter((v) => v !== valor) : this.enOrden([...actuales, valor]));
        }
    }

    private alTecla(nombre: string | undefined): void {
        const todos = this.elementos.map((e) => e.value);
        const actuales = this.value ?? [];
        switch (nombre) {
            case "a":
                this.marcar(todos);
                break;
            case "n":
                this.marcar([]);
                break;
            case "i":
                this.marcar(todos.filter((v) => !actuales.includes(v)));
                break;
            case "c":
                if (this.opciones.teclaDestacados) {
                    this.marcar(this.elementos.filter((e) => e.destacado).map((e) => e.value));
                }
                break;
        }
    }

    /** Los valores marcados, en el orden de la lista. */
    private enOrden(valores: T[]): T[] {
        return this.elementos.map((e) => e.value).filter((v) => valores.includes(v));
    }

    dibujar(): string {
        const encabezado = `${styleText("gray", S_BAR)}\n${symbol(this.state)}  ${this.opciones.mensaje}\n`;
        const marcados = this.value ?? [];
        const etiquetasMarcadas = this.elementos.filter((e) => marcados.includes(e.value)).map((e) => e.label);

        if (this.state === "submit") {
            const resumen = etiquetasMarcadas.length > 0 ? etiquetasMarcadas.join(", ") : "ninguno";
            return `${encabezado}${styleText("gray", S_BAR)}  ${styleText("dim", resumen)}`;
        }
        if (this.state === "cancel") {
            return `${encabezado}${styleText("gray", S_BAR)}  ${styleText(["strikethrough", "dim"], "cancelado")}`;
        }

        const barra = styleText("cyan", S_BAR);
        const filas = limitOptions({
            output: this.opciones.output as NodeJS.WriteStream | undefined,
            options: this.elementos,
            cursor: this.cursor,
            columnPadding: 3,
            rowPadding: 6,
            style: (elemento, activo) => {
                const marcado = marcados.includes(elemento.value);
                const casilla = marcado ? styleText("green", S_CHECKBOX_SELECTED) : activo ? styleText("cyan", S_CHECKBOX_ACTIVE) : styleText("dim", S_CHECKBOX_INACTIVE);
                const pista = elemento.hint ? ` ${styleText("dim", `(${elemento.hint})`)}` : "";
                const etiqueta = activo ? elemento.label : styleText("dim", elemento.label);
                return `${casilla} ${etiqueta}${activo || marcado ? pista : ""}`;
            },
        }).map((fila) => `${barra}  ${fila}`);

        const atajos = [
            "↑/↓ navegar",
            "espacio marcar",
            "a todos",
            "n ninguno",
            ...(this.opciones.teclaDestacados ? [`c ${this.opciones.teclaDestacados}`] : []),
            "i invertir",
            "enter confirmar",
        ];
        const cuenta = `${marcados.length} de ${this.elementos.length} marcados`;
        return `${encabezado}${filas.join("\n")}\n${barra}  ${styleText("dim", `${cuenta} · ${atajos.join(" · ")}`)}\n${styleText("cyan", S_BAR_END)}\n`;
    }
}
