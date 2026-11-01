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
