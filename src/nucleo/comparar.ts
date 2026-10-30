// Lógica pura de `asu comparar`: tramos, análisis de contenido, capturas, métricas, CRF igualado y caché.
import { createHash } from "node:crypto";

export type Tramo = {
    inicio: number;
    duracion: number;
};

export type MotivoTramo = "oscuro" | "movimiento" | "detalle" | "fijo" | "manual";

export type TramoElegido = Tramo & {
    motivo: MotivoTramo;
    /** Valor de la medida que lo eligió (luminancia, movimiento o entropía media). */
    valor?: number;
};

export const DURACION_TRAMO = 20;
export const POSICIONES_TRAMO: readonly number[] = [0.25, 0.5, 0.75];

/** "05:30", "1:05:30" o "330.5" → segundos. `null` si no es válido. */
export function parsearTiempo(texto: string): number | null {
    const partes = texto.trim().split(":");
    if (partes.length > 3 || partes.some((parte) => !/^\d+(?:\.\d+)?$/.test(parte))) {
        return null;
    }

    return partes.reduce((total, parte) => total * 60 + Number(parte), 0);
}

/** "05:30-05:50" → { inicio: 330, duracion: 20 }. */
export function parsearTramo(texto: string): Tramo | null {
    const [desde, hasta, ...resto] = texto.split("-");
    if (desde === undefined || hasta === undefined || resto.length > 0) {
        return null;
    }

    const inicio = parsearTiempo(desde);
    const fin = parsearTiempo(hasta);
    if (inicio === null || fin === null || fin <= inicio) {
        return null;
    }

    return { inicio, duracion: fin - inicio };
}

/** 3 tramos de 20 s centrados al 25, 50 y 75 % del episodio (más cortos si el video lo es). */
export function tramosPorDefecto(duracionTotal: number): Tramo[] {
    const largo = Math.min(DURACION_TRAMO, duracionTotal / POSICIONES_TRAMO.length);
    return POSICIONES_TRAMO.map((posicion) => ({
        inicio: Math.max(0, Math.min(duracionTotal - largo, duracionTotal * posicion - largo / 2)),
        duracion: largo,
    }));
}

