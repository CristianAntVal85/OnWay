/** Marca de sendero (blanco sobre rojo, como las de los GR): identidad de OnWay y señal de «estás aquí» en la barra. */
export function Blaze({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  return <span className={`blaze blaze-${size}`} aria-hidden="true" />;
}
