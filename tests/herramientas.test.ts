import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { configurarCarpetaHerramienta, diagnosticarHerramientas } from "../src/comandos/herramientas.ts";
import type { Ejecutor } from "../src/ejecutor.ts";
import { buscarHerramienta, exigirHerramientas, faltantes, type ContextoBusqueda } from "../src/herramientas.ts";
import { cargarConfig, configDeFabrica, guardarConfig } from "../src/nucleo/config.ts";
import { herramientasDeMegui } from "../src/nucleo/encode.ts";
import { CATALOGO, definicion, lineaVersion, mensajeFaltan, necesariasEncode, necesariasMenu, pistaFaltantes } from "../src/nucleo/herramientas.ts";
import { ErrorUsuario } from "../src/ui.ts";
import { directorioTemporal, simularAvisynth } from "./utilidades.ts";

const [MP4, , AVI] = configDeFabrica().salidas;

describe("catálogo (lógica pura)", () => {
    test("encode: video sin audio; audio según se copie el AAC y haya AVI", () => {
        expect(necesariasEncode([MP4!], null)).toEqual(["ffmpeg", "x264", "mp4box", "avisynth", "ffms2", "vsfilter"]);
        expect(necesariasEncode([AVI!], null)).toEqual(["ffmpeg", "xvid", "avimux", "avisynth", "ffms2", "vsfilter"]);
        expect(necesariasEncode([MP4!, AVI!], { copiarAac: true })).toEqual(["lame"]);
        expect(necesariasEncode([MP4!], { copiarAac: false })).toEqual(["neroAac"]);
        expect(necesariasEncode([MP4!], { copiarAac: true })).toEqual([]);
    });

    test("menú: cada opción con sus herramientas; las demás, ninguna", () => {
        expect(necesariasMenu("mkv", [])).toEqual(["mkvmerge", "mkvextract"]);
        expect(necesariasMenu("corregir-offset", [])).toEqual(["ffprobe", "mkvmerge"]);
        expect(necesariasMenu("encode", [AVI!])).toContain("lame");
        expect(necesariasMenu("encode", [MP4!])).not.toContain("neroAac");
        expect(necesariasMenu("fuentes", [MP4!])).toEqual([]);
    });

    test("mensaje: qué falta, dónde se buscó, cómo instalar (una vez por grupo) y asu herramientas", () => {
        const mensaje = mensajeFaltan(
            [
                { definicion: definicion("mkvmerge"), buscadaEn: ["PATH"] },
                { definicion: definicion("mkvextract"), buscadaEn: ["PATH"] },
            ],
            "asu mkv",
        );
        expect(mensaje).toContain("Faltan herramientas para asu mkv:");
        expect(mensaje).toContain("mkvextract.exe (MKVToolNix) — buscado en: PATH");
        expect(mensaje.match(/winget install MoritzBunkus\.MKVToolNix/g)).toHaveLength(1);
        expect(mensaje).toContain("asu herramientas");
    });

    test("pista del menú y línea de versión", () => {
        const falta = (clave: "x264" | "mp4box" | "ffmpeg") => ({ definicion: definicion(clave), buscadaEn: [] });
        expect(pistaFaltantes([])).toBeUndefined();
        expect(pistaFaltantes([falta("x264")])).toBe("falta x264.exe");
        expect(pistaFaltantes([falta("x264"), falta("mp4box"), falta("ffmpeg")])).toBe("faltan x264.exe, mp4box.exe…");
        expect(lineaVersion("\r\nmkvmerge v7.2.0 ('On Every Street') 32bit\nmás")).toBe("mkvmerge v7.2.0 ('On Every Street') 32bit");
        expect(lineaVersion("")).toBeNull();
        expect(lineaVersion("*************\n*     Nero AAC Encoder          *\n")).toBe("Nero AAC Encoder");
    });
});

