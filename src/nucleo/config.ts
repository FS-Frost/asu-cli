import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { validarNombreArchivo } from "./archivos.ts";

export type Preajuste = {
    nombre: string;
    ancho: number;
    alto: number;
    /** Parte final del nombre del .avs: "<serie> <ep> <etiqueta>.avs". */
    etiqueta: string;
};

export type AudioSalida = {
    codec: "aac" | "mp3";
    kbps: number;
};

export const PRESETS_X264: readonly string[] = [
    "ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow", "slower", "veryslow", "placebo",
];

export type AjustesX264 = {
    preset: string;
    crf: number;
    tune: string;
    keyint: number;
    level: string;
    vbvBufsize: number;
    vbvMaxrate: number;
    /** Argumentos adicionales de x264, al final de la línea de comandos (ej. ["--deblock", "-1:-1"]). */
    extra?: string[];
};

/** Ajustes x264 que una variante cambia sobre los de la salida comparada. `tune: ""` = sin --tune. */
export type Variante = {
    nombre: string;
    descripcion: string;
    x264: Partial<AjustesX264>;
};

export function variantesDeFabrica(): Variante[] {
    return [
        { nombre: "actual", descripcion: "Los ajustes de la salida, sin cambios", x264: {} },
        {
            nombre: "anime",
            descripcion: "Sin tune; líneas nítidas, más protección de degradados y oscuros",
            x264: {
                tune: "",
                extra: [
                    "--deblock", "-1:-1", "--psy-rd", "0.7:0", "--aq-mode", "3", "--aq-strength", "0.8",
                    "--bframes", "8", "--merange", "24", "--no-fast-pskip",
                ],
            },
        },
        {
            nombre: "intermedia",
            descripcion: "tune animation, con deblock -1:-1 y aq-mode 3",
            x264: { tune: "animation", extra: ["--deblock", "-1:-1", "--aq-mode", "3"] },
        },
    ];
}

/** Ajustes de la salida con los de la variante encima (`extra` de la variante reemplaza al de la salida). */
export function aplicarVariante(base: AjustesX264, variante: Variante): AjustesX264 {
    return { ...base, ...variante.x264 };
}

export function buscarVariante(config: Pick<Config, "variantes">, nombre: string): Variante | undefined {
    const clave = nombre.trim().toLowerCase();
    return config.variantes.find((variante) => variante.nombre.toLowerCase() === clave);
}

type SalidaBase = {
    nombre: string;
    activa: boolean;
    /** Nombre del preajuste (resolución y etiqueta del .avs). */
    preajuste: string;
    audio: AudioSalida;
};

export type SalidaMp4 = SalidaBase & {
    tipo: "mp4-x264";
    x264: AjustesX264;
};

export type SalidaAvi = SalidaBase & {
    tipo: "avi-xvid";
    /** Límite estricto del archivo final, en MiB. */
    tamanoMB: number;
    /** Argumentos de xvid_encraw, sin entrada, salida, pasada ni bitrate. */
    xvid: string[];
};

export type Salida = SalidaMp4 | SalidaAvi;

export type Config = {
    /** Formato del archivo; sirve para migrar configs viejas. */
    version: number;
    preajustes: Preajuste[];
    salidas: Salida[];
    /** Carpeta de instalación de MeGUI (se usan sus herramientas en `tools\`). */
    rutaMegui: string | null;
    /** Carpeta donde quedan los archivos finales de `asu encode`. */
    carpetaSalida: string | null;
    grupo: string;
    /** Versiones que se codifican a la vez en `asu encode` (1 = en secuencia). */
    paralelo: number;
    /** Variantes de x264 para `asu comparar`. */
    variantes: Variante[];
};

export const PARALELO_DE_FABRICA = 3;

/** Valida un límite de concurrencia: entero ≥ 1. */
export function parsearParalelo(valor: unknown): number | null {
    const numero = typeof valor === "string" ? Number(valor.trim()) : valor;
    return typeof numero === "number" && Number.isInteger(numero) && numero >= 1 ? numero : null;
}

export const PREAJUSTES_DE_FABRICA: readonly Preajuste[] = [
    { nombre: "720p", ancho: 1280, alto: 720, etiqueta: "MP4 720" },
    { nombre: "396p", ancho: 704, alto: 396, etiqueta: "AVI" },
    { nombre: "1080p", ancho: 1920, alto: 1080, etiqueta: "MP4 1080" },
];

