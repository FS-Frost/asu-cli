import * as fontkit from "fontkit";
import { normalizarNombreFuente } from "./fuentes-ass.ts";

// Registros de la tabla "name" que GDI usa para encontrar una fuente: familia (ID 1) y nombre completo (ID 4).
const REGISTROS_NOMBRE = ["fontFamily", "fullName"] as const;

type TablaNombres = {
    records?: Partial<Record<string, Record<string, string> | undefined>>;
};

function nombresDeUnaFuente(fuente: fontkit.Font): string[] {
    const nombres: string[] = [];
    // @types/fontkit no declara la tabla "name", que fontkit expone como propiedad.
    const tabla = (fuente as unknown as { name?: TablaNombres }).name;

    for (const registro of REGISTROS_NOMBRE) {
        const porIdioma = tabla?.records?.[registro];
        if (porIdioma) {
            nombres.push(...Object.values(porIdioma));
        }
    }

    if (nombres.length === 0 && fuente.familyName) {
        nombres.push(fuente.familyName);
    }

    return nombres;
}

/** Nombres normalizados (en todos los idiomas) de la fuente o colección de fuentes contenida en `datos`. */
export function nombresDeFuente(datos: Uint8Array): string[] {
    const resultado = fontkit.create(Buffer.from(datos));
    const fuentes = "fonts" in resultado ? resultado.fonts : [resultado];
    const nombres = new Set<string>();

    for (const fuente of fuentes) {
        for (const nombre of nombresDeUnaFuente(fuente)) {
            const clave = normalizarNombreFuente(nombre);
            if (clave.length > 0) {
                nombres.add(clave);
            }
        }
    }

    return [...nombres];
}
