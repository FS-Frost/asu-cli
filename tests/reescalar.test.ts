import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { leerASS } from "../src/nucleo/fuentes-ass.ts";
import { formatearNumero, playResDe, reescalarASS, type ModoReescalado } from "../src/nucleo/reescalar-ass.ts";
import { construirASS, directorioTemporal } from "./utilidades.ts";

function linea(texto: string, margenes = "0,0,0"): string {
    return `Dialogue: 0,0:00:01.00,0:00:02.00,Default,,${margenes},,${texto}`;
}

function reescalar(
    lineas: string[],
    desde: [number, number] | null,
    hacia: [number, number],
    modo: ModoReescalado = "estirar",
    scaledBorderAndShadow: "yes" | "no" = "yes",
) {
    const ass = leerASS(construirASS({ playRes: desde, scaledBorderAndShadow, estilos: [["Default", "Arial"]], lineas }))!;
    return reescalarASS(ass, { ancho: hacia[0], alto: hacia[1] }, modo).ass;
}

const contenidos = (ass: ReturnType<typeof reescalar>) => ass.events.lines.map((l) => l.content);

describe("misma proporción (1280x720 → 1920x1080, ×1.5)", () => {
    const ass = reescalar(
        [
            linea("{\\pos(100,200)\\fs40\\bord2\\shad1\\blur1\\be1\\fscx120\\t(0,500,\\fs50\\bord4)}Hola"),
            linea("{\\move(10,20,30,40,0,500)\\org(2,4)\\fsp2\\xbord2\\yshad-2}Mover"),
            linea("{\\clip(0,0,640,360)}Rect {\\iclip(m 0 0 l 100 0 100 100)}Vector {\\clip(2,m 0 0 l 100 100)}Escala"),
            linea("{\\pos(10,10)\\p1}m 0 0 l 10 0 10 10{\\p0}texto 10 20", "20,0,0"),
        ],
        [1280, 720],
        [1920, 1080],
    );

    test("posiciones, tamaños y tags dentro de \\t; tiempos y \\be sin tocar", () => {
        expect(contenidos(ass)[0]).toBe("{\\pos(150,300)\\fs60\\bord3\\shad1.5\\blur1.5\\be1\\fscx120\\t(0,500,\\fs75\\bord6)}Hola");
        expect(contenidos(ass)[1]).toBe("{\\move(15,30,45,60,0,500)\\org(3,6)\\fsp3\\xbord3\\yshad-3}Mover");
    });

    test("clip rectangular, vectorial y vectorial con escala", () => {
        expect(contenidos(ass)[2]).toBe("{\\clip(0,0,960,540)}Rect {\\iclip(m 0 0 l 150 0 150 150)}Vector {\\clip(2,m 0 0 l 150 150)}Escala");
    });

    test("dibujos \\p se escalan; el texto después de \\p0 no", () => {
        expect(contenidos(ass)[3]).toBe("{\\pos(15,15)\\p1}m 0 0 l 15 0 15 15{\\p0}texto 10 20");
    });

    test("márgenes de línea (0 = usar el del estilo, no se toca)", () => {
        const l = ass.events.lines[3]!;
        expect([l.marginLeft, l.marginRight, l.marginVertical]).toEqual([30, 0, 0]);
    });

    test("estilo y PlayRes", () => {
        const estilo = ass.styles.styles[0]!;
        expect([estilo.fontSize, estilo.outline, estilo.shadow, estilo.scaleX]).toEqual([90, 3, 3, 100]);
        expect([estilo.marginLeft, estilo.marginRight, estilo.marginVertical]).toEqual([15, 15, 15]);
        expect(ass.scriptInfo.properties.get("PlayResX")).toBe("1920");
        expect(ass.scriptInfo.properties.get("PlayResY")).toBe("1080");
    });
});

describe("proporción distinta (640x480 → 1920x1080)", () => {
    const lineas = [linea("{\\pos(100,100)\\fs40\\fscx100}A")];

    test("estirar: X×3, Y×2.25, tamaños×2.25, fscx×4/3", () => {
        const ass = reescalar(lineas, [640, 480], [1920, 1080], "estirar");
        expect(contenidos(ass)[0]).toBe("{\\pos(300,225)\\fs90\\fscx133.333}A");

        const estilo = ass.styles.styles[0]!;
        expect([estilo.fontSize, estilo.scaleX, estilo.marginLeft, estilo.marginVertical]).toEqual([135, 133.33, 30, 23]);
    });

    test("bandas: todo ×2.25 y X desplazado 240", () => {
        const ass = reescalar(lineas, [640, 480], [1920, 1080], "bandas");
        expect(contenidos(ass)[0]).toBe("{\\pos(465,225)\\fs90\\fscx100}A");

        const estilo = ass.styles.styles[0]!;
        expect([estilo.scaleX, estilo.marginLeft, estilo.marginVertical]).toEqual([100, 263, 23]);
    });
});

