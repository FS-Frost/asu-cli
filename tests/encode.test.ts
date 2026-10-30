import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { encode, type OpcionesEncode } from "../src/comandos/encode.ts";
import type { Ejecutor } from "../src/ejecutor.ts";
import { configDeFabrica, guardarConfig, type Config, type Salida } from "../src/nucleo/config.ts";
import {
    calcularBitrateXvid,
    comandoAviVideo,
    comandoMp4Mux,
    comandoMp4Video,
    comandoXvid,
    comandosAudio,
    comandosX264,
    elegirPistaAudio,
    gananciaNormalizacion,
    herramientasDeMegui,
    parsearDuracion,
    parsearPistasAudio,
    parsearVolumenMaximo,
    planificarCadenas,
    planificarPasos,
    scriptAvimux,
    type ArchivosSalida,
    type Comando,
} from "../src/nucleo/encode.ts";
import { ErrorUsuario } from "../src/ui.ts";
import { construirASS, directorioTemporal, escribirJson } from "./utilidades.ts";

const MEGUI = "C:\\MeGUI";
const h = herramientasDeMegui(MEGUI);
const [SALIDA_1080, SALIDA_720, SALIDA_AVI] = configDeFabrica().salidas;

/** Línea de comando como la escribe el log de MeGUI (sin comillas). */
const linea = (comando: Comando) => [comando.exe, ...comando.args].join(" ");

