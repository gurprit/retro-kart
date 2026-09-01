import Phaser from 'phaser'
import { RacerSpriteView } from '../rendering/RacerSpriteView'
import { ItemSystem } from './ItemSystem'

const LIGHTNING_EVENT = 'retro-kart:lightning-activated'
const LIGHTNING_DURATION_SECONDS = 5
const LIGHTNING_SHRINK_SCALE = 0.5

type LightningShrinkState = {
  scene: Phaser.Scene
  shrinkUntil: number
  handler: (ownerId: string, durationSeconds: number) => void
}

const shrinkStates = new WeakMap<RacerSpriteView, LightningShrinkState>()
let installed = false

export function installLightningPowerUp() {
  if (installed) return
  installed = true

  installItemBehavior()
  installRacerShrinkBehavior()
}

function installItemBehavior() {
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

function installRacerShrinkBehavior() {
  const prototype = RacerSpriteView.prototype as unknown as {
    update: (
      steerDirection: number,
      speedRatio: number,
      isOffRoad: boolean,
      isPowersliding: boolean,
      deltaSeconds: number,
    ) => void
  }

  const originalUpdate = prototype.update
  prototype.update = function (
    this: RacerSpriteView,
    steerDirection: number,
    speedRatio: number,
    isOffRoad: boolean,
    isPowersliding: boolean,
    deltaSeconds: number,
  ) {
    const racer = this as unknown as {
      scene: Phaser.Scene
      racerId: string
      sprite: Phaser.GameObjects.Image
    }

    let state = shrinkStates.get(this)
    if (!state) {
      const handler = (ownerId: string, durationSeconds: number) => {
        if (ownerId === racer.racerId) return
        const current = shrinkStates.get(this)
        if (!current) return
        current.shrinkUntil = Math.max(
          current.shrinkUntil,
          racer.scene.time.now + durationSeconds * 1000,
        )
      }

      state = {
        scene: racer.scene,
        shrinkUntil: 0,
        handler,
      }
      shrinkStates.set(this, state)
      racer.scene.events.on(LIGHTNING_EVENT, handler)
      racer.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
        racer.scene.events.off(LIGHTNING_EVENT, handler)
        shrinkStates.delete(this)
      })
    }

    originalUpdate.call(
      this,
      steerDirection,
      speedRatio,
      isOffRoad,
      isPowersliding,
      deltaSeconds,
    )

    if (racer.scene.time.now < state.shrinkUntil) {
      racer.sprite.setDisplaySize(
        racer.sprite.displayWidth * LIGHTNING_SHRINK_SCALE,
        racer.sprite.displayHeight * LIGHTNING_SHRINK_SCALE,
      )
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
