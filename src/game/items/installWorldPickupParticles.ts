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
}

const ITEM_BOX_RESPAWN_MS = 5000
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
    spawnWorldBurst(system, worldX, worldY, 'coin')
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
      spawnWorldBurst(system, itemBox.x, itemBox.y, 'itemBox')
      system.startRoulette()

      system.scene.time.delayedCall(ITEM_BOX_RESPAWN_MS, () => {
        itemBox.active = true
        system.refreshGroundPanels()
      })
      break
    }
  }
}

function spawnWorldBurst(
  system: ItemSystemInternals,
  worldX: number,
  worldY: number,
  kind: 'coin' | 'itemBox',
) {
  const particles = system.retroKartWorldParticles ?? []
  system.retroKartWorldParticles = particles

  const count = kind === 'coin' ? 44 : 34
  const worldScale = system.worldScale
  const horizontalSpeed = worldScale * (kind === 'coin' ? 0.19 : 0.16)
  const verticalSpeed = worldScale * (kind === 'coin' ? 0.24 : 0.2)
  const gravity = worldScale * 0.78

  for (let index = 0; index < count; index += 1) {
    const angle = Phaser.Math.FloatBetween(0, Math.PI * 2)
    const speed = Phaser.Math.FloatBetween(horizontalSpeed * 0.35, horizontalSpeed)
    const size = Phaser.Math.FloatBetween(3.5, kind === 'coin' ? 8 : 7)
    const body = system.scene.add
      .rectangle(0, 0, size, size * Phaser.Math.FloatBetween(0.55, 1.45), particleColour(kind, index), 1)
      .setDepth(82)
      .setVisible(false)

    particles.push({
      x: worldX,
      y: worldY,
      z: worldScale * Phaser.Math.FloatBetween(0.003, 0.012),
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      vz: Phaser.Math.FloatBetween(verticalSpeed * 0.55, verticalSpeed),
      gravity,
      bounce: Phaser.Math.FloatBetween(0.28, 0.5),
      drag: Phaser.Math.FloatBetween(2.6, 4.4),
      life: Phaser.Math.FloatBetween(0.9, 1.45),
      maxLife: 1.45,
      rotation: Phaser.Math.FloatBetween(-Math.PI, Math.PI),
      spin: Phaser.Math.FloatBetween(-9, 9),
      body,
    })
  }

  for (let index = 0; index < (kind === 'coin' ? 14 : 10); index += 1) {
    const angle = Phaser.Math.FloatBetween(0, Math.PI * 2)
    const body = system.scene.add
      .ellipse(0, 0, Phaser.Math.FloatBetween(2, 4.5), Phaser.Math.FloatBetween(2, 4.5), 0xfff6b0, 0.95)
      .setDepth(83)
      .setVisible(false)

    particles.push({
      x: worldX,
      y: worldY,
      z: worldScale * 0.01,
      vx: Math.cos(angle) * Phaser.Math.FloatBetween(horizontalSpeed * 0.4, horizontalSpeed * 1.15),
      vy: Math.sin(angle) * Phaser.Math.FloatBetween(horizontalSpeed * 0.4, horizontalSpeed * 1.15),
      vz: Phaser.Math.FloatBetween(verticalSpeed * 0.65, verticalSpeed * 1.15),
      gravity: gravity * 1.12,
      bounce: 0.2,
      drag: 4.6,
      life: Phaser.Math.FloatBetween(0.5, 0.85),
      maxLife: 0.85,
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
      const airDrag = Math.exp(-0.35 * dt)
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

function particleColour(kind: 'coin' | 'itemBox', index: number) {
  if (kind === 'itemBox') {
    const palette = [0xffc400, 0xffffff, 0xff7a00, 0xd92300]
    return palette[index % palette.length]
  }

  const palette = [0xfff0a6, 0xffd21f, 0xffa000, 0xffc400, 0xffffff]
  return palette[index % palette.length]
}