describe("líneas de comando (iguales a las de MeGUI)", () => {
    test("x264: ffmpeg | x264 con los ajustes de fábrica", () => {
        const [ffmpeg, x264] = comandosX264(h, "C:\\Ep\\Serie 01 MP4 1080.avs", (SALIDA_1080 as Extract<Salida, { tipo: "mp4-x264" }>).x264, "C:\\Tmp\\1080.264");
        expect(linea(ffmpeg!)).toBe("C:\\MeGUI\\tools\\ffmpeg\\ffmpeg.exe -loglevel level+error -i C:\\Ep\\Serie 01 MP4 1080.avs -strict -1 -f yuv4mpegpipe -");
        expect(linea(x264!)).toBe(
            "C:\\MeGUI\\tools\\x264\\x264.exe --preset slow --level 4.1 --tune animation --crf 18.0 --keyint 240 --vbv-bufsize 78125 --vbv-maxrate 62500 --sar 1:1 --output C:\\Tmp\\1080.264 --stdin y4m -",
        );
    });

    test("audio: neroAacEnc y lame con los argumentos de MeGUI, tras ffmpeg normalizado", () => {
        const [decodificar, nero] = comandosAudio(h, "C:\\Ep\\raw.mkv", 0, 3.4, { codec: "aac", kbps: 192 }, "C:\\Tmp\\a.m4a");
        expect(decodificar!.args).toContain("volume=3.4dB");
        expect(decodificar!.args).toEqual(expect.arrayContaining(["-map", "0:a:0", "-f", "wav", "-"]));
        expect(linea(nero!)).toBe("C:\\MeGUI\\tools\\eac3to\\neroAacEnc.exe -ignorelength -br 192000 -if - -of C:\\Tmp\\a.m4a");

        const [sinGanancia, lame] = comandosAudio(h, "C:\\Ep\\raw.mkv", 1, 0, { codec: "mp3", kbps: 192 }, "C:\\Tmp\\a.mp3");
        expect(sinGanancia!.args.join(" ")).not.toContain("volume");
        expect(sinGanancia!.args).toContain("0:a:1");
        expect(linea(lame!)).toBe("C:\\MeGUI\\tools\\lame\\lame.exe --abr 192 -h - C:\\Tmp\\a.mp3");
    });

    test("mp4box: video solo y mux con audio japonés", () => {
        expect(linea(comandoMp4Video(h, "C:\\Tmp\\1080.264", "C:\\Tmp", "C:\\Tmp\\1080-video.mp4"))).toBe(
            "C:\\MeGUI\\tools\\mp4box\\mp4box.exe -add C:\\Tmp\\1080.264#trackID=1:fps=24000/1001:par=1:1:name= -tmp C:\\Tmp -new C:\\Tmp\\1080-video.mp4",
        );
        expect(linea(comandoMp4Mux(h, "C:\\Tmp\\v.mp4", "C:\\Tmp\\a.m4a", "C:\\Tmp", "C:\\Tmp\\1080.mp4"))).toBe(
            "C:\\MeGUI\\tools\\mp4box\\mp4box.exe -add C:\\Tmp\\v.mp4#trackID=1:fps=24000/1001:par=1:1:name= -add C:\\Tmp\\a.m4a#trackID=1:lang=jpn:name= -tmp C:\\Tmp -new C:\\Tmp\\1080.mp4",
        );
    });

    test("xvid_encraw: 2 pasadas con las banderas del perfil", () => {
        const banderas = (SALIDA_AVI as { xvid: string[] }).xvid;
        const resto = "-max_key_interval 250 -kboost 100 -chigh 30 -clow 15 -bquant_ratio 162 -bquant_offset 0 -bvhq -qtype 1 -nopacked -masking 1 -imin 1 -bmin 1 -pmin 1 -threads 4 -par 1";
        expect(linea(comandoXvid(h, "C:\\Ep\\AVI.avs", 1, "C:\\Tmp\\396.stats", 876, banderas, "C:\\Tmp\\396.m4v"))).toBe(
            `C:\\MeGUI\\tools\\xvid_encraw\\xvid_encraw.exe -i C:\\Ep\\AVI.avs -pass1 C:\\Tmp\\396.stats -bitrate 876 ${resto}`,
        );
        expect(linea(comandoXvid(h, "C:\\Ep\\AVI.avs", 2, "C:\\Tmp\\396.stats", 876, banderas, "C:\\Tmp\\396.m4v"))).toBe(
            `C:\\MeGUI\\tools\\xvid_encraw\\xvid_encraw.exe -i C:\\Ep\\AVI.avs -o C:\\Tmp\\396.m4v -pass2 C:\\Tmp\\396.stats -bitrate 876 ${resto}`,
        );
    });

    test("AVI: ffmpeg con fourcc XVID y script de AVI-Mux GUI", () => {
        expect(linea(comandoAviVideo(h, "C:\\Tmp\\396.m4v", "C:\\Tmp\\396-video.avi"))).toBe(
            "C:\\MeGUI\\tools\\ffmpeg\\ffmpeg.exe -y -loglevel level+error -i C:\\Tmp\\396.m4v -vcodec copy -vtag XVID -r 23.976 C:\\Tmp\\396-video.avi",
        );

        const script = scriptAvimux("C:\\Tmp\\a.mp3", "C:\\Tmp\\396-video.avi", "C:\\Tmp\\396.avi").split("\r\n");
        expect(script.slice(0, 7)).toEqual([
            "CLEAR", "LOAD C:\\Tmp\\a.mp3", "SET OUTPUT OPTIONS", "LOAD C:\\Tmp\\396-video.avi", "SELECT FILE 2", "ADD VIDEOSOURCE", "DESELECT FILE 2",
        ]);
        expect(script).toContain("SET OPTION CLOSEAPP 1");
        expect(script).toContain("SET OPTION AUDIO INTERLEAVE 4 FR");
        expect(script.at(-2)).toBe("START C:\\Tmp\\396.avi");
    });
});

