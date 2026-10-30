// Esquema de resultados.json de `asu comparar`: la fuente de datos de la página y de otras herramientas.
import type { AjustesX264 } from "./config.ts";
import type { CapturaElegida, MotivoTramo } from "./comparar.ts";

export const VERSION_RESULTADOS = 1;
export const NOMBRE_RESULTADOS = "resultados.json";

export type ResultadoTramo = {
    tramo: number;
    kbps: number;
    /** Bitrate que tendría con el CRF de la salida (null en la referencia: es su bitrate). */
    kbpsCrf: number | null;
    /** CRF usado al igualar por CRF (null con 2 pasadas). */
    crf: number | null;
    fps: number | null;
    ssim: number | null;
    psnr: number | null;
    /** SSIM de cada frame del tramo contra el .avs, desde el frame 0. */
    ssimPorFrame: number[];
    /** Ruta relativa del clip. */
    clip: string;
    desdeCache: boolean;
};

export type ResultadoVariante = {
    nombre: string;
    descripcion: string;
    /** Lo que la distingue de la salida, para mostrar. */
    argumentos: string;
    /** Ajustes x264 completos que se usaron. */
    x264: AjustesX264;
    /** Comando para adoptarla (null en la referencia). */
    adoptar: string | null;
    promedio: { kbps: number | null; kbpsCrf: number | null; fps: number | null; ssim: number | null; psnr: number | null };
    porTramo: ResultadoTramo[];
};

export type ResultadoCaptura = {
    indice: number;
    tramo: number;
    frame: number;
    segundo: number;
    motivo: CapturaElegida["motivo"];
    /** Rutas relativas de los PNG. */
    fuente: string;
    variantes: Record<string, string>;
    /** SSIM de ese frame por variante. */
    ssim: Record<string, number | null>;
};

export type Voto = {
    sesion: string;
    fecha: string;
    captura: number;
    /** Nombre de la variante elegida, o "empate". */
    eleccion: string;
};

export type Resultados = {
    version: typeof VERSION_RESULTADOS;
    fecha: string;
    episodio: { serie: string; episodio: string; raw: string; avs: string };
    salida: { nombre: string; etiqueta: string; ancho: number; alto: number; x264: AjustesX264 };
    metodo: { referencia: string; igualacion: "bitrate" | "crf"; descripcion: string };
    tramos: { indice: number; inicio: number; duracion: number; motivo: MotivoTramo; valor?: number }[];
    variantes: ResultadoVariante[];
    capturas: ResultadoCaptura[];
    votos: Voto[];
};

/** Valida lo mínimo de un voto recibido de la página. Devuelve el error o `undefined`. */
export function validarVoto(resultados: Resultados, voto: unknown): string | undefined {
    const v = voto as Partial<Voto>;
    if (typeof v?.sesion !== "string" || v.sesion.length === 0 || v.sesion.length > 100) {
        return "Sesión inválida.";
    }
    if (!Number.isInteger(v.captura) || v.captura! < 0 || v.captura! >= resultados.capturas.length) {
        return "Captura inválida.";
    }
    if (typeof v.eleccion !== "string" || (v.eleccion !== "empate" && !resultados.variantes.some((x) => x.nombre === v.eleccion))) {
        return "Elección inválida.";
    }
    return undefined;
}

/** Agrega o reemplaza el voto de esa sesión para esa captura. */
export function registrarVoto(resultados: Resultados, voto: Omit<Voto, "fecha">, fecha: Date): Resultados {
    const otros = resultados.votos.filter((v) => !(v.sesion === voto.sesion && v.captura === voto.captura));
    return { ...resultados, votos: [...otros, { ...voto, fecha: fecha.toISOString() }] };
}

/** Conteo de votos por variante (y empates). */
export function contarVotos(resultados: Resultados): Record<string, number> {
    const conteo: Record<string, number> = { empate: 0 };
    for (const variante of resultados.variantes) {
        conteo[variante.nombre] = 0;
    }
    for (const voto of resultados.votos) {
        conteo[voto.eleccion] = (conteo[voto.eleccion] ?? 0) + 1;
    }
    return conteo;
}
