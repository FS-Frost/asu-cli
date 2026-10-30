import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { abrirComparacion, comparar, resumenComparacion, type OpcionesComparar } from "../src/comandos/comparar.ts";
import type { Ejecutor } from "../src/ejecutor.ts";
import {
    buscarCrfIgualado,
    claveCache,
    elegirCapturasMezcla,
    filtroSeleccion,
    formatearTiempo,
    kbps,
    marcaDeTiempo,
    parsearAnalisis,
    parsearPsnr,
    parsearSsim,
    parsearSsimPorFrame,
    parsearTiempo,
    parsearTramo,
    textoAvance,
    tramosPorContenido,
    tramosPorDefecto,
    ultimoPtsTime,
    type EstadisticaFrame,
} from "../src/nucleo/comparar.ts";
import { generarPagina } from "../src/nucleo/comparar-pagina.ts";
import { contarVotos, registrarVoto, validarVoto, type Resultados } from "../src/nucleo/comparar-resultados.ts";
import {
    aplicarVariante,
    cargarConfig,
    configDeFabrica,
    guardarConfig,
    usarVariante,
    validarVariante,
    variantesDeFabrica,
    type SalidaMp4,
} from "../src/nucleo/config.ts";
import { comandosX264, herramientasDeMegui, type Comando } from "../src/nucleo/encode.ts";
import { crearServidorComparacion } from "../src/servidor-comparacion.ts";
import { construirASS, directorioTemporal } from "./utilidades.ts";

const linea = (comando: Comando) => [comando.exe, ...comando.args].join(" ");
const X264 = (configDeFabrica().salidas[0] as SalidaMp4).x264;

describe("tiempos y tramos fijos", () => {
    test("parsearTiempo y parsearTramo", () => {
        expect(parsearTiempo("05:30")).toBe(330);
        expect(parsearTiempo("1:05:30")).toBe(3930);
        expect(parsearTiempo("5:xx")).toBeNull();
        expect(parsearTramo("05:30-05:50")).toEqual({ inicio: 330, duracion: 20 });
        expect(parsearTramo("05:50-05:30")).toBeNull();
    });

    test("por defecto: 3 tramos de 20 s centrados al 25/50/75 %", () => {
        expect(tramosPorDefecto(1400).map((t) => t.inicio)).toEqual([340, 690, 1040]);
    });

    test("formatearTiempo y marcaDeTiempo", () => {
        expect(formatearTiempo(342.7)).toBe("05:42");
        expect(marcaDeTiempo(new Date(2026, 9, 30, 9, 5))).toBe("2026-10-30 0905");
    });
});

/** Estadísticas de un episodio de `segundos` con zonas marcadas (una muestra por segundo). */
function episodioSimulado(segundos: number, zonas: { oscuro: number; movimiento: number; detalle: number; negro?: number }): EstadisticaFrame[] {
    return Array.from({ length: segundos }, (_, t) => {
        const en = (desde: number | undefined) => desde !== undefined && t >= desde && t < desde + 20;
        return {
            t: t + 0.5,
            luma: en(zonas.negro) ? 2 : en(zonas.oscuro) ? 30 : 120,
            movimiento: en(zonas.movimiento) ? 40 : 3,
            detalle: en(zonas.detalle) ? 0.95 : 0.6,
        };
    });
}

