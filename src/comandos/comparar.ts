import * as p from "@clack/prompts";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { ejecutorReal, type Ejecutor } from "../ejecutor.ts";
import { LectorAvance, ejecutarConLimite, ultimasLineas } from "../nucleo/avance.ts";
import {
    FILTRO_ANALISIS,
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
    parsearTramo,
    promedio,
    tramosPorContenido,
    tramosPorDefecto,
    type Tramo,
    type TramoElegido,
} from "../nucleo/comparar.ts";
import { generarPagina } from "../nucleo/comparar-pagina.ts";
import { NOMBRE_RESULTADOS, VERSION_RESULTADOS, type ResultadoCaptura, type ResultadoTramo, type Resultados } from "../nucleo/comparar-resultados.ts";
import {
    aplicarVariante,
    buscarPreajuste,
    buscarSalida,
    buscarVariante,
    cargarConfig,
    type AjustesX264,
    type Config,
    type SalidaMp4,
    type Variante,
} from "../nucleo/config.ts";
import { argumentosTramo, comandoInfo, comandoMp4Video, comandosX264, herramientasDeMegui, parsearDuracion, type Comando, type Herramientas } from "../nucleo/encode.ts";
import { PanelAvance } from "../panel-avance.ts";
import { servirComparacion, type OpcionesServidor } from "../servidor-comparacion.ts";
import { ErrorUsuario, elegir, elegirVarios, esInteractivo } from "../ui.ts";
import { elegirVideo, resolverDirectorio, resolverSerieEpisodio, type OpcionesSerieEpisodio } from "./comun.ts";
import {
    asegurarCarpetaSalida,
    asegurarRutaMegui,
    cargarRecuerdo,
    etiquetaSalida,
    paralelo,
    prepararAvs,
    verificarHerramientas,
} from "./encode.ts";

export type OpcionesComparar = OpcionesSerieEpisodio & {
    dir?: string;
    /** Salida MP4 a comparar (por defecto, la primera). */
    salida?: string;
    variantes?: string[];
    /** "mm:ss-mm:ss". */
    tramos?: string[];
    /** 25/50/75 % en vez de tramos por contenido. */
    tramosFijos?: boolean;
    /** Capturas por tramo. */
    capturas?: string;
    /** "bitrate" (2 pasadas, por defecto) o "crf" (CRF que pesa igual que la referencia). */
    igualar?: string;
    sinCache?: boolean;
    /** No levantar el servidor ni abrir el navegador al terminar. */
    noAbrir?: boolean;
    paralelo?: string;
    video?: string;
    subs?: string[];
    carpetaSalida?: string;
};

/** Para tests: otro ejecutor y otro servidor. */
export type DependenciasComparar = {
    ejecutor?: Ejecutor;
    servir?: (carpeta: string, opciones?: OpcionesServidor) => Promise<void>;
};

export const CAPTURAS_POR_TRAMO = 4;
export const CARPETA_COMPARACIONES = "Comparaciones";
export const CARPETA_CACHE = ".cache";
const REFERENCIA = "actual";

// ---- Elecciones ----

async function elegirSalidaComparar(config: Config, nombre: string | undefined): Promise<SalidaMp4> {
    const mp4 = config.salidas.filter((salida): salida is SalidaMp4 => salida.tipo === "mp4-x264");
    if (mp4.length === 0) {
        throw new ErrorUsuario("No hay salidas mp4-x264 en la config para comparar.");
    }

    if (nombre !== undefined) {
        const salida = buscarSalida(config, nombre);
        if (!salida || salida.tipo !== "mp4-x264") {
            throw new ErrorUsuario(`"${nombre}" no es una salida mp4-x264. Disponibles: ${mp4.map((x) => x.nombre).join(", ")}`);
        }
        return salida;
    }

    if (mp4.length === 1 || !esInteractivo()) {
        return mp4[0]!;
    }

    return elegir("Versión a comparar", mp4.map((salida) => ({ value: salida, label: etiquetaSalida(config, salida) })));
}

