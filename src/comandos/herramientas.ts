import * as p from "@clack/prompts";
import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { ejecutorReal, type Ejecutor } from "../ejecutor.ts";
import { buscarTodas, contextoDeConfig, type HerramientaEncontrada } from "../herramientas.ts";
import { cargarConfig, guardarConfig } from "../nucleo/config.ts";
import { CATALOGO, GRUPOS, NOMBRES_CARPETAS, lineaVersion, type GrupoHerramienta } from "../nucleo/herramientas.ts";
import { ErrorUsuario } from "../ui.ts";

/** Versión que informa la herramienta (si tiene `argsVersion`); 5 s sin salida = se corta. */
async function version(ejecutor: Ejecutor, h: HerramientaEncontrada): Promise<string | null> {
    if (!h.ruta || !h.definicion.argsVersion) {
        return null;
    }
    try {
        const { stdout, stderr } = await ejecutor.ejecutar([{ exe: h.ruta, args: h.definicion.argsVersion }], { capturar: true, vigilar: { segundos: 5 } });
        return lineaVersion(`${stdout ?? ""}\n${stderr}`);
    } catch {
        return null;
    }
}

/**
 * `asu herramientas`: estado de cada herramienta externa (ruta, de dónde salió, versión y qué
 * comandos la usan) y cómo instalar lo que falta. Código 1 si falta alguna.
 */
export async function diagnosticarHerramientas(dependencias: { ejecutor?: Ejecutor } = {}): Promise<number> {
    const ejecutor = dependencias.ejecutor ?? ejecutorReal;
    const config = cargarConfig();
    const encontradas = buscarTodas(contextoDeConfig(config));
    const versiones = await Promise.all(encontradas.map((h) => version(ejecutor, h)));

    const gruposConFaltas = new Set<GrupoHerramienta>();
    for (const grupo of Object.keys(GRUPOS) as GrupoHerramienta[]) {
        const titulo = grupo === "megui" ? `${GRUPOS.megui.nombre} (${config.rutaMegui ?? "sin configurar"})` : GRUPOS[grupo].nombre;
        const lineas = encontradas
            .map((h, i) => ({ h, version: versiones[i] }))
            .filter(({ h }) => h.definicion.grupo === grupo)
            .map(({ h, version }) => {
                if (!h.ruta) {
                    gruposConFaltas.add(grupo);
                    return `✗ ${h.definicion.archivo}  FALTA · usada por: ${h.definicion.usadaPor.join(", ")}\n    buscada en: ${h.buscadaEn.join(", ")}`;
                }
                return `✓ ${h.definicion.archivo}${version ? `  ${version}` : ""}\n    ${h.ruta} (${h.origen})`;
            });
        p.note(lineas.join("\n"), titulo);
    }

    if (gruposConFaltas.size === 0) {
        p.log.success("Están todas las herramientas.");
        return 0;
    }
    p.log.error(["Cómo instalar lo que falta:", ...[...gruposConFaltas].map((g) => `  ${GRUPOS[g].nombre}: ${GRUPOS[g].instalar}`)].join("\n"));
    return 1;
}

/**
 * `asu config herramienta <ffmpeg|mkvtoolnix|avisynth-plugins> <carpeta>`: carpeta donde buscarla
 * primero. Carpeta vacía = quitar (vuelve al PATH y las ubicaciones típicas).
 */
export function configurarCarpetaHerramienta(nombre: string, carpeta: string): number {
    const clave = NOMBRES_CARPETAS[nombre];
    if (!clave) {
        throw new ErrorUsuario(`Herramienta desconocida: ${nombre}. Válidas: ${Object.keys(NOMBRES_CARPETAS).join(", ")}.`);
    }

    const config = cargarConfig();
    if (carpeta.trim() === "") {
        const { [clave]: _quitada, ...resto } = config.herramientas;
        guardarConfig({ ...config, herramientas: resto });
        p.log.success(`${nombre}: se vuelve a buscar en el PATH y las ubicaciones típicas.`);
        return 0;
    }

    const absoluta = resolve(carpeta.trim());
    if (!existsSync(absoluta) || !statSync(absoluta).isDirectory()) {
        throw new ErrorUsuario(`No existe la carpeta: ${absoluta}`);
    }
    guardarConfig({ ...config, herramientas: { ...config.herramientas, [clave]: absoluta } });

    const grupo = nombre === "avisynth-plugins" ? "avisynth" : (nombre as GrupoHerramienta);
    const archivos = CATALOGO.filter((d) => d.grupo === grupo && d.clave !== "avisynth").map((d) => d.archivo);
    const ausentes = archivos.filter((archivo) => !existsSync(join(absoluta, archivo)));
    p.log.success(`${nombre}: ${absoluta}`);
    if (ausentes.length > 0) {
        p.log.warn(`En esa carpeta no están: ${ausentes.join(", ")}. Revisa con: asu herramientas`);
    }
    return 0;
}
