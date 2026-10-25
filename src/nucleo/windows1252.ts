// AviSynth+ 3.5 lee los scripts en la página de códigos ANSI del sistema (1252).

// Caracteres Unicode que Windows-1252 ubica en 0x80–0x9F.
const RANGO_ESPECIAL: ReadonlyMap<number, number> = new Map([
    [0x20AC, 0x80], [0x201A, 0x82], [0x0192, 0x83], [0x201E, 0x84],
    [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87], [0x02C6, 0x88],
    [0x2030, 0x89], [0x0160, 0x8A], [0x2039, 0x8B], [0x0152, 0x8C],
    [0x017D, 0x8E], [0x2018, 0x91], [0x2019, 0x92], [0x201C, 0x93],
    [0x201D, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
    [0x02DC, 0x98], [0x2122, 0x99], [0x0161, 0x9A], [0x203A, 0x9B],
    [0x0153, 0x9C], [0x017E, 0x9E], [0x0178, 0x9F],
]);

function aByte(puntoDeCodigo: number): number | undefined {
    if (puntoDeCodigo < 0x80 || (puntoDeCodigo >= 0xA0 && puntoDeCodigo <= 0xFF)) {
        return puntoDeCodigo;
    }

    return RANGO_ESPECIAL.get(puntoDeCodigo);
}

/** Caracteres de `texto` que no existen en Windows-1252, sin repetir. */
export function caracteresFuera1252(texto: string): string[] {
    const fuera = new Set<string>();
    for (const caracter of texto) {
        if (aByte(caracter.codePointAt(0)!) === undefined) {
            fuera.add(caracter);
        }
    }

    return [...fuera];
}

/** Codifica `texto` en Windows-1252. Lanza un error si algún carácter no es representable. */
export function codificarWindows1252(texto: string): Uint8Array {
    const fuera = caracteresFuera1252(texto);
    if (fuera.length > 0) {
        throw new Error(`Caracteres no representables en Windows-1252: ${fuera.join(" ")}`);
    }

    const bytes: number[] = [];
    for (const caracter of texto) {
        bytes.push(aByte(caracter.codePointAt(0)!)!);
    }

    return Uint8Array.from(bytes);
}
