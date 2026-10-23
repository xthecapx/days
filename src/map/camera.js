import { ZOOM } from '../core/config.js';
import { TILE_SIZE, WORLD_WIDTH, WORLD_HEIGHT } from './worldSize.js';

/**
 * Cámara 2D independiente del DOM. El mundo mide WORLD_WIDTH × WORLD_HEIGHT
 * unidades; `insets` reserva el espacio ocupado por la HUD (arriba/abajo)
 * para que "centrar" apunte al centro de la zona realmente visible.
 */
export function createCamera() {
  const cam = {
    zoom: 1.5,
    panX: 0,
    panY: 0,
    vw: window.innerWidth,
    vh: window.innerHeight,
    insets: { top: 0, bottom: 0 }
  };

  const clampZoom = (z) => Math.max(ZOOM.min, Math.min(ZOOM.max, z));

  function apply(zoom, panX, panY) {
    const z = clampZoom(zoom);
    const sw = WORLD_WIDTH * z;
    const sh = WORLD_HEIGHT * z;
    const { vw, vh } = cam;
    const minX = Math.min(vw * 0.15 - sw, (vw - sw) / 2);
    const maxX = Math.max(vw * 0.85, (vw - sw) / 2);
    const minY = Math.min(vh * 0.2 - sh, (vh - sh) / 2);
    const maxY = Math.max(vh * 0.8, (vh - sh) / 2);
    cam.zoom = z;
    cam.panX = Math.min(maxX, Math.max(minX, panX));
    cam.panY = Math.min(maxY, Math.max(minY, panY));
  }

  const freeCenter = () => ({
    x: cam.vw / 2,
    y: cam.insets.top + (cam.vh - cam.insets.top - cam.insets.bottom) / 2
  });

  return {
    state: cam,

    resize(vw, vh) {
      cam.vw = vw;
      cam.vh = vh;
      apply(cam.zoom, cam.panX, cam.panY);
    },

    setInsets(top, bottom) {
      cam.insets = { top, bottom };
    },

    set: apply,

    panBy(dx, dy) {
      apply(cam.zoom, cam.panX + dx, cam.panY + dy);
    },

    /** Zoom manteniendo fijo el punto de pantalla (sx, sy). */
    zoomAt(factorOrAbs, sx, sy, { absolute = false } = {}) {
      const next = clampZoom(absolute ? factorOrAbs : cam.zoom * factorOrAbs);
      const wx = (sx - cam.panX) / cam.zoom;
      const wy = (sy - cam.panY) / cam.zoom;
      apply(next, sx - wx * next, sy - wy * next);
    },

    zoomBy(factor) {
      const c = freeCenter();
      this.zoomAt(factor, c.x, c.y);
    },

    /** Centra el tile (tx, ty) en la zona libre de la pantalla. */
    focusTile(tx, ty, zoom = cam.zoom) {
      const z = clampZoom(zoom);
      const c = freeCenter();
      const wx = (tx + 0.5) * TILE_SIZE;
      const wy = (ty + 0.5) * TILE_SIZE;
      apply(z, c.x - wx * z, c.y - wy * z);
    },

    screenToWorld(sx, sy) {
      return { x: (sx - cam.panX) / cam.zoom, y: (sy - cam.panY) / cam.zoom };
    },

    /** Tile bajo un punto de pantalla, o null si cae fuera del mapa. */
    screenToTile(sx, sy, gridW, gridH) {
      const w = this.screenToWorld(sx, sy);
      const tx = Math.floor(w.x / TILE_SIZE);
      const ty = Math.floor(w.y / TILE_SIZE);
      if (tx < 0 || ty < 0 || tx >= gridW || ty >= gridH) return null;
      return { x: tx, y: ty };
    },

    /** Posición de pantalla de un tile (esquina superior izquierda). */
    tileToScreen(tx, ty) {
      return { x: tx * TILE_SIZE * cam.zoom + cam.panX, y: ty * TILE_SIZE * cam.zoom + cam.panY };
    }
  };
}
