import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
    deducirSerieEpisodio,
    nombreAvs,
    nombreFinal,
    normalizarEpisodio,
    serieEpisodioDeCarpetas,
    serieEpisodioDeRaw,
} from "../src/nucleo/nombres.ts";

describe("serieEpisodioDeRaw", () => {
    test("formato habitual: quita el grupo y las etiquetas finales, conserva el año", () => {
        expect(serieEpisodioDeRaw("[Grupo] Serie Inventada (2026) - 04 [1080p WEB-DL AVC AAC][MultiSub][ABCD1234].mkv")).toEqual({
            serie: "Serie Inventada (2026)",
            episodio: "04",
        });
    });

    test("episodio de 1 dígito se completa a 2; versión y paréntesis finales se ignoran", () => {
        expect(serieEpisodioDeRaw("[G] Otra Serie - 4v2 (1080p).mp4")).toEqual({ serie: "Otra Serie", episodio: "04" });
        expect(serieEpisodioDeRaw("Sin Grupo - 12.mkv")).toEqual({ serie: "Sin Grupo", episodio: "12" });
    });

    test("no calza sin ' - NN'", () => {
        expect(serieEpisodioDeRaw("Serie_04_BD.mkv")).toBeNull();
        expect(serieEpisodioDeRaw("video.mkv")).toBeNull();
    });
});

describe("serieEpisodioDeCarpetas", () => {
    test("serie = carpeta padre, episodio = carpeta numérica", () => {
        expect(serieEpisodioDeCarpetas(join("C:\\Proyectos", "Serie Inventada (2026)", "4"))).toEqual({
            serie: "Serie Inventada (2026)",
            episodio: "04",
        });
    });

    test("carpeta no numérica no sirve", () => {
        expect(serieEpisodioDeCarpetas(join("C:\\Proyectos", "Serie", "extras"))).toBeNull();
    });

    test("el raw tiene prioridad; si no calza, se usan las carpetas", () => {
        const dir = join("C:\\Proyectos", "Serie Carpeta", "07");
        expect(deducirSerieEpisodio(join(dir, "[G] Serie Raw - 03 [x].mkv"), dir)).toEqual({ serie: "Serie Raw", episodio: "03" });
        expect(deducirSerieEpisodio(join(dir, "raw.mkv"), dir)).toEqual({ serie: "Serie Carpeta", episodio: "07" });
    });
});

describe("nombres de archivo", () => {
    const datos = { serie: "Serie Inventada (2026)", episodio: "04" };

    test(".avs: <serie> <ep> <etiqueta>.avs", () => {
        expect(nombreAvs(datos, "MP4 1080")).toBe("Serie Inventada (2026) 04 MP4 1080.avs");
        expect(nombreAvs(datos, "AVI")).toBe("Serie Inventada (2026) 04 AVI.avs");
    });

    test("final: [grupo] serie - ep (fuente AxB)", () => {
        expect(nombreFinal({ ...datos, grupo: "SyncRajo", fuente: "HDTV", ancho: 1920, alto: 1080 })).toBe(
            "[SyncRajo] Serie Inventada (2026) - 04 (HDTV 1920x1080)",
        );
        expect(nombreFinal({ ...datos, grupo: "SyncRajo", fuente: "BD", ancho: 704, alto: 396 })).toBe(
            "[SyncRajo] Serie Inventada (2026) - 04 (BD 704x396)",
        );
    });

    test("normalizarEpisodio", () => {
        expect(normalizarEpisodio("1")).toBe("01");
        expect(normalizarEpisodio("123")).toBe("123");
        expect(normalizarEpisodio("OVA")).toBeNull();
    });
});
