const Cesium = window.Cesium

const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY
const errorBox = document.querySelector('#world-error')

if (!Cesium) {
  showError('Cesium failed to load.')
  throw new Error('Cesium failed to load')
}

if (!apiKey) {
  showError(
    'World Mode needs a Google Maps Platform API key.\n\nCreate .env.local in the project root and add:\nVITE_GOOGLE_MAPS_API_KEY=your_key_here',
  )
  throw new Error('Missing VITE_GOOGLE_MAPS_API_KEY')
}

Cesium.RequestScheduler.requestsByServer['tile.googleapis.com:443'] = 18

const viewer = new Cesium.Viewer('world', {
  animation: false,
  baseLayerPicker: false,
  fullscreenButton: false,
  geocoder: false,
  homeButton: false,
  imageryProvider: false,
  infoBox: false,
  navigationHelpButton: false,
  sceneModePicker: false,
  selectionIndicator: false,
  timeline: false,
})

viewer.scene.globe.show = false
viewer.scene.skyAtmosphere.show = true
viewer.scene.screenSpaceCameraController.enableInputs = false

const tileset = viewer.scene.primitives.add(
  new Cesium.Cesium3DTileset({
    url: `https://tile.googleapis.com/v1/3dtiles/root.json?key=${encodeURIComponent(apiKey)}`,
    showCreditsOnScreen: true,
  }),
)

const state = {
  lat: 51.5055,
  lon: -0.0754,
  altitude: 6,
  heading: 0,
  speed: 0,
}

const keys = new Set()
const earthRadius = 6378137
const maxForwardSpeed = 22
const maxReverseSpeed = -7
const acceleration = 9
const braking = 14
const rollingDrag = 3
const steeringRate = 78

const kartImage = await loadKartFrame('/assets/characters/Racers - Mario.png')

const kart = viewer.entities.add({
  position: Cesium.Cartesian3.fromDegrees(state.lon, state.lat, state.altitude),
  billboard: {
    image: kartImage,
    width: 96,
    height: 96,
    verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
    disableDepthTestDistance: 0,
  },
})

try {
  await tileset.readyPromise
} catch (error) {
  showError(`Google 3D Tiles could not load.\n\n${String(error)}`)
  throw error
}

window.addEventListener('keydown', (event) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)) {
    event.preventDefault()
  }
  keys.add(event.code)
})

window.addEventListener('keyup', (event) => {
  keys.delete(event.code)
})

let lastTime = performance.now()

viewer.clock.onTick.addEventListener(() => {
  const now = performance.now()
  const dt = Math.min((now - lastTime) / 1000, 0.05)
  lastTime = now

  updateKart(dt)
  updateEntity()
  updateCamera()
  updateHud()
})

updateCamera()
updateHud()

function updateKart(dt) {
  const forward = keys.has('ArrowUp') || keys.has('KeyW')
  const reverse = keys.has('ArrowDown') || keys.has('KeyS')
  const left = keys.has('ArrowLeft') || keys.has('KeyA')
  const right = keys.has('ArrowRight') || keys.has('KeyD')
  const hardBrake = keys.has('Space')

  if (forward) {
    state.speed = Math.min(maxForwardSpeed, state.speed + acceleration * dt)
  } else if (reverse) {
    state.speed = Math.max(maxReverseSpeed, state.speed - acceleration * dt)
  } else {
    state.speed = moveToward(state.speed, 0, rollingDrag * dt)
  }

  if (hardBrake) {
    state.speed = moveToward(state.speed, 0, braking * dt)
  }

  const speedFactor = Math.min(Math.abs(state.speed) / 4, 1)
  const direction = state.speed >= 0 ? 1 : -1

  if (left) state.heading -= steeringRate * speedFactor * direction * dt
  if (right) state.heading += steeringRate * speedFactor * direction * dt

  state.heading = (state.heading + 360) % 360

  const distance = state.speed * dt
  const headingRad = Cesium.Math.toRadians(state.heading)
  const north = Math.cos(headingRad) * distance
  const east = Math.sin(headingRad) * distance

  state.lat += Cesium.Math.toDegrees(north / earthRadius)

  const latitudeRadians = Cesium.Math.toRadians(state.lat)
  const lonScale = Math.max(Math.cos(latitudeRadians), 0.0001)
  state.lon += Cesium.Math.toDegrees(east / (earthRadius * lonScale))
}

function updateEntity() {
  kart.position = new Cesium.ConstantPositionProperty(
    Cesium.Cartesian3.fromDegrees(state.lon, state.lat, state.altitude),
  )
}

function updateCamera() {
  const target = Cesium.Cartesian3.fromDegrees(state.lon, state.lat, state.altitude + 1.5)
  const cameraHeading = Cesium.Math.toRadians(state.heading + 180)

  viewer.camera.lookAt(
    target,
    new Cesium.HeadingPitchRange(cameraHeading, Cesium.Math.toRadians(-18), 22),
  )
}

function updateHud() {
  setText('#hud-lat', state.lat.toFixed(5))
  setText('#hud-lon', state.lon.toFixed(5))
  setText('#hud-heading', `${Math.round(state.heading)}°`)
  setText('#hud-speed', `${Math.round(Math.abs(state.speed) * 3.6)} km/h`)
}

function setText(selector, value) {
  const element = document.querySelector(selector)
  if (element) element.textContent = value
}

function moveToward(value, target, amount) {
  if (value < target) return Math.min(value + amount, target)
  if (value > target) return Math.max(value - amount, target)
  return target
}

function showError(message) {
  if (!errorBox) return
  errorBox.hidden = false
  errorBox.textContent = message
}

function loadKartFrame(src) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      const frameSize = image.naturalHeight
      const canvas = document.createElement('canvas')
      canvas.width = frameSize * 4
      canvas.height = frameSize * 4

      const context = canvas.getContext('2d')
      context.imageSmoothingEnabled = false
      context.clearRect(0, 0, canvas.width, canvas.height)
      context.drawImage(
        image,
        0,
        0,
        frameSize,
        frameSize,
        0,
        0,
        canvas.width,
        canvas.height,
      )
      resolve(canvas)
    }
    image.onerror = reject
    image.src = src
  })
}
