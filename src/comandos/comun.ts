import * as p from "@clack/prompts";
import { existsSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, isAbsolute, join, resolve } from "node:path";
import { EXTENSIONES_ASS, EXTENSIONES_VIDEO, conExtension, listarArchivos, validarNombreArchivo } from "../nucleo/archivos.ts";
import { deducirSerieEpisodio, normalizarEpisodio, type SerieEpisodio } from "../nucleo/nombres.ts";
import { caracteresFuera1252, codificarWindows1252 } from "../nucleo/windows1252.ts";
import { ErrorUsuario, elegir, esInteractivo, ordenarLista, preguntarTexto } from "../ui.ts";

/** Directorio absoluto a usar: el indicado o el actual. Falla si no existe. */
export function resolverDirectorio(dir: string | undefined): string {
    const ruta = resolve(dir ?? process.cwd());
    if (!existsSync(ruta) || !statSync(ruta).isDirectory()) {
        throw new ErrorUsuario(`El directorio no existe: ${ruta}`);
    }

    return ruta;
}

/** Ruta absoluta de un archivo indicado por argumento (relativo a `dir`). Falla si no existe. */
export function resolverArchivo(dir: string, archivo: string): string {
    const ruta = isAbsolute(archivo) ? archivo : join(dir, archivo);
    if (!existsSync(ruta) || !statSync(ruta).isFile()) {
        throw new ErrorUsuario(`El archivo no existe: ${ruta}`);
    }

    return ruta;
}

/** Video indicado, el único del directorio, o el que elija el usuario si hay varios. */
export async function elegirVideo(dir: string, video: string | undefined): Promise<string> {
    if (video !== undefined) {
        const ruta = resolverArchivo(dir, video);
        if (!EXTENSIONES_VIDEO.includes(extname(ruta).toLowerCase())) {
            throw new ErrorUsuario(`No es un video soportado: ${basename(ruta)} (extensiones: ${EXTENSIONES_VIDEO.join(" ")})`);
        }

        return ruta;
    }

    const videos = listarArchivos(dir, EXTENSIONES_VIDEO);
    if (videos.length === 0) {
        throw new ErrorUsuario("No hay videos en el directorio.");
    }

    if (videos.length === 1) {
        return videos[0]!;
    }

    if (!esInteractivo()) {
        throw new ErrorUsuario(`Hay ${videos.length} videos en el directorio; indica cuál con --video.`);
    }

    return elegir("Elige el video", videos.map((ruta) => ({ value: ruta, label: basename(ruta) })));
}

export type OpcionesDestino = {
    forzar?: boolean;
    salida?: string;
};

export type OpcionesSerieEpisodio = {
    serie?: string;
    episodio?: string;
};

/**
 * Serie y episodio: de los argumentos, o deducidos del raw (o de las carpetas). En el menú se
 * muestran como sugerencia editable; sin terminal, si no se pueden deducir, es un error.
 */
export async function resolverSerieEpisodio(
    dir: string,
    video: string,
    opciones: OpcionesSerieEpisodio,
    extras: {
        /** Valores iniciales en el menú (y por defecto sin terminal), antes que lo deducido. */
        sugerido?: Partial<SerieEpisodio>;
        /** Se llama apenas se confirma cada respuesta en el menú. */
        alConfirmar?: (cambio: Partial<SerieEpisodio>) => void;
    } = {},
): Promise<SerieEpisodio> {
    const deducido = deducirSerieEpisodio(video, dir);
    let serie = opciones.serie ?? extras.sugerido?.serie ?? deducido?.serie;
    let episodio = opciones.episodio ?? extras.sugerido?.episodio ?? deducido?.episodio;

    if (esInteractivo()) {
        if (opciones.serie === undefined) {
            serie = (await preguntarTexto("Serie", { inicial: serie, validar: validarNombreArchivo })).trim();
            extras.alConfirmar?.({ serie });
        }
        if (opciones.episodio === undefined) {
            episodio = await preguntarTexto("Episodio", {
                inicial: episodio,
                validar: (valor) => (normalizarEpisodio(valor) ? undefined : "El episodio debe ser un número."),
            });
            extras.alConfirmar?.({ episodio: normalizarEpisodio(episodio) ?? episodio });
        }
    }

    if (serie === undefined || episodio === undefined) {
        throw new ErrorUsuario(
            `No se pudo deducir la serie y el episodio de "${basename(video)}" ni de las carpetas. Indícalos con --serie y --episodio.`,
        );
    }

    const errorSerie = validarNombreArchivo(serie);
    if (errorSerie) {
        throw new ErrorUsuario(`Serie: ${errorSerie}`);
    }

    const normalizado = normalizarEpisodio(episodio);
    if (normalizado === null) {
        throw new ErrorUsuario(`Episodio inválido: "${episodio}". Debe ser un número.`);
    }

    return { serie: serie.trim(), episodio: normalizado };
}