/** "mm:ss" o "h:mm:ss" para mostrar. */
export function formatearTiempo(segundos: number): string {
    const total = Math.floor(segundos);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = String(total % 60).padStart(2, "0");
    return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${String(m).padStart(2, "0")}:${s}`;
}

// ---- Tramos por contenido ----

export type EstadisticaFrame = {
    /** Segundo del frame. */
    t: number;
    /** Luminancia media (0-255). */
    luma: number;
    /** Diferencia media con el frame anterior (movimiento). */
    movimiento: number;
    /** Entropía normalizada de la luminancia (0-1): textura y detalle. */
    detalle: number;
};

/** Filtro de análisis: baja resolución, luminancia, movimiento y entropía por frame. */
export const FILTRO_ANALISIS = "scale=480:-2,signalstats,entropy,metadata=mode=print";

/**
 * Último `pts_time` completo de un trozo de la salida del análisis (para el avance), o null.
 * Un número cortado al final del trozo se ignora: el trozo siguiente trae otro.
 */
export function ultimoPtsTime(trozo: string): number | null {
    let ultimo: number | null = null;
    for (const coincidencia of trozo.matchAll(/pts_time:(-?[\d.]+)\s/g)) {
        ultimo = Number(coincidencia[1]);
    }
    return ultimo !== null && Number.isFinite(ultimo) ? ultimo : null;
}

/** "42 % (09:48 de 23:20, ×11, faltan ~01:15)": avance de un proceso que recorre `total` segundos de video. */
export function textoAvance(procesado: number, total: number, transcurrido: number): string {
    const hecho = Math.min(Math.max(procesado, 0), total);
    const porcentaje = total > 0 ? Math.floor((hecho / total) * 100) : 0;
    const velocidad = transcurrido > 0 ? hecho / transcurrido : 0;
    const detalle = [`${formatearTiempo(hecho)} de ${formatearTiempo(total)}`];
    if (velocidad > 0) {
        detalle.push(`×${velocidad >= 10 ? Math.round(velocidad) : velocidad.toFixed(1)}`, `faltan ~${formatearTiempo((total - hecho) / velocidad)}`);
    }
    return `${porcentaje} % (${detalle.join(", ")})`;
}

/** Estadísticas por frame de `metadata=print` (stderr de ffmpeg con FILTRO_ANALISIS). */
export function parsearAnalisis(salida: string): EstadisticaFrame[] {
    const frames: EstadisticaFrame[] = [];
    let actual: Partial<EstadisticaFrame> | null = null;
    const cerrar = () => {
        if (actual && actual.t !== undefined && actual.luma !== undefined && actual.movimiento !== undefined && actual.detalle !== undefined) {
            frames.push(actual as EstadisticaFrame);
        }
    };

    for (const linea of salida.split(/\r?\n|\r/)) {
        const tiempo = linea.match(/\bframe:\s*\d+\s+pts:\s*-?\d+\s+pts_time:(-?[\d.]+)/);
        if (tiempo) {
            cerrar();
            actual = { t: Number(tiempo[1]) };
            continue;
        }
        if (!actual) {
            continue;
        }

        const valor = linea.match(/lavfi\.(signalstats\.YAVG|signalstats\.YDIF|entropy\.normalized_entropy\.normal\.Y)=([\d.]+)/);
        if (valor) {
            const numero = Number(valor[2]);
            if (valor[1] === "signalstats.YAVG") actual.luma = numero;
            else if (valor[1] === "signalstats.YDIF") actual.movimiento = numero;
            else actual.detalle = numero;
        }
    }
    cerrar();

    return frames;
}

/** Luminancia media mínima para que un tramo cuente como "oscuro" y no como pantalla negra o fundido. */
export const LUMA_MINIMA_OSCURO = 20;

/**
 * 3 tramos de `largo` segundos que no se superponen: el más oscuro (sin contar negros), el de más
 * movimiento y el de más detalle. Se evalúan ventanas cada 1 s con el promedio por segundo.
 * Si el video es demasiado corto o no hay estadísticas, los tramos fijos (25/50/75 %).
 */
export function tramosPorContenido(estadisticas: readonly EstadisticaFrame[], duracionTotal: number, largo = DURACION_TRAMO): TramoElegido[] {
    const segundos = Math.floor(duracionTotal);
    if (estadisticas.length === 0 || segundos < largo * 3) {
        return tramosPorDefecto(duracionTotal).map((tramo) => ({ ...tramo, motivo: "fijo" as const }));
    }

    // Promedios por segundo.
    const suma = Array.from({ length: segundos }, () => ({ luma: 0, movimiento: 0, detalle: 0, n: 0 }));
    for (const frame of estadisticas) {
        const s = suma[Math.min(segundos - 1, Math.max(0, Math.floor(frame.t)))]!;
        s.luma += frame.luma;
        s.movimiento += frame.movimiento;
        s.detalle += frame.detalle;
        s.n++;
    }

    const ventanas: { inicio: number; luma: number; lumaMinima: number; movimiento: number; detalle: number }[] = [];
    for (let inicio = 0; inicio + largo <= segundos; inicio++) {
        const tramo = suma.slice(inicio, inicio + largo).filter((s) => s.n > 0);
        if (tramo.length === 0) {
            continue;
        }
        const media = (clave: "luma" | "movimiento" | "detalle") => tramo.reduce((t, s) => t + s[clave] / s.n, 0) / tramo.length;
        const lumaMinima = Math.min(...tramo.map((s) => s.luma / s.n));
        ventanas.push({ inicio, luma: media("luma"), lumaMinima, movimiento: media("movimiento"), detalle: media("detalle") });
    }

    const elegidos: TramoElegido[] = [];
    const libre = (inicio: number) => elegidos.every((e) => Math.abs(e.inicio - inicio) >= largo);
    const elegir = (motivo: "oscuro" | "movimiento" | "detalle", candidatos: typeof ventanas, puntaje: (v: (typeof ventanas)[number]) => number) => {
        const mejor = candidatos.filter((v) => libre(v.inicio)).sort((a, b) => puntaje(b) - puntaje(a))[0];
        if (mejor) {
            elegidos.push({ inicio: mejor.inicio, duracion: largo, motivo, valor: Number((motivo === "oscuro" ? mejor.luma : mejor[motivo]).toFixed(4)) });
        }
    };

    // Ni pantallas negras ni fundidos: ningún segundo de la ventana puede ser negro.
    const noNegras = ventanas.filter((v) => v.luma >= LUMA_MINIMA_OSCURO && v.lumaMinima >= LUMA_MINIMA_OSCURO / 2);
    elegir("oscuro", noNegras.length > 0 ? noNegras : ventanas, (v) => -v.luma);
    elegir("movimiento", ventanas, (v) => v.movimiento);
    elegir("detalle", ventanas, (v) => v.detalle);

    return elegidos.sort((a, b) => a.inicio - b.inicio);
}

// ---- Métricas ----

/** SSIM "All" de cada frame según `ssim=stats_file=-` (stdout), en orden. */
export function parsearSsimPorFrame(salida: string): number[] {
    return [...salida.matchAll(/^n:(\d+)\b.*?\bAll:([\d.]+|inf)/gm)]
        .sort((a, b) => Number(a[1]) - Number(b[1]))
        .map((coincidencia) => (coincidencia[2] === "inf" ? 1 : Number(coincidencia[2])));
}

export function parsearSsim(salida: string): number | null {
    const coincidencia = salida.match(/All:([\d.]+)/);
    return coincidencia ? Number(coincidencia[1]) : null;
}

export function parsearPsnr(salida: string): number | null {
    const coincidencia = salida.match(/average:([\d.]+|inf)/);
    return coincidencia ? (coincidencia[1] === "inf" ? Infinity : Number(coincidencia[1])) : null;
}

/** kbps de un archivo de `bytes` que dura `duracion` segundos. */
export function kbps(bytes: number, duracion: number): number {
    return Math.round((bytes * 8) / duracion / 1000);
}

export function promedio(valores: readonly (number | null)[]): number | null {
    const validos = valores.filter((valor): valor is number => valor !== null && Number.isFinite(valor));
    return validos.length === 0 ? null : validos.reduce((a, b) => a + b, 0) / validos.length;
}

// ---- Capturas ----

export type CapturaElegida = {
    /** Frame dentro del tramo, desde 0. */
    frame: number;
    /** "diferencia": donde las variantes más se separan; "minimo": donde alguna cae más. */
    motivo: "diferencia" | "minimo";
    /** Diferencia de SSIM entre variantes, o la SSIM mínima. */
    valor: number;
};

/**
 * Frames a capturar a partir de la SSIM por frame de cada variante (mismas posiciones):
 * la mitad donde las variantes más difieren y el resto donde alguna cae más, sin repetir y
 * separados al menos `separacion` frames (si no alcanzan, se relaja la separación).
 */
export function elegirCapturasMezcla(ssimPorVariante: readonly (readonly number[])[], cantidad: number, separacion = 24): CapturaElegida[] {
    const total = Math.min(...ssimPorVariante.map((serie) => serie.length));
    if (!Number.isFinite(total) || total === 0 || cantidad <= 0) {
        return [];
    }

    const frames = Array.from({ length: total }, (_, n) => {
        const valores = ssimPorVariante.map((serie) => serie[n]!);
        return { n, diferencia: Math.max(...valores) - Math.min(...valores), minimo: Math.min(...valores) };
    });

    const porDiferencia = [...frames].sort((a, b) => b.diferencia - a.diferencia || a.n - b.n);
    const porMinimo = [...frames].sort((a, b) => a.minimo - b.minimo || a.n - b.n);
    const deDiferencia = Math.ceil(cantidad / 2);

    for (const minima of [separacion, 0]) {
        const elegidas: CapturaElegida[] = [];
        const tomar = (lista: typeof frames, motivo: CapturaElegida["motivo"], hasta: number) => {
            for (const f of lista) {
                if (elegidas.length >= hasta) return;
                if (elegidas.every((e) => Math.abs(e.frame - f.n) > minima)) {
                    elegidas.push({ frame: f.n, motivo, valor: Number((motivo === "diferencia" ? f.diferencia : f.minimo).toFixed(6)) });
                }
            }
        };
        tomar(porDiferencia, "diferencia", deDiferencia);
        tomar(porMinimo, "minimo", cantidad);
        if (elegidas.length >= Math.min(cantidad, total)) {
            return elegidas.sort((a, b) => a.frame - b.frame);
        }
    }

    return [];
}

/** Expresión de `select` de ffmpeg para extraer varios frames por número. */
export function filtroSeleccion(frames: readonly number[]): string {
    return `select='${frames.map((n) => `eq(n\\,${n})`).join("+")}'`;
}

// ---- CRF igualado ----

export type PruebaCrf = { crf: number; kbps: number };

/**
 * Busca el CRF cuyo bitrate queda a ±`tolerancia` de `objetivo` (kbps). El bitrate baja al subir el
 * CRF de forma aproximadamente exponencial: primero se acota (pasos de 2) y luego se interpola en
 * log(kbps). Devuelve la mejor prueba aunque no llegue a la tolerancia en `maxPruebas`.
 */
export async function buscarCrfIgualado(
    medir: (crf: number) => Promise<number>,
    objetivo: number,
    inicial: number,
    opciones: { tolerancia?: number; maxPruebas?: number } = {},
): Promise<{ crf: number; kbps: number; pruebas: PruebaCrf[] }> {
    const tolerancia = opciones.tolerancia ?? 0.02;
    const maxPruebas = opciones.maxPruebas ?? 6;
    const pruebas: PruebaCrf[] = [];
    const cerca = (p: PruebaCrf) => Math.abs(p.kbps - objetivo) / objetivo;
    const redondear = (crf: number) => Math.min(51, Math.max(0, Math.round(crf * 10) / 10));

    let crf = redondear(inicial);
    while (pruebas.length < maxPruebas) {
        if (pruebas.some((p) => p.crf === crf)) {
            break;
        }

        const prueba = { crf, kbps: await medir(crf) };
        pruebas.push(prueba);
        if (cerca(prueba) <= tolerancia) {
            break;
        }

        // Más bitrate que el objetivo = CRF demasiado bajo.
        const altas = pruebas.filter((p) => p.kbps > objetivo).sort((a, b) => b.crf - a.crf);
        const bajas = pruebas.filter((p) => p.kbps <= objetivo).sort((a, b) => a.crf - b.crf);
        const alta = altas[0];
        const baja = bajas[0];

        if (alta && baja) {
            const fraccion = (Math.log(alta.kbps) - Math.log(objetivo)) / (Math.log(alta.kbps) - Math.log(baja.kbps));
            crf = redondear(alta.crf + (baja.crf - alta.crf) * fraccion);
            if (crf <= alta.crf || crf >= baja.crf) {
                crf = redondear((alta.crf + baja.crf) / 2);
            }
        } else {
            crf = redondear(prueba.crf + (prueba.kbps > objetivo ? 2 : -2));
        }
    }

    const mejor = [...pruebas].sort((a, b) => cerca(a) - cerca(b))[0]!;
    return { ...mejor, pruebas };
}

// ---- Caché ----

/** Clave de un clip en la caché: mismo .avs (tamaño y fecha), tramo, ajustes y objetivo = mismo resultado. */
export function claveCache(datos: {
    avs: string;
    tamanoAvs: number;
    fechaAvs: number;
    tramo: Tramo;
    x264: object;
    objetivo: { tipo: "crf" | "bitrate"; valor: number };
}): string {
    return createHash("sha1").update(JSON.stringify(datos)).digest("hex").slice(0, 20);
}

/** "2026-10-30 1015" para el nombre de la carpeta. */
export function marcaDeTiempo(fecha: Date): string {
    const dos = (n: number) => String(n).padStart(2, "0");
    return `${fecha.getFullYear()}-${dos(fecha.getMonth() + 1)}-${dos(fecha.getDate())} ${dos(fecha.getHours())}${dos(fecha.getMinutes())}`;
}