describe("lectura de ffmpeg", () => {
    const info = [
        "Input #0, matroska,webm, from 'raw.mkv':",
        "  Duration: 00:23:40.08, start: 0.000000, bitrate: 5000 kb/s",
        "  Stream #0:0: Video: h264 (High), yuv420p, 1920x1080, 23.98 fps",
        "  Stream #0:1(eng): Audio: aac (LC), 48000 Hz, stereo, fltp",
        "  Stream #0:2(jpn): Audio: aac (LC), 48000 Hz, stereo, fltp (default)",
        "  Stream #0:3(spa): Subtitle: ass",
    ].join("\n");

    test("pistas de audio, con índice entre audios e idioma", () => {
        expect(parsearPistasAudio(info).map((p) => [p.indice, p.idioma])).toEqual([[0, "eng"], [1, "jpn"]]);
    });

    test("elección: única, japonesa única, o null para preguntar", () => {
        const pistas = parsearPistasAudio(info);
        expect(elegirPistaAudio(pistas)!.idioma).toBe("jpn");
        expect(elegirPistaAudio([pistas[0]!])!.idioma).toBe("eng");
        expect(elegirPistaAudio([pistas[0]!, { ...pistas[0]!, indice: 1, idioma: "spa" }])).toBeNull();
        expect(() => elegirPistaAudio([])).toThrow();
    });

    test("duración, volumen máximo y ganancia", () => {
        expect(parsearDuracion(info)).toBeCloseTo(1420.08);
        expect(parsearVolumenMaximo("[Parsed_volumedetect_0] max_volume: -3.47 dB")).toBe(-3.47);
        expect(gananciaNormalizacion(-3.47)).toBe(3.4);
        expect(gananciaNormalizacion(0.5)).toBe(0);
    });
});

describe("calcularBitrateXvid", () => {
    test("deja el AVI bajo el tamaño y cerca del bitrate de MeGUI (876 kbps)", () => {
        const duracion = 34046 * 1001 / 24000;
        const bytesAudio = Math.round((192000 / 8) * duracion);
        const kbps = calcularBitrateXvid({ tamanoMB: 180, bytesAudio, duracion });
        expect(kbps).toBeGreaterThan(840);
        expect(kbps).toBeLessThanOrEqual(876);
        // Video + audio + 1 % de margen no supera los 180 MiB.
        expect((kbps * 1000 / 8) * duracion + bytesAudio).toBeLessThan(180 * 1024 * 1024);
    });

    test("si el audio no deja espacio es un error", () => {
        expect(() => calcularBitrateXvid({ tamanoMB: 1, bytesAudio: 2 * 1024 * 1024, duracion: 60 })).toThrow();
    });
});

describe("planificarPasos", () => {
    test("audios (compartidos) → videos → muxes", () => {
        const archivos: ArchivosSalida[] = [SALIDA_1080!, SALIDA_720!, SALIDA_AVI!].map((salida) => ({
            salida, avs: `${salida.nombre}.avs`, final: `${salida.nombre}.final`, temporal: `${salida.nombre}.tmp`,
        }));
        expect(planificarPasos(archivos, "C:\\Tmp").map((paso) => paso.id)).toEqual([
            "audio-aac-192", "audio-mp3-192", "x264-1080", "x264-720", "xvid1-396", "xvid2-396", "mux-1080", "mux-720", "mux-396",
        ]);
    });

    test("cadenas: audios aparte y una cadena por versión (video → mux)", () => {
        const archivos: ArchivosSalida[] = [SALIDA_1080!, SALIDA_720!, SALIDA_AVI!].map((salida) => ({
            salida, avs: `${salida.nombre}.avs`, final: `${salida.nombre}.final`, temporal: `${salida.nombre}.tmp`,
        }));
        const plan = planificarCadenas(archivos, "C:\\Tmp");
        expect(plan.audios.map((paso) => paso.id)).toEqual(["audio-aac-192", "audio-mp3-192"]);
        expect(plan.cadenas.map((cadena) => cadena.pasos.map((paso) => paso.id))).toEqual([
            ["x264-1080", "mux-1080"],
            ["x264-720", "mux-720"],
            ["xvid1-396", "xvid2-396", "mux-396"],
        ]);
    });
});

// ---- Flujo completo con un ejecutor falso ----

const RAW = "[Grupo] Serie de Prueba - 01 [1080p][ABCD1234].mkv";
const INFO_RAW = "  Duration: 00:23:40.00, start: 0.000000\n  Stream #0:0: Video: h264\n  Stream #0:1(jpn): Audio: aac (LC), 48000 Hz, stereo";

