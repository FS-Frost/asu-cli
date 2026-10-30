import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import {
    PREAJUSTES_DE_FABRICA,
    activarSalida,
    agregarPreajuste,
    cargarConfig,
    configDeFabrica,
    guardarConfig,
    parsearParalelo,
    parsearResolucion,
    quitarPreajuste,
    rutaConfig,
    XVID_DE_FABRICA,
    XVID_DE_FABRICA_V1,
    migrarConfig,
    validarSalida,
    type Salida,
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
        expect(PREAJUSTES_DE_FABRICA.map((p) => [p.ancho, p.alto, p.etiqueta])).toEqual([
            [1280, 720, "MP4 720"],
            [704, 396, "AVI"],
            [1920, 1080, "MP4 1080"],
        ]);
    });

    test("agregar rechaza nombres repetidos sin distinguir mayúsculas", () => {
        const config = configDeFabrica();
        expect(() => agregarPreajuste(config, { nombre: "720P", ancho: 1, alto: 1, etiqueta: "x" })).toThrow();
    });

    test("agregar rechaza etiquetas inválidas", () => {
        expect(() => agregarPreajuste(configDeFabrica(), { nombre: "x", ancho: 1, alto: 1, etiqueta: "a:b" })).toThrow();
    });

    test("agregar y quitar", () => {
        const conNuevo = agregarPreajuste(configDeFabrica(), { nombre: "900p", ancho: 1600, alto: 900, etiqueta: "MP4 900" });
        expect(conNuevo.preajustes).toHaveLength(4);
        expect(quitarPreajuste(conNuevo, "900P").preajustes).toHaveLength(3);
        expect(() => quitarPreajuste(conNuevo, "no-existe")).toThrow();
    });
});

describe("salidas", () => {
    test("de fábrica: 1080 y 720 en MP4 con AAC 192, 396 en AVI de 180 MB con MP3 192, sin rutas", () => {
        const config = configDeFabrica();
        expect(config.salidas.map((s) => [s.nombre, s.tipo, s.preajuste, s.audio.codec, s.audio.kbps, s.activa])).toEqual([
            ["1080", "mp4-x264", "1080p", "aac", 192, true],
            ["720", "mp4-x264", "720p", "aac", 192, true],
            ["396", "avi-xvid", "396p", "mp3", 192, true],
        ]);
        expect((config.salidas[2] as Extract<Salida, { tipo: "avi-xvid" }>).tamanoMB).toBe(180);
        expect([config.rutaMegui, config.carpetaSalida, config.grupo]).toEqual([null, null, "SyncRajo"]);
    });

    test("no se puede quitar un preajuste que usa una salida", () => {
        expect(() => quitarPreajuste(configDeFabrica(), "1080p")).toThrow("1080");
    });

    test("activar y desactivar", () => {
        const config = activarSalida(configDeFabrica(), "396", false);
        expect(config.salidas.find((s) => s.nombre === "396")!.activa).toBe(false);
        expect(() => activarSalida(config, "4k", true)).toThrow();
    });

    test("validación: preajuste inexistente, códec de audio incorrecto y tipo desconocido", () => {
        const [mp4, , avi] = configDeFabrica().salidas;
        const preajustes = [...PREAJUSTES_DE_FABRICA];
        expect(validarSalida(mp4!, preajustes)).toBeUndefined();
        expect(validarSalida({ ...mp4!, preajuste: "4k" }, preajustes)).toContain("4k");
        expect(validarSalida({ ...mp4!, audio: { codec: "mp3", kbps: 192 } }, preajustes)).toContain("aac");
        expect(validarSalida({ ...avi!, audio: { codec: "aac", kbps: 192 } }, preajustes)).toContain("mp3");
        expect(validarSalida({ ...mp4!, tipo: "mkv" } as unknown as Salida, preajustes)).toContain("mkv");
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
        const config = agregarPreajuste(configDeFabrica(), { nombre: "900p", ancho: 1600, alto: 900, etiqueta: "MP4 900" });
        guardarConfig(config);
        expect(cargarConfig()).toEqual(config);
    });

    test("config parcial se completa con lo de fábrica", () => {
        writeFileSync(rutaConfig(), JSON.stringify({ rutaMegui: "C:\\MeGUI" }));
        const config = cargarConfig();
        expect(config.rutaMegui).toBe("C:\\MeGUI");
        expect(config.salidas).toEqual(configDeFabrica().salidas);
    });

    test('preajuste con el campo viejo "archivo" explica el cambio', () => {
        writeFileSync(rutaConfig(), JSON.stringify({ preajustes: [{ nombre: "720p", ancho: 1280, alto: 720, archivo: "MP4-720p" }] }));
        expect(() => cargarConfig()).toThrow("etiqueta");
    });

    test("archivo inválido da un error con la ruta", () => {
        guardarConfig(configDeFabrica());
        writeFileSync(rutaConfig(), '{"preajustes": [{"nombre": "x", "ancho": -1}]}');
        expect(() => cargarConfig()).toThrow(rutaConfig());
    });
});