export const VERSION_CONFIG = 2;

const X264_DE_FABRICA: AjustesX264 = {
    // "slow": +3,5 % de compresión por −5 % de velocidad frente a "medium" (medido).
    preset: "slow",
    crf: 18,
    tune: "animation",
    keyint: 240,
    level: "4.1",
    vbvBufsize: 78125,
    vbvMaxrate: 62500,
};

// Banderas del perfil "SyncRajo AVI" de MeGUI, sin -turbo y con 4 hilos (versión 2).
export const XVID_DE_FABRICA: readonly string[] = [
    "-max_key_interval", "250", "-kboost", "100", "-chigh", "30", "-clow", "15",
    "-bquant_ratio", "162", "-bquant_offset", "0", "-bvhq", "-qtype", "1",
    "-nopacked", "-masking", "1", "-imin", "1", "-bmin", "1", "-pmin", "1", "-threads", "4", "-par", "1",
];

// Banderas de fábrica de la versión 1 (tal cual MeGUI), para migrar.
export const XVID_DE_FABRICA_V1: readonly string[] = [
    "-max_key_interval", "250", "-kboost", "100", "-chigh", "30", "-clow", "15",
    "-bquant_ratio", "162", "-bquant_offset", "0", "-turbo", "-bvhq", "-qtype", "1",
    "-nopacked", "-masking", "1", "-imin", "1", "-bmin", "1", "-pmin", "1", "-threads", "1", "-par", "1",
];

export function salidasDeFabrica(): Salida[] {
    return [
        { nombre: "1080", activa: true, preajuste: "1080p", tipo: "mp4-x264", x264: { ...X264_DE_FABRICA }, audio: { codec: "aac", kbps: 192 } },
        { nombre: "720", activa: true, preajuste: "720p", tipo: "mp4-x264", x264: { ...X264_DE_FABRICA }, audio: { codec: "aac", kbps: 192 } },
        { nombre: "396", activa: true, preajuste: "396p", tipo: "avi-xvid", tamanoMB: 180, xvid: [...XVID_DE_FABRICA], audio: { codec: "mp3", kbps: 192 } },
    ];
}

export function configDeFabrica(): Config {
    return {
        version: VERSION_CONFIG,
        preajustes: PREAJUSTES_DE_FABRICA.map((preajuste) => ({ ...preajuste })),
        salidas: salidasDeFabrica(),
        rutaMegui: null,
        carpetaSalida: null,
        grupo: "SyncRajo",
        paralelo: PARALELO_DE_FABRICA,
        variantes: variantesDeFabrica(),
    };
}

/** `~/.asu-cli`, o `ASU_CLI_HOME` si está definida (usado por los tests). */
export function directorioConfig(): string {
    return process.env.ASU_CLI_HOME ?? join(homedir(), ".asu-cli");
}

export function rutaConfig(): string {
    return join(directorioConfig(), "config.json");
}

export function rutaCacheFuentes(): string {
    return join(directorioConfig(), "cache-fuentes.json");
}

/** Interpreta "1280x720". Devuelve `null` si el formato o los valores no son válidos. */
export function parsearResolucion(texto: string): { ancho: number; alto: number } | null {
    const coincidencia = texto.trim().match(/^(\d+)\s*[xX×]\s*(\d+)$/);
    if (!coincidencia) {
        return null;
    }

    const ancho = Number(coincidencia[1]);
    const alto = Number(coincidencia[2]);
    if (ancho <= 0 || alto <= 0) {
        return null;
    }

    return { ancho, alto };
}

export function buscarPreajuste(config: Pick<Config, "preajustes">, nombre: string): Preajuste | undefined {
    const clave = nombre.trim().toLowerCase();
    return config.preajustes.find((preajuste) => preajuste.nombre.toLowerCase() === clave);
}

export function buscarSalida(config: Pick<Config, "salidas">, nombre: string): Salida | undefined {
    const clave = nombre.trim().toLowerCase();
    return config.salidas.find((salida) => salida.nombre.toLowerCase() === clave);
}