/**
 * Variantes a comparar; la referencia ("actual", o la salida sin cambios si no existe en la config)
 * va siempre primero: las demás se igualan a ella.
 */
async function elegirVariantes(config: Config, nombres: string[] | undefined): Promise<Variante[]> {
    const referencia = buscarVariante(config, REFERENCIA) ?? { nombre: REFERENCIA, descripcion: "Los ajustes de la salida, sin cambios", x264: {} };
    const otras = config.variantes.filter((variante) => variante.nombre.toLowerCase() !== REFERENCIA);

    let elegidas: Variante[];
    if (nombres !== undefined) {
        elegidas = nombres
            .filter((nombre) => nombre.trim().toLowerCase() !== REFERENCIA)
            .map((nombre) => {
                const variante = buscarVariante(config, nombre);
                if (!variante) {
                    throw new ErrorUsuario(`No existe la variante "${nombre}". Disponibles: ${config.variantes.map((x) => x.nombre).join(", ")}`);
                }
                return variante;
            });
    } else if (esInteractivo() && otras.length > 1) {
        elegidas = await elegirVarios(
            `Variantes a comparar contra "${REFERENCIA}"`,
            otras.map((variante) => ({ value: variante, label: variante.nombre, hint: variante.descripcion })),
            otras,
        );
    } else {
        elegidas = otras;
    }

    if (elegidas.length === 0) {
        throw new ErrorUsuario(`Elige al menos una variante para comparar con "${REFERENCIA}".`);
    }

    return [referencia, ...otras.filter((variante) => elegidas.includes(variante))];
}

function tramosManuales(textos: string[], duracionTotal: number): TramoElegido[] {
    return textos.map((texto) => {
        const tramo = parsearTramo(texto);
        if (!tramo) {
            throw new ErrorUsuario(`Tramo inválido: "${texto}". Formato: mm:ss-mm:ss (ej. 05:30-05:50).`);
        }
        if (tramo.inicio >= duracionTotal) {
            throw new ErrorUsuario(`El tramo "${texto}" empieza después del final del video (${formatearTiempo(duracionTotal)}).`);
        }
        return { inicio: tramo.inicio, duracion: Math.min(tramo.duracion, duracionTotal - tramo.inicio), motivo: "manual" as const };
    });
}

function capturasPorTramo(texto: string | undefined): number {
    if (texto === undefined) {
        return CAPTURAS_POR_TRAMO;
    }
    const valor = Number(texto);
    if (!Number.isInteger(valor) || valor < 1) {
        throw new ErrorUsuario(`--capturas debe ser un entero mayor o igual a 1 (recibido "${texto}").`);
    }
    return valor;
}

function igualacion(texto: string | undefined): "bitrate" | "crf" {
    if (texto === undefined || texto === "bitrate") {
        return "bitrate";
    }
    if (texto === "crf") {
        return "crf";
    }
    throw new ErrorUsuario(`--igualar debe ser "bitrate" o "crf" (recibido "${texto}").`);
}

/** Lo que distingue a la variante, para la tabla. */
function describirArgumentos(variante: Variante): string {
    const { tune, extra, ...resto } = variante.x264;
    return [
        tune === undefined ? "" : tune === "" ? "sin --tune" : `--tune ${tune}`,
        ...Object.entries(resto).map(([clave, valor]) => `${clave}=${valor}`),
        ...(extra ?? []),
    ].filter(Boolean).join(" ");
}

// ---- Ejecución ----

type Contexto = {
    ejecutor: Ejecutor;
    h: Herramientas;
    avs: string;
    tamanoAvs: number;
    fechaAvs: number;
    cache: string;
    sinCache: boolean;
    clips: string;
    panel: PanelAvance;
};