describe("búsqueda", () => {
    let base: string;
    const entorno = { ...process.env };
    const sinNada: ContextoBusqueda = { rutaMegui: null, carpetas: {} };

    const crear = (carpeta: string, archivo: string) => {
        mkdirSync(carpeta, { recursive: true });
        writeFileSync(join(carpeta, archivo), "");
        return join(carpeta, archivo);
    };

    beforeEach(() => {
        base = directorioTemporal();
        // PATH y ubicaciones típicas vacías: nada de la máquina se cuela en los tests.
        process.env.ASU_CLI_PATH = join(base, "path-vacio");
        process.env.ASU_CLI_UBICACIONES_TIPICAS = "";
        simularAvisynth(base);
    });

    afterEach(() => {
        process.env = { ...entorno };
        rmSync(base, { recursive: true, force: true });
    });

    test("FFmpeg/MKVToolNix: carpeta configurada → PATH → ubicación típica; si no, falta con dónde se buscó", () => {
        expect(buscarHerramienta("mkvextract", sinNada)).toMatchObject({ ruta: null, buscadaEn: ["PATH"] });

        const tipica = join(base, "Program Files", "MKVToolNix");
        process.env.ASU_CLI_UBICACIONES_TIPICAS = tipica;
        crear(tipica, "mkvextract.exe");
        expect(buscarHerramienta("mkvextract", sinNada)).toMatchObject({ ruta: join(tipica, "mkvextract.exe"), origen: "ubicación típica" });

        const path = join(base, "en-path");
        process.env.ASU_CLI_PATH = path;
        crear(path, "mkvextract.exe");
        expect(buscarHerramienta("mkvextract", sinNada).origen).toBe("PATH");

        const propia = join(base, "mi-mkvtoolnix");
        crear(propia, "mkvextract.exe");
        expect(buscarHerramienta("mkvextract", { rutaMegui: null, carpetas: { mkvtoolnix: propia } })).toMatchObject({
            ruta: join(propia, "mkvextract.exe"),
            origen: "carpeta configurada",
        });
    });

    test("carpeta configurada sin el archivo: sigue buscando y lo anota", () => {
        const path = join(base, "en-path");
        process.env.ASU_CLI_PATH = path;
        crear(path, "ffprobe.exe");
        const encontrada = buscarHerramienta("ffprobe", { rutaMegui: null, carpetas: { ffmpeg: join(base, "vacia") } });
        expect(encontrada.origen).toBe("PATH");
        expect(encontrada.buscadaEn).toEqual([join(base, "vacia", "ffprobe.exe"), "PATH"]);
    });

    test("MeGUI: sin configurar o sin el archivo, falta; AviSynth: SysWOW64 y carpeta de plugins (configurable)", () => {
        expect(buscarHerramienta("x264", sinNada).buscadaEn).toEqual(["MeGUI sin configurar"]);
        const megui = join(base, "MeGUI");
        const x264 = herramientasDeMegui(megui).x264;
        expect(buscarHerramienta("x264", { rutaMegui: megui, carpetas: {} }).ruta).toBeNull();
        crear(join(x264, ".."), "x264.exe");
        expect(buscarHerramienta("x264", { rutaMegui: megui, carpetas: {} })).toMatchObject({ ruta: x264, origen: "MeGUI" });

        expect(faltantes(["avisynth", "ffms2", "vsfilter"], sinNada)).toEqual([]);
        const otros = join(base, "otros-plugins");
        expect(faltantes(["ffms2"], { rutaMegui: null, carpetas: { avisynthPlugins: otros } }).map((f) => f.buscadaEn)).toEqual([[join(otros, "ffms2.dll")]]);
        crear(otros, "ffms2.dll");
        expect(buscarHerramienta("ffms2", { rutaMegui: null, carpetas: { avisynthPlugins: otros } }).origen).toBe("carpeta configurada");
    });

    test("exigirHerramientas: rutas si están; ErrorUsuario con el mensaje si falta alguna", () => {
        const path = join(base, "en-path");
        process.env.ASU_CLI_PATH = path;
        const mkvmerge = crear(path, "mkvmerge.exe");
        expect(() => exigirHerramientas(["mkvmerge", "mkvextract"], sinNada, "asu mkv")).toThrow(ErrorUsuario);
        expect(() => exigirHerramientas(["mkvmerge", "mkvextract"], sinNada, "asu mkv")).toThrow("winget install MoritzBunkus.MKVToolNix");
        crear(path, "mkvextract.exe");
        expect(exigirHerramientas(["mkvmerge", "mkvextract"], sinNada, "asu mkv").mkvmerge).toBe(mkvmerge);
    });

    describe("comandos", () => {
        beforeEach(() => {
            process.env.ASU_CLI_HOME = join(base, "home");
            process.env.ASU_CLI_NO_INTERACTIVO = "1";
        });

        test("asu config herramienta: guarda la carpeta, avisa si no tiene los archivos y \"\" la quita", () => {
            const carpeta = join(base, "mkvtoolnix");
            mkdirSync(carpeta);
            expect(configurarCarpetaHerramienta("mkvtoolnix", carpeta)).toBe(0);
            expect(cargarConfig().herramientas).toEqual({ mkvtoolnix: carpeta });
            expect(configurarCarpetaHerramienta("mkvtoolnix", "")).toBe(0);
            expect(cargarConfig().herramientas).toEqual({});
            expect(() => configurarCarpetaHerramienta("x264", carpeta)).toThrow("Válidas");
            expect(() => configurarCarpetaHerramienta("ffmpeg", join(base, "no-existe"))).toThrow("No existe");
        });

        test("config.json con herramientas inválidas: error claro", () => {
            guardarConfig({ ...configDeFabrica(), herramientas: { mkvtoolnix: 3 as unknown as string } });
            expect(() => cargarConfig()).toThrow("herramientas.mkvtoolnix");
        });

        test("asu herramientas: código 1 si falta alguna; 0 con todas; la versión solo de las que la informan", async () => {
            const versiones: string[] = [];
            const ejecutor: Ejecutor = {
                ejecutar: async (comandos) => {
                    versiones.push(comandos[0]!.exe);
                    return { codigo: 0, stderr: "", stdout: "v1.0" };
                },
            };
            expect(await diagnosticarHerramientas({ ejecutor })).toBe(1);

            const megui = join(base, "MeGUI");
            for (const ruta of Object.values(herramientasDeMegui(megui))) {
                crear(join(ruta, ".."), ruta.split(/[\\/]/).at(-1)!);
            }
            const path = join(base, "en-path");
            process.env.ASU_CLI_PATH = path;
            for (const archivo of ["ffprobe.exe", "mkvmerge.exe", "mkvextract.exe"]) {
                crear(path, archivo);
            }
            guardarConfig({ ...configDeFabrica(), rutaMegui: megui });
            versiones.length = 0;
            expect(await diagnosticarHerramientas({ ejecutor })).toBe(0);
            // AVI-Mux GUI (abre una ventana), xvid_encraw y las DLL no se ejecutan.
            expect(versiones).toHaveLength(CATALOGO.filter((d) => d.argsVersion).length);
            expect(versiones.some((exe) => exe.endsWith("AVIMux_GUI.exe"))).toBe(false);
        });
    });
});