/** Devuelve el error de validación del preajuste o `undefined`. */
export function validarPreajuste(preajuste: Preajuste): string | undefined {
    if (typeof preajuste.nombre !== "string" || preajuste.nombre.trim().length === 0) {
        return "El nombre del preajuste no puede estar vacío.";
    }

    if (!Number.isInteger(preajuste.ancho) || !Number.isInteger(preajuste.alto) || preajuste.ancho <= 0 || preajuste.alto <= 0) {
        return "El ancho y el alto deben ser enteros positivos.";
    }

    if (typeof preajuste.etiqueta !== "string") {
        return "archivo" in preajuste
            ? 'El campo "archivo" se renombró a "etiqueta" (ej. "MP4 1080"); el .avs ahora se llama "<serie> <ep> <etiqueta>.avs".'
            : 'Falta "etiqueta".';
    }

    const errorEtiqueta = validarNombreArchivo(preajuste.etiqueta);
    if (errorEtiqueta) {
        return `Etiqueta del preajuste: ${errorEtiqueta}`;
    }

    return undefined;
}

function esPositivo(valor: unknown): boolean {
    return typeof valor === "number" && Number.isFinite(valor) && valor > 0;
}

/**
 * Valida ajustes x264. `completo`: deben estar todos (salida); si no, solo se validan los presentes (variante).
 * `tune` puede ser "" (sin --tune).
 */
export function validarAjustesX264(x: Partial<AjustesX264> | undefined, completo: boolean): string | undefined {
    if (!x || typeof x !== "object") {
        return "Faltan los ajustes x264.";
    }

    const presente = (clave: keyof AjustesX264) => completo || x[clave] !== undefined;
    const invalidos = [
        presente("crf") && !esPositivo(x.crf) && "crf",
        presente("keyint") && !esPositivo(x.keyint) && "keyint",
        presente("vbvBufsize") && !esPositivo(x.vbvBufsize) && "vbvBufsize",
        presente("vbvMaxrate") && !esPositivo(x.vbvMaxrate) && "vbvMaxrate",
        presente("tune") && typeof x.tune !== "string" && "tune",
        presente("level") && typeof x.level !== "string" && "level",
        x.extra !== undefined && !(Array.isArray(x.extra) && x.extra.every((a) => typeof a === "string")) && "extra",
    ].filter(Boolean);
    if (invalidos.length > 0) {
        return `Ajustes x264 inválidos: ${invalidos.join(", ")}.`;
    }

    if (presente("preset") && !PRESETS_X264.includes(String(x.preset))) {
        return `Preset x264 inválido: "${x.preset}" (usa ${PRESETS_X264.join(", ")}).`;
    }

    return undefined;
}

export function validarVariante(variante: Variante): string | undefined {
    if (typeof variante?.nombre !== "string" || variante.nombre.trim().length === 0) {
        return "El nombre de la variante no puede estar vacío.";
    }
    const errorNombre = validarNombreArchivo(variante.nombre);
    if (errorNombre) {
        return `Nombre de la variante: ${errorNombre}`;
    }
    return validarAjustesX264(variante.x264, false);
}

/** Copia los ajustes de una variante a una salida MP4. */
export function usarVariante(config: Config, nombreSalida: string, nombreVariante: string): Config {
    const salida = buscarSalida(config, nombreSalida);
    if (!salida) {
        throw new Error(`No existe una salida llamada "${nombreSalida}". Disponibles: ${config.salidas.map((x) => x.nombre).join(", ")}`);
    }
    if (salida.tipo !== "mp4-x264") {
        throw new Error(`La salida "${salida.nombre}" no es x264: las variantes solo aplican a salidas mp4-x264.`);
    }

    const variante = buscarVariante(config, nombreVariante);
    if (!variante) {
        throw new Error(`No existe una variante llamada "${nombreVariante}". Disponibles: ${config.variantes.map((x) => x.nombre).join(", ")}`);
    }

    const x264 = aplicarVariante(salida.x264, variante);
    return { ...config, salidas: config.salidas.map((x) => (x === salida ? { ...salida, x264 } : x)) };
}

