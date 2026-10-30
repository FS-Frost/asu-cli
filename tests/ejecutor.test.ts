import { describe, expect, test } from "bun:test";
import { ejecutorReal } from "../src/ejecutor.ts";

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

    test("devuelve el código del proceso que falla", async () => {
        const resultado = await ejecutorReal.ejecutar(
            [bun("process.stdout.write('x')"), bun("await new Response(Bun.stdin.stream()).text(); process.exit(3)")],
            { capturar: true },
        );
        expect(resultado.codigo).toBe(3);
    });
});
