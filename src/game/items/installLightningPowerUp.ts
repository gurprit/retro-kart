import Phaser from 'phaser'
import { ItemSystem } from './ItemSystem'

const LIGHTNING_EVENT = 'retro-kart:lightning-activated'
const LIGHTNING_DURATION_SECONDS = 5

let installed = false

export function installLightningPowerUp() {
  if (installed) return
  installed = true

  const prototype = ItemSystem.prototype as unknown as {
    activateItem: (item: string) => void
    updateHeldHud: () => void
  }

  const originalActivateItem = prototype.activateItem
  prototype.activateItem = function (this: ItemSystem, item: string) {
    if (item !== 'fireball') {
      originalActivateItem.call(this, item)
      return
    }

    const system = this as unknown as {
      scene: Phaser.Scene
      hooks: {
        ownerId: string
        getRacers: () => readonly { id: string }[]
      }
    }

    const owner = system.hooks
      .getRacers()
      .find((racer) => racer.id === system.hooks.ownerId)
    if (!owner) return

    createLightningFlash(system.scene)
    system.scene.events.emit(
      LIGHTNING_EVENT,
      owner.id,
      LIGHTNING_DURATION_SECONDS,
    )
  }

  const originalUpdateHeldHud = prototype.updateHeldHud
  prototype.updateHeldHud = function (this: ItemSystem) {
    originalUpdateHeldHud.call(this)

    const system = this as unknown as {
      heldItem?: string
      heldText: Phaser.GameObjects.Text
    }
    if (system.heldItem === 'fireball') {
      system.heldText.setText('LIGHTNING  [SPACE]')
    }
  }
}

function createLightningFlash(scene: Phaser.Scene) {
  const flash = scene.add
    .rectangle(
      scene.scale.width / 2,
      scene.scale.height / 2,
      scene.scale.width,
      scene.scale.height,
      0xffffff,
      1,
    )
    .setScrollFactor(0)
    .setDepth(1000)
    .setBlendMode(Phaser.BlendModes.DIFFERENCE)

  scene.tweens.add({
    targets: flash,
    alpha: 0,
    duration: 120,
    yoyo: true,
    repeat: 2,
    hold: 55,
    ease: 'Linear',
    onComplete: () => flash.destroy(),
  })
}
