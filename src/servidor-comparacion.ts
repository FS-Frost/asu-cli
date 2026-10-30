import * as p from "@clack/prompts";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { NOMBRE_RESULTADOS, contarVotos, registrarVoto, validarVoto, type Resultados } from "./nucleo/comparar-resultados.ts";
import { cargarConfig, guardarConfig, usarVariante } from "./nucleo/config.ts";

export type OpcionesServidor = {
    /** Abrir el navegador al iniciar. */
    abrirNavegador?: boolean;
    /** Puerto (0 = uno libre). */
    puerto?: number;
    /** Abre una URL, carpeta o archivo con el programa de Windows (reemplazable en tests). */
    abrir?: (destino: string, tipo: "url" | "carpeta" | "archivo") => void;
};

export type ServidorComparacion = {
    url: string;
    token: string;
    /** Se resuelve cuando la página pide cerrar o se llama a `cerrar()`. */
    cerrado: Promise<void>;
    cerrar: () => void;
};

const TIPOS: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".mp4": "video/mp4",
};

function abrirConWindows(destino: string, tipo: "url" | "carpeta" | "archivo"): void {
    const comando = tipo === "carpeta" ? ["explorer", destino] : ["cmd", "/c", "start", "", destino];
    Bun.spawn(comando, { stdout: "ignore", stderr: "ignore", windowsHide: true });
}

/** Ruta dentro de `carpeta` para una ruta relativa de la URL, o null si sale de ella. */
function rutaDentro(carpeta: string, relativa: string): string | null {
    const ruta = resolve(carpeta, relativa);
    const desde = relative(carpeta, ruta);
    return desde === "" || desde.startsWith("..") || isAbsolute(desde) ? null : ruta;
}

