/** Entrega un archivo generado por el servidor como descarga del navegador. */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  // El navegador necesita un instante para empezar la descarga antes de soltar la dirección.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Un nombre de archivo sencillo a partir del nombre de una ruta: sin tildes, en minúsculas y con guiones. */
export function fileSlug(text: string, fallback = 'ruta'): string {
  const slug = text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return slug || fallback;
}
