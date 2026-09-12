import * as maplibregl from 'https://unpkg.com/maplibre-gl@^6.8.0/dist/maplibre-gl.mjs'

const state = { lat: 51.50558, lon: -0.07536, heading: 0, speed: 0, onRoad: true }
const keys = new Set()
const earthRadius = 6378137

// Arcade driving values. World Mode is deliberately quicker than the first
// prototype, but steering is still damped at high speed.
const maxForwardSpeed = 44
const maxReverseSpeed = -11
const acceleration = 20
const braking = 26
const rollingDrag = 4.5
const steeringRate = 108
const roadToleranceMeters = 10.5

// The camera looks at a point in front of the kart. We then project the kart's
// real geographic position back to screen space and draw the sprite there.
// This means visual position and physics position share exactly the same anchor.
const cameraPitch = 84
const cameraZoom = 20.45
const cameraLookAheadMeters = 13

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
  zoom: cameraZoom,
  pitch: cameraPitch,
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
window.addEventListener('resize', positionKartOnMap)

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

  let proposedHeading = state.heading
  if (steeringInput !== 0 && absSpeed > 0.35) {
    const speedRatio = Math.min(absSpeed / maxForwardSpeed, 1)
    const highSpeedDamping = 1 - speedRatio * 0.45
    const lowSpeedAssist = Math.min(absSpeed / 4.5, 1)
    proposedHeading = normalizeHeading(
      state.heading + steeringInput * steeringRate * highSpeedDamping * lowSpeedAssist * direction * dt,
    )
  }

  if (Math.abs(state.speed) < 0.01) return

  // Try the player's requested steering first.
  const steeredMove = movementCandidate(state.lon, state.lat, proposedHeading, state.speed * dt)
  const steeredRoad = findNearestRoad(steeredMove.lon, steeredMove.lat)

  if (isDriveableRoadPosition(steeredRoad)) {
    state.heading = proposedHeading
    state.lon = steeredMove.lon
    state.lat = steeredMove.lat
    state.onRoad = true
    return
  }

  // Important: do NOT keep rotating the heading when road collision rejects the
  // movement. The old implementation did that, which made the whole map spin
  // around a stationary kart. If the turn would leave the road, try continuing
  // along the previous heading instead.
  const straightMove = movementCandidate(state.lon, state.lat, state.heading, state.speed * dt)
  const straightRoad = findNearestRoad(straightMove.lon, straightMove.lat)

  if (isDriveableRoadPosition(straightRoad)) {
    state.lon = straightMove.lon
    state.lat = straightMove.lat
    state.onRoad = true
    state.speed *= 0.985
    return
  }

  state.onRoad = false
  state.speed *= 0.58
}

function movementCandidate(lon, lat, heading, distance) {
  const headingRad = heading * Math.PI / 180
  const north = Math.cos(headingRad) * distance
  const east = Math.sin(headingRad) * distance
  const nextLat = lat + north / earthRadius * 180 / Math.PI
  const lonScale = Math.max(Math.cos(nextLat * Math.PI / 180), 0.0001)
  const nextLon = lon + east / (earthRadius * lonScale) * 180 / Math.PI
  return { lon: nextLon, lat: nextLat }
}

function isDriveableRoadPosition(nearest) {
  return Boolean(nearest && nearest.distance <= roadToleranceMeters)
}

function updateCamera(now, force = false) {
  if (!map.loaded()) return
  if (!force && now - lastCameraUpdate < 33) {
    positionKartOnMap()
    return
  }
  lastCameraUpdate = now

  const lookAt = movementCandidate(
    state.lon,
    state.lat,
    state.heading,
    cameraLookAheadMeters,
  )

  map.jumpTo({
    center: [lookAt.lon, lookAt.lat],
    bearing: state.heading,
    pitch: cameraPitch,
    zoom: cameraZoom,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
  })

  positionKartOnMap()
}

function positionKartOnMap() {
  if (!kartCanvas || !map.loaded()) return
  const point = map.project([state.lon, state.lat])
  kartCanvas.style.left = `${Math.round(point.x)}px`
  kartCanvas.style.top = `${Math.round(point.y)}px`
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
function normalizeHeading(value) { return (value % 360 + 360) % 360 }
function showError(message) { if (errorBox) { errorBox.hidden = false; errorBox.textContent = message } }
