import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { extraerMkv, type OpcionesMkv } from "../src/comandos/mkv.ts";
import type { Ejecutor } from "../src/ejecutor.ts";
import type { Comando } from "../src/nucleo/encode.ts";
import {
    comandoMkvextract,
    desescapar,
    extensionCodec,
    nombreAdjunto,
    nombrePista,
    parsearIdentificacionJson,
    parsearIdentificacionTexto,
    parsearVersionMkvmerge,
    planificarExtraccion,
    usaJson,
    type PistaMkv,
} from "../src/nucleo/mkv.ts";
import { directorioTemporal } from "./utilidades.ts";

// Salida real de `mkvmerge --identify-verbose` (MKVToolNix 7.2.0) de un MKV de prueba;
// solo se recortó codec_private_data, que no se interpreta.
const IDENTIFICACION_7_2 = [
    "File '[G] Serie - 04 [1080p].mkv': container: Matroska [duration:1045000000 segment_uid:b8b3721bc90c70ffa94edbf3f4461ce9 is_providing_timecodes:1]",
    "Track ID 0: video (MPEG-4p10/AVC/h.264) [number:1 uid:10574968676706613127 codec_id:V_MPEG4/ISO/AVC codec_private_length:46 codec_private_data:01f4000d language:jpn track_name:Video\\sprincipal pixel_dimensions:320x240 display_dimensions:320x240 default_track:1 forced_track:0 enabled_track:1 packetizer:mpeg4_p10_video default_duration:41666665 tag_bps:58429 tag_duration:00\\c00\\c01.001000000 tag__statistics_writing_app:mkvmerge\\sv7.2.0\\s('On\\sEvery\\sStreet')\\s32bit]",
    "Track ID 1: audio (AAC) [number:2 uid:2744150192908587929 codec_id:A_AAC codec_private_length:5 codec_private_data:120856e500 language:jpn default_track:1 forced_track:0 enabled_track:1 default_duration:23219954 audio_sampling_frequency:44100 audio_channels:1]",
    "Track ID 2: subtitles (SubStationAlpha) [number:3 uid:9354545737939644324 codec_id:S_TEXT/ASS codec_private_length:523 codec_private_data:5b536372 language:eng track_name:Signs\\c\\s\\2Op\\2\\s\\h1\\s[x]\\\\y default_track:1 forced_track:0 enabled_track:1]",
    "Track ID 3: subtitles (SubStationAlpha) [number:4 uid:3669615955146592644 codec_id:S_TEXT/ASS codec_private_length:523 codec_private_data:5b536372 language:spa default_track:0 forced_track:0 enabled_track:1]",
    "Attachment ID 1: type 'application/x-truetype-font', size 1045956 bytes, file name 'Arial Regular.ttf' [uid:7691260941115836320]",
    "Tags for track ID 0: 7 entries",
].join("\r\n");

const MKV = "[G] Serie - 04 [1080p].mkv";