describe("tramos por contenido", () => {
    test("parsearAnalisis lee metadata=print de ffmpeg", () => {
        const salida = [
            "[Parsed_metadata_3 @ 0] frame:0    pts:17      pts_time:0.017",
            "[Parsed_metadata_3 @ 0] lavfi.signalstats.YAVG=149.147",
            "[Parsed_metadata_3 @ 0] lavfi.signalstats.YDIF=0",
            "[Parsed_metadata_3 @ 0] lavfi.entropy.normalized_entropy.normal.Y=0.900498",
            "frame=    1 fps=0.0 q=-0.0 size=N/A [Parsed_metadata_3 @ 0] frame:1    pts:58      pts_time:0.058",
            "[Parsed_metadata_3 @ 0] lavfi.signalstats.YAVG=160.572",
            "[Parsed_metadata_3 @ 0] lavfi.signalstats.YDIF=54.6165",
            "[Parsed_metadata_3 @ 0] lavfi.entropy.normalized_entropy.normal.Y=0.869210",
        ].join("\n");
        expect(parsearAnalisis(salida)).toEqual([
            { t: 0.017, luma: 149.147, movimiento: 0, detalle: 0.900498 },
            { t: 0.058, luma: 160.572, movimiento: 54.6165, detalle: 0.86921 },
        ]);
    });

    test("avance: último pts_time completo del trozo y texto con %, velocidad y lo que falta", () => {
        expect(ultimoPtsTime("frame:0 pts:17 pts_time:0.017\nlavfi.x=1\nframe:1 pts:58 pts_time:61.5\n")).toBe(61.5);
        // El último número puede venir cortado: se usa el anterior.
        expect(ultimoPtsTime("frame:0 pts:17 pts_time:10.5\nframe:1 pts:58 pts_time:1")).toBe(10.5);
        expect(ultimoPtsTime("lavfi.signalstats.YAVG=149.147\n")).toBeNull();

        expect(textoAvance(588, 1400, 50)).toBe("42 % (09:48 de 23:20, ×12, faltan ~01:09)");
        expect(textoAvance(10, 1400, 4)).toBe("0 % (00:10 de 23:20, ×2.5, faltan ~09:16)");
        expect(textoAvance(0, 1400, 0)).toBe("0 % (00:00 de 23:20)");
        expect(textoAvance(1500, 1400, 100)).toStartWith("100 %");
    });

    test("elige el más oscuro (sin contar negros), el de más movimiento y el de más detalle, sin superponerse", () => {
        const tramos = tramosPorContenido(episodioSimulado(1400, { negro: 50, oscuro: 300, movimiento: 700, detalle: 1000 }), 1400);
        expect(tramos.map((t) => [t.motivo, t.inicio, t.duracion])).toEqual([
            ["oscuro", 300, 20],
            ["movimiento", 700, 20],
            ["detalle", 1000, 20],
        ]);
    });

    test("si dos medidas coinciden en la misma zona, no se superponen", () => {
        const tramos = tramosPorContenido(episodioSimulado(1400, { oscuro: 300, movimiento: 300, detalle: 1000 }), 1400);
        const inicios = tramos.map((t) => t.inicio).sort((a, b) => a - b);
        expect(inicios.every((inicio, i) => i === 0 || inicio - inicios[i - 1]! >= 20)).toBe(true);
    });

    test("video corto o sin estadísticas: tramos fijos", () => {
        expect(tramosPorContenido([], 1400).every((t) => t.motivo === "fijo")).toBe(true);
        expect(tramosPorContenido(episodioSimulado(50, { oscuro: 0, movimiento: 20, detalle: 30 }), 50).every((t) => t.motivo === "fijo")).toBe(true);
    });
});

describe("métricas y capturas", () => {
    test("parsearSsimPorFrame, parsearSsim, parsearPsnr, kbps", () => {
        expect(parsearSsimPorFrame("n:2 Y:0.9 U:1 V:1 All:0.95 (13)\nn:1 Y:1 U:1 V:1 All:1.000000 (inf)\n")).toEqual([1, 0.95]);
        expect(parsearSsim("SSIM Y:0.99 All:0.988472 (19.38)")).toBe(0.988472);
        expect(parsearPsnr("PSNR average:45.08 min:40")).toBe(45.08);
        expect(kbps(2_500_000, 20)).toBe(1000);
        expect(filtroSeleccion([3, 17])).toBe("select='eq(n\\,3)+eq(n\\,17)'");
    });

    test("elegirCapturasMezcla: 2 de mayor diferencia y 2 de mínimo, separadas", () => {
        const base = Array.from({ length: 200 }, () => 0.99);
        const a = [...base];
        const b = [...base];
        b[50] = 0.95; // gran diferencia
        b[51] = 0.951; // demasiado cerca de 50
        b[150] = 0.96; // segunda diferencia
        a[100] = 0.9; b[100] = 0.9; // mínimo, sin diferencia
        a[10] = 0.92; b[10] = 0.92;
        const capturas = elegirCapturasMezcla([a, b], 4, 24);
        expect(capturas.map((c) => [c.frame, c.motivo])).toEqual([[10, "minimo"], [50, "diferencia"], [100, "minimo"], [150, "diferencia"]]);
    });

    test("clip corto: relaja la separación; sin datos: vacío", () => {
        expect(elegirCapturasMezcla([[0.9, 0.8, 0.7], [0.9, 0.9, 0.9]], 4).length).toBe(3);
        expect(elegirCapturasMezcla([[]], 4)).toEqual([]);
    });
});

