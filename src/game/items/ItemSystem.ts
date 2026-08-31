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
  view: Phaser.GameObjects.Image
}

const PICKUP_RADIUS_RATIO = 0.035
const ITEM_BOX_RESPAWN_MS = 5000
const PANEL_FRAME_MS = 300
const PANEL_TEXTURE_KEY = 'item-panels-complete'
const PANEL_SIZE = 16
const ACTIVE_PANEL_FRAMES = 4
const EMPTY_PANEL_FRAME_START = 4
const EMPTY_PANEL_FRAMES = 2
const PANEL_FRAME_COUNT = ACTIVE_PANEL_FRAMES + EMPTY_PANEL_FRAMES
const ROULETTE_DURATION_MS = 1100
const ROULETTE_STEP_MS = 110

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
  private panelFrame = 0
  private panelTimer?: Phaser.Time.TimerEvent
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
    this.createCompletePanelTexture()

    this.itemBoxes = MARIO_CIRCUIT_ITEM_BOXES.map((definition) => ({
      id: definition.id,
      x: renderer.sourceWidth * definition.xRatio,
      y: renderer.sourceHeight * definition.yRatio,
      active: true,
      view: scene.add.image(0, 0, PANEL_TEXTURE_KEY).setOrigin(0.5).setVisible(false),
    }))

    this.rouletteFrame = scene.add
      .rectangle(90, 128, 110, 86, 0x101018, 0.92)
      .setStrokeStyle(4, 0xffffff)
      .setDepth(40)
      .setVisible(false)

    this.rouletteSprite = scene.add
      .image(90, 125, rouletteTextureKey)
      .setDepth(41)
      .setScale(1.7)
      .setVisible(false)

    this.heldText = scene.add
      .text(90, 170, '', {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 3,
      })
      .setOrigin(0.5, 0)
      .setDepth(42)

    this.panelTimer = scene.time.addEvent({
      delay: PANEL_FRAME_MS,
      loop: true,
      callback: () => {
        this.panelFrame += 1
      },
    })
  }

  update(playerX: number, playerY: number, camera: Mode7CameraState) {
    this.updateItemBoxViews(camera)

    if (this.heldItem || this.rouletteRunning) return

    const pickupRadiusSq = this.pickupRadius * this.pickupRadius
    for (const itemBox of this.itemBoxes) {
      if (!itemBox.active) continue
      const dx = playerX - itemBox.x
      const dy = playerY - itemBox.y
      if (dx * dx + dy * dy <= pickupRadiusSq) {
        this.collect(itemBox)
        break
      }
    }
  }

  useHeldItem() {
    if (!this.heldItem || this.rouletteRunning) return undefined
    const item = this.heldItem
    this.heldItem = undefined
    this.updateHeldHud()
    return item
  }

  get currentItem() {
    return this.heldItem
  }

  destroy() {
    this.panelTimer?.destroy()
    this.rouletteTimer?.destroy()
    this.rouletteFinishTimer?.destroy()
    for (const itemBox of this.itemBoxes) itemBox.view.destroy()
    this.rouletteFrame.destroy()
    this.rouletteSprite.destroy()
    this.heldText.destroy()
    if (this.scene.textures.exists(PANEL_TEXTURE_KEY)) this.scene.textures.remove(PANEL_TEXTURE_KEY)
  }

  private collect(itemBox: ItemBox) {
    itemBox.active = false
    this.startRoulette()
    this.scene.time.delayedCall(ITEM_BOX_RESPAWN_MS, () => {
      itemBox.active = true
    })
  }

  private startRoulette() {
    this.rouletteRunning = true
    this.rouletteFrame.setVisible(true)
    this.rouletteSprite.setVisible(true).setAlpha(1)
    this.heldText.setText('ROULETTE')

    let step = 0
    this.rouletteTimer = this.scene.time.addEvent({
      delay: ROULETTE_STEP_MS,
      loop: true,
      callback: () => {
        step += 1
        this.rouletteSprite.setAlpha(step % 2 === 0 ? 1 : 0.55)
      },
    })

    this.rouletteFinishTimer = this.scene.time.delayedCall(ROULETTE_DURATION_MS, () => {
      this.rouletteTimer?.destroy()
      this.rouletteTimer = undefined
      this.rouletteRunning = false
      this.heldItem = 'banana'
      this.rouletteSprite.setAlpha(1)
      this.updateHeldHud()
    })
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
      const projected = this.renderer.projectWorldPoint(itemBox.x, itemBox.y, camera)
      if (!projected) {
        itemBox.view.setVisible(false)
        continue
      }

      const frame = itemBox.active
        ? this.panelFrame % ACTIVE_PANEL_FRAMES
        : EMPTY_PANEL_FRAME_START + (this.panelFrame % EMPTY_PANEL_FRAMES)
      itemBox.view.setCrop(frame * PANEL_SIZE, 0, PANEL_SIZE, PANEL_SIZE)

      const perspectiveScale = Phaser.Math.Clamp(projected.scale * 1.4, 0.55, 2.4)
      itemBox.view
        .setVisible(true)
        .setPosition(projected.x, projected.y)
        .setDisplaySize(PANEL_SIZE * 2.1 * perspectiveScale, PANEL_SIZE * 0.9 * perspectiveScale)
        .setDepth(8 + projected.screenY / 1000)
    }
  }

  private createCompletePanelTexture() {
    if (this.scene.textures.exists(PANEL_TEXTURE_KEY)) return

    const texture = this.scene.textures.createCanvas(
      PANEL_TEXTURE_KEY,
      PANEL_SIZE * PANEL_FRAME_COUNT,
      PANEL_SIZE,
    )
    if (!texture) return

    const context = texture.context
    context.imageSmoothingEnabled = false

    for (let frame = 0; frame < PANEL_FRAME_COUNT; frame += 1) {
      const x = frame * PANEL_SIZE
      const active = frame < ACTIVE_PANEL_FRAMES
      const pulse = active ? frame : frame - EMPTY_PANEL_FRAME_START

      context.fillStyle = active
        ? pulse % 2 === 0 ? '#ffc000' : '#ffd000'
        : pulse % 2 === 0 ? '#d40000' : '#ea0000'
      context.fillRect(x, 0, PANEL_SIZE, PANEL_SIZE)

      context.fillStyle = active ? '#ffffff' : '#ff9a00'
      context.fillRect(x, 0, PANEL_SIZE - 1, 1)
      context.fillRect(x, 0, 1, PANEL_SIZE - 1)

      context.fillStyle = '#8b0000'
      context.fillRect(x, PANEL_SIZE - 1, PANEL_SIZE, 1)
      context.fillRect(x + PANEL_SIZE - 1, 0, 1, PANEL_SIZE)

      if (active) {
        context.fillStyle = '#050505'
        const qx = x + (pulse === 1 ? 1 : 0)
        context.fillRect(qx + 4, 3, 7, 2)
        context.fillRect(qx + 9, 5, 3, 3)
        context.fillRect(qx + 7, 7, 4, 2)
        context.fillRect(qx + 6, 9, 3, 2)
        context.fillRect(qx + 6, 12, 3, 2)
      } else {
        context.fillStyle = '#500000'
        context.fillRect(x + 5, 7 + pulse, 6, 2)
      }
    }

    texture.refresh()
  }
}
