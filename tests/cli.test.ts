import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { listarArchivos, EXTENSIONES_VIDEO } from "../src/nucleo/archivos.ts";
import { assDePrueba, directorioTemporal } from "./utilidades.ts";

const CLI = join(import.meta.dir, "..", "src", "cli.ts");

let dir: string;
let home: string;

/** Ejecuta la CLI sin terminal (stdin en pipe), con config y fuentes del sistema aisladas. */
function asu(...args: string[]) {
    const resultado = Bun.spawnSync(["bun", CLI, ...args], {
        env: { ...process.env, ASU_CLI_HOME: home, ASU_CLI_DIRECTORIOS_FUENTES: "" },
        stdin: "pipe",
    });

    return {
        codigo: resultado.exitCode,
        salida: resultado.stdout.toString() + resultado.stderr.toString(),
    };
}

beforeEach(() => {
    dir = directorioTemporal();
    home = directorioTemporal();
});

afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
});

describe("listado de videos", () => {
    test("main.ts y .m4a no cuentan como video", () => {
        for (const nombre of ["main.ts", "audio.m4a", "video.mkv"]) {
            writeFileSync(join(dir, nombre), "");
        }

        expect(listarArchivos(dir, EXTENSIONES_VIDEO)).toEqual([join(dir, "video.mkv")]);
    });
});

describe("asu avs-trabajo", () => {
    test("crea RAW.avs con el único video, ignorando main.ts", () => {
        writeFileSync(join(dir, "main.ts"), "");
        writeFileSync(join(dir, "video.mkv"), "");

        const { codigo } = asu("avs-trabajo", dir);
        expect(codigo).toBe(0);
        expect(readFileSync(join(dir, "RAW.avs"), "latin1")).toStartWith(`raw="${join(dir, "video.mkv")}"\r\n`);
    });

    test("si RAW.avs existe: falla sin --forzar, crea otro con --salida, sobrescribe con --forzar", () => {
        writeFileSync(join(dir, "video.mkv"), "");
        writeFileSync(join(dir, "RAW.avs"), "previo");

        const sinForzar = asu("avs-trabajo", dir);
        expect(sinForzar.codigo).toBe(1);
        expect(sinForzar.salida).toContain("--forzar");
        expect(readFileSync(join(dir, "RAW.avs"), "latin1")).toBe("previo");

        expect(asu("avs-trabajo", dir, "--salida", "OTRO").codigo).toBe(0);
        expect(existsSync(join(dir, "OTRO.avs"))).toBe(true);

        expect(asu("avs-trabajo", dir, "--forzar").codigo).toBe(0);
        expect(readFileSync(join(dir, "RAW.avs"), "latin1")).toStartWith("raw=");
    });

    test("con varios videos y sin terminal pide --video", () => {
        writeFileSync(join(dir, "a.mkv"), "");
        writeFileSync(join(dir, "b.mp4"), "");

        const { codigo, salida } = asu("avs-trabajo", dir);
        expect(codigo).toBe(1);
        expect(salida).toContain("--video");
        expect(asu("avs-trabajo", dir, "--video", "b.mp4").codigo).toBe(0);
    });

    test("opción desconocida es un error", () => {
        expect(asu("avs-trabajo", dir, "--no-existe").codigo).toBe(1);
    });
});

/** Raw con el formato habitual: serie y episodio se deducen del nombre. */
const RAW = "[Grupo] Serie de Prueba - 01 [1080p][ABCD1234].mkv";

describe("asu avs-compresion", () => {
    test("usa el preajuste y los subs en el orden indicado", () => {
        writeFileSync(join(dir, RAW), "");
        writeFileSync(join(dir, "a.ass"), "");
        writeFileSync(join(dir, "b.ass"), "");

        const { codigo } = asu("avs-compresion", dir, "-p", "720p", "-s", "b.ass", "-s", "a.ass");
        expect(codigo).toBe(0);

        const avs = readFileSync(join(dir, "Serie de Prueba 01 MP4 720.avs"), "latin1");
        expect(avs).toContain("spline64Resize(1280,720)");
        expect(avs.indexOf("b.ass")).toBeLessThan(avs.indexOf("a.ass"));
    });

    test("sin --subs ni terminal usa todos los .ass en orden alfabético", () => {
        writeFileSync(join(dir, RAW), "");
        writeFileSync(join(dir, "z.ass"), "");
        writeFileSync(join(dir, "m.ass"), "");

        expect(asu("avs-compresion", dir, "-p", "396p").codigo).toBe(0);
        const avs = readFileSync(join(dir, "Serie de Prueba 01 AVI.avs"), "latin1");
        expect(avs.indexOf("m.ass")).toBeLessThan(avs.indexOf("z.ass"));
    });

    test("preajuste inexistente es un error", () => {
        writeFileSync(join(dir, RAW), "");
        expect(asu("avs-compresion", dir, "-p", "4k").codigo).toBe(1);
    });
});

describe("asu fuentes", () => {
    test("código 1 y lista las fuentes faltantes", () => {
        writeFileSync(join(dir, "ep01.ass"), `\uFEFF${assDePrueba()}`);

        const { codigo, salida } = asu("fuentes", dir);
        expect(codigo).toBe(1);
        expect(salida).toContain("Segunda Fuente");
        expect(salida).toContain("ep01.ass");
        expect(salida).not.toContain("Wingdings");
    });

    test.skipIf(!existsSync("C:\\Windows\\Fonts\\arial.ttf"))("una fuente suelta en el directorio cuenta como disponible", () => {
        writeFileSync(join(dir, "arial.ttf"), readFileSync("C:\\Windows\\Fonts\\arial.ttf"));
        writeFileSync(join(dir, "ep01.ass"), assDePrueba());

        const { salida } = asu("fuentes", dir);
        expect(salida).not.toMatch(/faltan[^\n]*arial/i);
    });

    test("sin .ass termina en 0", () => {
        expect(asu("fuentes", dir).codigo).toBe(0);
    });
});

describe("asu config", () => {
    test("agregar, usar y quitar un preajuste", () => {
        expect(asu("config", "preajustes", "agregar", "900p", "1600x900", "--etiqueta", "MP4 900").codigo).toBe(0);
        expect(asu("config", "preajustes").salida).toContain("1600x900");

        writeFileSync(join(dir, RAW), "");
        expect(asu("avs-compresion", dir, "-p", "900p").codigo).toBe(0);
        expect(existsSync(join(dir, "Serie de Prueba 01 MP4 900.avs"))).toBe(true);

        expect(asu("config", "preajustes", "quitar", "900p").codigo).toBe(0);
        expect(asu("config", "preajustes").salida).not.toContain("1600x900");
    });

    test("resolución inválida es un error", () => {
        expect(asu("config", "preajustes", "agregar", "x", "grande").codigo).toBe(1);
    });
});

describe("asu sin terminal", () => {
    test("el menú pide terminal interactiva", () => {
        const { codigo, salida } = asu();
        expect(codigo).toBe(1);
        expect(salida).toContain("terminal interactiva");
    });

    test("--version", () => {
        expect(asu("--version").salida.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    });
});