/** Devuelve el error de validación de la salida o `undefined`. */
export function validarSalida(salida: Salida, preajustes: readonly Preajuste[]): string | undefined {
    if (typeof salida.nombre !== "string" || salida.nombre.trim().length === 0) {
        return "El nombre de la salida no puede estar vacío.";
    }

    if (typeof salida.activa !== "boolean") {
        return '"activa" debe ser true o false.';
    }

    if (!buscarPreajuste({ preajustes: [...preajustes] }, String(salida.preajuste))) {
        return `No existe el preajuste "${salida.preajuste}".`;
    }

    if (!salida.audio || !["aac", "mp3"].includes(salida.audio.codec) || !esPositivo(salida.audio.kbps)) {
        return 'Audio inválido: { "codec": "aac" | "mp3", "kbps": <número> }.';
    }

    if (salida.tipo === "mp4-x264") {
        const error = validarAjustesX264(salida.x264, true);
        if (error) {
            return error;
        }
        if (salida.audio.codec !== "aac") {
            return "Una salida mp4-x264 necesita audio aac.";
        }
        return undefined;
    }

    if (salida.tipo === "avi-xvid") {
        if (!esPositivo(salida.tamanoMB)) {
            return '"tamanoMB" debe ser un número positivo.';
        }
        if (!Array.isArray(salida.xvid) || !salida.xvid.every((x) => typeof x === "string")) {
            return '"xvid" debe ser una lista de argumentos de texto.';
        }
        if (salida.audio.codec !== "mp3") {
            return "Una salida avi-xvid necesita audio mp3.";
        }
        return undefined;
    }

    return `Tipo desconocido: "${(salida as { tipo: unknown }).tipo}" (usa mp4-x264 o avi-xvid).`;
}

export function agregarPreajuste(config: Config, preajuste: Preajuste): Config {
    const error = validarPreajuste(preajuste);
    if (error) {
        throw new Error(error);
    }

    if (buscarPreajuste(config, preajuste.nombre)) {
        throw new Error(`Ya existe un preajuste llamado "${preajuste.nombre}".`);
    }

    return { ...config, preajustes: [...config.preajustes, { ...preajuste, nombre: preajuste.nombre.trim(), etiqueta: preajuste.etiqueta.trim() }] };
}

export function quitarPreajuste(config: Config, nombre: string): Config {
    const existente = buscarPreajuste(config, nombre);
    if (!existente) {
        throw new Error(`No existe un preajuste llamado "${nombre}".`);
    }

    const usadaPor = config.salidas.find((salida) => salida.preajuste.toLowerCase() === existente.nombre.toLowerCase());
    if (usadaPor) {
        throw new Error(`El preajuste "${existente.nombre}" lo usa la salida "${usadaPor.nombre}".`);
    }

    return { ...config, preajustes: config.preajustes.filter((preajuste) => preajuste !== existente) };
}

export function activarSalida(config: Config, nombre: string, activa: boolean): Config {
    const salida = buscarSalida(config, nombre);
    if (!salida) {
        throw new Error(`No existe una salida llamada "${nombre}". Disponibles: ${config.salidas.map((x) => x.nombre).join(", ")}`);
    }

    return { ...config, salidas: config.salidas.map((x) => (x === salida ? { ...x, activa } : x)) };
}

function iguales(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((valor, i) => valor === b[i]);
}

export type ResultadoMigracion = {
    datos: Record<string, unknown>;
    /** Hubo cambios que hay que guardar. */
    migrada: boolean;
    avisos: string[];
};

/**
 * Lleva un config.json de una versión anterior a la actual:
 * - v1 → v2: x264 sin `preset` recibe "slow"; banderas de XviD iguales a las de fábrica v1
 *   pasan a las nuevas (sin -turbo, 4 hilos). Si fueron editadas, no se tocan y se avisa.
 */
export function migrarConfig(datos: Record<string, unknown>): ResultadoMigracion {
    const version = typeof datos.version === "number" ? datos.version : 1;
    if (version >= VERSION_CONFIG) {
        return { datos, migrada: false, avisos: [] };
    }

    const avisos: string[] = [];
    const salidas = Array.isArray(datos.salidas)
        ? (datos.salidas as Record<string, unknown>[]).map((salida) => {
            if (salida?.tipo === "mp4-x264" && salida.x264 && typeof salida.x264 === "object" && !("preset" in salida.x264)) {
                return { ...salida, x264: { preset: "slow", ...(salida.x264 as object) } };
            }

            if (salida?.tipo === "avi-xvid" && Array.isArray(salida.xvid)) {
                if (iguales(salida.xvid as string[], XVID_DE_FABRICA_V1)) {
                    return { ...salida, xvid: [...XVID_DE_FABRICA] };
                }
                if (!iguales(salida.xvid as string[], XVID_DE_FABRICA)) {
                    avisos.push(
                        `Las banderas de XviD de la salida "${String(salida.nombre)}" fueron editadas: no se migraron. ` +
                        `Las nuevas de fábrica son: ${XVID_DE_FABRICA.join(" ")}`,
                    );
                }
            }

            return salida;
        })
        : datos.salidas;

    return { datos: { ...datos, salidas, version: VERSION_CONFIG }, migrada: true, avisos };
}