describe("CRF igualado y caché", () => {
    // Modelo: el bitrate se reduce a la mitad cada 6 puntos de CRF.
    const modelo = (crf: number) => 2000 * 2 ** ((18 - crf) / 6);

    test("encuentra el CRF que pesa ±2 % del objetivo en pocas pruebas", async () => {
        const resultado = await buscarCrfIgualado(async (crf) => modelo(crf), 1500, 18);
        expect(Math.abs(resultado.kbps - 1500) / 1500).toBeLessThanOrEqual(0.02);
        expect(resultado.pruebas.length).toBeLessThanOrEqual(6);
        expect(resultado.pruebas[0]!.crf).toBe(18);
        expect(resultado.crf).toBeGreaterThan(18);
    });

    test("objetivo mayor: baja el CRF", async () => {
        const resultado = await buscarCrfIgualado(async (crf) => modelo(crf), 2600, 18);
        expect(resultado.crf).toBeLessThan(18);
    });

    test("claveCache cambia con los ajustes, el tramo o el objetivo", () => {
        const datos = { avs: "a.avs", tamanoAvs: 1, fechaAvs: 2, tramo: { inicio: 0, duracion: 20 }, x264: X264, objetivo: { tipo: "crf" as const, valor: 18 } };
        const base = claveCache(datos);
        expect(claveCache({ ...datos })).toBe(base);
        expect(claveCache({ ...datos, x264: { ...X264, tune: "" } })).not.toBe(base);
        expect(claveCache({ ...datos, tramo: { inicio: 1, duracion: 20 } })).not.toBe(base);
        expect(claveCache({ ...datos, objetivo: { tipo: "bitrate", valor: 18 } })).not.toBe(base);
    });
});

describe("x264 con variantes", () => {
    test("variante anime: sin --tune y extra al final; tramo y 2 pasadas", () => {
        const anime = variantesDeFabrica().find((v) => v.nombre === "anime")!;
        const args = comandosX264(herramientasDeMegui("C:\\MeGUI"), "a.avs", aplicarVariante(X264, anime), "o.264")[1]!.args;
        expect(args).not.toContain("--tune");
        expect(args.indexOf("--no-fast-pskip")).toBeLessThan(args.indexOf("--output"));

        const [ffmpeg, x264] = comandosX264(herramientasDeMegui("C:\\MeGUI"), "a.avs", X264, "o.264", {
            tramo: { inicio: 330, duracion: 20 },
            pasada: { numero: 2, bitrate: 1234, stats: "s.stats" },
        });
        expect(linea(ffmpeg!)).toContain("-ss 330.000 -t 20.000 -i a.avs");
        expect(x264!.args.join(" ")).toContain("--bitrate 1234 --pass 2 --stats s.stats");
    });

    test("validarVariante y usarVariante", () => {
        expect(validarVariante({ nombre: "x", descripcion: "", x264: { preset: "lentísimo" } })).toContain("Preset");
        const config = usarVariante(configDeFabrica(), "1080", "anime");
        expect((config.salidas[0] as SalidaMp4).x264.tune).toBe("");
        expect((config.salidas[1] as SalidaMp4).x264.tune).toBe("animation");
        expect(() => usarVariante(configDeFabrica(), "396", "anime")).toThrow("x264");
    });
});

// ---- Resultados de ejemplo (votos, página, servidor) ----

function resultadosEjemplo(): Resultados {
    const variante = (nombre: string, adoptar: string | null) => ({
        nombre,
        descripcion: `desc ${nombre}`,
        argumentos: nombre === "actual" ? "" : "--aq-mode 3",
        x264: X264,
        adoptar,
        promedio: { kbps: 1800, kbpsCrf: adoptar ? 1900 : null, fps: 50, ssim: 0.99, psnr: 50 },
        porTramo: [{ tramo: 1, kbps: 1800, kbpsCrf: null, crf: null, fps: 50, ssim: 0.99, psnr: 50, ssimPorFrame: [0.99, 0.98, 0.97], clip: `clips/t1-${nombre}.mp4`, desdeCache: false }],
    });
    return {
        version: 1,
        fecha: "2026-10-30T10:00:00.000Z",
        episodio: { serie: "Serie <prueba>", episodio: "01", raw: "raw.mkv", avs: "a.avs" },
        salida: { nombre: "1080", etiqueta: "MP4 1080", ancho: 1920, alto: 1080, x264: X264 },
        metodo: { referencia: "actual", igualacion: "bitrate", descripcion: "método" },
        tramos: [{ indice: 1, inicio: 300, duracion: 20, motivo: "oscuro", valor: 30 }],
        variantes: [variante("actual", null), variante("anime", "asu config salidas usar-variante 1080 anime")],
        capturas: [{ indice: 0, tramo: 1, frame: 1, segundo: 300.04, motivo: "diferencia", fuente: "capturas/t1-fuente-f00001.png", variantes: { actual: "capturas/a.png", anime: "capturas/b.png" }, ssim: { actual: 0.99, anime: 0.98 } }],
        votos: [],
    };
}

