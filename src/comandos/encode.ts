import * as p from "@clack/prompts";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { ejecutorReal, type Ejecutor } from "../ejecutor.ts";
import { generarAvsCompresion } from "../nucleo/avs.ts";
import { buscarPreajuste, buscarSalida, cargarConfig, guardarConfig, parsearParalelo, type Config, type Salida } from "../nucleo/config.ts";
import { LectorAvance, ejecutarConLimite, framesAproximados, ultimasLineas } from "../nucleo/avance.ts";
import { PanelAvance } from "../panel-avance.ts";
import { Registro, anotarError, ejecutarVigilado, ejecutorConRegistro, rutaRegistroEncode } from "../registro.ts";
import {
    archivoAudio,
    calcularBitrateXvid,
    comandoAviVideo,
    comandoAvimux,
    comandoCopiarAudio,
    comandoDetectarVolumen,
    comandoInfo,
    comandoMp4Mux,
    comandoMp4Video,
    comandoXvid,
    comandosAudio,
    comandosX264,
    elegirPistaAudio,
    esAac,
    estadoNuevo,
    gananciaNormalizacion,
    herramientasDeMegui,
    parsearDuracion,
    parsearPistasAudio,
    parsearVolumenMaximo,
    planificarCadenas,
    scriptAvimux,
    superaTamano,
    type ArchivosSalida,
    type Cadena,
    type Comando,
    type EstadoEncode,
    type Herramientas,
    type Paso,
    type PistaAudio,
} from "../nucleo/encode.ts";
import { nombreAvs, nombreFinal, type SerieEpisodio } from "../nucleo/nombres.ts";
import {
    buscarProyecto,
    guardarEleccionesEncode,
    guardarProyecto,
    leerEleccionesEncode,
    type EleccionesEncode,
} from "../nucleo/proyecto.ts";
import { EXTENSIONES_ASS, listarArchivos } from "../nucleo/archivos.ts";
import { ErrorUsuario, confirmar, elegir, elegirVarios, esInteractivo, preguntarTexto } from "../ui.ts";
import {
    codificarAvs,
    elegirVideo,
    ordenarArchivos,
    resolverArchivosAss,
    resolverDestino,
    resolverDirectorio,
    resolverSerieEpisodio,
    type OpcionesSerieEpisodio,
} from "./comun.ts";
import { revisarFuentes } from "./verificar-fuentes.ts";

export type OpcionesEncode = OpcionesSerieEpisodio & {
    dir?: string;
    /** Nombres de las salidas a generar. Sin indicar: se eligen en el menú o se usan las activas. */
    solo?: string[];
    video?: string;
    subs?: string[];
    fuente?: string;
    /** Número de pista de audio, desde 1. */
    pistaAudio?: string;
    /** Versiones a la vez (reemplaza `paralelo` de la config). */
    paralelo?: string;
    carpetaSalida?: string;
    regenerarAvs?: boolean;
    ignorarFuentes?: boolean;
    reanudar?: boolean;
    reiniciar?: boolean;
    conservar?: boolean;
    forzar?: boolean;
};

const CARPETA_TEMPORALES = ".asu-encode";

/** Límite de versiones a la vez: `--paralelo` o el de la config. */
export function paralelo(config: Config, indicado: string | undefined): number {
    if (indicado === undefined) {
        return config.paralelo;
    }

    const valor = parsearParalelo(indicado);
    if (valor === null) {
        throw new ErrorUsuario(`--paralelo debe ser un entero mayor o igual a 1 (recibido "${indicado}").`);
    }
    return valor;
}

function extension(salida: Salida): string {
    return salida.tipo === "mp4-x264" ? ".mp4" : ".avi";
}

// ---- Versiones a generar ----

/** "MP4 1080 (1920x1080)" */
export function etiquetaSalida(config: Config, salida: Salida): string {
    const preajuste = buscarPreajuste(config, salida.preajuste)!;
    return `${preajuste.etiqueta} (${preajuste.ancho}x${preajuste.alto})`;
}

/**
 * Salidas de este encode, en el orden de la config: las indicadas con --solo (aunque estén
 * desactivadas); si no, las recordadas o se eligen en el menú; sin terminal, las activas.
 */
