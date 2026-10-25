// Codificación de adjuntos de la sección [Fonts] de un .ass: variante de UUencode
// donde cada carácter es un valor de 6 bits + 33. Grupos de 4 caracteres → 3 bytes;
// el último grupo puede tener 2 caracteres (1 byte) o 3 (2 bytes).

/** Decodifica las líneas de datos de un adjunto de un .ass. */
export function decodificarAdjunto(lineas: readonly string[]): Uint8Array {
    const texto = lineas.join("").trim();
    const bytes: number[] = [];

    for (let i = 0; i < texto.length; i += 4) {
        const grupo = texto.slice(i, i + 4);
        const valores = [...grupo].map((caracter) => (caracter.charCodeAt(0) - 33) & 0x3F);
        const [a = 0, b = 0, c = 0, d = 0] = valores;
        const bits = (a << 18) | (b << 12) | (c << 6) | d;

        bytes.push((bits >> 16) & 0xFF);
        if (grupo.length >= 3) {
            bytes.push((bits >> 8) & 0xFF);
        }
        if (grupo.length === 4) {
            bytes.push(bits & 0xFF);
        }
    }

    return Uint8Array.from(bytes);
}

/** Codifica bytes al formato de adjunto de un .ass, en líneas de hasta 80 caracteres. */
export function codificarAdjunto(datos: Uint8Array): string[] {
    let texto = "";

    for (let i = 0; i < datos.length; i += 3) {
        const cantidad = Math.min(3, datos.length - i);
        const bits = ((datos[i] ?? 0) << 16) | ((datos[i + 1] ?? 0) << 8) | (datos[i + 2] ?? 0);
        const valores = [(bits >> 18) & 0x3F, (bits >> 12) & 0x3F, (bits >> 6) & 0x3F, bits & 0x3F];
        texto += valores
            .slice(0, cantidad + 1)
            .map((valor) => String.fromCharCode(valor + 33))
            .join("");
    }

    const lineas: string[] = [];
    for (let i = 0; i < texto.length; i += 80) {
        lineas.push(texto.slice(i, i + 80));
    }

    return lineas;
}