describe("paralelo", () => {
    test("de fábrica 3; parsearParalelo acepta enteros ≥ 1", () => {
        expect(configDeFabrica().paralelo).toBe(3);
        expect(parsearParalelo("2")).toBe(2);
        expect(parsearParalelo(1)).toBe(1);
        expect(parsearParalelo("0")).toBeNull();
        expect(parsearParalelo("1.5")).toBeNull();
        expect(parsearParalelo("dos")).toBeNull();
    });
});

describe("migración v1 → v2", () => {
    let home: string;

    beforeEach(() => {
        home = directorioTemporal();
        process.env.ASU_CLI_HOME = home;
    });

    afterEach(() => {
        delete process.env.ASU_CLI_HOME;
        rmSync(home, { recursive: true, force: true });
    });

    /** config.json como lo dejaba la versión anterior (sin version, x264 sin preset, XviD de MeGUI). */
    const configV1 = (xvid: readonly string[] = XVID_DE_FABRICA_V1) => {
        const fabrica = configDeFabrica();
        return {
            preajustes: fabrica.preajustes,
            salidas: fabrica.salidas.map((salida) => {
                if (salida.tipo === "mp4-x264") {
                    const { preset: _, ...x264 } = salida.x264;
                    return { ...salida, x264 };
                }
                return { ...salida, xvid: [...xvid] };
            }),
            rutaMegui: "C:\MeGUI",
            carpetaSalida: null,
            grupo: "SyncRajo",
            paralelo: 3,
        };
    };

    test("valores viejos de fábrica: preset slow y XviD sin -turbo con 4 hilos; se guarda una vez", () => {
        writeFileSync(rutaConfig(), JSON.stringify(configV1()));
        const avisos: string[] = [];

        const config = cargarConfig((mensaje) => avisos.push(mensaje));
        const [mp4, , avi] = config.salidas;
        expect((mp4 as Extract<Salida, { tipo: "mp4-x264" }>).x264.preset).toBe("slow");
        expect((avi as Extract<Salida, { tipo: "avi-xvid" }>).xvid).toEqual([...XVID_DE_FABRICA]);
        expect(config.rutaMegui).toBe("C:\MeGUI");
        expect(avisos).toHaveLength(1);

        expect(JSON.parse(readFileSync(rutaConfig(), "utf8")).version).toBe(2);
        const otraVez: string[] = [];
        cargarConfig((mensaje) => otraVez.push(mensaje));
        expect(otraVez).toHaveLength(0);
    });

    test("XviD editado a mano: no se toca y se avisa", () => {
        const editadas = [...XVID_DE_FABRICA_V1, "-vhqmode", "4"];
        writeFileSync(rutaConfig(), JSON.stringify(configV1(editadas)));
        const avisos: string[] = [];

        const config = cargarConfig((mensaje) => avisos.push(mensaje));
        expect((config.salidas[2] as Extract<Salida, { tipo: "avi-xvid" }>).xvid).toEqual(editadas);
        expect(avisos.some((aviso) => aviso.includes("editadas"))).toBe(true);
    });

    test("x264 con preset propio se respeta; preset inválido es un error", () => {
        expect(migrarConfig({ version: 1, salidas: [{ tipo: "mp4-x264", x264: { preset: "veryslow" } }] }).datos.salidas).toEqual([
            { tipo: "mp4-x264", x264: { preset: "veryslow" } },
        ]);

        const config = configV1();
        (config.salidas[0] as { x264: object }).x264 = { ...(config.salidas[0] as { x264: object }).x264, preset: "rapidísimo" };
        writeFileSync(rutaConfig(), JSON.stringify({ ...config, version: 2 }));
        expect(() => cargarConfig()).toThrow("Preset x264 inválido");
    });

    test("config ya en v2 no se migra", () => {
        expect(migrarConfig({ version: 2, salidas: [] }).migrada).toBe(false);
    });
});