async function elegirSalidas(config: Config, solo: string[] | undefined, recuerdo: Recuerdo): Promise<Salida[]> {
    if (solo !== undefined) {
        const pedidas = solo.map((nombre) => {
            const salida = buscarSalida(config, nombre);
            if (!salida) {
                throw new ErrorUsuario(`No existe la salida "${nombre}". Disponibles: ${config.salidas.map((x) => x.nombre).join(", ")}`);
            }
            return salida;
        });
        return config.salidas.filter((salida) => pedidas.includes(salida));
    }

    const recordadas = recuerdo.previo.versiones?.map((nombre) => buscarSalida(config, nombre)!);
    if (recordadas && recuerdo.aplicar) {
        return config.salidas.filter((salida) => recordadas.includes(salida));
    }

    const activas = config.salidas.filter((salida) => salida.activa);
    if (!esInteractivo()) {
        if (activas.length === 0) {
            throw new ErrorUsuario('No hay salidas activas. Indica cuáles con --solo o actívalas con "asu config salidas activar <nombre>".');
        }
        return activas;
    }

    let elegidas: Salida[] = [];
    while (elegidas.length === 0) {
        elegidas = await elegirVarios(
            "Versiones a generar (espacio para marcar)",
            config.salidas.map((salida) => ({ value: salida, label: etiquetaSalida(config, salida) })),
            recordadas ?? activas,
        );
        if (elegidas.length === 0) {
            p.log.warn("Elige al menos una versión.");
        }
    }

    const ordenadas = config.salidas.filter((salida) => elegidas.includes(salida));
    recuerdo.guardar({ versiones: ordenadas.map((salida) => salida.nombre) });
    return ordenadas;
}

// ---- Elecciones recordadas (.asu\asu.json del episodio) ----

export type Recuerdo = {
    /** Lo recordado y todavía válido. */
    previo: EleccionesEncode;
    /** Usar lo recordado sin preguntar: el usuario lo aceptó en el resumen, o no hay terminal. */
    aplicar: boolean;
    guardar: (cambios: EleccionesEncode) => void;
};

/** Descarta (con aviso) lo recordado que ya no sirve: versiones inexistentes o .ass que ya no están. */
function validarRecordado(dir: string, config: Config, previo: EleccionesEncode): EleccionesEncode {
    const valido: EleccionesEncode = {};

    if (Array.isArray(previo.versiones) && previo.versiones.length > 0) {
        if (previo.versiones.every((nombre) => buscarSalida(config, String(nombre)))) {
            valido.versiones = previo.versiones;
        } else {
            p.log.warn(`Versiones recordadas desconocidas (${previo.versiones.join(", ")}): se vuelven a elegir.`);
        }
    }

    if (Array.isArray(previo.subtitulos)) {
        const faltantes = previo.subtitulos.filter((nombre) => !existsSync(join(dir, String(nombre))));
        if (faltantes.length === 0) {
            valido.subtitulos = previo.subtitulos;
        } else {
            p.log.warn(`Subtítulos recordados que ya no existen (${faltantes.join(", ")}): se vuelven a elegir.`);
        }
    }

    if (typeof previo.serie === "string" && previo.serie.trim()) {
        valido.serie = previo.serie;
    }
    if (typeof previo.episodio === "string" && previo.episodio.trim()) {
        valido.episodio = previo.episodio;
    }
    if (Number.isInteger(previo.pistaAudio) && previo.pistaAudio! > 0) {
        valido.pistaAudio = previo.pistaAudio;
    }

    return valido;
}

function resumenRecordado(config: Config, previo: EleccionesEncode): string {
    const lineas: string[] = [];
    if (previo.versiones) {
        lineas.push(`Versiones:  ${previo.versiones.map((nombre) => etiquetaSalida(config, buscarSalida(config, nombre)!)).join(", ")}`);
    }
    if (previo.serie) {
        lineas.push(`Serie:      ${previo.serie}`);
    }
    if (previo.episodio) {
        lineas.push(`Episodio:   ${previo.episodio}`);
    }
    if (previo.pistaAudio) {
        lineas.push(`Pista:      ${previo.pistaAudio}`);
    }
    if (previo.subtitulos) {
        lineas.push(previo.subtitulos.length === 0
            ? "Subtítulos: (ninguno)"
            : `Subtítulos:\n${previo.subtitulos.map((nombre, i) => `  ${i + 1}. ${nombre}`).join("\n")}`);
    }
    return lineas.join("\n");
}

/**
 * Carga lo recordado en `<dir>/.asu/asu.json`. En el menú, si hay algo, muestra un resumen y pregunta si
 * usarlo tal cual; si no, se pregunta todo con lo recordado como valor inicial. Sin terminal se aplica.
 * Cada respuesta del menú se guarda al confirmarla.
 */
export async function cargarRecuerdo(dir: string, config: Config, opciones: { sinVersiones?: boolean } = {}): Promise<Recuerdo> {
    const previo = validarRecordado(dir, config, leerEleccionesEncode(dir));
    // `asu comparar` elige su propia versión: no muestra ni usa las del último encode.
    if (opciones.sinVersiones) {
        delete previo.versiones;
    }
    const guardar = (cambios: EleccionesEncode) => guardarEleccionesEncode(dir, cambios);

    if (Object.keys(previo).length === 0) {
        return { previo, aplicar: false, guardar };
    }

    if (!esInteractivo()) {
        return { previo, aplicar: true, guardar };
    }

    p.note(resumenRecordado(config, previo), "Opciones del último encode en esta carpeta");
    const aplicar = await confirmar("¿Usar las mismas? (lo que falte se pregunta)");
    return { previo, aplicar, guardar };
}

