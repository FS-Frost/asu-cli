import type { ASSFile, Line, Style } from "@fs-frost/asu";

export type ModoReescalado = "estirar" | "bandas";

export const MODOS_REESCALADO: readonly ModoReescalado[] = ["estirar", "bandas"];

export type Resolucion = {
    ancho: number;
    alto: number;
};

export function resolucionATexto(resolucion: Resolucion): string {
    return `${resolucion.ancho}x${resolucion.alto}`;
}

/** PlayRes efectivo del script. Si falta, aplica los valores por defecto de ASS (como libass). */
export function playResDe(ass: ASSFile): Resolucion {
    const x = Number(ass.scriptInfo.properties.get("PlayResX"));
    const y = Number(ass.scriptInfo.properties.get("PlayResY"));
    const valido = (n: number) => Number.isFinite(n) && n > 0;

    if (valido(x) && valido(y)) {
        return { ancho: x, alto: y };
    }

    if (!valido(x) && !valido(y)) {
        return { ancho: 384, alto: 288 };
    }

    if (!valido(x)) {
        return { ancho: y === 1024 ? 1280 : Math.round((y * 4) / 3), alto: y };
    }

    return { ancho: x, alto: x === 1280 ? 1024 : Math.round((x * 3) / 4) };
}

export function mismaResolucion(a: Resolucion, b: Resolucion): boolean {
    return a.ancho === b.ancho && a.alto === b.alto;
}

export function mismaProporcion(a: Resolucion, b: Resolucion): boolean {
    return a.ancho * b.alto === b.ancho * a.alto;
}

/** Cómo cambia cada clase de valor al pasar de una resolución a otra. */
export type Transformacion = {
    /** Posición absoluta: v · factorX + desplazamientoX. */
    factorX: number;
    factorY: number;
    desplazamientoX: number;
    desplazamientoY: number;
    /** Tamaños que escalan junto con la fuente: \fs, \pbo, \fsp, dibujos \p, Fontsize, Spacing. */
    tamano: number;
    /**
     * Borde, sombra y \blur. Valen 1 si ScaledBorderAndShadow ≠ yes: en ese modo se miden
     * en píxeles del video, no del script, y cambiar el PlayRes no los afecta.
     */
    bordeX: number;
    bordeY: number;
    borde: number;
    /** Factor sobre \fscx y ScaleX del estilo, para conservar el ancho visual al estirar. */
    fscx: number;
};

export function calcularTransformacion(
    origen: Resolucion,
    destino: Resolucion,
    modo: ModoReescalado,
    escalarBordes: boolean,
): Transformacion {
    const rx = destino.ancho / origen.ancho;
    const ry = destino.alto / origen.alto;

    if (modo === "bandas") {
        const s = Math.min(rx, ry);
        return {
            factorX: s,
            factorY: s,
            desplazamientoX: (destino.ancho - origen.ancho * s) / 2,
            desplazamientoY: (destino.alto - origen.alto * s) / 2,
            tamano: s,
            bordeX: escalarBordes ? s : 1,
            bordeY: escalarBordes ? s : 1,
            borde: escalarBordes ? s : 1,
            fscx: 1,
        };
    }

    // Estirar: la letra crece con el alto (ry) y \fscx compensa el ancho, así el ancho visual escala por rx.
    return {
        factorX: rx,
        factorY: ry,
        desplazamientoX: 0,
        desplazamientoY: 0,
        tamano: ry,
        bordeX: escalarBordes ? rx : 1,
        bordeY: escalarBordes ? ry : 1,
        borde: escalarBordes ? ry : 1,
        fscx: rx / ry,
    };
}

/** Redondea y quita ceros sobrantes ("1.500" → "1.5", "-0" → "0"). */
export function formatearNumero(valor: number, decimales = 3): string {
    return String(Number(valor.toFixed(decimales)) || 0);
}

const NUMERO = /-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/gi;

/** Aplica `fx` a las coordenadas X y `fy` a las Y de un dibujo ASS ("m 0 0 l 10 20 ..."). */
export function transformarDibujo(dibujo: string, fx: (v: number) => number, fy: (v: number) => number): string {
    let indice = 0;
    return dibujo.replace(NUMERO, (numero) => {
        const transformar = indice++ % 2 === 0 ? fx : fy;
        return formatearNumero(transformar(Number(numero)));
    });
}

function posX(t: Transformacion, v: number): number {
    return v * t.factorX + t.desplazamientoX;
}

function posY(t: Transformacion, v: number): number {
    return v * t.factorY + t.desplazamientoY;
}

function transformarArgumentosPosicion(argumentos: string[], t: Transformacion, cantidad: number): string[] {
    return argumentos.map((argumento, i) => {
        const valor = Number(argumento.trim());
        if (i >= cantidad || !Number.isFinite(valor) || argumento.trim() === "") {
            return argumento;
        }

        return formatearNumero(i % 2 === 0 ? posX(t, valor) : posY(t, valor));
    });
}

function transformarClip(argumentos: string, t: Transformacion): string {
    const partes = argumentos.split(",");
    const esNumero = (texto: string) => texto.trim() !== "" && Number.isFinite(Number(texto.trim()));

    // Rectangular: \clip(x1,y1,x2,y2).
    if (partes.length === 4 && partes.every(esNumero)) {
        return transformarArgumentosPosicion(partes, t, 4).join(",");
    }

    // Vectorial: \clip([escala,]dibujo). Las coordenadas están multiplicadas por 2^(escala-1).
    const tieneEscala = partes.length >= 2 && esNumero(partes[0]!);
    const escala = tieneEscala ? Number(partes[0]!.trim()) : 1;
    const dibujo = tieneEscala ? partes.slice(1).join(",") : argumentos;

    const k = 2 ** Math.max(escala - 1, 0);
    const nuevo = transformarDibujo(dibujo, (v) => posX(t, v / k) * k, (v) => posY(t, v / k) * k);
    return tieneEscala ? `${partes[0]},${nuevo}` : nuevo;
}