/** Ejecuta y devuelve los frames que informó la herramienta y los segundos que tardó. */
async function correr(ctx: Contexto, comandos: Comando[], descripcion: string, esperado: string, fila?: string): Promise<{ frames: number | null; segundos: number }> {
    const lector = new LectorAvance();
    const inicio = Date.now();
    const { codigo, stderr } = await ctx.ejecutor.ejecutar(comandos, {
        alSalida: (texto) => {
            lector.leer(texto);
            if (fila && lector.frames !== null) {
                ctx.panel.frames(fila, lector.frames);
            }
        },
    });

    if (codigo !== 0 || !existsSync(esperado)) {
        const detalle = ultimasLineas(stderr);
        throw new ErrorUsuario(`Falló "${descripcion}" (código ${codigo}).${detalle ? `\n${detalle}` : ""}`);
    }

    return { frames: lector.frames, segundos: (Date.now() - inicio) / 1000 };
}

type Objetivo = { tipo: "crf"; valor: number } | { tipo: "bitrate"; valor: number };

type Codificado = {
    video264: string;
    kbps: number;
    fps: number | null;
    desdeCache: boolean;
};

/**
 * Codifica un tramo con unos ajustes y un objetivo (CRF o bitrate en 2 pasadas), o lo toma de la
 * caché si ya se codificó igual: mismo .avs (tamaño y fecha), tramo, ajustes y objetivo.
 */
async function codificarConCache(ctx: Contexto, x264: AjustesX264, tramo: Tramo, objetivo: Objetivo, descripcion: string, fila: string): Promise<Codificado> {
    const clave = claveCache({ avs: ctx.avs, tamanoAvs: ctx.tamanoAvs, fechaAvs: ctx.fechaAvs, tramo, x264, objetivo });
    const dir = join(ctx.cache, clave);
    const video264 = join(dir, "video.264");
    const meta = join(dir, "meta.json");

    if (!ctx.sinCache && existsSync(meta) && existsSync(video264)) {
        const datos = JSON.parse(readFileSync(meta, "utf8")) as { kbps: number; fps: number | null };
        return { video264, kbps: datos.kbps, fps: datos.fps, desdeCache: true };
    }

    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    let medida: { frames: number | null; segundos: number };
    if (objetivo.tipo === "crf") {
        medida = await correr(ctx, comandosX264(ctx.h, ctx.avs, { ...x264, crf: objetivo.valor }, video264, { tramo }), descripcion, video264, fila);
    } else {
        const stats = join(dir, "x264.stats");
        const pasada1 = join(dir, "pasada1.264");
        ctx.panel.paso(fila, `${descripcion} · 1.ª pasada`);
        await correr(ctx, comandosX264(ctx.h, ctx.avs, x264, pasada1, { tramo, pasada: { numero: 1, bitrate: objetivo.valor, stats } }), `${descripcion} (1.ª pasada)`, pasada1, fila);
        ctx.panel.paso(fila, `${descripcion} · 2.ª pasada`);
        medida = await correr(ctx, comandosX264(ctx.h, ctx.avs, x264, video264, { tramo, pasada: { numero: 2, bitrate: objetivo.valor, stats } }), `${descripcion} (2.ª pasada)`, video264, fila);
        rmSync(pasada1, { force: true });
    }

    const resultado = {
        kbps: kbps(statSync(video264).size, tramo.duracion),
        fps: medida.frames !== null && medida.segundos > 0 ? Number((medida.frames / medida.segundos).toFixed(2)) : null,
    };
    writeFileSync(meta, JSON.stringify(resultado));
    return { video264, ...resultado, desdeCache: false };
}

type Clip = {
    clip: string;
    kbps: number;
    kbpsCrf: number | null;
    crf: number | null;
    fps: number | null;
    desdeCache: boolean;
};

function nombreClip(tramo: number, variante: string): string {
    return `t${tramo + 1}-${variante}`;
}