function validarConfig(datos: unknown): Config {
    const parcial = (datos ?? {}) as Partial<Config>;
    const fabrica = configDeFabrica();
    // Las claves que faltan se completan con las de fábrica (configs viejas solo tenían preajustes).
    const config: Config = {
        version: parcial.version ?? fabrica.version,
        preajustes: parcial.preajustes ?? fabrica.preajustes,
        salidas: parcial.salidas ?? fabrica.salidas,
        rutaMegui: parcial.rutaMegui ?? null,
        carpetaSalida: parcial.carpetaSalida ?? null,
        grupo: parcial.grupo ?? fabrica.grupo,
        paralelo: parcial.paralelo ?? fabrica.paralelo,
        variantes: parcial.variantes ?? fabrica.variantes,
    };

    if (!Array.isArray(config.variantes)) {
        throw new Error('"variantes" debe ser una lista.');
    }
    for (const variante of config.variantes) {
        const error = validarVariante(variante);
        if (error) {
            throw new Error(`Variante "${variante?.nombre}": ${error}`);
        }
    }

    if (parsearParalelo(config.paralelo) === null) {
        throw new Error('"paralelo" debe ser un entero mayor o igual a 1.');
    }

    if (!Array.isArray(config.preajustes)) {
        throw new Error('"preajustes" debe ser una lista.');
    }
    for (const preajuste of config.preajustes) {
        const error = validarPreajuste(preajuste);
        if (error) {
            throw new Error(`Preajuste ${JSON.stringify(preajuste)}: ${error}`);
        }
    }

    if (!Array.isArray(config.salidas)) {
        throw new Error('"salidas" debe ser una lista.');
    }
    for (const salida of config.salidas) {
        const error = validarSalida(salida, config.preajustes);
        if (error) {
            throw new Error(`Salida "${salida?.nombre}": ${error}`);
        }
    }

    for (const clave of ["rutaMegui", "carpetaSalida"] as const) {
        if (config[clave] !== null && typeof config[clave] !== "string") {
            throw new Error(`"${clave}" debe ser una ruta o null.`);
        }
    }

    const errorGrupo = typeof config.grupo === "string" ? validarNombreArchivo(config.grupo) : "debe ser texto";
    if (errorGrupo) {
        throw new Error(`"grupo": ${errorGrupo}`);
    }

    return config;
}

/**
 * Lee la configuración. Si no existe, devuelve la de fábrica sin escribirla. Si es de una versión
 * anterior, la migra y la guarda (una sola vez); los avisos de la migración van a `alAviso`.
 */
export function cargarConfig(alAviso: (mensaje: string) => void = (mensaje) => console.warn(mensaje)): Config {
    const ruta = rutaConfig();
    if (!existsSync(ruta)) {
        return configDeFabrica();
    }

    let config: Config;
    let migracion: ResultadoMigracion;
    try {
        migracion = migrarConfig(JSON.parse(readFileSync(ruta, "utf8")) as Record<string, unknown>);
        config = validarConfig(migracion.datos);
    } catch (error) {
        throw new Error(`Configuración inválida en ${ruta}: ${(error as Error).message}`);
    }

    if (migracion.migrada) {
        guardarConfig(config);
        alAviso(`Configuración actualizada a la versión ${VERSION_CONFIG} (${ruta}).`);
        for (const aviso of migracion.avisos) {
            alAviso(aviso);
        }
    }

    return config;
}

export function guardarConfig(config: Config): void {
    mkdirSync(directorioConfig(), { recursive: true });
    writeFileSync(rutaConfig(), `${JSON.stringify(config, null, 2)}\n`);
}
