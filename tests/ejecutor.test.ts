import { describe, expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { ejecutorReal, type Ejecutor } from "../src/ejecutor.ts";
import { Registro, anotarError, ejecutorConRegistro, lineaComando } from "../src/registro.ts";
import { ErrorUsuario } from "../src/ui.ts";
import { directorioTemporal } from "./utilidades.ts";

// Procesos de prueba: el propio bun con un script en línea.
const bun = (codigo: string) => ({ exe: process.execPath, args: ["-e", codigo] });

describe("ejecutorReal", () => {
    test("tubería: la salida del primero entra al segundo", async () => {
        const resultado = await ejecutorReal.ejecutar(
            [
                bun('process.stdout.write("hola por tubería")'),
                bun('const t = await new Response(Bun.stdin.stream()).text(); console.error(t.toUpperCase());'),
            ],
            { capturar: true },
        );

        expect(resultado.codigo).toBe(0);
        expect(resultado.stderr).toContain("HOLA POR TUBERÍA");
    });

    test("alSalida recibe en vivo el stderr y el stdout del último; el resultado trae la cola", async () => {
        const recibido: string[] = [];
        const resultado = await ejecutorReal.ejecutar(
            [bun('console.error("avance 1"); console.log("frame 2"); process.exit(5)')],
            { alSalida: (texto) => recibido.push(texto) },
        );

        expect(resultado.codigo).toBe(5);
        expect(recibido.join("")).toContain("avance 1");
        expect(recibido.join("")).toContain("frame 2");
        expect(resultado.stderr).toContain("avance 1");
    });

    test("vigilante: si nadie escribe en el plazo, mata la tubería y dice quiénes seguían vivos", async () => {
        const inicio = Date.now();
        const resultado = await ejecutorReal.ejecutar(
            [bun('console.error("empieza"); await Bun.sleep(30000)')],
            { alSalida: () => undefined, vigilar: { segundos: 1 } },
        );

        expect(Date.now() - inicio).toBeLessThan(10000);
        expect(resultado.codigo).toBe(-1);
        expect(resultado.colgado?.vivos).toEqual([basename(process.execPath)]);
        expect(resultado.stderr).toContain("empieza");
    });

    test("vigilante: un proceso que sigue escribiendo no se corta", async () => {
        const resultado = await ejecutorReal.ejecutar(
            [bun('for (let i = 0; i < 6; i++) { console.error("frame " + i); await Bun.sleep(300); }')],
            { vigilar: { segundos: 1 } },
        );

        expect(resultado.codigo).toBe(0);
        expect(resultado.colgado).toBeUndefined();
        expect(resultado.stderr).toContain("frame 5");
    });

    test("devuelve el código del proceso que falla", async () => {
        const resultado = await ejecutorReal.ejecutar(
            [bun("process.stdout.write('x')"), bun("await new Response(Bun.stdin.stream()).text(); process.exit(3)")],
            { capturar: true },
        );
        expect(resultado.codigo).toBe(3);
    });
});

describe("registro", () => {
    test("lineaComando cita los argumentos con espacios y une la tubería", () => {
        expect(lineaComando([{ exe: "C:\\MeGUI\\ffmpeg.exe", args: ["-i", "a b.avs", ""] }, { exe: "x264.exe", args: ["--crf", "18"] }]))
            .toBe('C:\\MeGUI\\ffmpeg.exe -i "a b.avs" "" | x264.exe --crf 18');
    });

    test("ejecutorConRegistro anota comando, código, cuelgue y stderr", async () => {
        const base = directorioTemporal();
        try {
            const registro = new Registro(join(base, "sub", "registro.log"), "prueba");
            const falso: Ejecutor = {
                ejecutar: async () => ({ codigo: -1, codigos: [1, 1], stderr: "frame 398", colgado: { vivos: ["x264.exe"] } }),
            };
            await ejecutorConRegistro(falso, registro).ejecutar([{ exe: "ffmpeg.exe", args: ["-i", "x.avs"] }, { exe: "x264.exe", args: [] }], { vigilar: { segundos: 120 } });

            const texto = readFileSync(registro.ruta, "utf8");
            expect(texto).toContain("prueba");
            expect(texto).toContain("#1 inicia (vigilante: 120 s): ffmpeg.exe -i x.avs | x264.exe");
            expect(texto).toContain("#1 termina: código -1 (por proceso: 1, 1)");
            expect(texto).toContain("COLGADO: sin salida en 120 s; seguían vivos: x264.exe");
            expect(texto).toContain("frame 398");
        } finally {
            rmSync(base, { recursive: true, force: true });
        }
    });

    test("anotarError agrega la ruta del registro a los errores de usuario", () => {
        const base = directorioTemporal();
        try {
            const registro = new Registro(join(base, "registro.log"), "prueba");
            const error = anotarError(registro, new ErrorUsuario("falló algo")) as Error;
            expect(error).toBeInstanceOf(ErrorUsuario);
            expect(error.message).toBe(`falló algo\nRegistro: ${registro.ruta}`);
            expect(readFileSync(registro.ruta, "utf8")).toContain("ERROR: falló algo");

            const inesperado = new Error("bug");
            expect(anotarError(registro, inesperado)).toBe(inesperado);
            expect(anotarError(undefined, inesperado)).toBe(inesperado);
        } finally {
            rmSync(base, { recursive: true, force: true });
        }
    });
});
