# Monitor Vecinal en 2D Pixel Art — Sendero Río del Hato

Aplicación web **100% en español**, **100% anónima** y lista para publicar gratis en **GitHub Pages** usando `data/incidents.json` como base de datos abierta estilo Wikipedia.

## Características Principales

1. **Tablero Prioritario Gigante (`DÍAS DESDE EL ÚLTIMO INCIDENTE`)**:
   - Calcula automáticamente los días transcurridos desde el incidente más reciente en el sector.
   - Muestra el resumen del último evento, total de incidentes y cantidad de píxeles rojos en alerta.
2. **Mapa 2D Pixel Art con Sistema GPS por Píxeles (`120 × 80`)**:
   - Basado en la vista del sector `@7.0060325,-73.0640861,16.21z` (**Río del Hato, Sendero Río del Hato, Ciudad Tierrabuena, Exploretheworld, Azafrán, Conjunto Terracota y Autopista Piedecuesta**).
   - Incluye zoom fluido, arrastre libre, botón **Mi Píxel GPS** (100% local en el navegador) .
3. **Propagación de Píxeles Rojos según Incidente y Fecha**:
   - Al asociar un evento a un píxel `(X, Y)`, los píxeles vecinos se tiñen de rojo dependiendo de la gravedad (1 a 5), la cercanía de otros eventos y qué tan reciente es la fecha.
4. **6 Incidentes Iniciales en el Sendero Río del Hato**:
   - **#1** en la vía `Río del Hato` justo arriba de tu posición (punto azul).
   - **#2 al #6** ubicados a lo largo del **Sendero Río del Hato** por encima de la línea azul del río.
5. **Edición Abierta Estilo Wikipedia (`data/incidents.json`)**:
   - Permite reportar nuevos incidentes, confirmar fechas pendientes, mover el píxel de cualquier incidente en el mapa y revertir cambios desde la pestaña **Historial Wiki**.

## Uso Local

```bash
npm run dev
```

Abre `http://localhost:5173`. Cualquier cambio que hagas desde la interfaz en modo local se guarda automáticamente en `data/incidents.json`.

## Publicar Gratis en GitHub Pages

1. Sube este repositorio a GitHub.
2. En tu repositorio ve a **Settings → Pages → Build and deployment → Source: Deploy from a branch** y selecciona la rama `main` (`/ (root)`).
3. *(Opcional para edición directa de todos los vecinos sin cuenta de GitHub)*: Despliega gratis `worker/github-wiki-bridge.js` en Cloudflare Workers con un token restringido a `data/incidents.json`.