describe("identificación", () => {
    test("versión de mkvmerge: la 7.2 usa texto, ≥ 9.6 usa JSON", () => {
        expect(parsearVersionMkvmerge("mkvmerge v7.2.0 ('On Every Street') 32bit built on Sep 13 2014")).toEqual([7, 2, 0]);
        expect(usaJson([7, 2, 0])).toBe(false);
        expect(usaJson([9, 5, 0])).toBe(false);
        expect(usaJson([9, 6, 0])).toBe(true);
        expect(usaJson(parsearVersionMkvmerge("mkvmerge v88.0 ('All I Know') 64-bit"))).toBe(true);
        expect(usaJson(null)).toBe(false);
    });

    test("desescapar: \\s \\c \\2 \\h \\\\ y los corchetes tal cual", () => {
        expect(desescapar("Signs\\c\\s\\2Op\\2\\s\\h1\\s[x]\\\\y")).toBe('Signs: "Op" #1 [x]\\y');
    });

    test("texto de la 7.2: pistas con tipo, codec, idioma y nombre; adjuntos con nombre y tamaño", () => {
        expect(parsearIdentificacionTexto(IDENTIFICACION_7_2)).toEqual({
            pistas: [
                { id: 0, tipo: "video", codecId: "V_MPEG4/ISO/AVC", codec: "MPEG-4p10/AVC/h.264", idioma: "jpn", nombre: "Video principal" },
                { id: 1, tipo: "audio", codecId: "A_AAC", codec: "AAC", idioma: "jpn", nombre: null },
                { id: 2, tipo: "subs", codecId: "S_TEXT/ASS", codec: "SubStationAlpha", idioma: "eng", nombre: 'Signs: "Op" #1 [x]\\y' },
                { id: 3, tipo: "subs", codecId: "S_TEXT/ASS", codec: "SubStationAlpha", idioma: "spa", nombre: null },
            ],
            adjuntos: [{ id: 1, nombre: "Arial Regular.ttf", tipoMime: "application/x-truetype-font", bytes: 1045956 }],
        });
    });

    test("JSON (≥ 9.6)", () => {
        const json = JSON.stringify({
            tracks: [
                { id: 0, type: "video", codec: "AVC/H.264/MPEG-4p10", properties: { codec_id: "V_MPEG4/ISO/AVC", language: "jpn" } },
                { id: 1, type: "subtitles", codec: "SubStationAlpha", properties: { codec_id: "S_TEXT/ASS", language: "eng", track_name: "Signs" } },
            ],
            attachments: [{ id: 1, file_name: "Fuente.otf", content_type: "font/otf", size: 2048 }],
        });
        expect(parsearIdentificacionJson(json)).toEqual({
            pistas: [
                { id: 0, tipo: "video", codecId: "V_MPEG4/ISO/AVC", codec: "AVC/H.264/MPEG-4p10", idioma: "jpn", nombre: null },
                { id: 1, tipo: "subs", codecId: "S_TEXT/ASS", codec: "SubStationAlpha", idioma: "eng", nombre: "Signs" },
            ],
            adjuntos: [{ id: 1, nombre: "Fuente.otf", tipoMime: "font/otf", bytes: 2048 }],
        });
    });
});

describe("nombres y comandos", () => {
    const pista = (cambios: Partial<PistaMkv>): PistaMkv => ({ id: 2, tipo: "subs", codecId: "S_TEXT/ASS", codec: "", idioma: "eng", nombre: null, ...cambios });

    test("extensión según el codec; desconocido = null", () => {
        expect(extensionCodec("V_MPEG4/ISO/AVC")).toBe(".h264");
        expect(extensionCodec("V_MPEG4/ISO/ASP")).toBe(".m4v");
        expect(extensionCodec("A_AAC/MPEG4/LC")).toBe(".aac");
        expect(extensionCodec("A_PCM/INT/LIT")).toBe(".wav");
        expect(extensionCodec("S_TEXT/UTF8")).toBe(".srt");
        expect(extensionCodec("S_HDMV/PGS")).toBe(".sup");
        expect(extensionCodec("X_RARO")).toBeNull();
    });

    test("nombre de pista: id, tipo, idioma (sin und) y nombre, sin caracteres inválidos", () => {
        expect(nombrePista(MKV, pista({ nombre: 'Signs: "Op"' }), ".ass")).toBe("[G] Serie - 04 [1080p] - 2 subs eng Signs_ _Op_.ass");
        expect(nombrePista(MKV, pista({ idioma: "und" }), ".ass")).toBe("[G] Serie - 04 [1080p] - 2 subs.ass");
        expect(nombrePista(MKV, pista({ idioma: null, nombre: "  " }), ".ass")).toBe("[G] Serie - 04 [1080p] - 2 subs.ass");
        expect(nombreAdjunto({ id: 3, nombre: "a/b?.ttf", tipoMime: "", bytes: 1 })).toBe("a_b_.ttf");
        expect(nombreAdjunto({ id: 3, nombre: "", tipoMime: "", bytes: 1 })).toBe("adjunto 3");
    });

    test("comando con la sintaxis vieja de mkvextract; plan junto al MKV y codecs desconocidos aparte", () => {
        const contenido = parsearIdentificacionTexto(IDENTIFICACION_7_2);
        contenido.pistas.push(pista({ id: 4, codecId: "X_RARO" }));
        const ruta = join("C:\\Raws", MKV);
        const { extracciones, saltadas } = planificarExtraccion(ruta, contenido, [3, 4], [1]);
        expect(saltadas.map((p) => p.id)).toEqual([4]);
        expect(extracciones.map((e) => e.destino)).toEqual([join("C:\\Raws", "[G] Serie - 04 [1080p] - 3 subs spa.ass"), join("C:\\Raws", "Arial Regular.ttf")]);
        expect(comandoMkvextract("mkvextract", "tracks", ruta, extracciones.slice(0, 1)).args).toEqual([
            "tracks",
            ruta,
            `3:${join("C:\\Raws", "[G] Serie - 04 [1080p] - 3 subs spa.ass")}`,
        ]);
    });
});

