import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const COLORES = "&H00FFFFFF,&H000000FF,&H00000000,&H00000000";
const RESTO_ESTILO = "0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1";

function estilo(nombre: string, fuente: string): string {
    return `Style: ${nombre},${fuente},60,${COLORES},${RESTO_ESTILO}`;
}

/**
 * .ass con los casos de Verificar fuentes: \fn repetido, \r, "@" vertical, línea Comment,
 * estilo sin usar y una fuente que solo difiere en mayúsculas.
 */
export function assDePrueba(): string {
    return [
        "[Script Info]",
        "ScriptType: v4.00+",
        "PlayResX: 1920",
        "PlayResY: 1080",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        estilo("Default", "Arial"),
        estilo("Carteles", "@MS Gothic"),
        estilo("SoloReset", "Fuente Reset"),
        estilo("NoUsado", "Comic Sans MS"),
        estilo("SoloComentario", "Impact"),
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
        "Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,{\\fnPrimera}Hola {\\b1\\fnSegunda Fuente}mundo",
        "Dialogue: 0,0:00:02.00,0:00:03.00,Carteles,,0,0,0,,{\\rSoloReset}texto",
        "Comment: 0,0:00:03.00,0:00:04.00,SoloComentario,,0,0,0,,{\\fnWingdings}nada",
        "Dialogue: 0,0:00:04.00,0:00:05.00,Default,,0,0,0,,{\\fnarial}repetida",
        "",
    ].join("\r\n");
}

/** .ass mínimo para tests de unión. `lineas` son líneas completas de [Events]. */
export function construirASS(opciones: {
    /** `null`: sin PlayResX/PlayResY. */
    playRes?: [number, number] | null;
    scaledBorderAndShadow?: "yes" | "no";
    estilos: [nombre: string, fuente: string][];
    lineas: string[];
    fuentes?: { nombre: string; datos: string[] }[];
    extradata?: string[];
}): string {
    const partes = ["[Script Info]", "ScriptType: v4.00+"];
    if (opciones.playRes !== null) {
        const [x, y] = opciones.playRes ?? [1920, 1080];
        partes.push(`PlayResX: ${x}`, `PlayResY: ${y}`);
    }
    if (opciones.scaledBorderAndShadow) {
        partes.push(`ScaledBorderAndShadow: ${opciones.scaledBorderAndShadow}`);
    }

    partes.push(
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        ...opciones.estilos.map(([nombre, fuente]) => estilo(nombre, fuente)),
        "",
    );

    if (opciones.fuentes) {
        partes.push("[Fonts]");
        for (const fuente of opciones.fuentes) {
            partes.push(`fontname: ${fuente.nombre}`, ...fuente.datos);
        }
        partes.push("");
    }

    partes.push("[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text", ...opciones.lineas, "");

    if (opciones.extradata) {
        partes.push("[Aegisub Extradata]", ...opciones.extradata.map((dato) => `Data: ${dato}`), "");
    }

    return partes.join("\r\n");
}

export function directorioTemporal(): string {
    return mkdtempSync(join(tmpdir(), "asu-cli-test-"));
}

/** Escribe un archivo creando las carpetas que falten (p. ej. `.asu\asu.json`). */
export function escribirJson(ruta: string, texto: string): void {
    mkdirSync(dirname(ruta), { recursive: true });
    writeFileSync(ruta, texto);
}
