import { createReadStream } from "node:fs";
import { crc32 } from "node:zlib";
import { formatearCrc } from "./nucleo/nombres.ts";

/**
 * CRC32 de un archivo (8 hex en mayúsculas), leído por trozos para no cargarlo entero en memoria.
 * `alAvance` recibe los bytes leídos hasta ahora.
 */
export async function crc32Archivo(ruta: string, alAvance?: (bytes: number) => void): Promise<string> {
    let crc = 0;
    let bytes = 0;
    for await (const trozo of createReadStream(ruta, { highWaterMark: 4 * 1024 * 1024 })) {
        crc = crc32(trozo as Buffer, crc);
        bytes += (trozo as Buffer).length;
        alAvance?.(bytes);
    }
    return formatearCrc(crc);
}
