export const FPS_NUMERADOR = 24000;
export const FPS_DENOMINADOR = 1001;

export const NOMBRE_AVS_TRABAJO = "RAW.avs";

// RAW.avs conserva threads=1 para seguir idéntico al exe original.
const FUENTE_VIDEO = `threads=1, fpsnum=${FPS_NUMERADOR}, fpsden=${FPS_DENOMINADOR}, colorspace="YV12"`;

// Compresión: threads=-1 decodifica en todos los núcleos; duplicó la entrada del 720 (71 → 141 fps)
// con frames idénticos (comparados por hash).
const FUENTE_VIDEO_COMPRESION = `threads=-1, fpsnum=${FPS_NUMERADOR}, fpsden=${FPS_DENOMINADOR}, colorspace="YV12"`;

/**
 * Contenido de RAW.avs, idéntico byte a byte al del exe original:
 * `WriteLine` agrega "\r\n" y las líneas que empiezan con "\n" dejan un LF suelto.
 */
export function generarAvsTrabajo(rutaVideo: string): string {
    const lineas = [
        `raw="${rutaVideo}"`,
        `video=FFVideoSource(raw, ${FUENTE_VIDEO})`,
        "\naudio=FFAudioSource(raw)",
        "\nAudioDub(video, audio)",
    ];

    return lineas.map((linea) => `${linea}\r\n`).join("");
}

/** Contenido del AVS de compresión: video sin audio, redimensión y un `textsub` por subtítulo, en orden. */
export function generarAvsCompresion(rutaVideo: string, ancho: number, alto: number, rutasSubtitulos: readonly string[]): string {
    const lineas = [
        `FFVideoSource("${rutaVideo}", ${FUENTE_VIDEO_COMPRESION})`,
        `spline64Resize(${ancho},${alto})`,
        ...rutasSubtitulos.map((ruta) => `textsub("${ruta}")`),
    ];

    return lineas.map((linea) => `${linea}\r\n`).join("");
}