const TAGS_CON_PARENTESIS = /\\(pos|org|move|i?clip)\(([^)]*)\)/g;
const TAGS_NUMERICOS = /\\(xbord|ybord|bord|xshad|yshad|shad|blur|pbo|fscx|fsp|fs)(-?(?:\d+\.?\d*|\.\d+))/g;

/** Reescala los tags de un bloque `{...}` (incluye los anidados en \t). */
export function transformarBloque(bloque: string, t: Transformacion): string {
    const conParentesis = bloque.replace(TAGS_CON_PARENTESIS, (_, nombre: string, argumentos: string) => {
        if (nombre === "pos" || nombre === "org") {
            return `\\${nombre}(${transformarArgumentosPosicion(argumentos.split(","), t, 2).join(",")})`;
        }

        if (nombre === "move") {
            return `\\move(${transformarArgumentosPosicion(argumentos.split(","), t, 4).join(",")})`;
        }

        return `\\${nombre}(${transformarClip(argumentos, t)})`;
    });

    return conParentesis.replace(TAGS_NUMERICOS, (_, nombre: string, valor: string) => {
        const factores: Record<string, number> = {
            fs: t.tamano,
            fsp: t.tamano,
            pbo: t.tamano,
            blur: t.borde,
            bord: t.borde,
            shad: t.borde,
            xbord: t.bordeX,
            xshad: t.bordeX,
            ybord: t.bordeY,
            yshad: t.bordeY,
            fscx: t.fscx,
        };
        return `\\${nombre}${formatearNumero(Number(valor) * factores[nombre]!)}`;
    });
}

/** Reescala el texto de una línea: bloques de tags y, mientras \p > 0, los dibujos. */
export function transformarContenido(contenido: string, t: Transformacion): string {
    let nivelDibujo = 0;

    return contenido.replace(/(\{[^}]*\})|([^{]+)/g, (_, bloque: string | undefined, texto: string | undefined) => {
        if (bloque !== undefined) {
            for (const coincidencia of bloque.matchAll(/\\p(\d+)/g)) {
                nivelDibujo = Number(coincidencia[1]);
            }

            return transformarBloque(bloque, t);
        }

        // Los dibujos son relativos a \pos y crecen como la fuente (el ancho lo compensa \fscx).
        return nivelDibujo > 0 ? transformarDibujo(texto!, (v) => v * t.tamano, (v) => v * t.tamano) : texto!;
    });
}

function margenX(t: Transformacion, margen: number): number {
    return Math.round(margen * t.factorX + t.desplazamientoX);
}

function margenY(t: Transformacion, margen: number): number {
    return Math.round(margen * t.factorY + t.desplazamientoY);
}

export function transformarEstilo(estilo: Style, t: Transformacion): Style {
    return {
        ...estilo,
        fontSize: Math.max(1, Math.round(estilo.fontSize * t.tamano)),
        scaleX: Number((estilo.scaleX * t.fscx).toFixed(2)),
        spacing: Number((estilo.spacing * t.tamano).toFixed(3)),
        outline: Number((estilo.outline * t.borde).toFixed(3)),
        shadow: Number((estilo.shadow * t.borde).toFixed(3)),
        marginLeft: margenX(t, estilo.marginLeft),
        marginRight: margenX(t, estilo.marginRight),
        marginVertical: margenY(t, estilo.marginVertical),
    };
}

export function transformarLinea(linea: Line, t: Transformacion): Line {
    // Margen 0 en la línea significa "usar el del estilo": no se toca.
    return {
        ...linea,
        start: { ...linea.start },
        end: { ...linea.end },
        marginLeft: linea.marginLeft === 0 ? 0 : margenX(t, linea.marginLeft),
        marginRight: linea.marginRight === 0 ? 0 : margenX(t, linea.marginRight),
        marginVertical: linea.marginVertical === 0 ? 0 : margenY(t, linea.marginVertical),
        content: transformarContenido(linea.content, t),
    };
}

export type ResultadoReescalado = {
    ass: ASSFile;
    origen: Resolucion;
    transformacion: Transformacion;
};

/** Copia de `ass` reescalada a `destino`. El original no se modifica. */
export function reescalarASS(ass: ASSFile, destino: Resolucion, modo: ModoReescalado): ResultadoReescalado {
    const origen = playResDe(ass);
    const escalarBordes = ass.scriptInfo.properties.get("ScaledBorderAndShadow")?.trim().toLowerCase() === "yes";
    const t = calcularTransformacion(origen, destino, modo, escalarBordes);

    const propiedades = new Map(ass.scriptInfo.properties);
    propiedades.set("PlayResX", String(destino.ancho));
    propiedades.set("PlayResY", String(destino.alto));
    if (propiedades.has("LayoutResX") || propiedades.has("LayoutResY")) {
        propiedades.set("LayoutResX", String(destino.ancho));
        propiedades.set("LayoutResY", String(destino.alto));
    }

    return {
        origen,
        transformacion: t,
        ass: {
            ...ass,
            scriptInfo: { comments: [...ass.scriptInfo.comments], properties: propiedades },
            styles: { ...ass.styles, styles: ass.styles.styles.map((estilo) => transformarEstilo(estilo, t)) },
            events: { ...ass.events, lines: ass.events.lines.map((linea) => transformarLinea(linea, t)) },
        },
    };
}
