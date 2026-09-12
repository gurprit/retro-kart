import * as maplibregl from 'https://unpkg.com/maplibre-gl@^6.8.0/dist/maplibre-gl.mjs'

const state = { lat: 51.50558, lon: -0.07536, heading: 0, speed: 0, onRoad: true }
const keys = new Set()
const earthRadius = 6378137

const maxForwardSpeed = 60
const maxReverseSpeed = -14
const acceleration = 42
const braking = 38
const rollingDrag = 2.2
const steeringRate = 126
const roadToleranceMeters = 11.5

const cameraPitch = 84
const cameraZoom = 20.45
const cameraLookAheadMeters = 13
const cameraIntervalMs = 25
const hudIntervalMs = 100

const ROAD_CACHE_RADIUS_METERS = 320
const ROAD_REFRESH_DISTANCE_METERS = 90
const ROAD_REFRESH_INTERVAL_MS = 1800
const ROAD_BUCKET_SIZE_METERS = 60

const FRAME_WIDTH = 32
const FRAME_HEIGHT = 32
const FRAME_GAP = 1
const FRAME_COUNT = 12
const BACKGROUND_TOLERANCE = 20
const DRIVING_FRAMES = {
  neutral: 0,
  slightTurn: 1,
  mediumTurn: 2,
  hardTurn: 3,
  powerslide: 4,
}
const TURN_FRAME_THRESHOLDS = {
  medium: 0.4,
  hard: 0.72,
}

const kartCanvas = document.querySelector('#kart-sprite')
const errorBox = document.querySelector('#world-error')
let transportSourceId = null
let kartFrames = []
let lastCameraUpdate = 0
let lastHudUpdate = 0
let lastRoadRefresh = 0
let lastRoadRefreshPosition = null
let roadBuckets = new Map()
let currentSteeringInput = 0

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
    kartFrames = await prepareKartFrames('/assets/characters/Racers - Mario.png')
    await waitForMapIdle()
    refreshRoadSegments(true)
    snapSpawnToNearestRoad()
    refreshRoadSegments(true)
    updateCamera(performance.now(), true)
    updateHud()
    drawKart()
  } catch (error) {
    showError(`World Mode loaded, but setup failed.\n\n${String(error)}`)
  }
})

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

  maybeRefreshRoadSegments(now)
  updateKart(dt)
  updateCamera(now)

  if (now - lastHudUpdate >= hudIntervalMs) {
    updateHud()
    lastHudUpdate = now
  }

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

  currentSteeringInput = (right ? 1 : 0) - (left ? 1 : 0)

  if (forward) {
    const speedRatio = Math.min(Math.max(state.speed, 0) / maxForwardSpeed, 1)
    const throttleAcceleration = acceleration * (1 - speedRatio * 0.34)
    state.speed = Math.min(maxForwardSpeed, state.speed + throttleAcceleration * dt)
  } else if (reverse) {
    state.speed = Math.max(maxReverseSpeed, state.speed - acceleration * 0.72 * dt)
  } else {
    state.speed = moveToward(state.speed, 0, rollingDrag * dt)
  }

  if (hardBrake) state.speed = moveToward(state.speed, 0, braking * dt)

  const absSpeed = Math.abs(state.speed)
  const direction = state.speed >= 0 ? 1 : -1

  let proposedHeading = state.heading
  if (currentSteeringInput !== 0 && absSpeed > 0.2) {
    const speedRatio = Math.min(absSpeed / maxForwardSpeed, 1)
    const highSpeedDamping = 1 - speedRatio * 0.28
    const lowSpeedAssist = Math.min(absSpeed / 2.8, 1)
    proposedHeading = normalizeHeading(
      state.heading
        + currentSteeringInput
        * steeringRate
        * highSpeedDamping
        * lowSpeedAssist
        * direction
        * dt,
    )
  }

  if (absSpeed < 0.01) return

  const steeredMove = movementCandidate(
    state.lon,
    state.lat,
    proposedHeading,
    state.speed * dt,
  )
  const steeredRoad = findNearestRoad(steeredMove.lon, steeredMove.lat)

  if (isDriveableRoadPosition(steeredRoad)) {
    state.heading = proposedHeading
    state.lon = steeredMove.lon
    state.lat = steeredMove.lat
    state.onRoad = true
    return
  }

  const straightMove = movementCandidate(
    state.lon,
    state.lat,
    state.heading,
    state.speed * dt,
  )
  const straightRoad = findNearestRoad(straightMove.lon, straightMove.lat)

  if (isDriveableRoadPosition(straightRoad)) {
    state.lon = straightMove.lon
    state.lat = straightMove.lat
    state.onRoad = true
    return
  }

  state.onRoad = false
  state.speed *= 0.88
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
  if (!force && now - lastCameraUpdate < cameraIntervalMs) return
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
  if (!kartCanvas || kartFrames.length === 0) return

  const ctx = kartCanvas.getContext('2d')
  if (!ctx) return

  const speedRatio = Math.min(Math.abs(state.speed) / maxForwardSpeed, 1)
  const steerDirection = Math.sign(currentSteeringInput)
  let frameIndex = DRIVING_FRAMES.neutral

  if (steerDirection !== 0) {
    if (speedRatio >= TURN_FRAME_THRESHOLDS.hard) frameIndex = DRIVING_FRAMES.hardTurn
    else if (speedRatio >= TURN_FRAME_THRESHOLDS.medium) frameIndex = DRIVING_FRAMES.mediumTurn
    else frameIndex = DRIVING_FRAMES.slightTurn
  }

  const frame = kartFrames[Math.min(frameIndex, kartFrames.length - 1)] ?? kartFrames[0]
  if (!frame) return

  ctx.imageSmoothingEnabled = false
  ctx.clearRect(0, 0, kartCanvas.width, kartCanvas.height)

  const size = 104
  const x = Math.round((kartCanvas.width - size) / 2)
  const y = Math.round(kartCanvas.height - size - 4)

  ctx.save()
  if (steerDirection < 0) {
    ctx.translate(kartCanvas.width, 0)
    ctx.scale(-1, 1)
  }
  ctx.drawImage(frame, x, y, size, size)
  ctx.restore()
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
      filter: ['in', ['get', 'class'], ['literal', [
        'motorway',
        'trunk',
        'primary',
        'secondary',
        'tertiary',
        'minor',
        'service',
      ]]],
      paint: {
        'line-color': '#333333',
        'line-width': ['interpolate', ['linear'], ['zoom'], 15, 3, 19, 18, 20, 24],
        'line-opacity': 0.96,
      },
    })
  }
}