async function codificarClip(
    ctx: Contexto,
    x264Base: AjustesX264,
    variante: Variante,
    indice: number,
    tramo: Tramo,
    modo: "referencia" | "bitrate" | "crf",
    objetivo: number,
): Promise<Clip> {
    const x264 = aplicarVariante(x264Base, variante);
    const etiqueta = `tramo ${indice + 1}`;
    const fila = variante.nombre;
    let codificado: Codificado;
    let kbpsCrf: number | null = null;
    let crf: number | null = null;

    if (modo === "referencia") {
        ctx.panel.paso(fila, `${etiqueta} · CRF ${x264.crf}`);
        codificado = await codificarConCache(ctx, x264, tramo, { tipo: "crf", valor: x264.crf }, `${variante.nombre} ${etiqueta}`, fila);
    } else if (modo === "bitrate") {
        // Cuánto pesaría con el CRF de la salida (solo para informar).
        ctx.panel.paso(fila, `${etiqueta} · CRF (tamaño)`);
        kbpsCrf = (await codificarConCache(ctx, x264, tramo, { tipo: "crf", valor: x264.crf }, `${variante.nombre} ${etiqueta} (CRF)`, fila)).kbps;
        codificado = await codificarConCache(ctx, x264, tramo, { tipo: "bitrate", valor: objetivo }, `${variante.nombre} ${etiqueta}`, fila);
    } else {
        const porCrf = new Map<number, Codificado>();
        const busqueda = await buscarCrfIgualado(async (valor) => {
            ctx.panel.paso(fila, `${etiqueta} · buscando CRF (${valor})`);
            const c = await codificarConCache(ctx, x264, tramo, { tipo: "crf", valor }, `${variante.nombre} ${etiqueta} (CRF ${valor})`, fila);
            porCrf.set(valor, c);
            return c.kbps;
        }, objetivo, x264.crf);
        kbpsCrf = busqueda.pruebas[0]!.kbps;
        crf = busqueda.crf;
        codificado = porCrf.get(busqueda.crf)!;
    }

    ctx.panel.paso(fila, `${etiqueta} · mux`);
    const clip = join(ctx.clips, `${nombreClip(indice, variante.nombre)}.mp4`);
    await correr(ctx, [comandoMp4Video(ctx.h, codificado.video264, ctx.cache, clip)], `${variante.nombre} ${etiqueta} (mux)`, clip);

    return { clip, kbps: codificado.kbps, kbpsCrf, crf, fps: codificado.fps, desdeCache: codificado.desdeCache };
}

/** Frames `indices` de `entrada` (desde `tramo.inicio` si es el .avs) como PNG con colores BT.709. */
function comandoCapturas(h: Herramientas, entrada: string, indices: readonly number[], patron: string, tramo?: Tramo): Comando {
    return {
        exe: h.ffmpeg,
        args: [
            "-y", "-loglevel", "level+error",
            ...argumentosTramo(tramo),
            "-i", entrada,
            "-vf", `${filtroSeleccion(indices)},scale=in_color_matrix=bt709:flags=bicubic+accurate_rnd+full_chroma_int,format=rgb24`,
            "-vsync", "0", patron,
        ],
    };
}

/** Renombra "base-01.png", "base-02.png"... a "base-f<frame>.png" según `indices`. */
function nombrarCapturas(carpeta: string, base: string, indices: readonly number[]): string[] {
    return indices.map((frame, k) => {
        const origen = join(carpeta, `${base}-${String(k + 1).padStart(2, "0")}.png`);
        const destino = join(carpeta, `${base}-f${String(frame).padStart(5, "0")}.png`);
        if (!existsSync(origen)) {
            throw new ErrorUsuario(`Falta la captura ${basename(origen)}.`);
        }
        renameSync(origen, destino);
        return destino;
    });
}

