// Arranque del tema (UI-rediseno, D-U5): script clásico, bloqueante y del propio origen. Corre en <head>, antes del primer pintado,
// y fija `data-theme` en <html> con lo guardado en este navegador. Si no hay nada válido o algo falla, no toca nada: queda el oscuro del CSS.
// La clave y los valores son los de `src/theme/theme.ts` (una prueba vigila que coincidan); los dos colores, los de `--header-bg` de `tokens.css`.
(function () {
  try {
    var stored = window.localStorage.getItem('onway.theme');
    if (stored !== 'dark' && stored !== 'light' && stored !== 'system') return;
    var theme = stored === 'system' ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : stored;
    document.documentElement.setAttribute('data-theme', theme);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'light' ? '#17262b' : '#161b22');
  } catch {
    // Almacenamiento o matchMedia no disponibles: se queda el tema por defecto.
  }
})();