/** Rutas de .ass indicadas por argumento (relativas a `dir`), validando que existan, sean .ass y no se repitan. */
export function resolverArchivosAss(dir: string, archivos: readonly string[]): string[] {
    const rutas = archivos.map((archivo) => {
        const ruta = resolverArchivo(dir, archivo);
        if (!EXTENSIONES_ASS.includes(extname(ruta).toLowerCase())) {
            throw new ErrorUsuario(`No es un archivo .ass: ${basename(ruta)}`);
        }

        return ruta;
    });

    const repetido = rutas.find((ruta, i) => rutas.findIndex((otra) => otra.toLowerCase() === ruta.toLowerCase()) !== i);
    if (repetido) {
        throw new ErrorUsuario(`Archivo repetido: ${basename(repetido)}`);
    }

    return rutas;
}

/** Lista reordenable con `rutas` en el orden propuesto; Enter sin mover nada lo acepta. */
export async function ordenarArchivos(rutas: string[], titulo: string): Promise<string[]> {
    if (rutas.length < 2) {
        return rutas;
    }

    return ordenarLista(titulo, rutas.map((ruta) => ({ value: ruta, label: basename(ruta) })));
}

/**
 * Ruta del archivo a escribir. Si ya existe: con `forzar` se sobrescribe; en modo interactivo
 * se ofrece sobrescribir, usar otro nombre o cancelar (`null`); sin terminal es un error.
 */
export async function resolverDestino(
    dir: string,
    nombrePorDefecto: string,
    opciones: OpcionesDestino,
    extension = ".avs",
): Promise<string | null> {
    if (opciones.salida !== undefined) {
        const error = validarNombreArchivo(opciones.salida);
        if (error) {
            throw new ErrorUsuario(`--salida: ${error}`);
        }
    }

    let ruta = join(dir, conExtension(opciones.salida ?? nombrePorDefecto, extension));

    while (existsSync(ruta) && !opciones.forzar) {
        if (!esInteractivo()) {
            throw new ErrorUsuario(`${basename(ruta)} ya existe. Usa --forzar para sobrescribirlo o --salida <nombre> para crear otro.`);
        }

        const accion = await elegir(`${basename(ruta)} ya existe. ¿Qué hago?`, [
            { value: "sobrescribir", label: "Sobrescribir" },
            { value: "renombrar", label: "Crear con otro nombre" },
            { value: "cancelar", label: "Cancelar" },
        ]);

        if (accion === "sobrescribir") {
            break;
        }

        if (accion === "cancelar") {
            return null;
        }

        const nombre = await preguntarTexto("Nombre del nuevo archivo", { validar: validarNombreArchivo });
        ruta = join(dir, conExtension(nombre, extension));
    }

    return ruta;
}

/** Bytes en Windows-1252 del contenido de un .avs. Falla si alguna ruta tiene caracteres que AviSynth no puede leer. */
export function codificarAvs(contenido: string): Uint8Array {
    const fuera = caracteresFuera1252(contenido);
    if (fuera.length > 0) {
        throw new ErrorUsuario(
            `No se creó el AVS: las rutas contienen caracteres que AviSynth+ no puede leer (Windows-1252): ${fuera.join(" ")}\n` +
            "Renombra los archivos o carpetas y vuelve a intentarlo.",
        );
    }

    return codificarWindows1252(contenido);
}

export function escribirAvs(ruta: string, bytes: Uint8Array): void {
    writeFileSync(ruta, bytes);
    p.log.success(`Archivo AVS creado: ${ruta}`);
}