/** SSIM por frame y promedio (stdout/stderr de `ssim=stats_file=-`) y PSNR promedio de un clip contra el .avs. */
async function medir(ctx: Contexto, clip: string, tramo: Tramo): Promise<{ ssimPorFrame: number[]; ssim: number | null; psnr: number | null }> {
    // Una sola lectura del .avs (lo caro) para ambas métricas.
    const { stdout, stderr } = await ctx.ejecutor.ejecutar(
        [{
            exe: ctx.h.ffmpeg,
            args: [
                "-hide_banner", "-nostdin", "-nostats", "-i", clip, ...argumentosTramo(tramo), "-i", ctx.avs,
                "-lavfi", "[0:v]split[a][b];[1:v]split[c][d];[a][c]ssim=stats_file=-:shortest=1[s];[b][d]psnr=shortest=1[p]",
                "-map", "[s]", "-f", "null", "-", "-map", "[p]", "-f", "null", "-",
            ],
        }],
        { capturar: true },
    );
    return { ssimPorFrame: parsearSsimPorFrame(stdout ?? ""), ssim: parsearSsim(stderr), psnr: parsearPsnr(stderr) };
}

/** Tramos por contenido: ffmpeg analiza el raw completo a baja resolución. */
async function analizarContenido(ejecutor: Ejecutor, h: Herramientas, raw: string, duracionTotal: number): Promise<TramoElegido[]> {
    p.log.step("Analizando el episodio para elegir tramos (oscuro, movimiento, detalle)...");
    const { stderr } = await ejecutor.ejecutar(
        [{ exe: h.ffmpeg, args: ["-hide_banner", "-nostdin", "-nostats", "-i", raw, "-an", "-sn", "-vf", FILTRO_ANALISIS, "-f", "null", "-"] }],
        { capturar: true },
    );
    return tramosPorContenido(parsearAnalisis(stderr), duracionTotal);
}

function describirTramo(tramo: TramoElegido): string {
    const motivo = { oscuro: "más oscuro", movimiento: "más movimiento", detalle: "más detalle", fijo: "fijo", manual: "manual" }[tramo.motivo];
    return `${formatearTiempo(tramo.inicio)}-${formatearTiempo(tramo.inicio + tramo.duracion)} (${motivo})`;
}

// ---- Comando ----

/**
 * Prueba A/B de ajustes x264: codifica tramos de una salida MP4 con cada variante (la referencia con
 * su CRF; las demás igualadas a ella), mide la SSIM por frame, captura los frames que más distinguen
 * y deja resultados.json + una página. Al terminar la sirve en un servidor local y abre el navegador.
 */
