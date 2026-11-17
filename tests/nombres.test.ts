import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { crc32 } from "node:zlib";
import { archivosDeCarpeta, revisarArchivos, verificarCrc } from "../src/comandos/crc.ts";
import { crc32Archivo } from "../src/crc.ts";
import {
    conCrc,
    crcDelNombre,
    deducirSerieEpisodio,
    esMismoFinal,
    formatearCrc,
    nombreAvs,
    nombreFinal,
    normalizarEpisodio,
    serieEpisodioDeCarpetas,
    serieEpisodioDeRaw,
} from "../src/nucleo/nombres.ts";
import { directorioTemporal } from "./utilidades.ts";

describe("CRC en el nombre", () => {
    const FINAL = "[SyncRajo] Serie - 01 (HDTV 1920x1080).mp4";

    test("formatearCrc: 8 hex en mayúsculas, con ceros a la izquierda", () => {
        expect(formatearCrc(0xacdf4206)).toBe("ACDF4206");
        expect(formatearCrc(0x1f)).toBe("0000001F");
        expect(formatearCrc(-1)).toBe("FFFFFFFF");
    });

    test("conCrc y crcDelNombre", () => {
        expect(conCrc(FINAL, "ACDF4206")).toBe("[SyncRajo] Serie - 01 (HDTV 1920x1080) [ACDF4206].mp4");
        expect(conCrc(join("C:\\Encode", FINAL), "ACDF4206")).toBe(join("C:\\Encode", "[SyncRajo] Serie - 01 (HDTV 1920x1080) [ACDF4206].mp4"));
        expect(crcDelNombre("[Grupo] Serie - 01 [1080p][acdf4206].mkv")).toBe("ACDF4206");
        expect(crcDelNombre("[Grupo] Serie - 01 (HDTV 1920x1080) [ACDF4206].mp4")).toBe("ACDF4206");
        // El grupo al inicio o una etiqueta que no es CRC no cuentan.
        expect(crcDelNombre("[ABCDEF12] Serie - 01.mp4")).toBeNull();
        expect(crcDelNombre("[Grupo] Serie - 01 [1080p].mkv")).toBeNull();
        expect(crcDelNombre(FINAL)).toBeNull();
    });

    test("esMismoFinal: el mismo nombre sin CRC o con cualquier CRC, sin distinguir mayúsculas", () => {
        expect(esMismoFinal(FINAL, FINAL)).toBe(true);
        expect(esMismoFinal("[SyncRajo] Serie - 01 (HDTV 1920x1080) [DEADBEEF].mp4", FINAL)).toBe(true);
        expect(esMismoFinal("[syncrajo] serie - 01 (hdtv 1920x1080) [deadbeef].MP4", FINAL)).toBe(true);
        expect(esMismoFinal("[SyncRajo] Serie - 01 (HDTV 1280x720) [DEADBEEF].mp4", FINAL)).toBe(false);
        expect(esMismoFinal("[SyncRajo] Serie - 01 (HDTV 1920x1080) [DEADBEEF].avi", FINAL)).toBe(false);
        expect(esMismoFinal("[SyncRajo] Serie - 01 (HDTV 1920x1080) [v2].mp4", FINAL)).toBe(false);
        expect(esMismoFinal("[SyncRajo] Serie - 01 (HDTV 1920x1080)[DEADBEEF].mp4", FINAL)).toBe(false);
    });
});

describe("crc32Archivo y asu crc", () => {
    let dir: string;
    const entorno = { ...process.env };
    // Más de un trozo de lectura (4 MiB) para probar el cálculo incremental.
    const contenido = Buffer.alloc(9 * 1024 * 1024 + 123, 7);
    const crc = formatearCrc(crc32(contenido));

    beforeEach(() => {
        dir = directorioTemporal();
        process.env.ASU_CLI_NO_INTERACTIVO = "1";
    });

    afterEach(() => {
        process.env = { ...entorno };
        rmSync(dir, { recursive: true, force: true });
    });

    test("crc32Archivo por trozos da lo mismo que de una vez", async () => {
        const ruta = join(dir, "a.bin");
        writeFileSync(ruta, contenido);
        expect(await crc32Archivo(ruta)).toBe(crc);
    });

    test("carpeta: OK si coincide, código 1 si alguno no; los sin CRC se ignoran; sin archivos, código 1", async () => {
        writeFileSync(join(dir, `bueno [${crc}].mp4`), contenido);
        writeFileSync(join(dir, "sin crc.mp4"), "x");
        expect(await verificarCrc({ rutas: [dir] })).toBe(0);

        writeFileSync(join(dir, "malo [DEADBEEF].mp4"), contenido);
        expect(await verificarCrc({ rutas: [dir] })).toBe(1);

        const vacia = join(dir, "vacia");
        mkdirSync(vacia);
        expect(await verificarCrc({ rutas: [vacia] })).toBe(1);
    });

    test("calcular (elegidos): archivos de la carpeta sin subcarpetas; con CRC se compara, sin CRC solo se calcula", async () => {
        writeFileSync(join(dir, "b sin crc.mp4"), "x");
        writeFileSync(join(dir, `a [${crc}].mp4`), contenido);
        mkdirSync(join(dir, "subcarpeta"));
        expect(archivosDeCarpeta(dir).map((ruta) => ruta.slice(dir.length + 1))).toEqual([`a [${crc}].mp4`, "b sin crc.mp4"]);

        expect(await revisarArchivos(archivosDeCarpeta(dir))).toBe(0);
        writeFileSync(join(dir, "c [DEADBEEF].mp4"), "x");
        expect(await revisarArchivos(archivosDeCarpeta(dir))).toBe(1);
    });

    test("archivo indicado sin CRC en el nombre: solo informa (código 0); ruta inexistente: error", async () => {
        writeFileSync(join(dir, "sin crc.mp4"), "x");
        expect(await verificarCrc({ rutas: [join(dir, "sin crc.mp4")] })).toBe(0);
        await expect(verificarCrc({ rutas: [join(dir, "no-existe")] })).rejects.toThrow("No existe");
    });
});

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
