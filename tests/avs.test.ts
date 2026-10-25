import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generarAvsCompresion, generarAvsTrabajo } from "../src/nucleo/avs.ts";
import { caracteresFuera1252, codificarWindows1252 } from "../src/nucleo/windows1252.ts";

describe("generarAvsTrabajo", () => {
    test("es idéntico byte a byte al RAW.avs del exe original", () => {
        // RAW-original.avs lo generó Asu.CrearAVSDeTrabajo.exe; solo se reemplazó la ruta del video por una ficticia.
        const original = readFileSync(join(import.meta.dir, "fixtures", "RAW-original.avs"));
        const generado = codificarWindows1252(generarAvsTrabajo("C:\\Raw\\Ep01\\video.mkv"));

        expect(Buffer.from(generado).equals(original)).toBe(true);
    });
});

describe("generarAvsCompresion", () => {
    test("video sin audio, redimensión y textsub en orden", () => {
        const avs = generarAvsCompresion("C:\\raw\\video.mkv", 1280, 720, ["C:\\raw\\b.ass", "C:\\raw\\a.ass"]);

        expect(avs).toBe(
            'FFVideoSource("C:\\raw\\video.mkv", threads=1, fpsnum=24000, fpsden=1001, colorspace="YV12")\r\n' +
            "spline64Resize(1280,720)\r\n" +
            'textsub("C:\\raw\\b.ass")\r\n' +
            'textsub("C:\\raw\\a.ass")\r\n',
        );
    });

    test("sin subtítulos no agrega textsub", () => {
        expect(generarAvsCompresion("C:\\v.mp4", 704, 396, [])).not.toContain("textsub");
    });
});

describe("Windows-1252", () => {
    test("codifica tildes, ñ y caracteres del rango 0x80–0x9F", () => {
        expect([...codificarWindows1252("ñá€…")]).toEqual([0xF1, 0xE1, 0x80, 0x85]);
    });

    test("detecta caracteres no representables", () => {
        expect(caracteresFuera1252("C:\\アニメ\\ep01.mkv")).toEqual(["ア", "ニ", "メ"]);
        expect(() => codificarWindows1252("日本")).toThrow();
    });
});
