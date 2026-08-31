import Phaser from 'phaser'
import {
  Mode7Renderer,
  type Mode7CameraState,
} from '../rendering/Mode7Renderer'

export type ItemType = 'banana'

type ItemBox = {
  id: string
  x: number
  y: number
  active: boolean
  view: Phaser.GameObjects.Container
}

const PICKUP_RADIUS_RATIO = 0.035
const ITEM_BOX_RESPAWN_MS = 5000
const ROULETTE_DURATION_MS = 1100
const ROULETTE_STEP_MS = 75

// Mario Circuit 1 first item row, expressed in normalized track coordinates.
// Keeping placement data separate from the pickup logic lets future tracks,
// AI racers and multiplayer state provide their own item-box definitions.
const MARIO_CIRCUIT_ITEM_BOXES = [
  { id: 'mc1-1', xRatio: 0.86, yRatio: 0.5 },
  { id: 'mc1-2', xRatio: 0.885, yRatio: 0.5 },
  { id: 'mc1-3', xRatio: 0.91, yRatio: 0.5 },
  { id: 'mc1-4', xRatio: 0.935, yRatio: 0.5 },
  { id: 'mc1-5', xRatio: 0.96, yRatio: 0.5 },
] as const

export class ItemSystem {
  private readonly scene: Phaser.Scene
  private readonly renderer: Mode7Renderer
  private readonly itemBoxes: ItemBox[]
  private readonly pickupRadius: number
  private heldItem?: ItemType
  private rouletteRunning = false
  private rouletteTimer?: Phaser.Time.TimerEvent
  private rouletteFinishTimer?: Phaser.Time.TimerEvent

  private readonly rouletteFrame: Phaser.GameObjects.Rectangle
  private readonly rouletteSprite: Phaser.GameObjects.Image
  private readonly heldText: Phaser.GameObjects.Text

  constructor(
    scene: Phaser.Scene,
    renderer: Mode7Renderer,
    worldScale: number,
    rouletteTextureKey: string,
  ) {
    this.scene = scene
    this.renderer = renderer
    this.pickupRadius = worldScale * PICKUP_RADIUS_RATIO

    this.itemBoxes = MARIO_CIRCUIT_ITEM_BOXES.map((definition) => ({
      id: definition.id,
      x: renderer.sourceWidth * definition.xRatio,
      y: renderer.sourceHeight * definition.yRatio,
      active: true,
      view: this.createItemBoxView(),
    }))

    this.rouletteFrame = scene.add
      .rectangle(90, 128, 84, 72, 0x101018, 0.92)
      .setStrokeStyle(4, 0xffffff)
      .setDepth(40)
      .setVisible(false)

    // The original SNES roulette sheet is 80x94. During the roulette we move
    // a crop window through the sheet, which preserves the ripped pixel art
    // without coupling gameplay state to individual sprite coordinates yet.
    this.rouletteSprite = scene.add
      .image(90, 128, rouletteTextureKey)
      .setDepth(41)
      .setScale(2.2)
      .setVisible(false)

    this.heldText = scene.add
      .text(90, 172, '', {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 3,
      })
      .setOrigin(0.5, 0)
      .setDepth(42)
  }

  update(playerX: number, playerY: number, camera: Mode7CameraState) {
    this.updateItemBoxViews(camera)

    if (this.heldItem || this.rouletteRunning) {
      return
    }

    const pickupRadiusSq = this.pickupRadius * this.pickupRadius

    for (const itemBox of this.itemBoxes) {
      if (!itemBox.active) {
        continue
      }

      const dx = playerX - itemBox.x
      const dy = playerY - itemBox.y

      if (dx * dx + dy * dy <= pickupRadiusSq) {
        this.collect(itemBox)
        break
      }
    }
  }

  useHeldItem() {
    if (!this.heldItem || this.rouletteRunning) {
      return undefined
    }

    const item = this.heldItem
    this.heldItem = undefined
    this.updateHeldHud()
    return item
  }

  get currentItem() {
    return this.heldItem
  }

  destroy() {
    this.rouletteTimer?.destroy()
    this.rouletteFinishTimer?.destroy()

    for (const itemBox of this.itemBoxes) {
      itemBox.view.destroy()
    }

    this.rouletteFrame.destroy()
    this.rouletteSprite.destroy()
    this.heldText.destroy()
  }

  private collect(itemBox: ItemBox) {
    itemBox.active = false
    itemBox.view.setVisible(false)
    this.startRoulette()

    this.scene.time.delayedCall(ITEM_BOX_RESPAWN_MS, () => {
      itemBox.active = true
    })
  }

  private startRoulette() {
    this.rouletteRunning = true
    this.rouletteFrame.setVisible(true)
    this.rouletteSprite.setVisible(true)
    this.heldText.setText('ROULETTE')

    let step = 0
    this.rouletteTimer = this.scene.time.addEvent({
      delay: ROULETTE_STEP_MS,
      loop: true,
      callback: () => {
        step += 1
        const scale = step % 2 === 0 ? 2.05 : 2.35
        this.rouletteSprite.setScale(scale)
        this.rouletteSprite.setAngle((step % 3) - 1)
      },
    })

    this.rouletteFinishTimer = this.scene.time.delayedCall(
      ROULETTE_DURATION_MS,
      () => {
        this.rouletteTimer?.destroy()
        this.rouletteTimer = undefined
        this.rouletteRunning = false
        this.heldItem = 'banana'
        this.rouletteSprite.setScale(2.2).setAngle(0)
        this.updateHeldHud()
      },
    )
  }

  private updateHeldHud() {
    if (this.heldItem) {
      this.rouletteFrame.setVisible(true)
      this.rouletteSprite.setVisible(true)
      this.heldText.setText('BANANA  [SPACE]')
    } else {
      this.rouletteFrame.setVisible(false)
      this.rouletteSprite.setVisible(false)
      this.heldText.setText('')
    }
  }

  private updateItemBoxViews(camera: Mode7CameraState) {
    for (const itemBox of this.itemBoxes) {
      if (!itemBox.active) {
        itemBox.view.setVisible(false)
        continue
      }

      const projected = this.renderer.projectWorldPoint(itemBox.x, itemBox.y, camera)

      if (!projected) {
        itemBox.view.setVisible(false)
        continue
      }

      const scale = Phaser.Math.Clamp(projected.scale * 1.7, 0.55, 1.8)
      itemBox.view
        .setVisible(true)
        .setPosition(projected.x, projected.y)
        .setScale(scale)
        .setDepth(8 + projected.screenY / 1000)
    }
  }

  private createItemBoxView() {
    const container = this.scene.add.container(0, 0).setDepth(8)
    const box = this.scene.add
      .rectangle(0, 0, 24, 18, 0xf6d64a)
      .setStrokeStyle(2, 0xffffff)
    const question = this.scene.add
      .text(0, -1, '?', {
        fontFamily: 'monospace',
        fontSize: '17px',
        color: '#201608',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)

    container.add([box, question])
    return container
  }
}
