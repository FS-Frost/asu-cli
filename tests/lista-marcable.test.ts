import { isCancel } from "@clack/core";
import { describe, expect, test } from "bun:test";
import { PassThrough, Writable } from "node:stream";
import { elementosListaCrc } from "../src/comandos/crc.ts";
import { ListaMarcablePrompt } from "../src/lista-marcable.ts";

const ARRIBA = "\x1b[A";
const ABAJO = "\x1b[B";
const ESPACIO = " ";
const ENTER = "\r";
const CTRL_C = "\x03";

// "b" y "d" son los destacados (tienen CRC); de entrada va marcada solo "b".
const ELEMENTOS = [
    { value: "a", label: "a" },
    { value: "b", label: "b", destacado: true },
    { value: "c", label: "c" },
    { value: "d", label: "d", destacado: true },
];

/** Ejecuta la lista con teclas simuladas y devuelve el resultado. */
async function ejecutar(teclas: string[], opciones: { marcados?: string[]; teclaDestacados?: string } = {}) {
    const input = new PassThrough();
    const output = new Writable({ write: (_trozo, _codificacion, listo) => listo() });
    const prompt = new ListaMarcablePrompt({
        mensaje: "Archivos",
        elementos: ELEMENTOS,
        marcados: opciones.marcados ?? ["b"],
        teclaDestacados: "teclaDestacados" in opciones ? opciones.teclaDestacados : "solo con CRC",
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

describe("ListaMarcablePrompt", () => {
    test("Enter sin tocar nada devuelve los marcados de entrada", async () => {
        expect(await ejecutar([ENTER])).toEqual(["b"]);
    });

    test("espacio marca y desmarca el del cursor; el resultado va en el orden de la lista", async () => {
        // Marca "c" (abajo ×2) y luego "a" (arriba ×2), desmarca "b".
        expect(await ejecutar([ABAJO, ABAJO, ESPACIO, ARRIBA, ARRIBA, ESPACIO, ABAJO, ESPACIO, ENTER])).toEqual(["a", "c"]);
    });

    test("a marca todos (no alterna), n desmarca todos", async () => {
        expect(await ejecutar(["a", ENTER])).toEqual(["a", "b", "c", "d"]);
        expect(await ejecutar(["a", "a", ENTER])).toEqual(["a", "b", "c", "d"]);
        expect(await ejecutar(["n", ENTER])).toEqual([]);
    });

    test("c marca solo los destacados (con CRC); i invierte", async () => {
        expect(await ejecutar(["a", "c", ENTER])).toEqual(["b", "d"]);
        expect(await ejecutar(["i", ENTER])).toEqual(["a", "c", "d"]);
    });

    test("sin teclaDestacados, c no hace nada", async () => {
        expect(await ejecutar(["c", ENTER], { teclaDestacados: undefined })).toEqual(["b"]);
    });

    test("Ctrl+C cancela", async () => {
        expect(isCancel(await ejecutar([CTRL_C]))).toBe(true);
    });
});

describe("elementosListaCrc", () => {
    test("todos en orden; los que tienen CRC van marcados, destacados y con el CRC como pista", () => {
        const { elementos, marcados } = elementosListaCrc(["a [22A92BA7].mkv", "b.mkv", "c_(ABCD1234).mkv"]);
        expect(marcados).toEqual(["a [22A92BA7].mkv", "c_(ABCD1234).mkv"]);
        expect(elementos.map((e) => [e.label, e.hint, e.destacado])).toEqual([
            ["a [22A92BA7].mkv", "CRC 22A92BA7", true],
            ["b.mkv", undefined, false],
            ["c_(ABCD1234).mkv", "CRC ABCD1234, sin corchetes", true],
        ]);
    });

    test("sin archivos con CRC: nada marcado", () => {
        expect(elementosListaCrc(["a.mkv", "b.mkv"]).marcados).toEqual([]);
    });
});
