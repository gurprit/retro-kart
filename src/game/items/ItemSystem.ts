import Phaser from 'phaser'
import {
  Mode7Renderer,
  type Mode7CameraState,
  type Mode7GroundSprite,
} from '../rendering/Mode7Renderer'

export type ItemType = 'banana'

type ItemBox = {
  id: string
  x: number
  y: number
  active: boolean
}

const PICKUP_RADIUS_RATIO = 0.035
const ITEM_BOX_RESPAWN_MS = 5000

// Runtime-generated frames let us animate much more smoothly than the original
// partial tiles. 50ms = ~20fps, which is smooth while keeping the Mode 7
// overlay refresh comfortably below the main render loop rate.
const PANEL_FRAME_MS = 50
const PANEL_TEXTURE_KEY = 'item-panels-mode7'
const PANEL_SIZE = 32
const ACTIVE_PANEL_FRAMES = 24
const EMPTY_PANEL_FRAME = ACTIVE_PANEL_FRAMES
const PANEL_FRAME_COUNT = ACTIVE_PANEL_FRAMES + 1
const PANEL_WORLD_SCALE = 1.05

const ROULETTE_DURATION_MS = 1100
const ROULETTE_STEP_MS = 110

// Spread the row further apart so each panel keeps a visible strip of tarmac
// between it and its neighbours once projected through Mode 7.
const MARIO_CIRCUIT_ITEM_BOXES = [
  { id: 'mc1-1', xRatio: 0.83, yRatio: 0.5 },
  { id: 'mc1-2', xRatio: 0.87, yRatio: 0.5 },
  { id: 'mc1-3', xRatio: 0.91, yRatio: 0.5 },
  { id: 'mc1-4', xRatio: 0.95, yRatio: 0.5 },
  { id: 'mc1-5', xRatio: 0.99, yRatio: 0.5 },
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
    this.createPanelTexture()

    this.itemBoxes = MARIO_CIRCUIT_ITEM_BOXES.map((definition) => ({
      id: definition.id,
      x: renderer.sourceWidth * definition.xRatio,
      y: renderer.sourceHeight * definition.yRatio,
      active: true,
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
        this.panelFrame = (this.panelFrame + 1) % ACTIVE_PANEL_FRAMES
        this.refreshGroundPanels()
      },
    })

    this.refreshGroundPanels()
  }

  update(playerX: number, playerY: number, _camera: Mode7CameraState) {
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
    this.renderer.setGroundSprites(PANEL_TEXTURE_KEY, [])
    this.rouletteFrame.destroy()
    this.rouletteSprite.destroy()
    this.heldText.destroy()
    if (this.scene.textures.exists(PANEL_TEXTURE_KEY)) {
      this.scene.textures.remove(PANEL_TEXTURE_KEY)
    }
  }

  private collect(itemBox: ItemBox) {
    itemBox.active = false
    this.refreshGroundPanels()
    this.startRoulette()

    this.scene.time.delayedCall(ITEM_BOX_RESPAWN_MS, () => {
      itemBox.active = true
      this.refreshGroundPanels()
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

  private createPanelTexture() {
    if (this.scene.textures.exists(PANEL_TEXTURE_KEY)) return

    const texture = this.scene.textures.createCanvas(
      PANEL_TEXTURE_KEY,
      PANEL_SIZE * PANEL_FRAME_COUNT,
      PANEL_SIZE,
    )
    if (!texture) return

    const context = texture.context
    context.imageSmoothingEnabled = false

    // Draw two identical question marks one panel-width apart. As one exits
    // through the right edge, the next is already entering from the left, so
    // the active tile never sits blank between animation cycles.
    for (let frame = 0; frame < ACTIVE_PANEL_FRAMES; frame += 1) {
      const frameX = frame * PANEL_SIZE
      this.drawPanelBase(context, frameX, true)

      const progress = frame / ACTIVE_PANEL_FRAMES
      const glyphX = Math.floor(progress * PANEL_SIZE)

      context.save()
      context.beginPath()
      context.rect(frameX, 0, PANEL_SIZE, PANEL_SIZE)
      context.clip()
      this.drawQuestionMark(context, frameX + glyphX, 5)
      this.drawQuestionMark(context, frameX + glyphX - PANEL_SIZE, 5)
      context.restore()
    }

    this.drawPanelBase(
      context,
      EMPTY_PANEL_FRAME * PANEL_SIZE,
      false,
    )
    this.drawSadFace(
      context,
      EMPTY_PANEL_FRAME * PANEL_SIZE,
      0,
    )

    texture.refresh()
  }

  private drawPanelBase(
    context: CanvasRenderingContext2D,
    x: number,
    active: boolean,
  ) {
    context.fillStyle = active ? '#ffc000' : '#d90000'
    context.fillRect(x, 0, PANEL_SIZE, PANEL_SIZE)

    context.fillStyle = active ? '#ffffff' : '#ff9300'
    context.fillRect(x, 0, PANEL_SIZE - 2, 2)
    context.fillRect(x, 0, 2, PANEL_SIZE - 2)

    context.fillStyle = active ? '#9d1400' : '#690000'
    context.fillRect(x, PANEL_SIZE - 2, PANEL_SIZE, 2)
    context.fillRect(x + PANEL_SIZE - 2, 0, 2, PANEL_SIZE)
  }

  private drawQuestionMark(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
  ) {
    context.fillStyle = '#050505'

    const block = 3
    const pixels = [
      [1, 0], [2, 0], [3, 0], [4, 0],
      [0, 1], [4, 1],
      [3, 2], [4, 2],
      [2, 3], [3, 3],
      [2, 4],
      [2, 6],
    ] as const

    for (const [px, py] of pixels) {
      context.fillRect(x + px * block, y + py * block, block, block)
    }
  }

  private drawSadFace(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
  ) {
    context.fillStyle = '#4b0000'

    // Chunky pixel-art :( face for a depleted item panel.
    context.fillRect(x + 8, y + 9, 4, 5)
    context.fillRect(x + 20, y + 9, 4, 5)
    context.fillRect(x + 10, y + 21, 3, 3)
    context.fillRect(x + 13, y + 18, 6, 3)
    context.fillRect(x + 19, y + 21, 3, 3)
  }

  private refreshGroundPanels() {
    const sprites: Mode7GroundSprite[] = this.itemBoxes.map((itemBox) => {
      const frame = itemBox.active
        ? this.panelFrame
        : EMPTY_PANEL_FRAME

      return {
        x: itemBox.x,
        y: itemBox.y,
        frameX: frame * PANEL_SIZE,
        frameY: 0,
        frameWidth: PANEL_SIZE,
        frameHeight: PANEL_SIZE,
        worldScale: PANEL_WORLD_SCALE,
      }
    })

    this.renderer.setGroundSprites(PANEL_TEXTURE_KEY, sprites)
  }
}
