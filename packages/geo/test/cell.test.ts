import { describe, expect, it } from 'vitest';
import { CELL_DEGREES, elevationBand, roundToCell } from '../src/index.js';

describe('roundToCell (RF-708, INV-30, D-H1-10)', () => {
  it('lleva un punto exacto a la celda de 0,01°', () => {
    expect(roundToCell({ lat: 42.634567, lon: -0.104321 })).toEqual({ lat: 42.63, lon: -0.1 });
    expect(roundToCell({ lat: 42.636, lon: 1.5251 })).toEqual({ lat: 42.64, lon: 1.53 });
  });

  it('es idempotente: lo que el cliente ya redondeó, el servidor lo deja igual', () => {
    for (const lat of [42.63, 42.5, -33.87, 0.01, 89.99]) {
      for (const lon of [-0.1, 1.52, 179.99, -180, 0]) {
        const once = roundToCell({ lat, lon });
        expect(roundToCell(once)).toEqual(once);
        expect(once).toEqual({ lat, lon });
      }
    }
  });

  it('no deja ruido de coma flotante ni cero negativo', () => {
    const { lat, lon } = roundToCell({ lat: 42.629999999, lon: -0.001 });
    expect(lat).toBe(42.63);
    expect(Object.is(lon, 0)).toBe(true);
  });

  it('tiene ~1 km de lado: dos puntos a menos de media celda caen en la misma', () => {
    expect(CELL_DEGREES).toBe(0.01);
    expect(roundToCell({ lat: 42.6301, lon: -0.1 })).toEqual(roundToCell({ lat: 42.6349, lon: -0.1 }));
    expect(roundToCell({ lat: 42.6349, lon: -0.1 })).not.toEqual(roundToCell({ lat: 42.6351, lon: -0.1 }));
  });
});

describe('elevationBand', () => {
  it('redondea la altitud al múltiplo de 100 m más cercano', () => {
    expect(elevationBand(1049.9)).toBe(1000);
    expect(elevationBand(1050)).toBe(1100);
    expect(elevationBand(3404)).toBe(3400);
    expect(elevationBand(-20)).toBe(0);
    expect(Object.is(elevationBand(-20), -0)).toBe(false);
  });
});
