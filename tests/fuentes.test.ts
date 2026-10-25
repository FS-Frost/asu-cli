import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { codificarAdjunto, decodificarAdjunto } from "../src/nucleo/adjuntos-ass.ts";
import { fuentesFaltantes, fuentesUsadas, leerASS, normalizarNombreFuente } from "../src/nucleo/fuentes-ass.ts";
import { nombresDeFuente } from "../src/nucleo/fuentes-archivo.ts";
import { assDePrueba } from "./utilidades.ts";

const ARIAL = "C:\\Windows\\Fonts\\arial.ttf";

describe("leerASS", () => {
    test("acepta archivos con BOM", () => {
        const ass = leerASS(`\uFEFF${assDePrueba()}`);
        expect(ass).not.toBeNull();
        expect(ass!.styles.styles.length).toBe(5);
    });
});

describe("fuentesUsadas", () => {
    const ass = leerASS(assDePrueba())!;
    const usadas = fuentesUsadas(ass);

    test("incluye todos los \\fn de cada línea, no solo el primero", () => {
        expect(usadas).toContain("Primera");
        expect(usadas).toContain("Segunda Fuente");
    });

    test("incluye estilos usados directo y vía \\r", () => {
        expect(usadas).toContain("@MS Gothic");
        expect(usadas).toContain("Fuente Reset");
    });

    test("ignora líneas Comment y estilos no usados", () => {
        expect(usadas).not.toContain("Wingdings");
        expect(usadas).not.toContain("Impact");
        expect(usadas).not.toContain("Comic Sans MS");
    });

    test("no repite fuentes que difieren solo en mayúsculas", () => {
        expect(usadas.filter((f) => f.toLowerCase() === "arial")).toHaveLength(1);
        expect(usadas).toHaveLength(5);
    });
});

describe("fuentesFaltantes", () => {
    test("compara sin @ y sin distinguir mayúsculas", () => {
        const disponibles = new Set(["arial", "ms gothic", "primera"].map(normalizarNombreFuente));
        expect(fuentesFaltantes(["ARIAL", "@MS Gothic", "Primera", "Otra"], disponibles)).toEqual(["Otra"]);
    });
});

describe("adjuntos [Fonts]", () => {
    test("decodifica vectores conocidos", () => {
        expect([...decodificarAdjunto(["97*D"])]).toEqual([0x61, 0x62, 0x63]);
        expect([...decodificarAdjunto(["91"])]).toEqual([0x61]);
        expect([...decodificarAdjunto(["97*"])]).toEqual([0x61, 0x62]);
    });

    test("ida y vuelta con datos arbitrarios y líneas de 80 caracteres", () => {
        const datos = Uint8Array.from({ length: 1000 }, (_, i) => (i * 37) % 256);
        const lineas = codificarAdjunto(datos);
        expect(lineas.every((linea) => linea.length <= 80)).toBe(true);
        expect([...decodificarAdjunto(lineas)]).toEqual([...datos]);
    });
});

describe.skipIf(!existsSync(ARIAL))("nombres de fuente (requiere arial.ttf de Windows)", () => {
    test("lee familia y nombre completo", () => {
        const nombres = nombresDeFuente(readFileSync(ARIAL));
        expect(nombres).toContain("arial");
    });

    test("fuente incrustada en [Fonts] se decodifica y se reconoce", () => {
        const lineas = codificarAdjunto(readFileSync(ARIAL));
        const ass = leerASS(`${assDePrueba()}\n[Fonts]\nfontname: arial_0.ttf\n${lineas.join("\n")}\n`)!;
        expect(ass.fonts.files).toHaveLength(1);
        expect(nombresDeFuente(decodificarAdjunto(ass.fonts.files[0]!.data))).toContain("arial");
    });
});