describe("votos", () => {
    test("validar, registrar (reemplaza el de la misma sesión y captura) y contar", () => {
        let r = resultadosEjemplo();
        expect(validarVoto(r, { sesion: "s1", captura: 0, eleccion: "anime" })).toBeUndefined();
        expect(validarVoto(r, { sesion: "s1", captura: 5, eleccion: "anime" })).toContain("Captura");
        expect(validarVoto(r, { sesion: "s1", captura: 0, eleccion: "otra" })).toContain("Elección");
        r = registrarVoto(r, { sesion: "s1", captura: 0, eleccion: "anime" }, new Date());
        r = registrarVoto(r, { sesion: "s1", captura: 0, eleccion: "empate" }, new Date());
        r = registrarVoto(r, { sesion: "s2", captura: 0, eleccion: "anime" }, new Date());
        expect(contarVotos(r)).toEqual({ empate: 1, actual: 0, anime: 1 });
    });
});

describe("generarPagina", () => {
    const html = generarPagina(resultadosEjemplo());

    test("título escapado, datos incrustados sin '<' crudo, pestañas", () => {
        expect(html).toContain("Serie &lt;prueba&gt;");
        expect(html).toContain("const DATOS_INCRUSTADOS =");
        const datos = html.match(/const DATOS_INCRUSTADOS = (.*);<\/script>/)![1]!;
        expect(datos).not.toContain("<");
        expect(JSON.parse(datos).episodio.serie).toBe("Serie <prueba>");
        expect(html).toContain("A ciegas");
    });

    test("pantalla completa de la sección (tecla F) y lo secundario oculto en ella", () => {
        expect(html).toContain('getElementById("vista-" + pestana).requestFullscreen()');
        expect(html).toContain("main section:fullscreen .solo-ventana { display: none !important; }");
        expect(html).toContain("miniaturas solo-ventana");
        expect(html).toContain("adoptar solo-ventana");
    });

    test("los scripts son JavaScript válido", () => {
        for (const [, script] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
            expect(() => new Function(script!)).not.toThrow();
        }
    });
});

// ---- Flujo completo con un ejecutor falso ----

const RAW = "[Grupo] Serie de Prueba - 01 [1080p][ABCD1234].mkv";
const DURACION = 1400;