function maybeRefreshRoadSegments(now) {
  if (!transportSourceId || !map.loaded() || !map.areTilesLoaded()) return
  if (now - lastRoadRefresh < ROAD_REFRESH_INTERVAL_MS) return

  if (!lastRoadRefreshPosition) {
    refreshRoadSegments(true)
    return
  }

  const moved = distanceBetweenMeters(
    state.lon,
    state.lat,
    lastRoadRefreshPosition.lon,
    lastRoadRefreshPosition.lat,
  )

  if (moved >= ROAD_REFRESH_DISTANCE_METERS) refreshRoadSegments()
}

function refreshRoadSegments(force = false) {
  if (!transportSourceId || !map.loaded()) return
  if (!force && !map.areTilesLoaded()) return

  const features = map.querySourceFeatures(
    transportSourceId,
    { sourceLayer: 'transportation' },
  )
  const allowed = new Set([
    'motorway',
    'trunk',
    'primary',
    'secondary',
    'tertiary',
    'minor',
    'service',
  ])

  const nextBuckets = new Map()
  const seen = new Set()

  for (const feature of features) {
    if (!allowed.has(feature.properties?.class)) continue

    const geometry = feature.geometry
    const lines = geometry.type === 'LineString'
      ? [geometry.coordinates]
      : geometry.type === 'MultiLineString'
        ? geometry.coordinates
        : []

    for (const line of lines) {
      for (let i = 0; i < line.length - 1; i++) {
        const a = line[i]
        const b = line[i + 1]
        if (!segmentNearPlayer(a, b, ROAD_CACHE_RADIUS_METERS)) continue

        const key = segmentKey(a, b)
        if (seen.has(key)) continue
        seen.add(key)

        addSegmentToBuckets(nextBuckets, [a, b])
      }
    }
  }

  if (nextBuckets.size > 0) {
    roadBuckets = nextBuckets
    lastRoadRefreshPosition = { lon: state.lon, lat: state.lat }
  }

  lastRoadRefresh = performance.now()
}

function addSegmentToBuckets(buckets, segment) {
  const [a, b] = segment
  const midpointLon = (a[0] + b[0]) * 0.5
  const midpointLat = (a[1] + b[1]) * 0.5
  const bucket = roadBucketFor(midpointLon, midpointLat)
  const key = `${bucket.x}:${bucket.y}`
  const existing = buckets.get(key)
  if (existing) existing.push(segment)
  else buckets.set(key, [segment])
}

function snapSpawnToNearestRoad() {
  const best = findNearestRoad(state.lon, state.lat, 3)
  if (!best || best.distance > 150) return

  state.lon = best.lon
  state.lat = best.lat
  state.heading = best.heading
  state.onRoad = true
}

function findNearestRoad(lon, lat, searchRadiusBuckets = 1) {
  const origin = roadBucketFor(lon, lat)
  let best = null

  for (let dx = -searchRadiusBuckets; dx <= searchRadiusBuckets; dx++) {
    for (let dy = -searchRadiusBuckets; dy <= searchRadiusBuckets; dy++) {
      const segments = roadBuckets.get(`${origin.x + dx}:${origin.y + dy}`)
      if (!segments) continue

      for (const [a, b] of segments) {
        const candidate = nearestPointOnSegment(lon, lat, a, b)
        if (!best || candidate.distance < best.distance) best = candidate
      }
    }
  }

  return best
}