// ---- Configuración necesaria ----

export async function asegurarRutaMegui(config: Config): Promise<string> {
    if (config.rutaMegui) {
        return config.rutaMegui;
    }

    if (!esInteractivo()) {
        throw new ErrorUsuario('Falta la carpeta de MeGUI. Configúrala con: asu config megui "<ruta>"');
    }

    const ruta = await preguntarTexto("Carpeta de instalación de MeGUI", {
        validar: (valor) => (existsSync(join(valor.trim(), "tools")) ? undefined : "No se encontró la carpeta tools dentro."),
    });
    config.rutaMegui = resolve(ruta.trim());
    guardarConfig(config);
    return config.rutaMegui;
}

export async function asegurarCarpetaSalida(config: Config, indicada: string | undefined): Promise<string> {
    if (indicada !== undefined) {
        return resolve(indicada);
    }

    if (config.carpetaSalida) {
        return config.carpetaSalida;
    }

    if (!esInteractivo()) {
        throw new ErrorUsuario('Falta la carpeta de salida. Configúrala con: asu config carpeta-salida "<ruta>" o usa --carpeta-salida.');
    }

    const ruta = await preguntarTexto("Carpeta donde dejar los archivos finales", {
        validar: (valor) => (valor.trim().length > 0 ? undefined : "Indica una carpeta."),
    });
    config.carpetaSalida = resolve(ruta.trim());
    guardarConfig(config);
    return config.carpetaSalida;
}

export function verificarHerramientas(h: Herramientas, salidas: readonly Salida[]): void {
    const necesarias: (keyof Herramientas)[] = ["ffmpeg"];
    if (salidas.some((s) => s.tipo === "mp4-x264")) {
        necesarias.push("x264", "neroAac", "mp4box");
    }
    if (salidas.some((s) => s.tipo === "avi-xvid")) {
        necesarias.push("xvid", "lame", "avimux");
    }

    const faltantes = necesarias.map((clave) => h[clave]).filter((ruta) => !existsSync(ruta));
    if (faltantes.length > 0) {
        throw new ErrorUsuario(`Faltan herramientas de MeGUI:\n${faltantes.map((r) => `  ${r}`).join("\n")}`);
    }
}

async function resolverFuente(dir: string, indicada: string | undefined): Promise<string> {
    if (indicada !== undefined) {
        return indicada.trim();
    }

    const proyecto = buscarProyecto(dir);
    if (proyecto?.datos.fuente) {
        return proyecto.datos.fuente;
    }

    if (!esInteractivo()) {
        throw new ErrorUsuario('No se sabe la fuente (HDTV, BD...). Indícala con --fuente o en .asu\\asu.json de la carpeta de la serie: { "fuente": "HDTV" }');
    }

    const elegida = await elegir("Fuente del proyecto (se guarda para los próximos episodios)", [
        { value: "HDTV", label: "HDTV" },
        { value: "BD", label: "BD" },
        { value: "otra", label: "Otra..." },
    ]);
    const fuente = elegida === "otra"
        ? (await preguntarTexto("Fuente", { validar: (v) => (v.trim() ? undefined : "No puede estar vacía.") })).trim()
        : elegida;

    const ruta = guardarProyecto(dirname(dir), { fuente });
    p.log.info(`Fuente guardada en ${ruta}`);
    return fuente;
}

// ---- AVS ----

