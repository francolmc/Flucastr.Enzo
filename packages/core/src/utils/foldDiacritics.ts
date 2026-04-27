/** Case-fold helper: NFD + strip combining marks (same semantics as tool trigger matching). */
export function foldDiacritics(input: string): string {
  return input.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
