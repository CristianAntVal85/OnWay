// Ubicación del dispositivo (RF-708, INV-30, D-H1-10). Se pide UNA vez al entrar en la parte autenticada de la web, se redondea
// a la celda de ~1 km nada más llegar y vive solo en la memoria de este componente: nunca en localStorage, sessionStorage,
// IndexedDB, cookies ni en la dirección de la página. La posición exacta no sale de la función de éxito: no se guarda en ningún estado.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { roundToCell } from '@onway/geo';

export type DeviceLocation =
  /** Esperando la respuesta del navegador (o su permiso). */
  | { status: 'pending' }
  /** Posición ya redondeada a la celda de ~1 km. */
  | { status: 'ready'; lat: number; lon: number }
  | { status: 'denied' }
  /** Sin señal, tiempo agotado o posición no disponible. */
  | { status: 'failed' }
  /** El navegador no ofrece geolocalización. */
  | { status: 'unsupported' };

interface DeviceLocationContext {
  location: DeviceLocation;
  /** Vuelve a pedir la posición. Solo la llama una persona (botón «Probar de nuevo»): nunca se repite sola. */
  request: () => void;
}

const Context = createContext<DeviceLocationContext | null>(null);

const PERMISSION_DENIED = 1; // GeolocationPositionError.PERMISSION_DENIED
const OPTIONS: PositionOptions = { enableHighAccuracy: false, timeout: 15_000, maximumAge: 5 * 60_000 };

export function DeviceLocationProvider({ children }: { children: ReactNode }) {
  const [location, setLocation] = useState<DeviceLocation>({ status: 'pending' });
  const asked = useRef(false);
  const mounted = useRef(false);

  const request = useCallback(() => {
    const geolocation = typeof navigator === 'undefined' ? undefined : navigator.geolocation;
    if (!geolocation) {
      setLocation({ status: 'unsupported' });
      return;
    }
    setLocation({ status: 'pending' });
    geolocation.getCurrentPosition(
      (position) => {
        if (!mounted.current) return;
        // La coordenada exacta solo existe aquí dentro: al estado llega la celda.
        const cell = roundToCell({ lat: position.coords.latitude, lon: position.coords.longitude });
        setLocation({ status: 'ready', lat: cell.lat, lon: cell.lon });
      },
      (error) => {
        if (mounted.current) setLocation({ status: error.code === PERMISSION_DENIED ? 'denied' : 'failed' });
      },
      OPTIONS,
    );
  }, []);

  // Una sola petición por sesión (el proveedor vive mientras dure la sesión): `StrictMode` ejecuta el efecto dos veces en desarrollo.
  useEffect(() => {
    mounted.current = true;
    if (!asked.current) {
      asked.current = true;
      request();
    }
    return () => {
      mounted.current = false;
    };
  }, [request]);

  const value = useMemo(() => ({ location, request }), [location, request]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useDeviceLocation(): DeviceLocationContext {
  const value = useContext(Context);
  if (!value) throw new Error('DeviceLocationProvider ausente');
  return value;
}