/** Sirve un archivo, con soporte de rangos (lo pide `<video>` para adelantar). */
function servirArchivo(ruta: string, pedido: Request): Response {
    const archivo = Bun.file(ruta);
    const tamano = statSync(ruta).size;
    const tipo = TIPOS[extname(ruta).toLowerCase()] ?? "application/octet-stream";
    const rango = pedido.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);

    if (rango && (rango[1] || rango[2])) {
        const inicio = rango[1] ? Number(rango[1]) : Math.max(0, tamano - Number(rango[2]));
        const fin = rango[1] && rango[2] ? Math.min(Number(rango[2]), tamano - 1) : tamano - 1;
        if (inicio > fin || inicio >= tamano) {
            return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${tamano}` } });
        }
        return new Response(archivo.slice(inicio, fin + 1), {
            status: 206,
            headers: { "Content-Type": tipo, "Content-Range": `bytes ${inicio}-${fin}/${tamano}`, "Accept-Ranges": "bytes", "Content-Length": String(fin - inicio + 1) },
        });
    }

    return new Response(archivo, { headers: { "Content-Type": tipo, "Accept-Ranges": "bytes", "Cache-Control": "no-store" } });
}

function json(datos: unknown, status = 200): Response {
    return new Response(JSON.stringify(datos), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}

/**
 * Servidor local de una comparación: archivos estáticos de la carpeta y una API para votar, adoptar
 * variantes y abrir archivos. Solo 127.0.0.1; las acciones exigen el token de la sesión (cabecera
 * `x-asu-token`) y que el origen y el host sean los del propio servidor.
 */
export function crearServidorComparacion(carpeta: string, opciones: OpcionesServidor = {}): ServidorComparacion {
    const base = resolve(carpeta);
    const token = randomBytes(24).toString("hex");
    const abrir = opciones.abrir ?? abrirConWindows;
    let terminar!: () => void;
    const cerrado = new Promise<void>((resolver) => (terminar = resolver));
    const rutaResultados = join(base, NOMBRE_RESULTADOS);
    const leerResultados = () => JSON.parse(readFileSync(rutaResultados, "utf8")) as Resultados;

    const servidor = Bun.serve({
        hostname: "127.0.0.1",
        port: opciones.puerto ?? 0,
        async fetch(pedido) {
            const url = new URL(pedido.url);
            const propio = `127.0.0.1:${servidor.port}`;
            // DNS rebinding: un sitio que apunte su dominio a 127.0.0.1 llega con otro Host.
            if (pedido.headers.get("host") !== propio) {
                return new Response("Host no permitido.", { status: 403 });
            }

            if (url.pathname.startsWith("/api/")) {
                const origen = pedido.headers.get("origin");
                if (pedido.headers.get("x-asu-token") !== token || (origen !== null && origen !== `http://${propio}`)) {
                    return json({ error: "No autorizado." }, 403);
                }
                return api(url.pathname, pedido);
            }

            if (pedido.method !== "GET" && pedido.method !== "HEAD") {
                return new Response("Método no permitido.", { status: 405 });
            }

            const relativa = decodeURIComponent(url.pathname.replace(/^\/+/, "")) || "index.html";
            const ruta = rutaDentro(base, relativa);
            if (!ruta || !existsSync(ruta) || !statSync(ruta).isFile()) {
                return new Response("No encontrado.", { status: 404 });
            }
            return servirArchivo(ruta, pedido);
        },
    });

    async function api(ruta: string, pedido: Request): Promise<Response> {
        const cuerpo = pedido.method === "POST" ? ((await pedido.json().catch(() => null)) as Record<string, unknown> | null) : null;

        if (ruta === "/api/resultados" && pedido.method === "GET") {
            return json(leerResultados());
        }

        if (ruta === "/api/salidas" && pedido.method === "GET") {
            return json(cargarConfig().salidas.filter((s) => s.tipo === "mp4-x264").map((s) => s.nombre));
        }

        if (ruta === "/api/votos" && pedido.method === "POST") {
            const resultados = leerResultados();
            const error = validarVoto(resultados, cuerpo);
            if (error) {
                return json({ error }, 400);
            }
            const actualizados = registrarVoto(resultados, { sesion: String(cuerpo!.sesion), captura: Number(cuerpo!.captura), eleccion: String(cuerpo!.eleccion) }, new Date());
            writeFileSync(rutaResultados, `${JSON.stringify(actualizados, null, 2)}\n`);
            return json({ conteo: contarVotos(actualizados) });
        }

        if (ruta === "/api/adoptar" && pedido.method === "POST") {
            const resultados = leerResultados();
            const variante = resultados.variantes.find((v) => v.nombre === cuerpo?.variante);
            const salidas = Array.isArray(cuerpo?.salidas) ? (cuerpo!.salidas as unknown[]).map(String) : [resultados.salida.nombre];
            if (!variante || variante.adoptar === null) {
                return json({ error: "Variante inválida (la referencia no se adopta)." }, 400);
            }
            try {
                let config = cargarConfig();
                for (const salida of salidas) {
                    config = usarVariante(config, salida, variante.nombre);
                }
                guardarConfig(config);
            } catch (error) {
                return json({ error: (error as Error).message }, 400);
            }
            p.log.success(`Variante "${variante.nombre}" adoptada en: ${salidas.join(", ")}`);
            return json({ ok: true, salidas });
        }

        if (ruta === "/api/abrir" && pedido.method === "POST") {
            if (cuerpo?.tipo === "carpeta") {
                abrir(base, "carpeta");
                return json({ ok: true });
            }
            const destino = typeof cuerpo?.ruta === "string" ? rutaDentro(base, cuerpo.ruta) : null;
            if (cuerpo?.tipo !== "archivo" || !destino || !existsSync(destino)) {
                return json({ error: "Ruta inválida." }, 400);
            }
            abrir(destino, "archivo");
            return json({ ok: true });
        }

        if (ruta === "/api/cerrar" && pedido.method === "POST") {
            setTimeout(cerrar, 50);
            return json({ ok: true });
        }

        return json({ error: "No existe." }, 404);
    }

    function cerrar(): void {
        servidor.stop(true);
        terminar();
    }

    const url = `http://127.0.0.1:${servidor.port}/?token=${token}`;
    if (opciones.abrirNavegador) {
        abrir(url, "url");
    }
    return { url, token, cerrado, cerrar };
}

/** Levanta el servidor, muestra la URL y espera a que la página lo cierre o a Ctrl+C. */
export async function servirComparacion(carpeta: string, opciones: OpcionesServidor = {}): Promise<void> {
    const servidor = crearServidorComparacion(carpeta, opciones);
    p.log.info(`Comparación en ${servidor.url}\nCtrl+C o el botón "Cerrar" de la página para terminar.`);

    const alInterrumpir = () => servidor.cerrar();
    process.once("SIGINT", alInterrumpir);
    await servidor.cerrado;
    process.off("SIGINT", alInterrumpir);
    p.log.info("Servidor de la comparación cerrado.");
}
