import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "./nucleo/config.ts";
import { herramientasDeMegui, type Herramientas } from "./nucleo/encode.ts";
import {
    CATALOGO,
    definicion,
    mensajeFaltan,
    type CarpetasHerramientas,
    type ClaveHerramienta,
    type DefinicionHerramienta,
    type Faltante,
} from "./nucleo/herramientas.ts";
import { ErrorUsuario } from "./ui.ts";

export type OrigenHerramienta = "MeGUI" | "carpeta configurada" | "PATH" | "ubicación típica" | "sistema";

export type HerramientaEncontrada = {
    definicion: DefinicionHerramienta;
    ruta: string | null;
    origen: OrigenHerramienta | null;
    /** Dónde se buscó (para el mensaje si falta). */
    buscadaEn: string[];
};

export type ContextoBusqueda = { rutaMegui: string | null; carpetas: CarpetasHerramientas };

export function contextoDeConfig(config: Pick<Config, "rutaMegui" | "herramientas">, rutaMegui = config.rutaMegui): ContextoBusqueda {
    return { rutaMegui, carpetas: config.herramientas };
}

function programFiles(x86: boolean): string {
    return (x86 ? process.env["ProgramFiles(x86)"] : process.env.ProgramFiles) ?? (x86 ? "C:\\Program Files (x86)" : "C:\\Program Files");
}

/** Ubicaciones típicas de instalación (`ASU_CLI_UBICACIONES_TIPICAS`, separadas por ";", las reemplaza en los tests). */
function ubicacionesTipicas(grupo: "ffmpeg" | "mkvtoolnix"): string[] {
    const reemplazo = process.env.ASU_CLI_UBICACIONES_TIPICAS;
    if (reemplazo !== undefined) {
        return reemplazo.split(";").filter(Boolean);
    }
    const winget = process.env.LOCALAPPDATA ? [join(process.env.LOCALAPPDATA, "Microsoft", "WinGet", "Links")] : [];
    return grupo === "ffmpeg"
        ? ["C:\\ffmpeg\\bin", "C:\\ffmpeg", join(programFiles(false), "ffmpeg", "bin"), ...winget]
        : [join(programFiles(false), "MKVToolNix"), join(programFiles(true), "MKVToolNix"), ...winget];
}

/** `SysWOW64`, donde está el AviSynth 2.60 de 32 bits (`ASU_CLI_SYSWOW64` la reemplaza en los tests). */
function carpetaSysWow64(): string {
    return process.env.ASU_CLI_SYSWOW64 ?? join(process.env.SystemRoot ?? "C:\\Windows", "SysWOW64");
}

/** Carpeta de plugins de AviSynth: la configurada, o la de fábrica (`ASU_CLI_AVISYNTH_PLUGINS` la reemplaza en los tests). */
function carpetaPlugins(carpetas: CarpetasHerramientas): { carpeta: string; configurada: boolean } {
    if (carpetas.avisynthPlugins) {
        return { carpeta: carpetas.avisynthPlugins, configurada: true };
    }
    return { carpeta: process.env.ASU_CLI_AVISYNTH_PLUGINS ?? join(programFiles(true), "AviSynth", "plugins"), configurada: false };
}

/**
 * Busca una herramienta: las de MeGUI en `<rutaMegui>\tools`; AviSynth en SysWOW64 y su carpeta de
 * plugins; FFmpeg y MKVToolNix en la carpeta configurada → PATH → ubicaciones típicas.
 */
export function buscarHerramienta(clave: ClaveHerramienta, contexto: ContextoBusqueda): HerramientaEncontrada {
    const def = definicion(clave);
    const encontrada = (ruta: string, origen: OrigenHerramienta, buscadaEn: string[]): HerramientaEncontrada => ({ definicion: def, ruta, origen, buscadaEn });
    const falta = (buscadaEn: string[]): HerramientaEncontrada => ({ definicion: def, ruta: null, origen: null, buscadaEn });

    switch (def.grupo) {
        case "megui": {
            if (!contexto.rutaMegui) {
                return falta(["MeGUI sin configurar"]);
            }
            const ruta = herramientasDeMegui(contexto.rutaMegui)[clave as keyof Herramientas];
            return existsSync(ruta) ? encontrada(ruta, "MeGUI", [ruta]) : falta([ruta]);
        }

        case "avisynth": {
            if (clave === "avisynth") {
                const ruta = join(carpetaSysWow64(), def.archivo);
                return existsSync(ruta) ? encontrada(ruta, "sistema", [ruta]) : falta([ruta]);
            }
            const { carpeta, configurada } = carpetaPlugins(contexto.carpetas);
            const ruta = join(carpeta, def.archivo);
            return existsSync(ruta) ? encontrada(ruta, configurada ? "carpeta configurada" : "sistema", [ruta]) : falta([ruta]);
        }

        case "ffmpeg":
        case "mkvtoolnix": {
            const buscadaEn: string[] = [];
            const configurada = contexto.carpetas[def.grupo];
            if (configurada) {
                const ruta = join(configurada, def.archivo);
                if (existsSync(ruta)) {
                    return encontrada(ruta, "carpeta configurada", [ruta]);
                }
                buscadaEn.push(ruta);
            }

            const enPath = Bun.which(def.archivo.replace(/\.exe$/i, ""), { PATH: process.env.ASU_CLI_PATH ?? process.env.PATH ?? "" });
            if (enPath) {
                return encontrada(enPath, "PATH", [...buscadaEn, "PATH"]);
            }
            buscadaEn.push("PATH");

            for (const carpeta of ubicacionesTipicas(def.grupo)) {
                const ruta = join(carpeta, def.archivo);
                if (existsSync(ruta)) {
                    return encontrada(ruta, "ubicación típica", [...buscadaEn, carpeta]);
                }
                buscadaEn.push(carpeta);
            }
            return falta(buscadaEn);
        }
    }
}

export function buscarTodas(contexto: ContextoBusqueda): HerramientaEncontrada[] {
    return CATALOGO.map((def) => buscarHerramienta(def.clave, contexto));
}

export function faltantes(claves: readonly ClaveHerramienta[], contexto: ContextoBusqueda): Faltante[] {
    return claves
        .map((clave) => buscarHerramienta(clave, contexto))
        .filter((h) => h.ruta === null)
        .map((h) => ({ definicion: h.definicion, buscadaEn: h.buscadaEn }));
}

/** Rutas de `claves`; si falta alguna, `ErrorUsuario` con el mensaje único (qué, dónde, cómo instalar). */
export function exigirHerramientas(claves: readonly ClaveHerramienta[], contexto: ContextoBusqueda, comando: string): Record<ClaveHerramienta, string> {
    const faltan = faltantes(claves, contexto);
    if (faltan.length > 0) {
        throw new ErrorUsuario(mensajeFaltan(faltan, comando));
    }
    return Object.fromEntries(claves.map((clave) => [clave, buscarHerramienta(clave, contexto).ruta!])) as Record<ClaveHerramienta, string>;
}
