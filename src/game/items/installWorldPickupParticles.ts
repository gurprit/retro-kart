import Phaser from 'phaser'
import { ItemSystem } from './ItemSystem'

type CameraState = unknown

type ItemBoxState = {
  id: string
  x: number
  y: number
  active: boolean
}

type WorldParticle = {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  gravity: number
  bounce: number
  drag: number
  life: number
  maxLife: number
  rotation: number
  spin: number
  body: Phaser.GameObjects.Rectangle | Phaser.GameObjects.Ellipse
}

type CoinBurstEvent = {
  x: number
  y: number
}

type ItemSystemInternals = {
  scene: Phaser.Scene
  renderer: {
    projectWorldPoint: (
      x: number,
      y: number,
      camera: CameraState,
    ) => { x: number; y: number; screenY: number; scale: number } | undefined
  }
  worldScale: number
  itemBoxes: ItemBoxState[]
  pickupRadius: number
  heldItem?: string
  rouletteRunning: boolean
  hooks: {
    ownerId: string
    getRacers: () => readonly { id: string; x: number; y: number }[]
  }
  refreshGroundPanels: () => void
  startRoulette: () => void
  retroKartWorldParticles?: WorldParticle[]
  retroKartWorldParticleCamera?: CameraState
  retroKartCoinBurstHandler?: (event: CoinBurstEvent) => void
}

const ITEM_BOX_RESPAWN_MS = 5000
export const COIN_WORLD_BURST_EVENT = 'retro-kart:coin-world-burst'
let installed = false

export function installWorldPickupParticles() {
  if (installed) return
  installed = true

  const prototype = ItemSystem.prototype as unknown as {
    update: (deltaSeconds: number, camera: CameraState) => void
    checkItemBoxPickup: () => void
    createCoinPickupVisual: (
      worldX: number,
      worldY: number,
      camera: CameraState,
    ) => void
  }

  const originalUpdate = prototype.update
  prototype.update = function (
    this: ItemSystem,
    deltaSeconds: number,
    camera: CameraState,
  ) {
    originalUpdate.call(this, deltaSeconds, camera)
    const system = this as unknown as ItemSystemInternals
    system.retroKartWorldParticleCamera = camera

    if (!system.retroKartCoinBurstHandler) {
      const handler = (event: CoinBurstEvent) => {
        if (!event || !Number.isFinite(event.x) || !Number.isFinite(event.y)) return
        spawnCoinWorldBurst(system, event.x, event.y)
      }
      system.retroKartCoinBurstHandler = handler
      system.scene.events.on(COIN_WORLD_BURST_EVENT, handler)
      system.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
        system.scene.events.off(COIN_WORLD_BURST_EVENT, handler)
        system.retroKartCoinBurstHandler = undefined
      })
    }

    updateWorldParticles(system, deltaSeconds, camera)
  }

  prototype.createCoinPickupVisual = function (
    this: ItemSystem,
    worldX: number,
    worldY: number,
    camera: CameraState,
  ) {
    const system = this as unknown as ItemSystemInternals
    system.retroKartWorldParticleCamera = camera
    spawnCoinWorldBurst(system, worldX, worldY)
  }

  prototype.checkItemBoxPickup = function (this: ItemSystem) {
    const system = this as unknown as ItemSystemInternals
    if (system.heldItem || system.rouletteRunning) return

    const owner = system.hooks
      .getRacers()
      .find((racer) => racer.id === system.hooks.ownerId)
    if (!owner) return

    const pickupRadiusSq = system.pickupRadius * system.pickupRadius
    for (const itemBox of system.itemBoxes) {
      if (!itemBox.active) continue
      const dx = owner.x - itemBox.x
      const dy = owner.y - itemBox.y
      if (dx * dx + dy * dy > pickupRadiusSq) continue

      itemBox.active = false
      system.refreshGroundPanels()
      system.startRoulette()

      system.scene.time.delayedCall(ITEM_BOX_RESPAWN_MS, () => {
        itemBox.active = true
        system.refreshGroundPanels()
      })
      break
    }
  }
}

