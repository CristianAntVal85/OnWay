// Encoded polylines (Google algorithm) as Valhalla returns them: precision 6 by default, 5 on request.
/** Decodes to `[lon, lat]` pairs. */
export function decodePolyline(encoded, precision = 6) {
  const factor = 10 ** precision;
  const coords = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  const next = () => {
    let result = 0;
    let shift = 0;
    let byte;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < encoded.length) {
    lat += next();
    lon += next();
    coords.push([lon / factor, lat / factor]);
  }
  return coords;
}