function roadBucketFor(lon, lat) {
  const cosLat = Math.cos(state.lat * Math.PI / 180)
  const metersPerDegLat = Math.PI * earthRadius / 180
  const metersPerDegLon = metersPerDegLat * Math.max(cosLat, 0.0001)
  return {
    x: Math.floor(lon * metersPerDegLon / ROAD_BUCKET_SIZE_METERS),
    y: Math.floor(lat * metersPerDegLat / ROAD_BUCKET_SIZE_METERS),
  }
}

function segmentNearPlayer(a, b, radiusMeters) {
  const midpointLon = (a[0] + b[0]) * 0.5
  const midpointLat = (a[1] + b[1]) * 0.5
  const segmentHalfLength = distanceBetweenMeters(a[0], a[1], b[0], b[1]) * 0.5
  return distanceBetweenMeters(state.lon, state.lat, midpointLon, midpointLat) <= radiusMeters + segmentHalfLength
}

function segmentKey(a, b) {
  const aKey = `${a[0].toFixed(6)},${a[1].toFixed(6)}`
  const bKey = `${b[0].toFixed(6)},${b[1].toFixed(6)}`
  return aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`
}

function distanceBetweenMeters(lonA, latA, lonB, latB) {
  const meanLat = (latA + latB) * 0.5 * Math.PI / 180
  const metersPerDegLat = Math.PI * earthRadius / 180
  const metersPerDegLon = metersPerDegLat * Math.max(Math.cos(meanLat), 0.0001)
  const dx = (lonB - lonA) * metersPerDegLon
  const dy = (latB - latA) * metersPerDegLat
  return Math.hypot(dx, dy)
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

function prepareKartFrames(src) {
  return new Promise((resolve, reject) => {
    const image = new Image()

    image.onload = () => {
      const sourceCanvas = document.createElement('canvas')
      sourceCanvas.width = image.naturalWidth
      sourceCanvas.height = image.naturalHeight

      const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true })
      if (!sourceContext) {
        resolve([])
        return
      }

      sourceContext.imageSmoothingEnabled = false
      sourceContext.drawImage(image, 0, 0)

      const availableFrames = Math.min(
        FRAME_COUNT,
        Math.floor((image.naturalWidth + FRAME_GAP) / (FRAME_WIDTH + FRAME_GAP)),
      )

      const frames = []

      for (let index = 0; index < availableFrames; index += 1) {
        const sourceX = index * (FRAME_WIDTH + FRAME_GAP)
        const imageData = sourceContext.getImageData(
          sourceX,
          0,
          FRAME_WIDTH,
          FRAME_HEIGHT,
        )

        removeFrameBackground(imageData)

        const frameCanvas = document.createElement('canvas')
        frameCanvas.width = FRAME_WIDTH
        frameCanvas.height = FRAME_HEIGHT

        const frameContext = frameCanvas.getContext('2d')
        if (!frameContext) continue

        frameContext.imageSmoothingEnabled = false
        frameContext.clearRect(0, 0, FRAME_WIDTH, FRAME_HEIGHT)
        frameContext.putImageData(imageData, 0, 0)
        frames.push(frameCanvas)
      }

      resolve(frames)
    }

    image.onerror = reject
    image.src = src
  })
}

function removeFrameBackground(imageData) {
  const pixels = imageData.data
  const corners = [
    pixelAt(pixels, 0, 0),
    pixelAt(pixels, FRAME_WIDTH - 1, 0),
    pixelAt(pixels, 0, FRAME_HEIGHT - 1),
    pixelAt(pixels, FRAME_WIDTH - 1, FRAME_HEIGHT - 1),
  ]

  for (let offset = 0; offset < pixels.length; offset += 4) {
    const matchesBackground = corners.some(
      ({ r, g, b }) =>
        Math.abs(pixels[offset] - r)
        + Math.abs(pixels[offset + 1] - g)
        + Math.abs(pixels[offset + 2] - b)
        <= BACKGROUND_TOLERANCE,
    )

    if (matchesBackground) pixels[offset + 3] = 0
  }
}

function pixelAt(pixels, x, y) {
  const offset = (y * FRAME_WIDTH + x) * 4
  return {
    r: pixels[offset],
    g: pixels[offset + 1],
    b: pixels[offset + 2],
  }
}

function updateHud() {
  setText('#hud-lat', state.lat.toFixed(5))
  setText('#hud-lon', state.lon.toFixed(5))
  setText('#hud-heading', `${Math.round(state.heading)}°`)
  setText('#hud-speed', `${Math.round(Math.abs(state.speed) * 3.6)} km/h`)
  setText('#hud-surface', state.onRoad ? 'ROAD' : 'BLOCKED')
}

function setText(selector, value) {
  const el = document.querySelector(selector)
  if (el) el.textContent = value
}

function moveToward(value, target, amount) {
  if (value < target) return Math.min(value + amount, target)
  if (value > target) return Math.max(value - amount, target)
  return target
}

function normalizeHeading(value) {
  return (value % 360 + 360) % 360
}

function showError(message) {
  if (!errorBox) return
  errorBox.hidden = false
  errorBox.textContent = message
}