describe("asu mkv (ejecutor falso)", () => {
    let dir: string;
    let llamadas: Comando[][];
    const entorno = { ...process.env };

    /** mkvmerge 7.2 con IDENTIFICACION_7_2; mkvextract crea cada "id:destino". */
    const ejecutor: Ejecutor = {
        async ejecutar(comandos) {
            llamadas.push([...comandos]);
            const { exe, args } = comandos[0]!;
            if (exe === "mkvmerge") {
                return args[0] === "--version"
                    ? { codigo: 0, stderr: "", stdout: "mkvmerge v7.2.0 ('On Every Street') 32bit" }
                    : { codigo: 0, stderr: "", stdout: IDENTIFICACION_7_2 };
            }
            for (const spec of args.slice(2)) {
                writeFileSync(spec.slice(spec.indexOf(":") + 1), "extraído");
            }
            return { codigo: 0, stderr: "", stdout: "Progress: 100%" };
        },
    };
    const correr = (opciones: OpcionesMkv = {}) => extraerMkv({ dir, ...opciones }, { ejecutor, herramientas: { mkvmerge: "mkvmerge", mkvextract: "mkvextract" } });
    const extraidas = () => llamadas.filter((t) => t[0]!.exe === "mkvextract").map((t) => t[0]!.args[0]);

    beforeEach(() => {
        dir = directorioTemporal();
        writeFileSync(join(dir, MKV), "");
        writeFileSync(join(dir, "otro.mp4"), "");
        llamadas = [];
        process.env.ASU_CLI_NO_INTERACTIVO = "1";
    });

    afterEach(() => {
        process.env = { ...entorno };
        rmSync(dir, { recursive: true, force: true });
    });

    test("--listar no extrae nada; solo considera contenedores Matroska", async () => {
        expect(await correr({ listar: true })).toBe(0);
        expect(extraidas()).toEqual([]);
        expect(llamadas.at(-1)![0]!.args).toEqual(["--identify-verbose", join(dir, MKV)]);
    });

    test("--pista y --adjuntos: un mkvextract tracks y uno attachments, junto al MKV", async () => {
        expect(await correr({ pistas: ["2", "3"], adjuntos: true })).toBe(0);
        expect(extraidas()).toEqual(["tracks", "attachments"]);
        expect(readdirSync(dir).sort()).toEqual([
            MKV,
            "Arial Regular.ttf",
            "[G] Serie - 04 [1080p] - 2 subs eng Signs_ _Op_ #1 [x]_y.ass",
            "[G] Serie - 04 [1080p] - 3 subs spa.ass",
            "otro.mp4",
        ].sort());
    });

    test("solo adjuntos: no llama a tracks", async () => {
        expect(await correr({ adjuntos: true })).toBe(0);
        expect(extraidas()).toEqual(["attachments"]);
    });

    test("pista inexistente o sin elegir nada sin terminal: error con el contenido", async () => {
        await expect(correr({ pistas: ["9"] })).rejects.toThrow("--pista 9");
        await expect(correr({})).rejects.toThrow("2 subs · ASS · eng");
        expect(extraidas()).toEqual([]);
    });

    test("destino existente: error sin -f (antes de extraer); con -f se sobrescribe", async () => {
        writeFileSync(join(dir, "Arial Regular.ttf"), "previo");
        await expect(correr({ adjuntos: true })).rejects.toThrow("--forzar");
        expect(extraidas()).toEqual([]);
        expect(await correr({ adjuntos: true, forzar: true })).toBe(0);
        expect(existsSync(join(dir, "Arial Regular.ttf"))).toBe(true);
    });

    test("mkvextract con error (código 2): error con su salida", async () => {
        const fallido: Ejecutor = {
            ejecutar: async (comandos, opciones) =>
                comandos[0]!.exe === "mkvextract" ? { codigo: 2, stderr: "", stdout: "Error: falla simulada" } : ejecutor.ejecutar(comandos, opciones),
        };
        await expect(extraerMkv({ dir, adjuntos: true }, { ejecutor: fallido, herramientas: { mkvmerge: "mkvmerge", mkvextract: "mkvextract" } })).rejects.toThrow("falla simulada");
    });

    test("varios MKV sin --video ni terminal: hay que indicar cuál", async () => {
        mkdirSync(join(dir, "sub"));
        writeFileSync(join(dir, "b.mka"), "");
        await expect(correr({ adjuntos: true })).rejects.toThrow("--video");
    });
});