describe("casos especiales", () => {
    test("ScaledBorderAndShadow: no, borde, sombra y blur no cambian", () => {
        const ass = reescalar([linea("{\\fs10\\bord2\\shad2\\blur1}A")], [1280, 720], [1920, 1080], "estirar", "no");
        expect(contenidos(ass)[0]).toBe("{\\fs15\\bord2\\shad2\\blur1}A");
        expect(ass.styles.styles[0]!.outline).toBe(2);
    });

    test("sin PlayRes se toma 384x288", () => {
        const ass = reescalar([linea("{\\pos(10,10)}A")], null, [768, 576]);
        expect(contenidos(ass)[0]).toBe("{\\pos(20,20)}A");
    });

    test("PlayRes parcial se completa como libass", () => {
        const soloY = leerASS(construirASS({ playRes: null, estilos: [], lineas: [] }))!;
        soloY.scriptInfo.properties.set("PlayResY", "1024");
        expect(playResDe(soloY)).toEqual({ ancho: 1280, alto: 1024 });

        const soloX = leerASS(construirASS({ playRes: null, estilos: [], lineas: [] }))!;
        soloX.scriptInfo.properties.set("PlayResX", "640");
        expect(playResDe(soloX)).toEqual({ ancho: 640, alto: 480 });
    });

    test("no modifica el original", () => {
        const original = leerASS(construirASS({ playRes: [1280, 720], estilos: [["Default", "Arial"]], lineas: [linea("{\\pos(1,1)}A")] }))!;
        reescalarASS(original, { ancho: 1920, alto: 1080 }, "estirar");
        expect(original.events.lines[0]!.content).toBe("{\\pos(1,1)}A");
        expect(original.styles.styles[0]!.fontSize).toBe(60);
        expect(original.scriptInfo.properties.get("PlayResX")).toBe("1280");
    });

    test("formatearNumero", () => {
        expect(formatearNumero(1.5)).toBe("1.5");
        expect(formatearNumero(133.33333)).toBe("133.333");
        expect(formatearNumero(-0)).toBe("0");
    });
});

describe("CLI", () => {
    let dir: string;
    let home: string;
    const CLI = join(import.meta.dir, "..", "src", "cli.ts");

    const asu = (...args: string[]) => {
        const r = Bun.spawnSync(["bun", CLI, ...args], { env: { ...process.env, ASU_CLI_HOME: home }, stdin: "pipe" });
        return { codigo: r.exitCode, salida: r.stdout.toString() + r.stderr.toString() };
    };

    const archivo = (nombre: string, playRes: [number, number]) =>
        writeFileSync(
            join(dir, nombre),
            construirASS({ playRes, scaledBorderAndShadow: "yes", estilos: [["Default", "Arial"]], lineas: [linea("{\\pos(100,100)}A")] }),
        );

    beforeEach(() => {
        dir = directorioTemporal();
        home = directorioTemporal();
        archivo("hd.ass", [1920, 1080]);
        archivo("sd.ass", [1280, 720]);
    });

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
        rmSync(home, { recursive: true, force: true });
    });

    test("asu reescalar crea un archivo nuevo y no toca el original", () => {
        const antes = readFileSync(join(dir, "sd.ass"), "utf8");
        expect(asu("reescalar", dir, "-s", "sd.ass", "-r", "1920x1080").codigo).toBe(0);

        const nuevo = leerASS(readFileSync(join(dir, "sd - 1920x1080.ass"), "utf8"))!;
        expect(nuevo.scriptInfo.properties.get("PlayResX")).toBe("1920");
        expect(nuevo.events.lines[0]!.content).toBe("{\\pos(150,150)}A");
        expect(readFileSync(join(dir, "sd.ass"), "utf8")).toBe(antes);
    });

    test("misma resolución se omite; -o con varios archivos y modo inválido son errores", () => {
        expect(asu("reescalar", dir, "-s", "hd.ass", "-r", "1920x1080").codigo).toBe(0);
        expect(existsSync(join(dir, "hd - 1920x1080.ass"))).toBe(false);

        expect(asu("reescalar", dir, "-s", "hd.ass", "-s", "sd.ass", "-r", "1920x1080", "-o", "x").codigo).toBe(1);
        expect(asu("reescalar", dir, "-s", "sd.ass", "-r", "1920x1080", "-m", "recortar").codigo).toBe(1);
        expect(asu("reescalar", dir, "-s", "sd.ass").codigo).toBe(1);
    });

    test("asu unir sin --reescalar avisa y sugiere el comando", () => {
        const { codigo, salida } = asu("unir", dir, "-s", "hd.ass", "-s", "sd.ass");
        expect(codigo).toBe(0);
        expect(salida).toContain("asu reescalar");
        expect(salida).toContain("--reescalar");
    });

    test("asu unir --reescalar ajusta al PlayRes del primero sin tocar los originales", () => {
        const antes = readFileSync(join(dir, "sd.ass"), "utf8");
        const { codigo, salida } = asu("unir", dir, "-s", "hd.ass", "-s", "sd.ass", "--reescalar", "-o", "Final");
        expect(codigo).toBe(0);
        expect(salida).not.toContain("Sugerencia");

        const unido = leerASS(readFileSync(join(dir, "Final.ass"), "utf8"))!;
        expect(unido.events.lines.map((l) => l.content)).toEqual(["{\\pos(100,100)}A", "{\\pos(150,150)}A"]);
        expect(readFileSync(join(dir, "sd.ass"), "utf8")).toBe(antes);
    });
});
