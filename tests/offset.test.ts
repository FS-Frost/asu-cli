import { describe, expect, test } from "bun:test";
import {
    argumentosMkvmerge,
    desplazamientoMs,
    nombreCorregido,
    parsearInicioVideo,
    parsearPistasVideo,
} from "../src/nucleo/offset.ts";

describe("nombreCorregido", () => {
    test("agrega [fixed] y quita la extensión, sea cual sea el contenedor", () => {
        expect(nombreCorregido("C:\\raw\\Minami-ke - S01E01.mkv")).toBe("Minami-ke - S01E01 [fixed]");
        expect(nombreCorregido("C:\\raw\\ep.02.mp4")).toBe("ep.02 [fixed]");
    });
});

describe("parsearInicioVideo", () => {
    test("lee start_time del primer stream", () => {
        expect(parsearInicioVideo('{"programs":[],"streams":[{"index":0,"start_time":"0.043000"}]}')).toBe(0.043);
    });

    test("sin streams o sin start_time devuelve undefined", () => {
        expect(parsearInicioVideo('{"streams":[]}')).toBeUndefined();
        expect(parsearInicioVideo('{"streams":[{"index":0}]}')).toBeUndefined();
    });
});

describe("parsearPistasVideo", () => {
    test("solo las pistas de video de mkvmerge --identify", () => {
        const salida =
            "File 'a.mkv': container: Matroska\r\n" +
            "Track ID 0: video (MPEG-H/HEVC/h.265)\r\n" +
            "Track ID 1: audio (AAC)\r\n" +
            "Track ID 2: subtitles (SubStationAlpha)\r\n" +
            "Attachment ID 1: type 'font/otf', size 1 bytes, file name 'video.otf'\r\n";

        expect(parsearPistasVideo(salida)).toEqual([0]);
    });
});

describe("desplazamientoMs", () => {
    test("negativo para un video que empieza tarde", () => {
        expect(desplazamientoMs(0.043)).toBe(-43);
    });

    test("trunca hacia cero sin errores de coma flotante", () => {
        expect(desplazamientoMs(0.029)).toBe(-29);
        expect(desplazamientoMs(0.041708)).toBe(-41);
    });

    test("positivo para un video que empieza antes de 0", () => {
        expect(desplazamientoMs(-0.083)).toBe(83);
    });

    test("menos de 1 ms es 0", () => {
        expect(desplazamientoMs(0)).toBe(0);
        expect(desplazamientoMs(0.0004)).toBe(0);
    });
});

describe("argumentosMkvmerge", () => {
    test("desplaza solo la pista de video", () => {
        expect(argumentosMkvmerge("in.mp4", "out.mkv", 1, -43)).toEqual(["-o", "out.mkv", "--sync", "1:-43", "in.mp4"]);
    });
});
