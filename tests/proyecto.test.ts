import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buscarProyecto, guardarEleccionesEncode, guardarProyecto, leerEleccionesEncode } from "../src/nucleo/proyecto.ts";
import { directorioTemporal, escribirJson } from "./utilidades.ts";

describe("asu.json", () => {
    let base: string;
    let episodio: string;

    beforeEach(() => {
        base = directorioTemporal();
        episodio = join(base, "Serie", "01");
        mkdirSync(episodio, { recursive: true });
    });

    afterEach(() => {
        rmSync(base, { recursive: true, force: true });
    });

    test("guardarEleccionesEncode mezcla campos y conserva el resto del archivo", () => {
        escribirJson(join(episodio, ".asu", "asu.json"), JSON.stringify({ fuente: "BD", otro: 1 }));
        guardarEleccionesEncode(episodio, { versiones: ["1080"] });
        guardarEleccionesEncode(episodio, { serie: "Serie" });
        guardarEleccionesEncode(episodio, { versiones: ["720", "396"] });

        expect(JSON.parse(readFileSync(join(episodio, ".asu", "asu.json"), "utf8"))).toEqual({
            fuente: "BD",
            otro: 1,
            encode: { versiones: ["720", "396"], serie: "Serie" },
        });
        expect(leerEleccionesEncode(episodio)).toEqual({ versiones: ["720", "396"], serie: "Serie" });
    });

    test("leerEleccionesEncode: sin archivo o dañado devuelve vacío; solo mira esa carpeta", () => {
        expect(leerEleccionesEncode(episodio)).toEqual({});
        escribirJson(join(base, "Serie", ".asu", "asu.json"), JSON.stringify({ encode: { serie: "X" } }));
        expect(leerEleccionesEncode(episodio)).toEqual({});
        escribirJson(join(episodio, ".asu", "asu.json"), "{ roto");
        expect(leerEleccionesEncode(episodio)).toEqual({});
    });

    test("se escribe en .asu\\asu.json; un asu.json suelto (ubicación vieja) se ignora", () => {
        writeFileSync(join(base, "Serie", "asu.json"), JSON.stringify({ fuente: "BD" }));
        writeFileSync(join(episodio, "asu.json"), JSON.stringify({ encode: { serie: "Vieja" } }));
        expect(buscarProyecto(episodio)).toBeNull();
        expect(leerEleccionesEncode(episodio)).toEqual({});

        guardarEleccionesEncode(episodio, { serie: "Nueva" });
        expect(existsSync(join(episodio, ".asu", "asu.json"))).toBe(true);
        expect(JSON.parse(readFileSync(join(episodio, "asu.json"), "utf8"))).toEqual({ encode: { serie: "Vieja" } });
        expect(guardarProyecto(join(base, "Serie"), { fuente: "HDTV" })).toBe(join(base, "Serie", ".asu", "asu.json"));
    });

    test("buscarProyecto salta los asu.json sin fuente", () => {
        guardarProyecto(join(base, "Serie"), { fuente: "HDTV" });
        guardarEleccionesEncode(episodio, { versiones: ["1080"] });
        expect(buscarProyecto(episodio)?.datos.fuente).toBe("HDTV");
    });
});
