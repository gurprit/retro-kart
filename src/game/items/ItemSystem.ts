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

// Keep the ground-panel animation deliberately gentle. The earlier fast frame
// cycling looked like texture corruption once perspective scaling was applied.
const PANEL_FRAME_MS = 420
const PANEL_TEXTURE_KEY = 'item-panels-complete'
const PANEL_SIZE = 32
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
      view: scene.add
        .image(0, 0, PANEL_TEXTURE_KEY)
        .setOrigin(0.5)
        .setVisible(false),
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

    for (const itemBox of this.itemBoxes) {
      itemBox.view.destroy()
    }

    this.rouletteFrame.destroy()
    this.rouletteSprite.destroy()
    this.heldText.destroy()

    if (this.scene.textures.exists(PANEL_TEXTURE_KEY)) {
      this.scene.textures.remove(PANEL_TEXTURE_KEY)
    }
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

    this.rouletteFinishTimer = this.scene.time.delayedCall(
      ROULETTE_DURATION_MS,
      () => {
        this.rouletteTimer?.destroy()
        this.rouletteTimer = undefined
        this.rouletteRunning = false
        this.heldItem = 'banana'
        this.rouletteSprite.setAlpha(1)
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
      const projected = this.renderer.projectWorldPoint(
        itemBox.x,
        itemBox.y,
        camera,
      )

      if (!projected) {
        itemBox.view.setVisible(false)
        continue
      }

      const frame = itemBox.active
        ? this.panelFrame % ACTIVE_PANEL_FRAMES
        : EMPTY_PANEL_FRAME_START +
          (this.panelFrame % EMPTY_PANEL_FRAMES)

      itemBox.view.setCrop(
        frame * PANEL_SIZE,
        0,
        PANEL_SIZE,
        PANEL_SIZE,
      )

      // Draw a complete square panel, then flatten only its screen-space height
      // to make it read as painted onto the road. Width and height are derived
      // from the same perspective scale, avoiding the old one-axis blow-ups.
      const perspectiveScale = Phaser.Math.Clamp(
        projected.scale,
        0.42,
        2.15,
      )
      const panelWidth = PANEL_SIZE * 1.55 * perspectiveScale
      const panelHeight = PANEL_SIZE * 0.72 * perspectiveScale

      itemBox.view
        .setVisible(true)
        .setPosition(projected.x, projected.y)
        .setDisplaySize(panelWidth, panelHeight)
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

      this.drawPanelFrame(context, x, active, pulse)
    }

    texture.refresh()
  }

  private drawPanelFrame(
    context: CanvasRenderingContext2D,
    x: number,
    active: boolean,
    pulse: number,
  ) {
    const size = PANEL_SIZE

    // Full panel based on the reconstructed reference: bright face, white
    // upper/left lip and a dark red lower/right edge. Every animation frame is
    // complete, so there are no component-tile seams to expose under scaling.
    context.fillStyle = active
      ? pulse % 2 === 0
        ? '#ffc000'
        : '#ffd020'
      : pulse % 2 === 0
        ? '#d40000'
        : '#e01800'
    context.fillRect(x, 0, size, size)

    context.fillStyle = active ? '#ffffff' : '#ff8b00'
    context.fillRect(x, 0, size - 2, 2)
    context.fillRect(x, 0, 2, size - 2)

    context.fillStyle = '#8b0000'
    context.fillRect(x, size - 2, size, 2)
    context.fillRect(x + size - 2, 0, 2, size)

    if (!active) {
      context.fillStyle = '#5a0000'
      const slotY = 14 + pulse * 2
      context.fillRect(x + 10, slotY, 12, 3)
      return
    }

    // A chunky pixel question mark scaled from the supplied complete-block
    // reference. Only tiny highlight shifts animate, keeping the silhouette
    // stable rather than making the whole symbol jump around.
    const nudge = pulse === 1 ? 1 : 0
    const qx = x + nudge

    context.fillStyle = '#050505'
    context.fillRect(qx + 9, 7, 13, 4)
    context.fillRect(qx + 19, 10, 5, 6)
    context.fillRect(qx + 15, 14, 7, 4)
    context.fillRect(qx + 13, 17, 5, 5)
    context.fillRect(qx + 13, 25, 5, 4)

    // Tiny glint variation gives movement without changing panel proportions.
    if (pulse >= 2) {
      context.fillStyle = '#fff7a0'
      context.fillRect(x + 3 + (pulse - 2) * 2, 3, 5, 2)
    }
  }
}
