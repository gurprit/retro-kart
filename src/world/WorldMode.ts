import { WorldKart, type WorldControls, type WorldSurface } from './WorldKart'
import './world-mode.css'

type Point = { x: number; y: number }
type MapFeature = { layer?: { id?: string; 'source-layer'?: string }; properties?: Record<string, unknown> }
type MapLibreMap = {
  on(event: string, handler: () => void): void
  jumpTo(options: Record<string, unknown>): void
  resize(): void
  getCanvas(): HTMLCanvasElement
  queryRenderedFeatures(point: Point, options?: { layers?: string[] }): MapFeature[]
}
type MapLibre = { Map: new (options: Record<string, unknown>) => MapLibreMap }

// Broadway at Times Square: a broad OSM road with an immediately navigable junction.
const START = { lng: -73.98553, lat: 40.75802, heading: -0.50 }
const STYLE = 'https://tiles.openfreemap.org/styles/liberty'

function loadMapLibre(): Promise<MapLibre> {
  return new Promise((resolve, reject) => {
    const existing = (window as unknown as { maplibregl?: MapLibre }).maplibregl
    if (existing) return resolve(existing)
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = 'https://unpkg.com/maplibre-gl@5.7.1/dist/maplibre-gl.css'
    document.head.append(link)
    const script = document.createElement('script')
    script.src = 'https://unpkg.com/maplibre-gl@5.7.1/dist/maplibre-gl.js'
    script.onload = () => resolve((window as unknown as { maplibregl: MapLibre }).maplibregl)
    script.onerror = () => reject(new Error('Unable to load MapLibre'))
    document.head.append(script)
  })
}

export async function startWorldMode() {
  document.body.innerHTML = `<main id="world-map" aria-label="World Mode map"></main>
    <div id="world-kart" role="img" aria-label="Mario's kart"></div>
    <section id="world-hud"><strong>WORLD MODE</strong><output id="speed">0</output><span>km/h</span><em id="surface">LOADING MAP</em></section>
    <aside id="help">↑/W accelerate · ↓/S reverse · ← → steer · Space drift<br><a href="?classic">Classic Retro Kart</a></aside>
    <div id="load-error" hidden></div>`

  try {
    const maplibre = await loadMapLibre()
    runWorld(maplibre)
  } catch (error) {
    const message = document.querySelector<HTMLDivElement>('#load-error')!
    message.hidden = false
    message.textContent = `${error instanceof Error ? error.message : error}. Check your connection and reload.`
  }
}

function runWorld(maplibre: MapLibre) {
  const kart = new WorldKart(START.lng, START.lat, START.heading)
  const map = new maplibre.Map({
    container: 'world-map', style: STYLE, center: [kart.lng, kart.lat], zoom: 18.4,
    pitch: 73, bearing: 90, antialias: false, attributionControl: false,
  })
  const pressed = new Set<string>()
  const speed = document.querySelector<HTMLOutputElement>('#speed')!
  const surfaceLabel = document.querySelector<HTMLElement>('#surface')!
  let surface: WorldSurface = 'road'
  let ready = false
  let last = performance.now()
  let surfaceTimer = 0

  addEventListener('keydown', (event) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)) event.preventDefault()
    pressed.add(event.code)
  })
  addEventListener('keyup', (event) => pressed.delete(event.code))
  addEventListener('blur', () => pressed.clear())
  map.on('load', () => { ready = true; map.resize(); surfaceLabel.textContent = 'ON ROAD' })

  const frame = (now: number) => {
    const dt = Math.min((now - last) / 1000, 0.05)
    last = now
    if (ready) {
      surfaceTimer -= dt
      if (surfaceTimer <= 0) {
        surface = roadAtKart(map) ? 'road' : 'offroad'
        surfaceTimer = 0.1
      }
      const controls: WorldControls = {
        accelerate: pressed.has('ArrowUp') || pressed.has('KeyW'),
        brake: pressed.has('ArrowDown') || pressed.has('KeyS'),
        left: pressed.has('ArrowLeft') || pressed.has('KeyA'),
        right: pressed.has('ArrowRight') || pressed.has('KeyD'),
        powerslide: pressed.has('Space'),
      }
      kart.update(controls, dt, surface)
      // Padding places the geographic camera pivot exactly beneath the kart sprite.
      map.jumpTo({ center: [kart.lng, kart.lat], bearing: kart.heading * 180 / Math.PI,
        padding: { top: innerHeight * 0.42, bottom: 0, left: 0, right: 0 } })
      speed.value = String(Math.round(kart.kilometresPerHour))
      surfaceLabel.textContent = surface === 'road' ? 'ON ROAD' : 'OFF ROAD'
      surfaceLabel.classList.toggle('offroad', surface === 'offroad')
    }
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

function roadAtKart(map: MapLibreMap) {
  const canvas = map.getCanvas()
  const point = { x: canvas.clientWidth / 2, y: canvas.clientHeight * 0.71 }
  // A small footprint avoids cracks between road polygons at intersections.
  const features = map.queryRenderedFeatures(point)
  return features.some((feature) => {
    const sourceLayer = feature.layer?.['source-layer'] ?? ''
    const id = feature.layer?.id ?? ''
    const kind = String(feature.properties?.class ?? feature.properties?.subclass ?? '')
    return sourceLayer === 'transportation' || /road|street|motorway|path|track/i.test(`${id} ${kind}`)
  })
}
