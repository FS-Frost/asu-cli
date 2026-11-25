import { basename, dirname, extname, join } from "node:path";
import type { Comando } from "./encode.ts";

export type TipoPista = "video" | "audio" | "subs";

export type PistaMkv = {
    id: number;
    tipo: TipoPista;
    /** "V_MPEG4/ISO/AVC", "S_TEXT/ASS"... */
    codecId: string;
    /** Descripción legible de mkvmerge: "MPEG-4p10/AVC/h.264", "SubStationAlpha"... */
    codec: string;
    idioma: string | null;
    nombre: string | null;
};

export type AdjuntoMkv = {
    id: number;
    nombre: string;
    tipoMime: string;
    bytes: number;
};

export type ContenidoMkv = { pistas: PistaMkv[]; adjuntos: AdjuntoMkv[] };

const TIPOS: Record<string, TipoPista> = { video: "video", audio: "audio", subtitles: "subs" };

/** Primera versión de mkvmerge con `-J` (identificación en JSON). */
const VERSION_JSON: readonly [number, number] = [9, 6];

/** "mkvmerge v7.2.0 ('On Every Street') 32bit" → [7, 2, 0]; null si no se reconoce. */
export function parsearVersionMkvmerge(salida: string): [number, number, number] | null {
    const coincidencia = salida.match(/mkvmerge v(\d+)\.(\d+)(?:\.(\d+))?/);
    return coincidencia ? [Number(coincidencia[1]), Number(coincidencia[2]), Number(coincidencia[3] ?? 0)] : null;
}

/** ¿Esta versión identifica con `-J`? Las viejas (como la 7.2) solo con `--identify-verbose`. */
export function usaJson(version: readonly [number, number, number] | null): boolean {
    if (!version) {
        return false;
    }
    const [mayor, menor] = version;
    return mayor > VERSION_JSON[0] || (mayor === VERSION_JSON[0] && menor >= VERSION_JSON[1]);
}

/** Comando de identificación según la versión. */
export function argumentosIdentificar(archivo: string, json: boolean): string[] {
    return json ? ["-J", archivo] : ["--identify-verbose", archivo];
}

/** Deshace el escapado de `--identify-verbose`: \s espacio, \c dos puntos, \2 comillas, \h numeral, \b [ , \B ], \\ barra. */
export function desescapar(valor: string): string {
    const tabla: Record<string, string> = { s: " ", c: ":", "2": '"', h: "#", b: "[", B: "]", "\\": "\\" };
    return valor.replace(/\\(.)/g, (todo, letra: string) => tabla[letra] ?? todo);
}

/** Propiedades "clave:valor" del bloque [...] de `--identify-verbose` (separadas por espacios; los valores vienen escapados). */
function propiedades(bloque: string): Map<string, string> {
    const mapa = new Map<string, string>();
    for (const parte of bloque.split(" ")) {
        const dos = parte.indexOf(":");
        if (dos > 0) {
            mapa.set(parte.slice(0, dos), desescapar(parte.slice(dos + 1)));
        }
    }
    return mapa;
}

/** Pistas y adjuntos según `mkvmerge --identify-verbose` (MKVToolNix 7.x, formato texto). */
export function parsearIdentificacionTexto(salida: string): ContenidoMkv {
    const pistas: PistaMkv[] = [];
    const adjuntos: AdjuntoMkv[] = [];
    for (const linea of salida.split(/\r?\n/)) {
        const pista = linea.match(/^Track ID (\d+): (video|audio|subtitles) \((.*?)\)(?: \[(.*)\])?$/);
        if (pista) {
            const props = propiedades(pista[4] ?? "");
            pistas.push({
                id: Number(pista[1]),
                tipo: TIPOS[pista[2]!]!,
                codecId: props.get("codec_id") ?? "",
                codec: pista[3]!,
                idioma: props.get("language") ?? null,
                nombre: props.get("track_name") ?? null,
            });
            continue;
        }

        const adjunto = linea.match(/^Attachment ID (\d+): type '(.*?)', size (\d+) bytes(?:, description '.*?')?, file name '(.*)'(?: \[[^\]]*\])?$/);
        if (adjunto) {
            adjuntos.push({ id: Number(adjunto[1]), tipoMime: adjunto[2]!, bytes: Number(adjunto[3]), nombre: adjunto[4]! });
        }
    }
    return { pistas, adjuntos };
}

type JsonMkvmerge = {
    tracks?: { id: number; type: string; codec?: string; properties?: { codec_id?: string; language?: string; track_name?: string } }[];
    attachments?: { id: number; file_name?: string; content_type?: string; size?: number }[];
};

/** Pistas y adjuntos según `mkvmerge -J` (MKVToolNix ≥ 9.6). */
export function parsearIdentificacionJson(salida: string): ContenidoMkv {
    const datos = JSON.parse(salida) as JsonMkvmerge;
    return {
        pistas: (datos.tracks ?? [])
            .filter((t) => t.type in TIPOS)
            .map((t) => ({
                id: t.id,
                tipo: TIPOS[t.type]!,
                codecId: t.properties?.codec_id ?? "",
                codec: t.codec ?? "",
                idioma: t.properties?.language ?? null,
                nombre: t.properties?.track_name ?? null,
            })),
        adjuntos: (datos.attachments ?? []).map((a) => ({
            id: a.id,
            nombre: a.file_name ?? `adjunto ${a.id}`,
            tipoMime: a.content_type ?? "",
            bytes: a.size ?? 0,
        })),
    };
}

