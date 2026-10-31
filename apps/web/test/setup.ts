import { afterEach } from 'vitest';
import { cleanup, configure } from '@testing-library/react';

// Un ordenador o un ejecutor de CI cargado puede tardar más de 1 s en pintar una vista; la espera por defecto de Testing Library es esa.
configure({ asyncUtilTimeout: 4000 });

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  document.documentElement.lang = 'es';
});
