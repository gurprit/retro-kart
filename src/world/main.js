import * as maplibregl from 'https://unpkg.com/maplibre-gl@^6.8.0/dist/maplibre-gl.mjs'

const state = { lat: 51.50558, lon: -0.07536, heading: 0, speed: 0, onRoad: true }
const keys = new Set()
const earthRadius = 6378137
const maxForwardSpeed = 36
const maxReverseSpeed = -10
const acceleration = 16
const braking = 22
const rollingDrag = 4
const steeringRate = 102
const roadToleranceMeters = 7.5
const kartCanvas = document.querySelector('#kart-sprite')
const errorBox = document.querySelector('#world-error')
let transportSourceId = null
let kartFrame = null
let lastCameraUpdate = 0
let roadSegments = []
let lastRoadRefresh = 0

const map = new maplibregl.Map({
  container: 'world',
  style: 'https://tiles.openfreemap.org/styles/liberty',
  center: [state.lon, state.lat],
  zoom: 20.15,
  pitch: 82,
  maxPitch: 85,
  bearing: state.heading,
  attributionControl: true,
  maplibreLogo: false,
  interactive: false,
  antialias: false,
})

map.on('load', async () => {
  try {
    makeWorldGameLike()
    kartFrame = await prepareKartFrame('/assets/characters/Racers - Mario.png')
    await waitForMapIdle()
    refreshRoadSegments()
    snapSpawnToNearestRoad()
    updateCamera(performance.now(), true)
    updateHud()
    drawKart()
  } catch (error) {
    showError(`World Mode loaded, but setup failed.\n\n${String(error)}`)
  }
})

map.on('idle', () => refreshRoadSegments())
map.on('error', (event) => console.error('MapLibre error', event.error))

window.addEventListener('keydown', (event) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)) event.preventDefault()
  keys.add(event.code)
})
window.addEventListener('keyup', (event) => keys.delete(event.code))
window.addEventListener('blur', () => keys.clear())

let lastTime = performance.now()
function frame(now) {
  const dt = Math.min((now - lastTime) / 1000, 0.05)
  lastTime = now

  if (now - lastRoadRefresh > 900 && map.areTilesLoaded()) refreshRoadSegments()

  updateKart(dt)
  updateCamera(now)
  updateHud()
  drawKart()
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)

function updateKart(dt) {
  const forward = keys.has('ArrowUp') || keys.has('KeyW')
  const reverse = keys.has('ArrowDown') || keys.has('KeyS')
  const left = keys.has('ArrowLeft') || keys.has('KeyA')
  const right = keys.has('ArrowRight') || keys.has('KeyD')
  const hardBrake = keys.has('Space')

  if (forward) state.speed = Math.min(maxForwardSpeed, state.speed + acceleration * dt)
  else if (reverse) state.speed = Math.max(maxReverseSpeed, state.speed - acceleration * dt)
  else state.speed = moveToward(state.speed, 0, rollingDrag * dt)
  if (hardBrake) state.speed = moveToward(state.speed, 0, braking * dt)

  const absSpeed = Math.abs(state.speed)
  const direction = state.speed >= 0 ? 1 : -1
  const steeringInput = (right ? 1 : 0) - (left ? 1 : 0)

  // Arcade steering: enough authority at low speed to turn naturally, but
  // progressively calmer at high speed so the road does not whip around the kart.
  if (steeringInput !== 0 && absSpeed > 0.4) {
    const speedRatio = Math.min(absSpeed / maxForwardSpeed, 1)
    const highSpeedDamping = 1 - speedRatio * 0.36
    const lowSpeedAssist = Math.min(absSpeed / 5, 1)
    state.heading += steeringInput * steeringRate * highSpeedDamping * lowSpeedAssist * direction * dt
  }
  state.heading = (state.heading + 360) % 360

  const previous = { lat: state.lat, lon: state.lon }
  const distance = state.speed * dt
  const headingRad = state.heading * Math.PI / 180
  const north = Math.cos(headingRad) * distance
  const east = Math.sin(headingRad) * distance
  const candidateLat = state.lat + north / earthRadius * 180 / Math.PI
  const lonScale = Math.max(Math.cos(candidateLat * Math.PI / 180), 0.0001)
  const candidateLon = state.lon + east / (earthRadius * lonScale) * 180 / Math.PI

  const nearest = findNearestRoad(candidateLon, candidateLat)

  if (!nearest || nearest.distance > roadToleranceMeters) {
    state.onRoad = false
    state.lat = previous.lat
    state.lon = previous.lon
    state.speed *= 0.72
    return
  }

  // Do not magnetically pull the kart toward the road centre. That was fighting
  // steering input and made the world appear to pivot around the wrong point.
  // The road data now acts only as a boundary/collision surface.
  state.onRoad = true
  state.lat = candidateLat
  state.lon = candidateLon
}

function updateCamera(now, force = false) {
  if (!map.loaded()) return
  if (!force && now - lastCameraUpdate < 33) return
  lastCameraUpdate = now

  map.jumpTo({
    center: [state.lon, state.lat],
    bearing: state.heading,
    pitch: 82,
    zoom: 20.15,
    padding: {
      top: 0,
      right: 0,
      bottom: Math.round(window.innerHeight * 0.44),
      left: 0,
    },
  })
}

function drawKart() {
  if (!kartCanvas || !kartFrame) return
  const ctx = kartCanvas.getContext('2d')
  if (!ctx) return
  ctx.imageSmoothingEnabled = false
  ctx.clearRect(0, 0, kartCanvas.width, kartCanvas.height)

  const size = 104
  const x = Math.round((kartCanvas.width - size) / 2)
  const y = Math.round(kartCanvas.height - size - 4)
  ctx.drawImage(kartFrame, x, y, size, size)
}