export async function comparar(opciones: OpcionesComparar, dependencias: DependenciasComparar = {}): Promise<number> {
    const ejecutor = dependencias.ejecutor ?? ejecutorReal;
    const dir = resolverDirectorio(opciones.dir);
    p.log.info(`Directorio: ${dir}`);

    const config = cargarConfig();
    const salida = await elegirSalidaComparar(config, opciones.salida);
    const variantes = await elegirVariantes(config, opciones.variantes);
    const porTramo = capturasPorTramo(opciones.capturas);
    const modo = igualacion(opciones.igualar);
    const limite = paralelo(config, opciones.paralelo);
    p.log.info(`Versión: ${etiquetaSalida(config, salida)} · variantes: ${variantes.map((v) => v.nombre).join(", ")}`);

    const recuerdo = await cargarRecuerdo(dir, config, { sinVersiones: true });
    const h = herramientasDeMegui(await asegurarRutaMegui(config));
    verificarHerramientas(h, [salida]);
    const carpetaSalida = await asegurarCarpetaSalida(config, opciones.carpetaSalida);

    const video = await elegirVideo(dir, opciones.video);
    const { serie, episodio } = recuerdo.aplicar ? recuerdo.previo : {};
    const serieEpisodio = await resolverSerieEpisodio(
        dir,
        video,
        { serie: opciones.serie ?? serie, episodio: opciones.episodio ?? episodio },
        { sugerido: recuerdo.previo, alConfirmar: recuerdo.guardar },
    );
    const { avs: rutasAvs } = await prepararAvs(dir, video, serieEpisodio, [salida], config, { subs: opciones.subs }, recuerdo);
    const avs = rutasAvs.get(salida)!;

    const info = await ejecutor.ejecutar([comandoInfo(h, avs)], { capturar: true });
    const duracionTotal = parsearDuracion(info.stderr);
    if (!duracionTotal) {
        throw new ErrorUsuario(`No se pudo leer la duración de ${basename(avs)}.`);
    }

    const tramos: TramoElegido[] = opciones.tramos !== undefined
        ? tramosManuales(opciones.tramos, duracionTotal)
        : opciones.tramosFijos
            ? tramosPorDefecto(duracionTotal).map((t) => ({ ...t, motivo: "fijo" as const }))
            : await analizarContenido(ejecutor, h, video, duracionTotal);
    p.log.info(`Tramos: ${tramos.map(describirTramo).join(", ")}`);

    const comparaciones = join(carpetaSalida, CARPETA_COMPARACIONES);
    const nombreBase = `${serieEpisodio.serie} - ${serieEpisodio.episodio} - ${marcaDeTiempo(new Date())}`;
    let carpeta = join(comparaciones, nombreBase);
    for (let n = 2; existsSync(carpeta); n++) {
        carpeta = join(comparaciones, `${nombreBase} (${n})`);
    }
    const { size, mtimeMs } = statSync(avs);
    const ctx: Contexto = {
        ejecutor,
        h,
        avs,
        tamanoAvs: size,
        fechaAvs: mtimeMs,
        cache: join(comparaciones, CARPETA_CACHE),
        sinCache: opciones.sinCache ?? false,
        clips: join(carpeta, "clips"),
        panel: new PanelAvance(variantes.map((v) => v.nombre)),
    };
    const dirCapturas = join(carpeta, "capturas");
    for (const ruta of [ctx.cache, ctx.clips, dirCapturas]) {
        mkdirSync(ruta, { recursive: true });
    }

    // clips[variante][tramo]
    const clips = new Map<string, Clip[]>(variantes.map((v) => [v.nombre, []]));
    const [referencia, ...otras] = variantes;

    p.log.step(`Codificando ${tramos.length} tramos × ${variantes.length} variantes (hasta ${limite} a la vez, igualadas por ${modo === "crf" ? "tamaño con CRF" : "bitrate en 2 pasadas"})`);
    ctx.panel.iniciar();
    const errores = await ejecutarConLimite(
        tramos.map((tramo, i) => async () => {
            clips.get(referencia!.nombre)![i] = await codificarClip(ctx, salida.x264, referencia!, i, tramo, "referencia", 0);
        }),
        limite,
    );
    if (errores.length === 0) {
        errores.push(...(await ejecutarConLimite(
            otras.flatMap((variante) => tramos.map((tramo, i) => async () => {
                const objetivo = clips.get(referencia!.nombre)![i]!.kbps;
                clips.get(variante.nombre)![i] = await codificarClip(ctx, salida.x264, variante, i, tramo, modo, objetivo);
            })),
            limite,
        )));
    }
    for (const variante of variantes) {
        ctx.panel.terminar(variante.nombre, errores.length === 0 ? "listo" : "error");
    }
    ctx.panel.detener();

    if (errores.length > 0) {
        const mensajes = errores.map((error) => (error instanceof Error ? error.message : String(error)));
        throw new ErrorUsuario(`${mensajes.join("\n\n")}\nLos archivos quedan en ${carpeta}.`);
    }

    p.log.step("Midiendo SSIM/PSNR por frame...");
    const metricas = new Map<string, { ssimPorFrame: number[]; ssim: number | null; psnr: number | null }[]>(variantes.map((v) => [v.nombre, []]));
    await ejecutarConLimite(
        variantes.flatMap((variante) => tramos.map((tramo, i) => async () => {
            metricas.get(variante.nombre)![i] = await medir(ctx, clips.get(variante.nombre)![i]!.clip, tramo);
        })),
        limite,
    );

    p.log.step("Capturando los frames que más distinguen a las variantes...");
    const capturas: ResultadoCaptura[] = [];
    for (const [i, tramo] of tramos.entries()) {
        const series = variantes.map((v) => metricas.get(v.nombre)![i]!.ssimPorFrame);
        const elegidas = elegirCapturasMezcla(series, porTramo);
        if (elegidas.length === 0) {
            throw new ErrorUsuario(`No se pudo leer la SSIM por frame del tramo ${i + 1}.`);
        }
        const indices = elegidas.map((c) => c.frame);

        const base = `t${i + 1}`;
        await correr(ctx, [comandoCapturas(h, avs, indices, join(dirCapturas, `${base}-fuente-%02d.png`), tramo)], `capturas de la fuente, tramo ${i + 1}`, join(dirCapturas, `${base}-fuente-01.png`));
        const fuente = nombrarCapturas(dirCapturas, `${base}-fuente`, indices);

        const porVariante = new Map<string, string[]>();
        for (const variante of variantes) {
            const nombre = `${base}-${variante.nombre}`;
            await correr(ctx, [comandoCapturas(h, clips.get(variante.nombre)![i]!.clip, indices, join(dirCapturas, `${nombre}-%02d.png`))], `capturas de ${variante.nombre}, tramo ${i + 1}`, join(dirCapturas, `${nombre}-01.png`));
            porVariante.set(variante.nombre, nombrarCapturas(dirCapturas, nombre, indices));
        }

        elegidas.forEach((captura, k) => {
            capturas.push({
                indice: capturas.length,
                tramo: i + 1,
                frame: captura.frame,
                segundo: Number((tramo.inicio + (captura.frame * 1001) / 24000).toFixed(3)),
                motivo: captura.motivo,
                fuente: `capturas/${basename(fuente[k]!)}`,
                variantes: Object.fromEntries(variantes.map((v) => [v.nombre, `capturas/${basename(porVariante.get(v.nombre)![k]!)}`])),
                ssim: Object.fromEntries(variantes.map((v) => [v.nombre, metricas.get(v.nombre)![i]!.ssimPorFrame[captura.frame] ?? null])),
            });
        });
    }

    const preajuste = buscarPreajuste(config, salida.preajuste)!;
    const resultados: Resultados = {
        version: VERSION_RESULTADOS,
        fecha: new Date().toISOString(),
        episodio: { serie: serieEpisodio.serie, episodio: serieEpisodio.episodio, raw: video, avs },
        salida: { nombre: salida.nombre, etiqueta: preajuste.etiqueta, ancho: preajuste.ancho, alto: preajuste.alto, x264: salida.x264 },
        metodo: {
            referencia: REFERENCIA,
            igualacion: modo,
            descripcion: modo === "crf"
                ? `"${REFERENCIA}" con CRF ${salida.x264.crf}; el resto con el CRF que pesa igual (±2 %) en cada tramo.`
                : `"${REFERENCIA}" con CRF ${salida.x264.crf}; el resto en 2 pasadas al mismo bitrate en cada tramo.`,
        },
        tramos: tramos.map((t, i) => ({ indice: i + 1, inicio: Number(t.inicio.toFixed(3)), duracion: Number(t.duracion.toFixed(3)), motivo: t.motivo, ...(t.valor !== undefined ? { valor: t.valor } : {}) })),
        variantes: variantes.map((variante) => {
            const porTramoVariante: ResultadoTramo[] = tramos.map((_, i) => {
                const c = clips.get(variante.nombre)![i]!;
                const m = metricas.get(variante.nombre)![i]!;
                return {
                    tramo: i + 1,
                    kbps: c.kbps,
                    kbpsCrf: c.kbpsCrf,
                    crf: c.crf,
                    fps: c.fps,
                    ssim: m.ssim,
                    psnr: m.psnr,
                    ssimPorFrame: m.ssimPorFrame,
                    clip: `clips/${basename(c.clip)}`,
                    desdeCache: c.desdeCache,
                };
            });
            const media = (clave: "kbps" | "kbpsCrf" | "fps" | "ssim" | "psnr") => {
                const valor = promedio(porTramoVariante.map((t) => t[clave]));
                return valor === null ? null : Number(valor.toFixed(clave === "ssim" ? 6 : 2));
            };
            return {
                nombre: variante.nombre,
                descripcion: variante.descripcion,
                argumentos: describirArgumentos(variante),
                x264: aplicarVariante(salida.x264, variante),
                adoptar: variante === referencia ? null : `asu config salidas usar-variante ${salida.nombre} ${variante.nombre}`,
                promedio: { kbps: media("kbps"), kbpsCrf: variante === referencia ? null : media("kbpsCrf"), fps: media("fps"), ssim: media("ssim"), psnr: media("psnr") },
                porTramo: porTramoVariante,
            };
        }),
        capturas,
        votos: [],
    };

    writeFileSync(join(carpeta, NOMBRE_RESULTADOS), `${JSON.stringify(resultados, null, 2)}\n`);
    writeFileSync(join(carpeta, "index.html"), generarPagina(resultados));

    p.note(
        resultados.variantes.map((v) => `${v.nombre.padEnd(12)} ${String(Math.round(v.promedio.kbps ?? 0)).padStart(6)} kbps  SSIM ${v.promedio.ssim?.toFixed(5) ?? "—"}  PSNR ${v.promedio.psnr?.toFixed(2) ?? "—"}`).join("\n"),
        "Resultados",
    );
    const desdeCache = resultados.variantes.flatMap((v) => v.porTramo).filter((t) => t.desdeCache).length;
    if (desdeCache > 0) {
        p.log.info(`${desdeCache} clips salieron de la caché (sin recodificar).`);
    }
    p.log.success(`Resultados: ${carpeta}`);

    if (!opciones.noAbrir && esInteractivo()) {
        await (dependencias.servir ?? servirComparacion)(carpeta, { abrirNavegador: true });
    } else {
        p.log.info(`Para verla: asu comparar abrir "${carpeta}"`);
    }
    return 0;
}