type EjecutorFalso = Ejecutor & {
    llamadas: Comando[][];
    /** Hace fallar el primer comando cuyo texto contenga esto. */
    fallarEn?: string;
    duracion: string;
    /** Salida de `ffmpeg -i <raw>`. */
    infoRaw: string;
    bytesAvi: number;
    /** Codificaciones de video (x264 / xvid) corriendo ahora y el máximo simultáneo visto. */
    videosActivos: number;
    maxVideosSimultaneos: number;
};

/** Crea los archivos que dejaría cada herramienta y responde a las consultas de ffmpeg. */
function ejecutorFalso(): EjecutorFalso {
    const falso: EjecutorFalso = {
        llamadas: [],
        duracion: "00:23:40.00",
        infoRaw: INFO_RAW,
        bytesAvi: 1000,
        videosActivos: 0,
        maxVideosSimultaneos: 0,
        async ejecutar(comandos, opciones) {
            falso.llamadas.push([...comandos]);
            const texto = comandos.map(linea).join(" | ");

            // Los videos "tardan" un poco y reportan avance, para poder ver si corren a la vez.
            const esVideo = comandos.some((c) => c.exe === h.x264 || c.exe === h.xvid);
            if (esVideo) {
                falso.videosActivos++;
                falso.maxVideosSimultaneos = Math.max(falso.maxVideosSimultaneos, falso.videosActivos);
                opciones?.alSalida?.("10 frames: 5.00 fps, 100 kb/s\r");
                await Bun.sleep(20);
                falso.videosActivos--;
            }

            if (falso.fallarEn && texto.includes(falso.fallarEn)) {
                falso.fallarEn = undefined;
                return { codigo: 1, stderr: "x264 [error]: algo salió mal\n" };
            }

            const ultimo = comandos.at(-1)!;
            const args = ultimo.args;
            const despues = (bandera: string) => args[args.indexOf(bandera) + 1]!;
            const crear = (ruta: string, bytes = 100) => writeFileSync(ruta, Buffer.alloc(bytes));

            if (args.includes("volumedetect")) {
                return { codigo: 0, stderr: "max_volume: -2.05 dB" };
            }
            if (ultimo.exe === h.ffmpeg && args.length === 3) {
                const archivo = args[2]!;
                return { codigo: 1, stderr: archivo.endsWith(".avs") ? `  Duration: ${falso.duracion}, start: 0` : falso.infoRaw };
            }

            if (ultimo.exe === h.neroAac) crear(despues("-of"));
            else if (ultimo.exe === h.lame) crear(args.at(-1)!, 1000);
            else if (ultimo.exe === h.x264) crear(despues("--output"));
            else if (ultimo.exe === h.xvid) crear(args.includes("-pass1") ? despues("-pass1") : despues("-o"));
            else if (ultimo.exe === h.mp4box) crear(despues("-new"));
            else if (ultimo.exe === h.ffmpeg) crear(args.at(-1)!);
            else if (ultimo.exe === h.avimux) {
                const script = readFileSync(args[0]!, "utf8");
                crear(script.match(/^START (.+)$/m)![1]!.trim(), falso.bytesAvi);
            }

            return { codigo: 0, stderr: "" };
        },
    };
    return falso;
}