function spawnCoinWorldBurst(
  system: ItemSystemInternals,
  worldX: number,
  worldY: number,
) {
  const particles = system.retroKartWorldParticles ?? []
  system.retroKartWorldParticles = particles

  const worldScale = system.worldScale
  const horizontalSpeed = worldScale * 0.16
  const verticalSpeed = worldScale * 0.39
  const gravity = worldScale * 0.9

  for (let index = 0; index < 48; index += 1) {
    const angle = Phaser.Math.FloatBetween(0, Math.PI * 2)
    const speed = Phaser.Math.FloatBetween(horizontalSpeed * 0.25, horizontalSpeed)
    const size = Phaser.Math.FloatBetween(3.5, 8)
    const body = system.scene.add
      .rectangle(
        0,
        0,
        size,
        size * Phaser.Math.FloatBetween(0.55, 1.45),
        particleColour(index),
        1,
      )
      .setDepth(82)
      .setVisible(false)

    particles.push({
      x: worldX,
      y: worldY,
      z: worldScale * Phaser.Math.FloatBetween(0.004, 0.014),
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      vz: Phaser.Math.FloatBetween(verticalSpeed * 0.72, verticalSpeed * 1.12),
      gravity,
      bounce: Phaser.Math.FloatBetween(0.3, 0.52),
      drag: Phaser.Math.FloatBetween(2.6, 4.4),
      life: Phaser.Math.FloatBetween(1.05, 1.65),
      maxLife: 1.65,
      rotation: Phaser.Math.FloatBetween(-Math.PI, Math.PI),
      spin: Phaser.Math.FloatBetween(-10, 10),
      body,
    })
  }

  for (let index = 0; index < 18; index += 1) {
    const angle = Phaser.Math.FloatBetween(0, Math.PI * 2)
    const body = system.scene.add
      .ellipse(
        0,
        0,
        Phaser.Math.FloatBetween(2, 4.5),
        Phaser.Math.FloatBetween(2, 4.5),
        0xfff6b0,
        0.95,
      )
      .setDepth(83)
      .setVisible(false)

    const sparkSpeed = Phaser.Math.FloatBetween(horizontalSpeed * 0.3, horizontalSpeed * 1.05)
    particles.push({
      x: worldX,
      y: worldY,
      z: worldScale * 0.012,
      vx: Math.cos(angle) * sparkSpeed,
      vy: Math.sin(angle) * sparkSpeed,
      vz: Phaser.Math.FloatBetween(verticalSpeed * 0.9, verticalSpeed * 1.25),
      gravity: gravity * 1.08,
      bounce: 0.22,
      drag: 4.8,
      life: Phaser.Math.FloatBetween(0.62, 0.98),
      maxLife: 0.98,
      rotation: 0,
      spin: 0,
      body,
    })
  }
}

function updateWorldParticles(
  system: ItemSystemInternals,
  deltaSeconds: number,
  camera: CameraState,
) {
  const particles = system.retroKartWorldParticles
  if (!particles?.length) return

  const dt = Math.min(deltaSeconds, 0.05)
  for (let index = particles.length - 1; index >= 0; index -= 1) {
    const particle = particles[index]
    particle.life -= dt
    if (particle.life <= 0) {
      particle.body.destroy()
      particles.splice(index, 1)
      continue
    }

    particle.vz -= particle.gravity * dt
    particle.x += particle.vx * dt
    particle.y += particle.vy * dt
    particle.z += particle.vz * dt
    particle.rotation += particle.spin * dt

    if (particle.z <= 0) {
      particle.z = 0
      if (Math.abs(particle.vz) > system.worldScale * 0.025) {
        particle.vz = -particle.vz * particle.bounce
      } else {
        particle.vz = 0
      }
      const groundDrag = Math.exp(-particle.drag * dt)
      particle.vx *= groundDrag
      particle.vy *= groundDrag
      particle.spin *= groundDrag
    } else {
      const airDrag = Math.exp(-0.28 * dt)
      particle.vx *= airDrag
      particle.vy *= airDrag
    }

    const projected = system.renderer.projectWorldPoint(particle.x, particle.y, camera)
    if (!projected) {
      particle.body.setVisible(false)
      continue
    }

    const perspective = Phaser.Math.Clamp(projected.scale, 0.35, 1.8)
    const heightPixels = particle.z * perspective * 0.72
    const fade = Phaser.Math.Clamp(particle.life / Math.min(particle.maxLife, 0.45), 0, 1)

    particle.body
      .setVisible(true)
      .setPosition(projected.x, projected.y - heightPixels)
      .setScale(perspective)
      .setRotation(particle.rotation)
      .setAlpha(fade)
      .setDepth(82 + projected.screenY * 0.01 + (particle.z > 0 ? 1 : 0))
  }
}

function particleColour(index: number) {
  const palette = [0xfff0a6, 0xffd21f, 0xffa000, 0xffc400, 0xffffff]
  return palette[index % palette.length]
}
