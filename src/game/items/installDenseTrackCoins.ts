import Phaser from 'phaser'
import { ItemSystem } from './ItemSystem'

const TRACK_TEXTURE_KEY = 'prototype-track'
const GRID_SPACING_RATIO = 0.032
const EDGE_MARGIN_RATIO = 0.018
const CLEARANCE_RATIO = 0.012

type ItemSystemInternals = {
  scene: Phaser.Scene
  renderer: { sourceWidth: number; sourceHeight: number }
  worldScale: number
  hooks: { isBarrierAt: (x: number, y: number) => boolean }
  spawnWorldItem: (
    kind: string,
    ownerId: string,
    x: number,
    y: number,
    vx: number,
    vy: number,
    ttl: number,
    ownerGrace: number,
    trackCoin?: boolean,
  ) => unknown
}

let installed = false

export function installDenseTrackCoins() {
  if (installed) return
  installed = true

  const prototype = ItemSystem.prototype as unknown as {
    spawnTrackCoins: () => void
  }
  const originalSpawnTrackCoins = prototype.spawnTrackCoins

  prototype.spawnTrackCoins = function (this: ItemSystem) {
    originalSpawnTrackCoins.call(this)

    const system = this as unknown as ItemSystemInternals
    const isRoad = createRoadSampler(system.scene)
    const spacing = Math.max(18, system.worldScale * GRID_SPACING_RATIO)
    const edgeMargin = Math.max(12, system.worldScale * EDGE_MARGIN_RATIO)
    const clearance = Math.max(8, system.worldScale * CLEARANCE_RATIO)
    let row = 0

    for (
      let y = edgeMargin;
      y < system.renderer.sourceHeight - edgeMargin;
      y += spacing
    ) {
      const stagger = row % 2 === 0 ? 0 : spacing * 0.5
      for (
        let x = edgeMargin + stagger;
        x < system.renderer.sourceWidth - edgeMargin;
        x += spacing
      ) {
        if (!isSafeRoadPoint(x, y, clearance, isRoad, system.hooks.isBarrierAt)) continue
        system.spawnWorldItem(
          'coin',
          'track',
          x,
          y,
          0,
          0,
          Number.POSITIVE_INFINITY,
          0,
          true,
        )
      }
      row += 1
    }
  }
}

function createRoadSampler(scene: Phaser.Scene) {
  const texture = scene.textures.get(TRACK_TEXTURE_KEY)
  const source = texture.getSourceImage() as CanvasImageSource & {
    width: number
    height: number
  }
  const canvas = document.createElement('canvas')
  canvas.width = source.width
  canvas.height = source.height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return () => false

  context.imageSmoothingEnabled = false
  context.drawImage(source, 0, 0)
  const pixels = context.getImageData(0, 0, source.width, source.height).data

  return (x: number, y: number) => {
    const px = Math.floor(x)
    const py = Math.floor(y)
    if (px < 0 || py < 0 || px >= source.width || py >= source.height) return false
    const offset = (py * source.width + px) * 4
    const r = pixels[offset]
    const g = pixels[offset + 1]
    const b = pixels[offset + 2]
    const a = pixels[offset + 3]
    const maxChannel = Math.max(r, g, b)
    const minChannel = Math.min(r, g, b)
    const saturation = maxChannel - minChannel
    const brightness = (r + g + b) / 3
    return a > 16 && saturation < 24 && brightness >= 65 && brightness <= 175
  }
}

function isSafeRoadPoint(
  x: number,
  y: number,
  clearance: number,
  isRoad: (x: number, y: number) => boolean,
  isBarrier: (x: number, y: number) => boolean,
) {
  const diagonal = clearance * 0.72
  const checks = [
    [0, 0],
    [clearance, 0],
    [-clearance, 0],
    [0, clearance],
    [0, -clearance],
    [diagonal, diagonal],
    [-diagonal, diagonal],
    [diagonal, -diagonal],
    [-diagonal, -diagonal],
  ] as const

  return checks.every(([dx, dy]) => {
    const sampleX = x + dx
    const sampleY = y + dy
    return isRoad(sampleX, sampleY) && !isBarrier(sampleX, sampleY)
  })
}