describe("asu encode (ejecutor falso)", () => {
    let base: string;
    let dir: string;
    let salida: string;
    let falso: EjecutorFalso;
    const entorno = { ...process.env };

    const config = (cambios: Partial<Config> = {}) =>
        guardarConfig({ ...configDeFabrica(), rutaMegui: MEGUI, carpetaSalida: salida, ...cambios });

    const correr = (opciones: OpcionesEncode = {}) => encode({ dir, fuente: "HDTV", ignorarFuentes: true, ...opciones }, falso);

    const llamadasCon = (texto: string) => falso.llamadas.filter((tuberia) => tuberia.map(linea).join(" | ").includes(texto));

    const finales = {
        mp4_1080: () => join(salida, "[SyncRajo] Serie de Prueba - 01 (HDTV 1920x1080).mp4"),
        mp4_720: () => join(salida, "[SyncRajo] Serie de Prueba - 01 (HDTV 1280x720).mp4"),
        avi: () => join(salida, "[SyncRajo] Serie de Prueba - 01 (HDTV 704x396).avi"),
    };

    beforeEach(() => {
        base = directorioTemporal();
        dir = join(base, "Serie de Prueba", "01");
        salida = join(base, "Encode");
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, RAW), "");
        writeFileSync(join(dir, "Serie - Subs.ass"), construirASS({ estilos: [["Default", "Fuente Inexistente"]], lineas: ["Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,Hola"] }));

        process.env.ASU_CLI_HOME = join(base, "home");
        process.env.ASU_CLI_DIRECTORIOS_FUENTES = "";
        process.env.ASU_CLI_NO_INTERACTIVO = "1";
        falso = ejecutorFalso();
    });

    afterEach(() => {
        process.env = { ...entorno };
        rmSync(base, { recursive: true, force: true });
    });

    // Las herramientas viven en C:\MeGUI (ficticio): se reemplaza la ruta por una carpeta temporal con archivos vacíos.
    const conHerramientas = () => {
        const megui = join(base, "MeGUI");
        const reales = herramientasDeMegui(megui);
        for (const ruta of Object.values(reales)) {
            mkdirSync(dirname(ruta), { recursive: true });
            writeFileSync(ruta, "");
        }
        return megui;
    };

    test("sin MeGUI configurado es un error claro", async () => {
        config({ rutaMegui: null });
        await expect(correr()).rejects.toThrow("asu config megui");
    });

    test("faltan herramientas: lista las rutas", async () => {
        config({ rutaMegui: join(base, "MeGUI-vacio") });
        await expect(correr()).rejects.toThrow("x264.exe");
    });

    describe("con herramientas", () => {
        let hReal: ReturnType<typeof herramientasDeMegui>;

        beforeEach(() => {
            const megui = conHerramientas();
            hReal = herramientasDeMegui(megui);
            config({ rutaMegui: megui });
            // El ejecutor falso compara con las rutas de `h`: las apunto a la carpeta temporal.
            Object.assign(h, hReal);
        });

        afterEach(() => {
            Object.assign(h, herramientasDeMegui(MEGUI));
        });

        test("deja los 3 archivos finales, genera los .avs y borra los temporales", async () => {
            expect(await correr()).toBe(0);

            for (const final of Object.values(finales)) {
                expect(existsSync(final())).toBe(true);
            }
            expect(existsSync(join(dir, "Serie de Prueba 01 MP4 1080.avs"))).toBe(true);
            expect(existsSync(join(dir, "Serie de Prueba 01 MP4 720.avs"))).toBe(true);
            expect(existsSync(join(dir, "Serie de Prueba 01 AVI.avs"))).toBe(true);
            expect(existsSync(join(salida, ".asu-encode"))).toBe(false);
        });

        test("raw con AAC: los MP4 comparten una copia sin recodificar; el MP3 se normaliza; misma tasa en las 2 pasadas", async () => {
            await correr();

            expect(llamadasCon("neroAacEnc.exe")).toHaveLength(0);
            const copias = llamadasCon("-c:a copy");
            expect(copias).toHaveLength(1);
            expect(copias[0]![0]!.args.at(-1)).toEndWith("audio-aac-copia.m4a");
            expect(llamadasCon("audio-aac-copia.m4a#trackID=1:lang=jpn")).toHaveLength(2);
            expect(llamadasCon("lame.exe")).toHaveLength(1);
            expect(llamadasCon("volume=2dB")).toHaveLength(1);
            expect(llamadasCon("x264.exe")).toHaveLength(2);
            expect(llamadasCon("--preset slow")).toHaveLength(2);

            const bitrates = llamadasCon("xvid_encraw.exe").map((t) => t[0]!.args[t[0]!.args.indexOf("-bitrate") + 1]);
            expect(bitrates).toHaveLength(2);
            expect(bitrates[0]).toBe(bitrates[1]);
        });

        test("la fuente sale del asu.json del proyecto", async () => {
            escribirJson(join(dirname(dir), ".asu", "asu.json"), JSON.stringify({ fuente: "BD" }));
            expect(await correr({ fuente: undefined })).toBe(0);
            expect(existsSync(join(salida, "[SyncRajo] Serie de Prueba - 01 (BD 1920x1080).mp4"))).toBe(true);
        });

        test("sin fuente ni asu.json, sin terminal, es un error", async () => {
            await expect(correr({ fuente: undefined })).rejects.toThrow("--fuente");
        });

        test("salida desactivada no se codifica", async () => {
            const fabrica = configDeFabrica();
            config({ rutaMegui: dirname(dirname(dirname(hReal.ffmpeg))), salidas: fabrica.salidas.map((s) => ({ ...s, activa: s.nombre !== "396" })) });
            expect(await correr()).toBe(0);
            expect(existsSync(finales.avi())).toBe(false);
            expect(llamadasCon("lame.exe")).toHaveLength(0);
        });

        test("--solo genera solo las versiones pedidas (solo su audio y sus .avs)", async () => {
            expect(await correr({ solo: ["396"] })).toBe(0);
            expect(existsSync(finales.avi())).toBe(true);
            expect(existsSync(finales.mp4_1080())).toBe(false);
            expect(existsSync(finales.mp4_720())).toBe(false);
            expect(llamadasCon("neroAacEnc.exe")).toHaveLength(0);
            expect(llamadasCon("x264.exe")).toHaveLength(0);
            expect(existsSync(join(dir, "Serie de Prueba 01 MP4 1080.avs"))).toBe(false);
        });

        test("--solo acepta una salida desactivada y respeta el orden de la config", async () => {
            const fabrica = configDeFabrica();
            config({ rutaMegui: dirname(dirname(dirname(hReal.ffmpeg))), salidas: fabrica.salidas.map((s) => ({ ...s, activa: false })) });
            expect(await correr({ solo: ["720", "1080"] })).toBe(0);
            expect(llamadasCon("x264.exe").map((t) => t.map(linea).join(" | "))[0]).toContain("1080.264");
            expect(existsSync(finales.avi())).toBe(false);
        });

        test("--solo con un nombre inexistente o sin salidas activas es un error", async () => {
            await expect(correr({ solo: ["4k"] })).rejects.toThrow("4k");

            const fabrica = configDeFabrica();
            config({ rutaMegui: dirname(dirname(dirname(hReal.ffmpeg))), salidas: fabrica.salidas.map((s) => ({ ...s, activa: false })) });
            await expect(correr()).rejects.toThrow("--solo");
        });

        test("faltan fuentes: sin --ignorar-fuentes aborta antes de codificar", async () => {
            await expect(correr({ ignorarFuentes: false })).rejects.toThrow("--ignorar-fuentes");
            expect(falso.llamadas).toHaveLength(0);
        });

        test("archivo final existente: error sin -f, sobrescribe con -f", async () => {
            mkdirSync(salida, { recursive: true });
            writeFileSync(finales.mp4_720(), "previo");
            await expect(correr()).rejects.toThrow("--forzar");

            expect(await correr({ forzar: true })).toBe(0);
            expect(readFileSync(finales.mp4_720(), "utf8")).not.toBe("previo");
        });

        test("si un paso falla, se puede reanudar sin repetir lo hecho", async () => {
            falso.fallarEn = "720.264";
            const error = await correr().catch((e: unknown) => e);
            expect(error).toBeInstanceOf(ErrorUsuario);
            expect((error as Error).message).toContain("--reanudar");

            // Sin --reanudar ni terminal: hay que elegir.
            await expect(correr()).rejects.toThrow("--reiniciar");

            falso.llamadas = [];
            expect(await correr({ reanudar: true })).toBe(0);
            expect(llamadasCon("neroAacEnc.exe")).toHaveLength(0);
            expect(llamadasCon("1080.264 --stdin")).toHaveLength(0);
            expect(llamadasCon("720.264 --stdin")).toHaveLength(1);
            expect(existsSync(finales.mp4_720())).toBe(true);
        });

        test("las versiones se codifican en paralelo hasta el límite de la config (3)", async () => {
            expect(await correr()).toBe(0);
            expect(falso.maxVideosSimultaneos).toBe(3);
        });

        test("--paralelo 1 codifica en secuencia; --paralelo inválido es un error", async () => {
            expect(await correr({ paralelo: "1" })).toBe(0);
            expect(falso.maxVideosSimultaneos).toBe(1);
            await expect(correr({ paralelo: "0", forzar: true })).rejects.toThrow("--paralelo");
        });

        test("paralelo de la config", async () => {
            config({ rutaMegui: dirname(dirname(dirname(hReal.ffmpeg))), paralelo: 2 });
            expect(await correr()).toBe(0);
            expect(falso.maxVideosSimultaneos).toBe(2);
        });

        test("si una versión falla, las otras terminan; el error muestra la salida de la herramienta y no se mueve ningún final", async () => {
            falso.fallarEn = "720.264";
            const error = (await correr().catch((e: unknown) => e)) as Error;
            expect(error.message).toContain("algo salió mal");

            const temporales = join(salida, ".asu-encode", "Serie de Prueba - 01");
            expect(existsSync(join(temporales, "1080.mp4"))).toBe(true);
            expect(existsSync(join(temporales, "396.avi"))).toBe(true);
            expect(existsSync(finales.mp4_1080())).toBe(false);

            const estado = JSON.parse(readFileSync(join(temporales, "estado.json"), "utf8"));
            expect(estado.completados).toEqual(expect.arrayContaining(["mux-1080", "mux-396"]));
            expect(estado.completados).not.toContain("x264-720");
        });

        test("--reiniciar descarta lo hecho", async () => {
            falso.fallarEn = "720.264";
            await correr().catch(() => undefined);

            falso.llamadas = [];
            expect(await correr({ reiniciar: true })).toBe(0);
            expect(llamadasCon("-c:a copy")).toHaveLength(1);
        });

        test("raw sin AAC: se recodifica con neroAacEnc normalizado", async () => {
            falso.infoRaw = INFO_RAW.replace("Audio: aac (LC)", "Audio: eac3");
            expect(await correr()).toBe(0);
            expect(llamadasCon("-c:a copy")).toHaveLength(0);
            expect(llamadasCon("neroAacEnc.exe")).toHaveLength(1);
            expect(llamadasCon("volume=2dB")).toHaveLength(2);
        });

        test("solo MP4 con raw AAC: no se mide el volumen", async () => {
            expect(await correr({ solo: ["1080"] })).toBe(0);
            expect(llamadasCon("volumedetect")).toHaveLength(0);
        });

        test("AVI sobre el límite: código 1 y conserva los temporales", async () => {
            const fabrica = configDeFabrica();
            config({
                rutaMegui: dirname(dirname(dirname(hReal.ffmpeg))),
                salidas: fabrica.salidas.map((s) => (s.tipo === "avi-xvid" ? { ...s, tamanoMB: 1 } : s)),
            });
            falso.duracion = "00:00:10.00";
            falso.bytesAvi = 2 * 1024 * 1024;

            expect(await correr()).toBe(1);
            expect(statSync(finales.avi()).size).toBe(2 * 1024 * 1024);
            expect(existsSync(join(salida, ".asu-encode"))).toBe(true);
        });

        test("--conservar no borra los temporales", async () => {
            expect(await correr({ conservar: true })).toBe(0);
            expect(existsSync(join(salida, ".asu-encode", "Serie de Prueba - 01", "estado.json"))).toBe(true);
        });

        test("reutiliza .avs existentes y verifica las fuentes de sus textsub", async () => {
            for (const etiqueta of ["MP4 1080", "MP4 720", "AVI"]) {
                writeFileSync(join(dir, `Serie de Prueba 01 ${etiqueta}.avs`), `textsub("${join(dir, "Serie - Subs.ass")}")\r\n`);
            }

            await expect(correr({ ignorarFuentes: false })).rejects.toThrow("Faltan fuentes");
            expect(readFileSync(join(dir, "Serie de Prueba 01 AVI.avs"), "latin1")).not.toContain("spline64Resize");
        });

        describe("elecciones recordadas (asu.json del episodio)", () => {
            const recordar = (encode: object) => escribirJson(join(dir, ".asu", "asu.json"), JSON.stringify({ encode }));
            const leerAsuJson = () => JSON.parse(readFileSync(join(dir, ".asu", "asu.json"), "utf8"));
            const textsubs = (etiqueta: string) =>
                [...readFileSync(join(dir, `${etiqueta}.avs`), "latin1").matchAll(/textsub\("([^"]+)"\)/g)].map((m) => basename(m[1]!));

            beforeEach(() => {
                writeFileSync(join(dir, "Serie - Carteles.ass"), construirASS({ estilos: [["Default", "Arial"]], lineas: [] }));
            });

            test("sin terminal se aplica lo recordado: versiones, serie, episodio y orden de subtítulos", async () => {
                recordar({ versiones: ["396"], subtitulos: ["Serie - Subs.ass", "Serie - Carteles.ass"], serie: "Otra Serie", episodio: "07" });

                expect(await correr()).toBe(0);
                expect(existsSync(join(salida, "[SyncRajo] Otra Serie - 07 (HDTV 704x396).avi"))).toBe(true);
                expect(llamadasCon("x264.exe")).toHaveLength(0);
                expect(textsubs("Otra Serie 07 AVI")).toEqual(["Serie - Subs.ass", "Serie - Carteles.ass"]);
            });

            test("lo pasado por argumento manda y no se guarda", async () => {
                recordar({ versiones: ["396"], serie: "Otra Serie", episodio: "07" });

                expect(await correr({ solo: ["720"], episodio: "08" })).toBe(0);
                expect(existsSync(join(salida, "[SyncRajo] Otra Serie - 08 (HDTV 1280x720).mp4"))).toBe(true);
                expect(existsSync(join(salida, "[SyncRajo] Otra Serie - 07 (HDTV 704x396).avi"))).toBe(false);
                expect(leerAsuJson().encode).toEqual({ versiones: ["396"], serie: "Otra Serie", episodio: "07" });
            });

            test("subtítulo recordado que ya no existe: se descarta y se usan todos en orden alfabético", async () => {
                recordar({ versiones: ["396"], subtitulos: ["Serie - Subs.ass", "borrado.ass"] });

                expect(await correr()).toBe(0);
                expect(textsubs("Serie de Prueba 01 AVI")).toEqual(["Serie - Carteles.ass", "Serie - Subs.ass"]);
            });

            test("versión recordada desconocida se descarta (vuelven las activas)", async () => {
                recordar({ versiones: ["4k"] });
                expect(await correr()).toBe(0);
                expect(existsSync(finales.mp4_1080())).toBe(true);
                expect(existsSync(finales.avi())).toBe(true);
            });

            test("--reanudar funciona con las versiones recordadas", async () => {
                recordar({ versiones: ["1080"] });
                falso.fallarEn = "1080.264";
                await correr().catch(() => undefined);

                falso.llamadas = [];
                expect(await correr({ reanudar: true })).toBe(0);
                expect(existsSync(finales.mp4_1080())).toBe(true);
                expect(llamadasCon("neroAacEnc.exe")).toHaveLength(0);
            });

            test("el asu.json del episodio no tapa la fuente del de la serie", async () => {
                escribirJson(join(dirname(dir), ".asu", "asu.json"), JSON.stringify({ fuente: "BD" }));
                recordar({ versiones: ["1080"] });

                expect(await correr({ fuente: undefined })).toBe(0);
                expect(existsSync(join(salida, "[SyncRajo] Serie de Prueba - 01 (BD 1920x1080).mp4"))).toBe(true);
            });
        });

        test("los nombres finales usan el grupo de la config", async () => {
            config({ rutaMegui: dirname(dirname(dirname(hReal.ffmpeg))), grupo: "OtroGrupo" });
            expect(await correr()).toBe(0);
            expect(existsSync(join(salida, "[OtroGrupo] Serie de Prueba - 01 (HDTV 1920x1080).mp4"))).toBe(true);
        });
    });
});