/** Comparaciones de la carpeta de salida, de la más reciente a la más antigua. */
export function listarComparaciones(carpetaSalida: string): string[] {
    const comparaciones = join(carpetaSalida, CARPETA_COMPARACIONES);
    if (!existsSync(comparaciones)) {
        return [];
    }
    return readdirSync(comparaciones, { withFileTypes: true })
        .filter((e) => e.isDirectory() && e.name !== CARPETA_CACHE && existsSync(join(comparaciones, e.name, NOMBRE_RESULTADOS)))
        .map((e) => join(comparaciones, e.name))
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
}

/** `asu comparar abrir [carpeta]`: sirve una comparación existente (por defecto, la última). */
export async function abrirComparacion(
    opciones: { carpeta?: string; carpetaSalida?: string; noAbrir?: boolean },
    dependencias: DependenciasComparar = {},
): Promise<number> {
    let carpeta = opciones.carpeta;
    if (carpeta === undefined) {
        const config = cargarConfig();
        const base = opciones.carpetaSalida ?? config.carpetaSalida;
        if (!base) {
            throw new ErrorUsuario('Indica la carpeta de la comparación o configura la carpeta de salida (asu config carpeta-salida "<ruta>").');
        }
        carpeta = listarComparaciones(base)[0];
        if (!carpeta) {
            throw new ErrorUsuario(`No hay comparaciones en ${join(base, CARPETA_COMPARACIONES)}.`);
        }
    }

    if (!existsSync(carpeta)) {
        throw new ErrorUsuario(`No existe la carpeta: ${carpeta}`);
    }
    if (!existsSync(join(carpeta, NOMBRE_RESULTADOS))) {
        throw new ErrorUsuario(`No es una comparación (falta ${NOMBRE_RESULTADOS}): ${carpeta}`);
    }

    // Regenera la página por si se creó con otra versión de asu.
    const resultados = JSON.parse(readFileSync(join(carpeta, NOMBRE_RESULTADOS), "utf8")) as Resultados;
    writeFileSync(join(carpeta, "index.html"), generarPagina(resultados));

    await (dependencias.servir ?? servirComparacion)(carpeta, { abrirNavegador: !opciones.noAbrir });
    return 0;
}
