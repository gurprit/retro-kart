import * as maplibregl from 'https://unpkg.com/maplibre-gl@^6.8.0/dist/maplibre-gl.mjs'

const state = { lat: 51.5055, lon: -0.0754, heading: 85, speed: 0 }
const keys = new Set()
const earthRadius = 6378137
const maxForwardSpeed = 22
const maxReverseSpeed = -7
const acceleration = 9
const braking = 14
const rollingDrag = 3
const steeringRate = 78
const kart = document.querySelector('#kart-sprite')
const errorBox = document.querySelector('#world-error')

const map = new maplibregl.Map({
  container: 'world',
  style: 'https://tiles.openfreemap.org/styles/liberty',
  center: [state.lon, state.lat],
  zoom: 17.3,
  pitch: 67,
  bearing: state.heading,
  attributionControl: true,
  maplibreLogo: false,
  interactive: false,
  antialias: true,
})

map.on('load', () => {
  try {
    makeWorldGameLike()
    updateHud()
  } catch (error) {
    showError(`World Mode loaded, but styling failed.\n\n${String(error)}`)
  }
})

map.on('error', (event) => {
  console.error('MapLibre error', event.error)
})

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
  updateKart(dt)
  updateCamera()
  updateHud()
  updateKartSprite()
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

  const speedFactor = Math.min(Math.abs(state.speed) / 4, 1)
  const direction = state.speed >= 0 ? 1 : -1
  if (left) state.heading -= steeringRate * speedFactor * direction * dt
  if (right) state.heading += steeringRate * speedFactor * direction * dt
  state.heading = (state.heading + 360) % 360

  const distance = state.speed * dt
  const headingRad = state.heading * Math.PI / 180
  const north = Math.cos(headingRad) * distance
  const east = Math.sin(headingRad) * distance
  state.lat += north / earthRadius * 180 / Math.PI
  const lonScale = Math.max(Math.cos(state.lat * Math.PI / 180), 0.0001)
  state.lon += east / (earthRadius * lonScale) * 180 / Math.PI
}

function updateCamera() {
  if (!map.loaded()) return
  map.jumpTo({ center: [state.lon, state.lat], bearing: state.heading, pitch: 67, zoom: 17.3 })
}

function updateKartSprite() {
  if (!kart) return
  const steering = (keys.has('ArrowLeft') || keys.has('KeyA')) ? -1 : (keys.has('ArrowRight') || keys.has('KeyD')) ? 1 : 0
  kart.style.setProperty('--kart-turn', `${steering * 4}deg`)
}

function makeWorldGameLike() {
  const layers = map.getStyle().layers || []
  for (const layer of layers) {
    if (layer.type === 'symbol') {
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
      minzoom: 14,
      paint: {
        'fill-extrusion-color': ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], ['get', 'height'], 8], 0, '#d9d2c3', 20, '#c6bba9', 80, '#a99d8c'],
        'fill-extrusion-height': ['coalesce', ['get', 'render_height'], ['get', 'height'], 8],
        'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
        'fill-extrusion-opacity': 0.92,
      },
    })
  }

  const transportLayer = layers.find((layer) => layer['source-layer'] === 'transportation')
  if (transportLayer) {
    map.addLayer({
      id: 'retro-kart-road-highlight',
      type: 'line',
      source: transportLayer.source,
      'source-layer': 'transportation',
      filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service']]],
      paint: { 'line-color': '#353535', 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 2, 18, 14], 'line-opacity': 0.9 },
    })
  }
}

function updateHud() {
  setText('#hud-lat', state.lat.toFixed(5))
  setText('#hud-lon', state.lon.toFixed(5))
  setText('#hud-heading', `${Math.round(state.heading)}°`)
  setText('#hud-speed', `${Math.round(Math.abs(state.speed) * 3.6)} km/h`)
}
function setText(selector, value) { const el = document.querySelector(selector); if (el) el.textContent = value }
function moveToward(value, target, amount) {
  if (value < target) return Math.min(value + amount, target)
  if (value > target) return Math.max(value - amount, target)
  return target
}
function showError(message) { if (errorBox) { errorBox.hidden = false; errorBox.textContent = message } }
