import * as p from "@clack/prompts";
import { ListaOrdenablePrompt, type ElementoLista } from "./lista-ordenable.ts";

/** Error esperado (entrada inválida, archivo faltante...): se muestra el mensaje sin stack. */
export class ErrorUsuario extends Error {}

/** El usuario canceló un prompt (Ctrl+C / Esc). */
export class Cancelado extends Error {
    constructor() {
        super("Operación cancelada.");
    }
}

/** Hay terminal para preguntar. Sin ella, todo dato faltante es un error. */
export function esInteractivo(): boolean {
    // Solo para tests: fuerza el modo sin terminal aunque `bun test` corra en una.
    if (process.env.ASU_CLI_NO_INTERACTIVO) {
        return false;
    }

    return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function sinCancelar<T>(valor: T): Exclude<T, symbol> {
    if (p.isCancel(valor)) {
        throw new Cancelado();
    }

    return valor as Exclude<T, symbol>;
}

export type Opcion<T> = {
    value: T;
    label: string;
    hint?: string;
};

export async function elegir<T>(mensaje: string, opciones: Opcion<T>[], inicial?: T): Promise<T> {
    const resultado = await p.select({
        message: mensaje,
        options: opciones as Parameters<typeof p.select<T>>[0]["options"],
        initialValue: inicial,
    });
    return sinCancelar(resultado);
}

export async function elegirVarios<T>(mensaje: string, opciones: Opcion<T>[], iniciales: T[]): Promise<T[]> {
    const resultado = await p.multiselect({
        message: mensaje,
        options: opciones as Parameters<typeof p.multiselect<T>>[0]["options"],
        initialValues: iniciales,
        required: false,
    });
    return sinCancelar(resultado);
}

export async function preguntarTexto(
    mensaje: string,
    opciones: { inicial?: string; validar?: (valor: string) => string | undefined } = {},
): Promise<string> {
    const resultado = await p.text({
        message: mensaje,
        initialValue: opciones.inicial,
        validate: opciones.validar ? (valor) => opciones.validar!(valor ?? "") : undefined,
    });
    return sinCancelar(resultado);
}

/** Lista reordenable (ver `ListaOrdenablePrompt`). Devuelve los valores en el orden final. */
export async function ordenarLista<T>(mensaje: string, elementos: ElementoLista<T>[]): Promise<T[]> {
    const resultado = await new ListaOrdenablePrompt({ mensaje, elementos }).prompt();
    return sinCancelar(resultado) ?? elementos.map((elemento) => elemento.value);
}

export async function confirmar(mensaje: string, inicial = true): Promise<boolean> {
    return sinCancelar(await p.confirm({ message: mensaje, initialValue: inicial, active: "Sí", inactive: "No" }));
}
