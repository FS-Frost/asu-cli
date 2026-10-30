import { describe, expect, test } from "bun:test";
import { LectorAvance, ejecutarConLimite, framesAproximados, ultimasLineas } from "../src/nucleo/avance.ts";

describe("LectorAvance", () => {
    test("x264: líneas separadas por \\r, también cortadas entre trozos", () => {
        const lector = new LectorAvance();
        lector.leer("x264 [info]: profile High, level 4.1\n1 frames: 0.74 fps, 33633.57 kb/s\r25 fra");
        expect(lector.frames).toBe(1);
        lector.leer("mes: 12.10 fps, 3000.00 kb/s\r");
        expect(lector.frames).toBe(25);
    });

    test("x264 con --frames: [12.3%] 123/1000 frames", () => {
        const lector = new LectorAvance();
        lector.leer("[12.3%] 123/1000 frames, 50.00 fps, 2000.00 kb/s, eta 0:00:17\r");
        expect(lector.frames).toBe(123);
    });

    test("xvid_encraw: una línea por frame", () => {
        const lector = new LectorAvance();
        lector.leer("xvid_encraw - raw mpeg4 bitstream encoder\r\n\r\n    3: key=0, time=      0, len=   39534 | type=I\r\n    4: key=0, time=");
        expect(lector.frames).toBe(3);
        lector.leer("      2, len=  2681 | type=B\r\n   57: key=0, time= 0\r\n");
        expect(lector.frames).toBe(57);
    });

    test("texto sin avance no cambia nada", () => {
        const lector = new LectorAvance();
        lector.leer("Detected 16 cpus, using 1 threads.\r\nBitstream version: 1.4.-127\r\n");
        expect(lector.frames).toBeNull();
    });
});

describe("utilidades", () => {
    test("framesAproximados a 23,976 fps", () => {
        expect(framesAproximados(60)).toBe(1439);
    });

    test("ultimasLineas: sin líneas vacías ni \\r", () => {
        expect(ultimasLineas("a\r\n\r\nb\rc\n\n", 2)).toBe("b\nc");
    });
});

describe("ejecutarConLimite", () => {
    const tarea = (registro: { activas: number; maximo: number }, falla = false) => async () => {
        registro.activas++;
        registro.maximo = Math.max(registro.maximo, registro.activas);
        await Bun.sleep(10);
        registro.activas--;
        if (falla) {
            throw new Error("falló");
        }
    };

    test("nunca supera el límite y usa todo el límite", async () => {
        const registro = { activas: 0, maximo: 0 };
        await ejecutarConLimite(Array.from({ length: 5 }, () => tarea(registro)), 3);
        expect(registro.maximo).toBe(3);

        const secuencial = { activas: 0, maximo: 0 };
        await ejecutarConLimite(Array.from({ length: 3 }, () => tarea(secuencial)), 1);
        expect(secuencial.maximo).toBe(1);
    });

    test("si una falla, las demás terminan y se devuelven los errores", async () => {
        const registro = { activas: 0, maximo: 0 };
        let terminadas = 0;
        const errores = await ejecutarConLimite(
            [tarea(registro, true), async () => { await tarea(registro)(); terminadas++; }, async () => { await tarea(registro)(); terminadas++; }],
            2,
        );
        expect(errores).toHaveLength(1);
        expect(terminadas).toBe(2);
    });
});
