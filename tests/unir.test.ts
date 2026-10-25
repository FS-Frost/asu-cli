import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { leerASS } from "../src/nucleo/fuentes-ass.ts";
import { assATexto, ordenUnionPorDefecto, quitarReferenciaExtradata, renombrarResets, unirASS } from "../src/nucleo/unir-ass.ts";
import { construirASS, directorioTemporal } from "./utilidades.ts";

const DIALOGOS = construirASS({
    estilos: [["Default", "Arial"], ["Compartido", "Verdana"]],
    lineas: [
        "Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,Uno",
        "Comment: 0,0:00:02.00,0:00:03.00,Default,,0,0,0,,Nota",
        "Dialogue: 0,0:00:03.00,0:00:04.00,Compartido,,0,0,0,,Dos",
    ],
    fuentes: [{ nombre: "comun_0.ttf", datos: ["AAAA"] }],
});

const CARTELES = construirASS({
    estilos: [["Default", "Impact"], ["Compartido", "Verdana"]],
    lineas: [
        "Dialogue: 0,0:00:00.50,0:00:01.50,Default,,0,0,0,,{=1}{\\pos(10,10)}Cartel",
        "Dialogue: 0,0:00:05.00,0:00:06.00,Compartido,,0,0,0,,{\\rDefault\\b1}Reset",
    ],
    fuentes: [{ nombre: "comun_0.ttf", datos: ["AAAA"] }, { nombre: "otra_0.ttf", datos: ["BBBB"] }],
    extradata: ["1,_aegi_perspective_ambient_plane,e1"],
});

function unir(...archivos: [string, string][]) {
    return unirASS(archivos.map(([nombre, texto]) => ({ nombre, ass: leerASS(texto)! })));
}

describe("unirASS", () => {
    const { ass, renombrados, avisos } = unir(["Dialogos", DIALOGOS], ["Carteles", CARTELES]);

    test("estilo homónimo distinto se renombra con el nombre del archivo", () => {
        expect(renombrados).toEqual([{ archivo: "Carteles", original: "Default", nuevo: "Default (Carteles)" }]);
        expect(ass.styles.styles.map((s) => [s.name, s.fontName])).toEqual([
            ["Default", "Arial"],
            ["Compartido", "Verdana"],
            ["Default (Carteles)", "Impact"],
        ]);
    });

    test("líneas por bloque, en orden, con Comment, estilo y \\r renombrados", () => {
        expect(ass.events.lines.map((l) => [l.type, l.style, l.content])).toEqual([
            ["Dialogue", "Default", "Uno"],
            ["Comment", "Default", "Nota"],
            ["Dialogue", "Compartido", "Dos"],
            ["Dialogue", "Default (Carteles)", "{\\pos(10,10)}Cartel"],
            ["Dialogue", "Compartido", "{\\rDefault (Carteles)\\b1}Reset"],
        ]);
    });

    test("fuentes adjuntas sin repetir y extradata descartada", () => {
        expect(ass.fonts.files.map((f) => f.name)).toEqual(["comun_0.ttf", "otra_0.ttf"]);
        expect(ass.extraData.data).toEqual([]);
    });

    test("mismo PlayRes no avisa", () => {
        expect(avisos).toEqual([]);
    });

    test("PlayRes distinto avisa y se usa el del primero", () => {
        const otro = construirASS({ playRes: [1280, 720], estilos: [["Default", "Arial"]], lineas: [] });
        const resultado = unir(["Dialogos", DIALOGOS], ["Viejo", otro]);

        expect(resultado.avisos).toHaveLength(1);
        expect(resultado.avisos[0]).toContain("1280x720");
        expect(resultado.ass.scriptInfo.properties.get("PlayResX")).toBe("1920");
    });

    test("el orden de entrada manda", () => {
        const invertido = unir(["Carteles", CARTELES], ["Dialogos", DIALOGOS]);
        expect(invertido.ass.events.lines[0]!.content).toBe("{\\pos(10,10)}Cartel");
        expect(invertido.renombrados[0]!.nuevo).toBe("Default (Dialogos)");
    });

    test("no modifica los archivos de entrada", () => {
        const entrada = leerASS(CARTELES)!;
        unirASS([{ nombre: "A", ass: leerASS(DIALOGOS)! }, { nombre: "B", ass: entrada }]);
        expect(entrada.events.lines[0]!.style).toBe("Default");
    });

    test("comas del nombre de archivo no llegan al nombre del estilo", () => {
        const { renombrados } = unir(["A", DIALOGOS], ["Ep 01, final", CARTELES]);
        expect(renombrados[0]!.nuevo).toBe("Default (Ep 01  final)");
    });
});

