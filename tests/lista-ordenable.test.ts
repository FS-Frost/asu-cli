import { isCancel } from "@clack/core";
import { describe, expect, test } from "bun:test";
import { PassThrough, Writable } from "node:stream";
import { ListaOrdenablePrompt } from "../src/lista-ordenable.ts";

const ARRIBA = "\x1b[A";
const ABAJO = "\x1b[B";
const ESPACIO = " ";
const ENTER = "\r";
const CTRL_C = "\x03";

/** Ejecuta la lista con teclas simuladas y devuelve el resultado. */
async function ejecutar(teclas: string[], elementos = ["a", "b", "c"]) {
    const input = new PassThrough();
    const output = new Writable({ write: (_trozo, _codificacion, listo) => listo() });
    const prompt = new ListaOrdenablePrompt({
        mensaje: "Orden",
        elementos: elementos.map((valor) => ({ value: valor, label: valor })),
        input,
        output,
    });

    const resultado = prompt.prompt();
    for (const tecla of teclas) {
        await Bun.sleep(5);
        input.write(tecla);
    }

    return resultado;
}

describe("ListaOrdenablePrompt", () => {
    test("Enter sin mover nada acepta el orden propuesto", async () => {
        expect(await ejecutar([ENTER])).toEqual(["a", "b", "c"]);
    });

    test("navegar sin agarrar no cambia el orden", async () => {
        expect(await ejecutar([ABAJO, ABAJO, ARRIBA, ENTER])).toEqual(["a", "b", "c"]);
    });

    test("agarrar con espacio y mover con flechas", async () => {
        // Agarra "a" y la baja dos posiciones.
        expect(await ejecutar([ESPACIO, ABAJO, ABAJO, ESPACIO, ENTER])).toEqual(["b", "c", "a"]);
        // Va a "c", la agarra y la sube al principio.
        expect(await ejecutar([ABAJO, ABAJO, ESPACIO, ARRIBA, ARRIBA, ENTER])).toEqual(["c", "a", "b"]);
    });

    test("agarrado no da la vuelta en los bordes", async () => {
        expect(await ejecutar([ESPACIO, ARRIBA, ENTER])).toEqual(["a", "b", "c"]);
    });

    test("soltar y seguir navegando mueve solo el cursor", async () => {
        // Agarra "a", la baja una, la suelta, baja el cursor a "c", la agarra y la sube una.
        expect(await ejecutar([ESPACIO, ABAJO, ESPACIO, ABAJO, ESPACIO, ARRIBA, ENTER])).toEqual(["b", "c", "a"]);
    });

    test("Ctrl+C cancela", async () => {
        expect(isCancel(await ejecutar([CTRL_C]))).toBe(true);
    });
});
