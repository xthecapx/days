/** Pure geometric utilities (coordinates in tiles). */

export function pointInPolygon(x, y, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const crosses = (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-7) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

/** Deterministic hash per tile: same map on every load, no Math.random. */
export function tileHash(x, y, salt = 0) {
  return (((x * 73856093) ^ (y * 19349663) ^ (salt * 83492791)) >>> 0);
}

/** Point and direction along a polyline for t ∈ [0, 1] (in tiles). */
export function samplePolyline(polyline, tNorm) {
  const t = ((tNorm % 1) + 1) % 1;
  const lens = [];
  let total = 0;
  for (let i = 0; i < polyline.length - 1; i++) {
    const len = Math.hypot(polyline[i + 1][0] - polyline[i][0], polyline[i + 1][1] - polyline[i][1]);
    lens.push(len);
    total += len;
  }
  if (total === 0) return { x: polyline[0][0], y: polyline[0][1], dx: 1, dy: 0 };

  let target = t * total;
  for (let i = 0; i < lens.length; i++) {
    if (target <= lens[i] || i === lens.length - 1) {
      const lt = lens[i] > 0 ? target / lens[i] : 0;
      const dx = polyline[i + 1][0] - polyline[i][0];
      const dy = polyline[i + 1][1] - polyline[i][1];
      return { x: polyline[i][0] + dx * lt, y: polyline[i][1] + dy * lt, dx, dy };
    }
    target -= lens[i];
  }
  return { x: 0, y: 0, dx: 1, dy: 0 };
}