describe("ordenUnionPorDefecto", () => {
    test("carteles → karaoke → subs → resto, sin distinguir mayúsculas, alfabético en cada grupo", () => {
        const rutas = ["Ep01 - Subs.ass", "otro.ass", "Ep01 - KARAOKE.ass", "ep01 - carteles.ass", "aaa.ass"].map((n) => join("C:\\x", n));
        expect(ordenUnionPorDefecto(rutas).map((r) => r.slice(5))).toEqual([
            "ep01 - carteles.ass",
            "Ep01 - KARAOKE.ass",
            "Ep01 - Subs.ass",
            "aaa.ass",
            "otro.ass",
        ]);
    });

    test("con varias palabras gana la de mayor prioridad; solo mira el nombre, no la carpeta", () => {
        const rutas = [join("C:\\carteles", "zz.ass"), join("C:\\x", "subs.ass"), join("C:\\x", "karaoke subs.ass")];
        expect(ordenUnionPorDefecto(rutas)).toEqual([rutas[2]!, rutas[1]!, rutas[0]!]);
    });

    test("no modifica el arreglo recibido", () => {
        const rutas = ["b subs.ass", "a carteles.ass"];
        ordenUnionPorDefecto(rutas);
        expect(rutas).toEqual(["b subs.ass", "a carteles.ass"]);
    });
});

describe("utilidades de contenido", () => {
    test("quitarReferenciaExtradata solo quita el prefijo {=N}", () => {
        expect(quitarReferenciaExtradata("{=3=12}{\\b1}Hola")).toBe("{\\b1}Hola");
        expect(quitarReferenciaExtradata("{\\b1}{=3}Hola")).toBe("{\\b1}{=3}Hola");
    });

    test("renombrarResets solo toca \\r dentro de {}", () => {
        const renombres = new Map([["A", "A (x)"]]);
        expect(renombrarResets("{\\rA}texto \\rA {\\b1\\rB\\rA}", renombres)).toBe("{\\rA (x)}texto \\rA {\\b1\\rB\\rA (x)}");
    });
});

describe("assATexto", () => {
    test("UTF-8 con BOM, CRLF y se vuelve a leer igual", () => {
        const { ass } = unir(["Dialogos", DIALOGOS], ["Carteles", CARTELES]);
        const texto = assATexto(ass);

        expect(texto.startsWith("﻿[Script Info]\r\n")).toBe(true);
        expect(texto.replaceAll("\r\n", "")).not.toContain("\n");

        const releido = leerASS(texto)!;
        expect(releido.events.lines).toHaveLength(5);
        expect(releido.styles.styles).toHaveLength(3);
        expect(releido.fonts.files).toHaveLength(2);
    });
});

describe("asu unir", () => {
    let dir: string;
    let home: string;
    const CLI = join(import.meta.dir, "..", "src", "cli.ts");

    const asu = (...args: string[]) => {
        const r = Bun.spawnSync(["bun", CLI, ...args], { env: { ...process.env, ASU_CLI_HOME: home }, stdin: "pipe" });
        return { codigo: r.exitCode, salida: r.stdout.toString() + r.stderr.toString() };
    };

    beforeEach(() => {
        dir = directorioTemporal();
        home = directorioTemporal();
        writeFileSync(join(dir, "dialogos.ass"), `﻿${DIALOGOS}`);
        writeFileSync(join(dir, "carteles.ass"), CARTELES);
    });

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
        rmSync(home, { recursive: true, force: true });
    });

    test("une en el orden de -s con el nombre de -o", () => {
        const { codigo, salida } = asu("unir", dir, "-s", "carteles.ass", "-s", "dialogos.ass", "-o", "Final");
        expect(codigo).toBe(0);
        expect(salida).toContain("Default (dialogos)");

        const unido = leerASS(readFileSync(join(dir, "Final.ass"), "utf8"))!;
        expect(unido.events.lines[0]!.content).toBe("{\\pos(10,10)}Cartel");
    });

    test("sin -o usa Unificado.ass y no sobrescribe sin --forzar", () => {
        expect(asu("unir", dir, "-s", "dialogos.ass", "-s", "carteles.ass").codigo).toBe(0);
        expect(asu("unir", dir, "-s", "dialogos.ass", "-s", "carteles.ass").codigo).toBe(1);
        expect(asu("unir", dir, "-s", "dialogos.ass", "-s", "carteles.ass", "-f").codigo).toBe(0);
    });

    test("menos de 2 archivos, repetidos o sin -s sin terminal es un error", () => {
        expect(asu("unir", dir, "-s", "dialogos.ass").codigo).toBe(1);
        expect(asu("unir", dir, "-s", "dialogos.ass", "-s", "DIALOGOS.ass").codigo).toBe(1);
        expect(asu("unir", dir).codigo).toBe(1);
    });
});
