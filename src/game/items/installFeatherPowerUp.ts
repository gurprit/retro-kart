import { ItemSystem } from './ItemSystem'

const FEATHER_EVENT = 'retro-kart:feather-activated'
let installed = false

export function installFeatherPowerUp() {
  if (installed) return
  installed = true

  const prototype = ItemSystem.prototype as unknown as {
    activateItem: (item: string) => void
    updateHeldHud: () => void
  }

  const originalActivateItem = prototype.activateItem
  prototype.activateItem = function (this: ItemSystem, item: string) {
    if (item !== 'egg') {
      originalActivateItem.call(this, item)
      return
    }

    const system = this as unknown as {
      scene: { events: { emit: (event: string, ...args: unknown[]) => void } }
      hooks: {
        ownerId: string
        getRacers: () => readonly { id: string }[]
      }
    }
    const owner = system.hooks.getRacers().find((racer) => racer.id === system.hooks.ownerId)
    if (!owner) return
    system.scene.events.emit(FEATHER_EVENT, owner.id)
  }

  const originalUpdateHeldHud = prototype.updateHeldHud
  prototype.updateHeldHud = function (this: ItemSystem) {
    originalUpdateHeldHud.call(this)
    const system = this as unknown as {
      heldItem?: string
      heldText: { setText: (text: string) => unknown }
    }
    if (system.heldItem === 'egg') system.heldText.setText('FEATHER  [SPACE]')
  }
}
