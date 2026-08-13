// Pliegue común para búsquedas/filtros (RgSelect): minúsculas + sin
// diacríticos (NFD separa la marca combinante y el rango U+0300–U+036F la
// elimina). Aplicar SIEMPRE a ambos lados (consulta y pajar): así "croacia"
// encuentra "Croàcia" y viceversa. Herencia berserk.
export function foldSearchText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}
