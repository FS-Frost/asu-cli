import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import {
    PREAJUSTES_DE_FABRICA,
    agregarPreajuste,
    cargarConfig,
    configDeFabrica,
    guardarConfig,
    parsearResolucion,
    quitarPreajuste,
    rutaConfig,
} from "../src/nucleo/config.ts";
import { directorioTemporal } from "./utilidades.ts";

describe("parsearResolucion", () => {
    test("acepta <ancho>x<alto>", () => {
        expect(parsearResolucion("1280x720")).toEqual({ ancho: 1280, alto: 720 });
        expect(parsearResolucion(" 1920 X 1080 ")).toEqual({ ancho: 1920, alto: 1080 });
    });

    test("rechaza formatos inválidos y ceros", () => {
        expect(parsearResolucion("1280")).toBeNull();
        expect(parsearResolucion("0x720")).toBeNull();
        expect(parsearResolucion("12.5x7")).toBeNull();
    });
});

describe("preajustes", () => {
    test("de fábrica son los del .bat original", () => {
        expect(PREAJUSTES_DE_FABRICA.map((p) => [p.ancho, p.alto, p.archivo])).toEqual([
            [1280, 720, "MP4-720p"],
            [704, 396, "AVI"],
            [1920, 1080, "MP4-1080p"],
        ]);
    });

    test("agregar rechaza nombres repetidos sin distinguir mayúsculas", () => {
        const config = configDeFabrica();
        expect(() => agregarPreajuste(config, { nombre: "720P", ancho: 1, alto: 1, archivo: "x" })).toThrow();
    });

    test("agregar rechaza nombres de archivo inválidos", () => {
        expect(() => agregarPreajuste(configDeFabrica(), { nombre: "x", ancho: 1, alto: 1, archivo: "a:b" })).toThrow();
    });

    test("agregar y quitar", () => {
        const conNuevo = agregarPreajuste(configDeFabrica(), { nombre: "900p", ancho: 1600, alto: 900, archivo: "MP4-900p" });
        expect(conNuevo.preajustes).toHaveLength(4);
        expect(quitarPreajuste(conNuevo, "900P").preajustes).toHaveLength(3);
        expect(() => quitarPreajuste(conNuevo, "no-existe")).toThrow();
    });
});

describe("archivo de configuración", () => {
    let home: string;

    beforeEach(() => {
        home = directorioTemporal();
        process.env.ASU_CLI_HOME = home;
    });

    afterEach(() => {
        delete process.env.ASU_CLI_HOME;
        rmSync(home, { recursive: true, force: true });
    });

    test("sin archivo devuelve la de fábrica y no lo crea", () => {
        expect(cargarConfig()).toEqual(configDeFabrica());
        expect(existsSync(rutaConfig())).toBe(false);
    });

    test("guarda y vuelve a leer", () => {
        const config = agregarPreajuste(configDeFabrica(), { nombre: "900p", ancho: 1600, alto: 900, archivo: "MP4-900p" });
        guardarConfig(config);
        expect(cargarConfig()).toEqual(config);
    });

    test("archivo inválido da un error con la ruta", () => {
        guardarConfig(configDeFabrica());
        writeFileSync(rutaConfig(), '{"preajustes": [{"nombre": "x", "ancho": -1}]}');
        expect(() => cargarConfig()).toThrow(rutaConfig());
    });
});
