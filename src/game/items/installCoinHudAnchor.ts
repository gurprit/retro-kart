import Phaser from 'phaser'
import { ItemSystem } from './ItemSystem'

let installed = false

export function installCoinHudAnchor() {
  if (installed) return
  installed = true

  const prototype = ItemSystem.prototype as unknown as {
    createRouletteCoinVisual: () => void
  }

  prototype.createRouletteCoinVisual = function (this: ItemSystem) {
    const system = this as unknown as {
      scene: Phaser.Scene
      worldFrames: Map<string, string[]>
    }

    const frames = system.worldFrames.get('coin') ?? []
    if (frames.length === 0) return

    const camera = system.scene.cameras.main
    const playerBaseY = camera.height - 42
    const x = camera.centerX
    const startY = playerBaseY - 96
    const peakY = startY - 82

    const coin = system.scene.add
      .image(x, startY, frames[0])
      .setDepth(90)
      .setDisplaySize(38, 38)
      .setOrigin(0.5)
      .setScrollFactor(0)

    let frameIndex = 0
    const animation = system.scene.time.addEvent({
      delay: 80,
      loop: true,
      callback: () => {
        frameIndex = (frameIndex + 1) % frames.length
        coin.setTexture(frames[frameIndex])
      },
    })

    system.scene.tweens.add({
      targets: coin,
      y: peakY,
      duration: 270,
      ease: 'Quad.easeOut',
      yoyo: true,
      hold: 70,
      onComplete: () => {
        animation.destroy()
        coin.destroy()
      },
    })
  }
}