function makeWorldGameLike() {
  const layers = map.getStyle().layers || []
  for (const layer of layers) {
    if (layer.type === 'symbol') {
      try { map.setLayoutProperty(layer.id, 'visibility', 'none') } catch {}
    }
    if (layer['source-layer'] === 'building') {
      try { map.setLayoutProperty(layer.id, 'visibility', 'none') } catch {}
    }
  }

  const buildingLayer = layers.find((layer) => layer['source-layer'] === 'building')
  if (buildingLayer) {
    map.addLayer({
      id: 'retro-kart-buildings',
      type: 'fill-extrusion',
      source: buildingLayer.source,
      'source-layer': 'building',
      minzoom: 15,
      paint: {
        'fill-extrusion-color': '#b9b0a2',
        'fill-extrusion-height': ['coalesce', ['get', 'render_height'], ['get', 'height'], 8],
        'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
        'fill-extrusion-opacity': 0.88,
      },
    })
  }

  const transportLayer = layers.find((layer) => layer['source-layer'] === 'transportation')
  if (transportLayer) {
    transportSourceId = transportLayer.source
    map.addLayer({
      id: 'retro-kart-road-highlight',
      type: 'line',
      source: transportLayer.source,
      'source-layer': 'transportation',
      filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service']]],
      paint: {
        'line-color': '#333333',
        'line-width': ['interpolate', ['linear'], ['zoom'], 15, 3, 19, 18, 20, 24],
        'line-opacity': 0.96,
      },
    })
  }
}

function refreshRoadSegments() {
  if (!transportSourceId || !map.loaded()) return
  const features = map.querySourceFeatures(transportSourceId, { sourceLayer: 'transportation' })
  const allowed = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service'])
  const segments = []

  for (const feature of features) {
    if (!allowed.has(feature.properties?.class)) continue
    const geometry = feature.geometry
    const lines = geometry.type === 'LineString'
      ? [geometry.coordinates]
      : geometry.type === 'MultiLineString'
        ? geometry.coordinates
        : []

    for (const line of lines) {
      for (let i = 0; i < line.length - 1; i++) segments.push([line[i], line[i + 1]])
    }
  }

  if (segments.length) roadSegments = segments
  lastRoadRefresh = performance.now()
}

function snapSpawnToNearestRoad() {
  const best = findNearestRoad(state.lon, state.lat)
  if (!best || best.distance > 150) return
  state.lon = best.lon
  state.lat = best.lat
  state.heading = best.heading
  state.onRoad = true
}

function findNearestRoad(lon, lat) {
  let best = null
  for (const [a, b] of roadSegments) {
    const candidate = nearestPointOnSegment(lon, lat, a, b)
    if (!best || candidate.distance < best.distance) best = candidate
  }
  return best
}

function nearestPointOnSegment(lon, lat, a, b) {
  const cosLat = Math.cos(lat * Math.PI / 180)
  const metersPerDegLat = Math.PI * earthRadius / 180
  const metersPerDegLon = metersPerDegLat * cosLat
  const ax = (a[0] - lon) * metersPerDegLon
  const ay = (a[1] - lat) * metersPerDegLat
  const bx = (b[0] - lon) * metersPerDegLon
  const by = (b[1] - lat) * metersPerDegLat
  const vx = bx - ax
  const vy = by - ay
  const denom = vx * vx + vy * vy || 1
  const t = Math.max(0, Math.min(1, -(ax * vx + ay * vy) / denom))
  const px = ax + vx * t
  const py = ay + vy * t
  const distance = Math.hypot(px, py)
  const snappedLon = lon + px / metersPerDegLon
  const snappedLat = lat + py / metersPerDegLat
  const heading = (Math.atan2(vx, vy) * 180 / Math.PI + 360) % 360
  return { lon: snappedLon, lat: snappedLat, distance, heading }
}

function waitForMapIdle() {
  if (map.loaded() && map.areTilesLoaded()) return Promise.resolve()
  return new Promise((resolve) => map.once('idle', resolve))
}

function prepareKartFrame(src) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      const frameSize = image.naturalHeight
      const canvas = document.createElement('canvas')
      canvas.width = frameSize
      canvas.height = frameSize
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      ctx.drawImage(image, 0, 0, frameSize, frameSize, 0, 0, frameSize, frameSize)

      const pixels = ctx.getImageData(0, 0, frameSize, frameSize)
      for (let i = 0; i < pixels.data.length; i += 4) {
        const r = pixels.data[i]
        const g = pixels.data[i + 1]
        const b = pixels.data[i + 2]
        if (g > 70 && g > r * 1.18 && g > b * 1.12) pixels.data[i + 3] = 0
      }
      ctx.putImageData(pixels, 0, 0)
      resolve(canvas)
    }
    image.onerror = reject
    image.src = src
  })
}

function updateHud() {
  setText('#hud-lat', state.lat.toFixed(5))
  setText('#hud-lon', state.lon.toFixed(5))
  setText('#hud-heading', `${Math.round(state.heading)}°`)
  setText('#hud-speed', `${Math.round(Math.abs(state.speed) * 3.6)} km/h`)
  setText('#hud-surface', state.onRoad ? 'ROAD' : 'BLOCKED')
}
function setText(selector, value) { const el = document.querySelector(selector); if (el) el.textContent = value }
function moveToward(value, target, amount) {
  if (value < target) return Math.min(value + amount, target)
  if (value > target) return Math.max(value - amount, target)
  return target
}
function showError(message) { if (errorBox) { errorBox.hidden = false; errorBox.textContent = message } }