/** Simula ffmpeg (info, análisis, SSIM/PSNR, capturas), x264 y mp4box. */
function ejecutorFalso(h: ReturnType<typeof herramientasDeMegui>) {
    const llamadas: Comando[][] = [];
    const ejecutor: Ejecutor = {
        async ejecutar(comandos) {
            llamadas.push([...comandos]);
            const ultimo = comandos.at(-1)!;
            const args = ultimo.args;
            const despues = (lista: string[], bandera: string) => lista[lista.indexOf(bandera) + 1]!;

            if (ultimo.exe === h.x264) {
                const duracion = Number(despues(comandos[0]!.args, "-t"));
                let kbpsSalida: number;
                if (args.includes("--pass")) {
                    kbpsSalida = Number(despues(args, "--bitrate"));
                } else {
                    const crf = Number(despues(args, "--crf"));
                    const anime = args.includes("--no-fast-pskip");
                    kbpsSalida = (anime ? 2100 : 2000) * 2 ** ((18 - crf) / 6);
                }
                writeFileSync(despues(args, "--output"), Buffer.alloc(Math.round((kbpsSalida * 1000 / 8) * duracion)));
                return { codigo: 0, stderr: "" };
            }
            if (ultimo.exe === h.mp4box) {
                writeFileSync(despues(args, "-new"), "mp4");
                return { codigo: 0, stderr: "" };
            }
            const filtro = args.find((a) => a.includes("ssim") || a.includes("psnr") || a.includes("metadata=mode=print") || a.startsWith("select=")) ?? "";
            if (filtro.includes("metadata=mode=print")) {
                const frames = episodioSimulado(DURACION, { oscuro: 300, movimiento: 700, detalle: 1000 });
                const texto = frames.map((f, n) => `frame:${n} pts:${n} pts_time:${f.t}\nlavfi.signalstats.YAVG=${f.luma}\nlavfi.signalstats.YDIF=${f.movimiento}\nlavfi.entropy.normalized_entropy.normal.Y=${f.detalle}`).join("\n");
                return { codigo: 0, stderr: texto, stdout: "" };
            }
            if (filtro.includes("ssim")) {
                const anime = args.some((a) => a.includes("-anime."));
                const frames = Array.from({ length: 480 }, (_, n) => `n:${n + 1} Y:1 U:1 V:1 All:${(anime && n % 97 === 5 ? 0.95 : 0.99 - (n % 7) / 1000).toFixed(6)} (20)`);
                // SSIM y PSNR van en la misma pasada de ffmpeg.
                return { codigo: 0, stderr: "SSIM All:0.990000 (20.0)\nPSNR average:45.000000", stdout: frames.join("\n") };
            }
            if (filtro.includes("psnr")) {
                return { codigo: 0, stderr: "PSNR average:45.000000" };
            }
            if (filtro.startsWith("select=")) {
                const cantidad = (filtro.match(/eq\(/g) ?? []).length;
                for (let k = 1; k <= cantidad; k++) {
                    writeFileSync(args.at(-1)!.replace("%02d", String(k).padStart(2, "0")), "png");
                }
                return { codigo: 0, stderr: "" };
            }
            // ffmpeg -i <.avs>: duración.
            return { codigo: 1, stderr: `  Duration: 00:23:20.00, start: 0` };
        },
    };
    return { ejecutor, llamadas };
}

describe("asu comparar (ejecutor falso)", () => {
    let base: string;
    let dir: string;
    let salida: string;
    let h: ReturnType<typeof herramientasDeMegui>;
    let falso: ReturnType<typeof ejecutorFalso>;
    let servidas: string[];
    const entorno = { ...process.env };

    const correr = (opciones: OpcionesComparar = {}) =>
        comparar({ dir, ...opciones }, { ejecutor: falso.ejecutor, servir: async (carpeta) => { servidas.push(carpeta); } });
    const comparaciones = () => readdirSync(join(salida, "Comparaciones")).filter((n) => n !== ".cache").map((n) => join(salida, "Comparaciones", n));
    const resultados = (carpeta = comparaciones()[0]!) => JSON.parse(readFileSync(join(carpeta, "resultados.json"), "utf8")) as Resultados;
    const x264Con = (texto: string) => falso.llamadas.filter((t) => t.some((c) => c.exe === h.x264) && t.map(linea).join(" ").includes(texto));

    beforeEach(() => {
        base = directorioTemporal();
        dir = join(base, "Serie de Prueba", "01");
        salida = join(base, "Encode");
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, RAW), "");
        writeFileSync(join(dir, "Serie - Subs.ass"), construirASS({ estilos: [["Default", "Arial"]], lineas: [] }));

        const megui = join(base, "MeGUI");
        h = herramientasDeMegui(megui);
        for (const ruta of Object.values(h)) {
            mkdirSync(dirname(ruta), { recursive: true });
            writeFileSync(ruta, "");
        }

        process.env.ASU_CLI_HOME = join(base, "home");
        process.env.ASU_CLI_NO_INTERACTIVO = "1";
        guardarConfig({ ...configDeFabrica(), rutaMegui: megui, carpetaSalida: salida });
        falso = ejecutorFalso(h);
        servidas = [];
    });

    afterEach(() => {
        process.env = { ...entorno };
        rmSync(base, { recursive: true, force: true });
    });

    test("por defecto: tramos por contenido, capturas mezcladas, resultados.json y página; sin servidor sin terminal", async () => {
        expect(await correr()).toBe(0);
        const carpeta = comparaciones()[0]!;
        const r = resultados(carpeta);

        expect(r.tramos.map((t) => [t.motivo, t.inicio])).toEqual([["oscuro", 300], ["movimiento", 700], ["detalle", 1000]]);
        expect(r.variantes.map((v) => v.nombre)).toEqual(["actual", "anime", "intermedia"]);
        expect(r.variantes[0]!.porTramo[0]!.ssimPorFrame).toHaveLength(480);
        expect(r.capturas).toHaveLength(12);
        expect(new Set(r.capturas.map((c) => c.motivo))).toEqual(new Set(["diferencia", "minimo"]));
        expect(r.capturas[0]!.ssim.anime).toBeDefined();
        // 3 tramos × 4 capturas × (fuente + 3 variantes)
        expect(readdirSync(join(carpeta, "capturas"))).toHaveLength(48);
        expect(readFileSync(join(carpeta, "index.html"), "utf8")).toContain("DATOS_INCRUSTADOS");
        expect(r.variantes[1]!.adoptar).toBe("asu config salidas usar-variante 1080 anime");
        expect(r.variantes[0]!.porTramo[0]!.psnr).toBe(45);
        expect(servidas).toEqual([]);
    });

    test("2 pasadas al bitrate de la referencia (por defecto)", async () => {
        await correr({ tramosFijos: true });
        const r = resultados();
        expect(r.metodo.igualacion).toBe("bitrate");
        expect(x264Con("--pass 2")).toHaveLength(6);
        const referencia = r.variantes[0]!.porTramo[0]!.kbps;
        expect(Math.abs(r.variantes[1]!.porTramo[0]!.kbps - referencia)).toBeLessThanOrEqual(1);
        expect(r.variantes[1]!.porTramo[0]!.kbpsCrf).toBeGreaterThan(referencia);
        expect(r.tramos.every((t) => t.motivo === "fijo")).toBe(true);
    });

    test("--igualar crf: busca el CRF que pesa igual, sin 2 pasadas", async () => {
        await correr({ igualar: "crf", tramosFijos: true, variantes: ["anime"] });
        const r = resultados();
        expect(x264Con("--pass")).toHaveLength(0);
        const anime = r.variantes[1]!.porTramo[0]!;
        expect(anime.crf).not.toBeNull();
        expect(Math.abs(anime.kbps - r.variantes[0]!.porTramo[0]!.kbps) / r.variantes[0]!.porTramo[0]!.kbps).toBeLessThanOrEqual(0.02);
        expect(r.metodo.igualacion).toBe("crf");
    });

    test("caché: la segunda vez no recodifica; --sin-cache sí", async () => {
        await correr({ tramosFijos: true });
        falso.llamadas.length = 0;
        await correr({ tramosFijos: true });
        expect(x264Con("--output")).toHaveLength(0);
        expect(resultados(comparaciones().sort().at(-1)!).variantes.every((v) => v.porTramo.every((t) => t.desdeCache))).toBe(true);

        falso.llamadas.length = 0;
        await correr({ tramosFijos: true, sinCache: true });
        expect(x264Con("--output").length).toBeGreaterThan(0);
    });

    test("registro.log en la carpeta de la comparación; las codificaciones con vigilante", async () => {
        const vigiladas: string[] = [];
        const base = falso.ejecutor;
        falso.ejecutor = { ejecutar: (comandos, opciones) => {
            if (opciones?.vigilar) vigiladas.push(comandos.map(linea).join(" | "));
            return base.ejecutar(comandos, opciones);
        } };

        expect(await correr({ tramosFijos: true, variantes: ["anime"] })).toBe(0);
        const texto = readFileSync(join(comparaciones()[0]!, "registro.log"), "utf8");
        expect(texto).toContain("asu comparar");
        expect(texto).toContain("Variante anime:");
        expect(texto).toContain("x264.exe");
        expect(texto).toContain("Terminado (código 0).");
        expect(vigiladas.length).toBeGreaterThan(0);
        expect(vigiladas.every((l) => l.includes("x264.exe"))).toBe(true);
    });

    test("x264 colgado: se reintenta una vez; dos veces es error con la ruta del registro", async () => {
        const base = falso.ejecutor;
        let cuelgues = 1;
        falso.ejecutor = { ejecutar: (comandos, opciones) => {
            if (cuelgues > 0 && comandos.some((c) => c.exe === h.x264)) {
                cuelgues--;
                return Promise.resolve({ codigo: -1, stderr: "", colgado: { vivos: ["x264.exe"] } });
            }
            return base.ejecutar(comandos, opciones);
        } };

        expect(await correr({ tramosFijos: true, variantes: ["anime"] })).toBe(0);
        expect(readFileSync(join(comparaciones()[0]!, "registro.log"), "utf8")).toContain("se reintenta una vez");

        cuelgues = 2;
        const error = (await correr({ tramosFijos: true, variantes: ["anime"], sinCache: true, paralelo: "1" }).catch((e: unknown) => e)) as Error;
        expect(error.message).toContain("se colgó dos veces");
        expect(error.message).toMatch(/Registro: .+registro\.log$/);
    });

    test("análisis con vigilante: un cuelgue se reintenta y los tramos salen igual", async () => {
        const base = falso.ejecutor;
        let cuelgues = 1;
        let vigilado = false;
        falso.ejecutor = { ejecutar: (comandos, opciones) => {
            const esAnalisis = comandos.some((c) => c.args.some((a) => a.includes("metadata=mode=print")));
            if (esAnalisis) {
                vigilado = opciones?.vigilar !== undefined;
                if (cuelgues-- > 0) {
                    return Promise.resolve({ codigo: -1, stderr: "", colgado: { vivos: ["ffmpeg.exe"] } });
                }
            }
            return base.ejecutar(comandos, opciones);
        } };

        expect(await correr({ variantes: ["anime"] })).toBe(0);
        expect(vigilado).toBe(true);
        expect(resultados().tramos.map((t) => t.motivo)).toEqual(["oscuro", "movimiento", "detalle"]);
        expect(readFileSync(join(comparaciones()[0]!, "registro.log"), "utf8")).toContain('"análisis del episodio" se colgó');
    });

    test("--tramo manual y errores", async () => {
        expect(await correr({ tramos: ["01:00-01:10"], variantes: ["intermedia"] })).toBe(0);
        expect(resultados().tramos).toEqual([{ indice: 1, inicio: 60, duracion: 10, motivo: "manual" }]);

        await expect(correr({ tramos: ["10:00-09:00"] })).rejects.toThrow("Tramo inválido");
        await expect(correr({ variantes: ["nada"] })).rejects.toThrow("nada");
        await expect(correr({ salida: "396" })).rejects.toThrow("mp4-x264");
        await expect(correr({ igualar: "tamaño" })).rejects.toThrow("--igualar");
    });

    test("resumenComparacion (menú): versión, variantes, tramos y votos; ilegible si falta el json", async () => {
        await correr({ tramosFijos: true, variantes: ["anime"] });
        expect(resumenComparacion(comparaciones()[0]!)).toBe("MP4 1080 · actual, anime · 3 tramos · 0 votos");
        expect(resumenComparacion(join(base, "no-existe"))).toBe("resultados.json ilegible");
    });

    test("asu comparar abrir: sirve la última comparación y regenera la página", async () => {
        await correr({ tramosFijos: true, variantes: ["anime"] });
        const carpeta = comparaciones()[0]!;
        writeFileSync(join(carpeta, "index.html"), "vieja");

        expect(await abrirComparacion({}, { servir: async (c) => { servidas.push(c); } })).toBe(0);
        expect(servidas).toEqual([carpeta]);
        expect(readFileSync(join(carpeta, "index.html"), "utf8")).toContain("DATOS_INCRUSTADOS");
        await expect(abrirComparacion({ carpeta: base }, { servir: async () => {} })).rejects.toThrow("resultados.json");
        await expect(abrirComparacion({ carpeta: join(base, "no-existe") }, { servir: async () => {} })).rejects.toThrow("No existe la carpeta");
    });
});