// Extensión por prefijo de codec_id (lo que escribe mkvextract tracks). El primero que calza gana.
const EXTENSIONES_CODEC: readonly [string, string][] = [
    ["V_MPEG4/ISO/AVC", ".h264"],
    ["V_MPEGH/ISO/HEVC", ".h265"],
    ["V_MPEG4/ISO/", ".m4v"],
    ["V_MPEG1", ".m1v"],
    ["V_MPEG2", ".m2v"],
    ["V_MS/VFW/FOURCC", ".avi"],
    ["V_VP8", ".ivf"],
    ["V_VP9", ".ivf"],
    ["V_AV1", ".ivf"],
    ["A_AAC", ".aac"],
    ["A_AC3", ".ac3"],
    ["A_EAC3", ".eac3"],
    ["A_DTS", ".dts"],
    ["A_FLAC", ".flac"],
    ["A_OPUS", ".opus"],
    ["A_VORBIS", ".ogg"],
    ["A_MPEG/L3", ".mp3"],
    ["A_MPEG/L2", ".mp2"],
    ["A_PCM/", ".wav"],
    ["A_TRUEHD", ".thd"],
    ["S_TEXT/ASS", ".ass"],
    ["S_TEXT/SSA", ".ssa"],
    ["S_TEXT/UTF8", ".srt"],
    ["S_TEXT/WEBVTT", ".vtt"],
    ["S_TEXT/USF", ".usf"],
    ["S_HDMV/PGS", ".sup"],
    ["S_VOBSUB", ".sub"],
];

/** Extensión del archivo extraído según el codec, o null si no se conoce (la pista se salta). */
export function extensionCodec(codecId: string): string | null {
    return EXTENSIONES_CODEC.find(([prefijo]) => codecId.startsWith(prefijo))?.[1] ?? null;
}

/** Reemplaza lo que Windows no admite en un nombre de archivo por "_" y limpia espacios. */
export function limpiarNombre(nombre: string): string {
    return nombre.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "");
}

/** "[G] Serie - 04 [1080p] - 2 subs eng Signs.ass" (sin idioma "und" ni nombre vacío). */
export function nombrePista(mkv: string, pista: PistaMkv, extension: string): string {
    const partes = [String(pista.id), pista.tipo];
    if (pista.idioma && pista.idioma !== "und") {
        partes.push(pista.idioma);
    }
    if (pista.nombre?.trim()) {
        partes.push(pista.nombre);
    }
    return limpiarNombre(`${basename(mkv, extname(mkv))} - ${partes.join(" ")}`) + extension;
}

/** Nombre de un adjunto en disco: el original, sin caracteres inválidos. */
export function nombreAdjunto(adjunto: AdjuntoMkv): string {
    return limpiarNombre(adjunto.nombre) || `adjunto ${adjunto.id}`;
}

export type Extraccion = { tipo: "pista" | "adjunto"; id: number; destino: string; etiqueta: string };

/** `mkvextract tracks|attachments <mkv> id:destino...` (sintaxis vieja: la 7.2 la exige y las nuevas la aceptan). */
export function comandoMkvextract(mkvextract: string, modo: "tracks" | "attachments", mkv: string, extracciones: readonly Extraccion[]): Comando {
    return { exe: mkvextract, args: [modo, mkv, ...extracciones.map((e) => `${e.id}:${e.destino}`)] };
}

/** Destinos de lo elegido, junto al MKV. Las pistas con codec desconocido van en `saltadas`. */
export function planificarExtraccion(
    mkv: string,
    contenido: ContenidoMkv,
    pistas: readonly number[],
    adjuntos: readonly number[],
): { extracciones: Extraccion[]; saltadas: PistaMkv[] } {
    const carpeta = dirname(mkv);
    const extracciones: Extraccion[] = [];
    const saltadas: PistaMkv[] = [];
    for (const pista of contenido.pistas.filter((p) => pistas.includes(p.id))) {
        const extension = extensionCodec(pista.codecId);
        if (!extension) {
            saltadas.push(pista);
            continue;
        }
        extracciones.push({ tipo: "pista", id: pista.id, destino: join(carpeta, nombrePista(mkv, pista, extension)), etiqueta: describirPista(pista) });
    }
    for (const adjunto of contenido.adjuntos.filter((a) => adjuntos.includes(a.id))) {
        extracciones.push({ tipo: "adjunto", id: adjunto.id, destino: join(carpeta, nombreAdjunto(adjunto)), etiqueta: describirAdjunto(adjunto) });
    }
    return { extracciones, saltadas };
}

/** "2 subs · ASS · eng · Signs" para listas y mensajes. */
export function describirPista(pista: PistaMkv): string {
    const codec = pista.codecId.replace(/^[VAS]_/, "").replace(/^TEXT\//, "") || pista.codec;
    return [`${pista.id} ${pista.tipo}`, codec, pista.idioma && pista.idioma !== "und" ? pista.idioma : null, pista.nombre || null]
        .filter(Boolean)
        .join(" · ");
}

/** "adjunto 1 · Arial Regular.ttf · 1.0 MB". */
export function describirAdjunto(adjunto: AdjuntoMkv): string {
    const tamano = adjunto.bytes >= 1024 * 1024 ? `${(adjunto.bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(adjunto.bytes / 1024))} KB`;
    return `adjunto ${adjunto.id} · ${adjunto.nombre} · ${tamano}`;
}