/** `textsub("...")` de un .avs existente. */
export function subtitulosDeAvs(texto: string): string[] {
    return [...texto.matchAll(/textsub\("([^"]+)"\)/gi)].map((coincidencia) => coincidencia[1]!);
}

/**
 * Subtítulos para los .avs: los de -s; los recordados (si se aplican); o elegidos en el menú
 * (marcados los recordados, en su orden). Sin terminal ni recuerdo, todos en orden alfabético.
 */
async function elegirSubtitulosEncode(dir: string, subs: string[] | undefined, recuerdo: Recuerdo): Promise<string[]> {
    if (subs !== undefined) {
        return resolverArchivosAss(dir, subs);
    }

    const recordados = recuerdo.previo.subtitulos?.map((nombre) => join(dir, nombre));
    if (recordados && recuerdo.aplicar) {
        return recordados;
    }

    const disponibles = listarArchivos(dir, EXTENSIONES_ASS);
    if (disponibles.length === 0 || !esInteractivo()) {
        return disponibles;
    }

    const elegidos = await elegirVarios(
        "Subtítulos a incluir",
        disponibles.map((ruta) => ({ value: ruta, label: basename(ruta) })),
        recordados ?? disponibles,
    );

    // Orden inicial: el recordado y, después, los nuevos en orden de la lista.
    const previos = (recordados ?? []).filter((ruta) => elegidos.includes(ruta));
    const propuesto = [...previos, ...disponibles.filter((ruta) => elegidos.includes(ruta) && !previos.includes(ruta))];
    recuerdo.guardar({ subtitulos: propuesto.map((ruta) => basename(ruta)) });

    const orden = await ordenarArchivos(propuesto, "Orden de los textsub");
    recuerdo.guardar({ subtitulos: orden.map((ruta) => basename(ruta)) });
    return orden;
}

/** Genera o reutiliza los .avs de cada salida. Devuelve la ruta por salida y los .ass que usan. */
export async function prepararAvs(
    dir: string,
    video: string,
    serieEpisodio: SerieEpisodio,
    salidas: readonly Salida[],
    config: Config,
    opciones: OpcionesEncode,
    recuerdo: Recuerdo,
): Promise<{ avs: Map<Salida, string>; subtitulos: string[] }> {
    const avs = new Map<Salida, string>();
    for (const salida of salidas) {
        const preajuste = buscarPreajuste(config, salida.preajuste)!;
        avs.set(salida, join(dir, nombreAvs(serieEpisodio, preajuste.etiqueta)));
    }

    const existentes = [...avs.values()].filter((ruta) => existsSync(ruta));
    let regenerar = opciones.regenerarAvs ?? false;
    if (!regenerar && existentes.length > 0 && esInteractivo()) {
        regenerar = await elegir(`Ya existen ${existentes.length} de ${avs.size} .avs`, [
            { value: false, label: "Usar los existentes", hint: "se generan solo los que faltan" },
            { value: true, label: "Regenerar todos" },
        ]);
    }

    const aGenerar = [...avs.entries()].filter(([, ruta]) => regenerar || !existsSync(ruta));
    const subtitulos = new Set<string>();

    for (const [, ruta] of avs) {
        if (!aGenerar.some(([, r]) => r === ruta)) {
            p.log.info(`Usando ${basename(ruta)}`);
            for (const sub of subtitulosDeAvs(readFileSync(ruta, "latin1"))) {
                subtitulos.add(sub);
            }
        }
    }

    if (aGenerar.length > 0) {
        const elegidos = await elegirSubtitulosEncode(dir, opciones.subs, recuerdo);
        if (elegidos.length === 0) {
            p.log.warn("Sin subtítulos: los .avs no tendrán textsub.");
        }

        for (const [salida, ruta] of aGenerar) {
            const preajuste = buscarPreajuste(config, salida.preajuste)!;
            writeFileSync(ruta, codificarAvs(generarAvsCompresion(video, preajuste.ancho, preajuste.alto, elegidos)));
            p.log.success(`Creado ${basename(ruta)}`);
        }
        for (const sub of elegidos) {
            subtitulos.add(sub);
        }
    }

    return { avs, subtitulos: [...subtitulos] };
}

async function comprobarFuentes(subtitulos: readonly string[], ignorar: boolean): Promise<void> {
    const existentes = subtitulos.filter((ruta) => existsSync(ruta));
    if (existentes.length === 0) {
        return;
    }

    p.log.step("Verificando fuentes...");
    const { faltantes, errores } = revisarFuentes(existentes);
    const problemas = [
        ...[...faltantes].map(([ruta, fuentes]) => `${basename(ruta)}: faltan ${fuentes.join(", ")}`),
        ...errores.map((ruta) => `${basename(ruta)}: no se pudo leer`),
    ];
    if (problemas.length === 0) {
        p.log.success("Fuentes completas.");
        return;
    }

    p.log.warn(problemas.join("\n"));
    if (ignorar) {
        return;
    }

    if (!esInteractivo()) {
        throw new ErrorUsuario("Faltan fuentes: el encode quedaría con fuentes reemplazadas. Instálalas o usa --ignorar-fuentes.");
    }

    if (!(await confirmar("Faltan fuentes. ¿Continuar igual?", false))) {
        throw new ErrorUsuario("Encode cancelado por fuentes faltantes.");
    }
}

// ---- Audio ----

async function elegirPista(
    ejecutor: Ejecutor,
    h: Herramientas,
    video: string,
    indicada: string | undefined,
    recuerdo: Recuerdo,
): Promise<PistaAudio> {
    const { stderr } = await ejecutor.ejecutar([comandoInfo(h, video)], { capturar: true });
    const pistas = parsearPistasAudio(stderr);
    if (pistas.length === 0) {
        throw new ErrorUsuario(`"${basename(video)}" no tiene pistas de audio.`);
    }

    const describir = (pista: PistaAudio) => `${pista.indice + 1}. ${pista.idioma ?? "sin idioma"} — ${pista.descripcion}`;

    if (indicada !== undefined) {
        const numero = Number(indicada);
        const pista = Number.isInteger(numero) ? pistas[numero - 1] : undefined;
        if (!pista) {
            throw new ErrorUsuario(`--pista-audio debe ser un número entre 1 y ${pistas.length}:\n${pistas.map(describir).join("\n")}`);
        }
        return pista;
    }

    const recordada = recuerdo.previo.pistaAudio !== undefined ? pistas[recuerdo.previo.pistaAudio - 1] : undefined;
    if (recuerdo.previo.pistaAudio !== undefined && !recordada) {
        p.log.warn(`La pista de audio recordada (${recuerdo.previo.pistaAudio}) no existe en este raw.`);
    }
    if (recordada && recuerdo.aplicar) {
        return recordada;
    }

    const automatica = elegirPistaAudio(pistas);
    if (automatica) {
        return automatica;
    }

    if (!esInteractivo()) {
        throw new ErrorUsuario(`Hay ${pistas.length} pistas de audio y ninguna japonesa única. Indica cuál con --pista-audio:\n${pistas.map(describir).join("\n")}`);
    }

    const elegida = await elegir("Pista de audio", pistas.map((pista) => ({ value: pista, label: describir(pista) })), recordada);
    recuerdo.guardar({ pistaAudio: elegida.indice + 1 });
    return elegida;
}

// ---- Estado ----

function firmaTrabajo(video: string, pista: number, archivos: readonly ArchivosSalida[]): string {
    const datos = {
        video,
        pista,
        salidas: archivos.map(({ salida, avs }) => {
            const { size, mtimeMs } = statSync(avs);
            return { salida, avs, size, mtimeMs };
        }),
    };
    return createHash("sha1").update(JSON.stringify(datos)).digest("hex");
}

function leerEstado(ruta: string): EstadoEncode | null {
    try {
        return JSON.parse(readFileSync(ruta, "utf8")) as EstadoEncode;
    } catch {
        return null;
    }
}

async function prepararEstado(dirTemporal: string, firma: string, opciones: OpcionesEncode): Promise<EstadoEncode> {
    const ruta = join(dirTemporal, "estado.json");
    const previo = existsSync(ruta) ? leerEstado(ruta) : null;

    if (previo === null) {
        if (opciones.reanudar) {
            p.log.warn("No hay un encode incompleto para reanudar: se empieza de cero.");
        }
        rmSync(dirTemporal, { recursive: true, force: true });
        return estadoNuevo(firma);
    }

    let reanudar = opciones.reanudar ?? false;
    if (!reanudar && !opciones.reiniciar) {
        if (!esInteractivo()) {
            throw new ErrorUsuario(`Hay un encode incompleto de este episodio (${dirTemporal}). Usa --reanudar o --reiniciar.`);
        }

        const accion = await elegir("Hay un encode incompleto de este episodio", [
            { value: "reanudar", label: "Reanudar", hint: `${previo.completados.length} pasos ya hechos` },
            { value: "reiniciar", label: "Empezar de cero" },
            { value: "cancelar", label: "Cancelar" },
        ]);
        if (accion === "cancelar") {
            throw new ErrorUsuario("Encode cancelado.");
        }
        reanudar = accion === "reanudar";
    }

    if (!reanudar) {
        rmSync(dirTemporal, { recursive: true, force: true });
        return estadoNuevo(firma);
    }

    if (previo.firma !== firma) {
        throw new ErrorUsuario(
            "No se puede reanudar: cambiaron el video, la pista de audio, los .avs o las versiones elegidas desde el encode anterior. Usa --reiniciar.",
        );
    }

    p.log.info(`Reanudando: ${previo.completados.length} pasos ya hechos.`);
    return previo;
}

function guardarEstado(dirTemporal: string, estado: EstadoEncode): void {
    writeFileSync(join(dirTemporal, "estado.json"), `${JSON.stringify(estado, null, 2)}\n`);
}

// ---- Ejecución de pasos ----

/** Archivo que deja cada paso (si falta al reanudar, el paso se repite). */
function producto(paso: Paso): string {
    switch (paso.tipo) {
        case "audio":
            return paso.salida;
        case "x264":
            return paso.video264;
        case "xvid":
            return paso.pasada === 1 ? paso.stats : paso.m4v;
        case "mux-mp4":
        case "mux-avi":
            return paso.archivos.temporal;
    }
}

/**
 * Ejecuta una tubería leyendo su salida (avance en `alFrames`). Si falla, el error incluye las
 * últimas líneas de la herramienta, que no se mostraron mientras corría. Con `vigilar` (las
 * codificaciones), un cuelgue se reintenta una vez.
 */
async function correr(
    ctx: Contexto,
    comandos: Comando[],
    descripcion: string,
    esperado: string,
    { alFrames, vigilar = false }: { alFrames?: (frames: number) => void; vigilar?: boolean } = {},
): Promise<void> {
    const lector = new LectorAvance();
    const opciones = {
        alSalida: (texto: string) => {
            lector.leer(texto);
            if (lector.frames !== null) {
                alFrames?.(lector.frames);
            }
        },
    };
    const { codigo, stderr } = vigilar
        ? await ejecutarVigilado(ctx.ejecutor, comandos, opciones, descripcion, ({ vivos }) =>
            ctx.registro?.escribir(`"${descripcion}" se colgó (vivos: ${vivos.join(", ") || "ninguno"}); se reintenta una vez.`))
        : await ctx.ejecutor.ejecutar(comandos, opciones);

    if (codigo !== 0 || !existsSync(esperado)) {
        const detalle = ultimasLineas(stderr);
        throw new ErrorUsuario(`Falló "${descripcion}" (código ${codigo}).${detalle ? `\n${detalle}` : ""}`);
    }
}

type Contexto = {
    ejecutor: Ejecutor;
    h: Herramientas;
    video: string;
    pista: number;
    dirTemporal: string;
    estado: EstadoEncode;
    registro?: Registro;
};

async function ejecutarPaso(paso: Paso, ctx: Contexto, alFrames?: (frames: number) => void): Promise<void> {
    const { h, dirTemporal, estado } = ctx;

    switch (paso.tipo) {
        case "audio":
            if (paso.copiar) {
                return correr(ctx, [comandoCopiarAudio(h, ctx.video, ctx.pista, paso.salida)], paso.descripcion, paso.salida);
            }
            return correr(ctx, comandosAudio(h, ctx.video, ctx.pista, estado.ganancia ?? 0, paso.audio, paso.salida), paso.descripcion, paso.salida);

        case "x264":
            if (paso.archivos.salida.tipo !== "mp4-x264") {
                return;
            }
            return correr(ctx, comandosX264(h, paso.archivos.avs, paso.archivos.salida.x264, paso.video264), paso.descripcion, paso.video264, { alFrames, vigilar: true });

        case "xvid": {
            const salida = paso.archivos.salida;
            const bitrate = estado.bitrates[salida.nombre];
            if (salida.tipo !== "avi-xvid" || bitrate === undefined) {
                throw new Error(`Falta el bitrate de ${salida.nombre}.`);
            }

            return correr(
                ctx,
                [comandoXvid(h, paso.archivos.avs, paso.pasada, paso.stats, bitrate, salida.xvid, paso.m4v)],
                paso.descripcion,
                producto(paso),
                { alFrames, vigilar: true },
            );
        }

        case "mux-mp4":
            await correr(ctx, [comandoMp4Video(h, paso.video264, dirTemporal, paso.videoMp4)], paso.descripcion, paso.videoMp4);
            return correr(ctx, [comandoMp4Mux(h, paso.videoMp4, paso.audio, dirTemporal, paso.archivos.temporal)], paso.descripcion, paso.archivos.temporal);

        case "mux-avi":
            await correr(ctx, [comandoAviVideo(h, paso.m4v, paso.aviVideo)], paso.descripcion, paso.aviVideo);
            // MeGUI escribe el script en UTF-8 con BOM.
            writeFileSync(paso.script, `﻿${scriptAvimux(paso.audio, paso.aviVideo, paso.archivos.temporal)}`, "utf8");
            return correr(ctx, [comandoAvimux(h, paso.script)], paso.descripcion, paso.archivos.temporal);
    }
}

function marcarHecho(ctx: Contexto, paso: Paso): void {
    ctx.estado.completados = [...ctx.estado.completados.filter((id) => id !== paso.id), paso.id];
    guardarEstado(ctx.dirTemporal, ctx.estado);
}

function yaHecho(ctx: Contexto, paso: Paso): boolean {
    return ctx.estado.completados.includes(paso.id) && existsSync(producto(paso));
}

/** Duración del .avs en segundos (para el % y el bitrate del AVI). */
async function duracionAvs(ctx: Contexto, avs: string): Promise<number | null> {
    const { stderr } = await ctx.ejecutor.ejecutar([comandoInfo(ctx.h, avs)], { capturar: true });
    const duracion = parsearDuracion(stderr);
    return duracion !== null && duracion > 0 ? duracion : null;
}

/** Bitrate de cada AVI (necesita el MP3 ya codificado). Se fija en el estado para que las 2 pasadas y un reanudar usen el mismo. */
function fijarBitrates(ctx: Contexto, archivos: readonly ArchivosSalida[], duraciones: ReadonlyMap<Salida, number | null>): void {
    for (const { salida, avs } of archivos) {
        if (salida.tipo !== "avi-xvid" || ctx.estado.bitrates[salida.nombre] !== undefined) {
            continue;
        }

        const duracion = duraciones.get(salida);
        if (!duracion) {
            throw new ErrorUsuario(`No se pudo leer la duración de ${basename(avs)}.`);
        }

        const audio = archivoAudio(ctx.dirTemporal, salida.audio);
        ctx.estado.bitrates[salida.nombre] = calcularBitrateXvid({ tamanoMB: salida.tamanoMB, bytesAudio: statSync(audio).size, duracion });
        guardarEstado(ctx.dirTemporal, ctx.estado);
        p.log.info(`Bitrate de video del AVI "${salida.nombre}" para ${salida.tamanoMB} MB: ${ctx.estado.bitrates[salida.nombre]} kbps`);
    }
}

/** Ejecuta los pasos de una versión en orden, informando el avance en el panel. */
async function ejecutarCadena(cadena: Cadena, ctx: Contexto, panel: PanelAvance, nombre: string, total: number | null): Promise<void> {
    try {
        for (const paso of cadena.pasos) {
            if (yaHecho(ctx, paso)) {
                continue;
            }

            const etapa = paso.tipo === "xvid" ? `XviD pasada ${paso.pasada}/2` : paso.tipo === "x264" ? "x264" : "mux";
            panel.paso(nombre, etapa, paso.tipo === "x264" || paso.tipo === "xvid" ? total : null);
            await ejecutarPaso(paso, ctx, (frames) => panel.frames(nombre, frames));
            marcarHecho(ctx, paso);
        }
        panel.terminar(nombre, "listo");
    } catch (error) {
        panel.terminar(nombre, "error", error instanceof Error ? error.message.split("\n")[0] : "falló");
        throw error;
    }
}

// ---- Comando ----

/**
 * Encode completo de un episodio: genera o reutiliza los .avs, codifica cada salida activa con las
 * herramientas de MeGUI, la deja con su nombre final en la carpeta de salida y limpia los temporales.
 */
export async function encode(opciones: OpcionesEncode, ejecutor: Ejecutor = ejecutorReal): Promise<number> {
    let registro: Registro | undefined;
    try {
        const codigo = await encodeConRegistro(opciones, ejecutor, (r) => (registro = r));
        registro?.escribir(`Terminado (código ${codigo}).`);
        return codigo;
    } catch (error) {
        throw anotarError(registro, error);
    }
}

/** El registro se crea al empezar a codificar (`alRegistro`); lo anterior son preguntas y lecturas rápidas. */
async function encodeConRegistro(opciones: OpcionesEncode, ejecutorBase: Ejecutor, alRegistro: (registro: Registro) => void): Promise<number> {
    let ejecutor = ejecutorBase;
    const dir = resolverDirectorio(opciones.dir);
    p.log.info(`Directorio: ${dir}`);

    const config = cargarConfig();
    const recuerdo = await cargarRecuerdo(dir, config);
    const salidas = await elegirSalidas(config, opciones.solo, recuerdo);
    p.log.info(`Versiones: ${salidas.map((salida) => etiquetaSalida(config, salida)).join(", ")}`);

    const h = herramientasDeMegui(await asegurarRutaMegui(config));
    verificarHerramientas(h, salidas);
    const carpetaSalida = await asegurarCarpetaSalida(config, opciones.carpetaSalida);

    const video = await elegirVideo(dir, opciones.video);
    p.log.info(`Raw: ${basename(video)}`);

    const { serie, episodio } = recuerdo.aplicar ? recuerdo.previo : {};
    const serieEpisodio = await resolverSerieEpisodio(
        dir,
        video,
        { serie: opciones.serie ?? serie, episodio: opciones.episodio ?? episodio },
        { sugerido: recuerdo.previo, alConfirmar: recuerdo.guardar },
    );
    const fuente = await resolverFuente(dir, opciones.fuente);

    const { avs, subtitulos } = await prepararAvs(dir, video, serieEpisodio, salidas, config, opciones, recuerdo);
    await comprobarFuentes(subtitulos, opciones.ignorarFuentes ?? false);

    const pista = await elegirPista(ejecutor, h, video, opciones.pistaAudio, recuerdo);
    p.log.info(`Audio: pista ${pista.indice + 1} (${pista.idioma ?? "sin idioma"})`);

    // Destinos finales: se resuelven antes de codificar para no preguntar después de horas.
    mkdirSync(carpetaSalida, { recursive: true });
    const dirTemporal = join(carpetaSalida, CARPETA_TEMPORALES, `${serieEpisodio.serie} - ${serieEpisodio.episodio}`);
    const archivos: ArchivosSalida[] = [];
    for (const salida of salidas) {
        const preajuste = buscarPreajuste(config, salida.preajuste)!;
        const nombre = nombreFinal({ ...serieEpisodio, grupo: config.grupo, fuente, ancho: preajuste.ancho, alto: preajuste.alto });
        const final = await resolverDestino(carpetaSalida, nombre, { forzar: opciones.forzar }, extension(salida));
        if (final === null) {
            p.log.warn("Encode cancelado.");
            return 1;
        }

        archivos.push({ salida, avs: avs.get(salida)!, final, temporal: join(dirTemporal, `${salida.nombre}${extension(salida)}`) });
    }

    const estado = await prepararEstado(dirTemporal, firmaTrabajo(video, pista.indice, archivos), opciones);
    mkdirSync(dirTemporal, { recursive: true });
    guardarEstado(dirTemporal, estado);

    const registro = new Registro(rutaRegistroEncode(dir), "asu encode");
    alRegistro(registro);
    registro.escribir(
        [
            `Episodio: ${dir}`,
            `Raw: ${video} (pista ${pista.indice + 1})`,
            `Temporales: ${dirTemporal}${estado.completados.length > 0 ? ` (reanudando: ${estado.completados.length} pasos hechos)` : ""}`,
            `Opciones: ${JSON.stringify(opciones)}`,
            ...archivos.map((a) => `Salida ${a.salida.nombre}: ${a.avs} -> ${a.final}\n  ${JSON.stringify(a.salida)}`),
        ].join("\n"),
    );
    p.log.info(`Registro: ${registro.ruta}`);
    ejecutor = ejecutorConRegistro(ejecutorBase, registro);

    const ctx: Contexto = { ejecutor, h, video, pista: pista.indice, dirTemporal, estado, registro };
    try {
        const plan = planificarCadenas(archivos, dirTemporal, { copiarAac: esAac(pista) });

        // La normalización solo hace falta si algún audio se recodifica (el AAC copiado queda tal cual).
        const recodifica = plan.audios.some((paso) => paso.tipo === "audio" && !paso.copiar && !yaHecho(ctx, paso));
        if (recodifica && estado.ganancia === null) {
            p.log.step("Midiendo volumen del audio...");
            const { stderr } = await ejecutor.ejecutar([comandoDetectarVolumen(h, video, pista.indice)], { capturar: true });
            const maximo = parsearVolumenMaximo(stderr);
            if (maximo === null) {
                throw new ErrorUsuario("No se pudo medir el volumen del audio.");
            }
            estado.ganancia = gananciaNormalizacion(maximo);
            guardarEstado(dirTemporal, estado);
        }

        for (const paso of plan.audios) {
            if (yaHecho(ctx, paso)) {
                p.log.info(`${paso.descripcion}: ya hecho.`);
                continue;
            }
            p.log.step(paso.descripcion);
            await ejecutarPaso(paso, ctx);
            marcarHecho(ctx, paso);
        }

        const duraciones = new Map<Salida, number | null>();
        for (const a of archivos) {
            duraciones.set(a.salida, await duracionAvs(ctx, a.avs));
        }
        fijarBitrates(ctx, archivos, duraciones);

        const nombres = new Map(archivos.map((a) => [a.salida, etiquetaSalida(config, a.salida)]));
        const limite = paralelo(config, opciones.paralelo);
        p.log.step(`Codificando ${archivos.length} ${archivos.length === 1 ? "versión" : "versiones"} (hasta ${limite} a la vez)`);

        const panel = new PanelAvance([...nombres.values()]);
        panel.iniciar();
        const errores = await ejecutarConLimite(
            plan.cadenas.map((cadena) => () => {
                const duracion = duraciones.get(cadena.salida);
                return ejecutarCadena(cadena, ctx, panel, nombres.get(cadena.salida)!, duracion ? framesAproximados(duracion) : null);
            }),
            limite,
        );
        panel.detener();

        if (errores.length > 0) {
            const usuario = errores.filter((error): error is ErrorUsuario => error instanceof ErrorUsuario);
            if (usuario.length !== errores.length) {
                throw errores.find((error) => !(error instanceof ErrorUsuario));
            }
            throw new ErrorUsuario(usuario.map((error) => error.message).join("\n\n"));
        }
    } catch (error) {
        if (error instanceof ErrorUsuario) {
            throw new ErrorUsuario(`${error.message}\nLos temporales quedan en ${dirTemporal}. Para retomar: asu encode --reanudar`);
        }
        throw error;
    }

    let excedidos = 0;
    for (const a of archivos) {
        rmSync(a.final, { force: true });
        renameSync(a.temporal, a.final);
        const { size } = statSync(a.final);
        if (a.salida.tipo === "avi-xvid" && superaTamano(size, a.salida.tamanoMB)) {
            p.log.error(`${basename(a.final)} pesa ${(size / 1024 / 1024).toFixed(1)} MB: supera el límite de ${a.salida.tamanoMB} MB.`);
            excedidos++;
        } else {
            p.log.success(`${basename(a.final)} (${(size / 1024 / 1024).toFixed(1)} MB)`);
        }
    }

    if (excedidos > 0) {
        p.log.warn(`Los temporales quedan en ${dirTemporal}.`);
        return 1;
    }

    if (opciones.conservar) {
        p.log.info(`Temporales conservados en ${dirTemporal}.`);
    } else {
        rmSync(dirTemporal, { recursive: true, force: true });
        const base = join(carpetaSalida, CARPETA_TEMPORALES);
        if (existsSync(base) && readdirSync(base).length === 0) {
            rmSync(base, { recursive: true, force: true });
        }
    }

    p.log.success(`Encode terminado en ${carpetaSalida}`);
    return 0;
}