// ---- Servidor ----

describe("servidor de la comparación", () => {
    let carpeta: string;
    let home: string;
    let abiertos: [string, string][];
    let servidor: ReturnType<typeof crearServidorComparacion>;
    const entorno = { ...process.env };
    const origen = () => new URL(servidor.url).origin;
    const llamar = (ruta: string, opciones: { token?: string | null; cuerpo?: unknown; origen?: string } = {}) => fetch(origen() + ruta, {
        method: opciones.cuerpo === undefined ? "GET" : "POST",
        headers: {
            ...(opciones.token === null ? {} : { "x-asu-token": opciones.token ?? servidor.token }),
            ...(opciones.origen ? { origin: opciones.origen } : {}),
            "content-type": "application/json",
        },
        body: opciones.cuerpo === undefined ? undefined : JSON.stringify(opciones.cuerpo),
    });

    beforeEach(() => {
        carpeta = directorioTemporal();
        home = directorioTemporal();
        process.env.ASU_CLI_HOME = home;
        guardarConfig(configDeFabrica());
        mkdirSync(join(carpeta, "clips"));
        writeFileSync(join(carpeta, "resultados.json"), JSON.stringify(resultadosEjemplo()));
        writeFileSync(join(carpeta, "index.html"), "<html>página</html>");
        writeFileSync(join(carpeta, "clips", "t1-anime.mp4"), Buffer.from("0123456789abcdef"));
        abiertos = [];
        servidor = crearServidorComparacion(carpeta, { abrir: (destino, tipo) => abiertos.push([destino, tipo]) });
    });

    afterEach(() => {
        servidor.cerrar();
        process.env = { ...entorno };
        rmSync(carpeta, { recursive: true, force: true });
        rmSync(home, { recursive: true, force: true });
    });

    test("solo 127.0.0.1; la página se sirve; la API exige token", async () => {
        expect(servidor.url).toStartWith("http://127.0.0.1:");
        expect(await (await fetch(origen() + "/")).text()).toContain("página");
        expect((await llamar("/api/resultados", { token: null })).status).toBe(403);
        expect((await llamar("/api/resultados", { token: "otro" })).status).toBe(403);
        expect(((await (await llamar("/api/resultados")).json()) as Resultados).salida.nombre).toBe("1080");
    });

    test("origen ajeno: 403 aunque tenga token", async () => {
        expect((await llamar("/api/votos", { cuerpo: { sesion: "s", captura: 0, eleccion: "anime" }, origen: "http://malicioso.example" })).status).toBe(403);
    });

    test("votos: se guardan en resultados.json; inválidos 400", async () => {
        const respuesta = await llamar("/api/votos", { cuerpo: { sesion: "s", captura: 0, eleccion: "anime" }, origen: origen() });
        expect(respuesta.status).toBe(200);
        expect(((await respuesta.json()) as { conteo: Record<string, number> }).conteo.anime).toBe(1);
        expect(JSON.parse(readFileSync(join(carpeta, "resultados.json"), "utf8")).votos).toHaveLength(1);
        expect((await llamar("/api/votos", { cuerpo: { sesion: "s", captura: 9, eleccion: "anime" } })).status).toBe(400);
    });

    test("adoptar: modifica la config; la referencia no se adopta", async () => {
        expect((await llamar("/api/adoptar", { cuerpo: { variante: "anime", salidas: ["1080", "720"] } })).status).toBe(200);
        const config = cargarConfig();
        expect((config.salidas[0] as SalidaMp4).x264.tune).toBe("");
        expect((config.salidas[1] as SalidaMp4).x264.extra).toContain("--aq-mode");
        expect((await llamar("/api/adoptar", { cuerpo: { variante: "actual" } })).status).toBe(400);
        expect((await llamar("/api/adoptar", { cuerpo: { variante: "anime", salidas: ["396"] } })).status).toBe(400);
    });

    test("abrir: carpeta y archivo dentro de la carpeta; fuera, 400", async () => {
        expect((await llamar("/api/abrir", { cuerpo: { tipo: "carpeta" } })).status).toBe(200);
        expect((await llamar("/api/abrir", { cuerpo: { tipo: "archivo", ruta: "clips/t1-anime.mp4" } })).status).toBe(200);
        expect((await llamar("/api/abrir", { cuerpo: { tipo: "archivo", ruta: "../../Windows/notepad.exe" } })).status).toBe(400);
        expect(abiertos.map(([, tipo]) => tipo)).toEqual(["carpeta", "archivo"]);
    });

    test("rangos para <video> y nada fuera de la carpeta", async () => {
        const parcial = await fetch(origen() + "/clips/t1-anime.mp4", { headers: { range: "bytes=2-5" } });
        expect(parcial.status).toBe(206);
        expect(await parcial.text()).toBe("2345");
        expect(parcial.headers.get("content-range")).toBe("bytes 2-5/16");
        expect((await fetch(origen() + "/..%2F..%2Fsecreto.txt")).status).toBe(404);
    });

    test("cerrar desde la página resuelve 'cerrado'", async () => {
        await llamar("/api/cerrar", { cuerpo: {} });
        await servidor.cerrado;
        expect(existsSync(carpeta)).toBe(true);
    });
});
