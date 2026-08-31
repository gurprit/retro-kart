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
  panel: Phaser.GameObjects.Image
  glyph: Phaser.GameObjects.Image
}

const PICKUP_RADIUS_RATIO = 0.035
const ITEM_BOX_RESPAWN_MS = 5000

// Keep the physical panel completely static. Only the question-mark layer
// animates, which avoids the full-tile shimmer from swapping complete frames.
const PANEL_FRAME_MS = 150
const PANEL_TEXTURE_KEY = 'item-panel-base'
const GLYPH_TEXTURE_KEY = 'item-panel-question'
const PANEL_SIZE = 32
const GLYPH_FRAMES = 8

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
    this.createPanelTextures()

    this.itemBoxes = MARIO_CIRCUIT_ITEM_BOXES.map((definition) => {
      const panel = scene.add
        .image(0, 0, PANEL_TEXTURE_KEY)
        .setOrigin(0.5, 1)
        .setCrop(0, 0, PANEL_SIZE, PANEL_SIZE)

      const glyph = scene.add
        .image(0, 0, GLYPH_TEXTURE_KEY)
        .setOrigin(0.5, 1)
        .setCrop(0, 0, PANEL_SIZE, PANEL_SIZE)

      const view = scene.add
        .container(0, 0, [panel, glyph])
        .setDepth(8)
        .setVisible(false)

      return {
        id: definition.id,
        x: renderer.sourceWidth * definition.xRatio,
        y: renderer.sourceHeight * definition.yRatio,
        active: true,
        view,
        panel,
        glyph,
      }
    })

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
        this.panelFrame = (this.panelFrame + 1) % GLYPH_FRAMES
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
    for (const itemBox of this.itemBoxes) itemBox.view.destroy(true)
    this.rouletteFrame.destroy()
    this.rouletteSprite.destroy()
    this.heldText.destroy()
    if (this.scene.textures.exists(PANEL_TEXTURE_KEY)) {
      this.scene.textures.remove(PANEL_TEXTURE_KEY)
    }
    if (this.scene.textures.exists(GLYPH_TEXTURE_KEY)) {
      this.scene.textures.remove(GLYPH_TEXTURE_KEY)
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

      // The base panel never animates. Active = yellow frame 0, empty = red
      // frame 1. The question-mark image above it is the only moving layer.
      itemBox.panel.setCrop(
        itemBox.active ? 0 : PANEL_SIZE,
        0,
        PANEL_SIZE,
        PANEL_SIZE,
      )
      itemBox.glyph
        .setVisible(itemBox.active)
        .setCrop(
          this.panelFrame * PANEL_SIZE,
          0,
          PANEL_SIZE,
          PANEL_SIZE,
        )

      const perspectiveScale = Phaser.Math.Clamp(
        projected.scale * 1.55,
        0.72,
        2.8,
      )

      // Anchor the bottom edge directly on the projected road point. The
      // dimensions are deliberately broader and less vertically crushed than
      // before so the panel reads as a square tile lying in perspective rather
      // than a thin floating sign.
      const displayWidth = PANEL_SIZE * 4.35 * perspectiveScale
      const displayHeight = PANEL_SIZE * 2.25 * perspectiveScale

      itemBox.panel.setDisplaySize(displayWidth, displayHeight)
      itemBox.glyph.setDisplaySize(displayWidth, displayHeight)
      itemBox.view
        .setVisible(true)
        .setPosition(projected.x, projected.y + 2)
        .setDepth(8 + projected.screenY / 1000)
    }
  }

  private createPanelTextures() {
    if (!this.scene.textures.exists(PANEL_TEXTURE_KEY)) {
      const texture = this.scene.textures.createCanvas(
        PANEL_TEXTURE_KEY,
        PANEL_SIZE * 2,
        PANEL_SIZE,
      )

      if (texture) {
        const context = texture.context
        context.imageSmoothingEnabled = false
        this.drawPanelBase(context, 0, true)
        this.drawPanelBase(context, PANEL_SIZE, false)
        texture.refresh()
      }
    }

    if (!this.scene.textures.exists(GLYPH_TEXTURE_KEY)) {
      const texture = this.scene.textures.createCanvas(
        GLYPH_TEXTURE_KEY,
        PANEL_SIZE * GLYPH_FRAMES,
        PANEL_SIZE,
      )

      if (!texture) return

      const context = texture.context
      context.imageSmoothingEnabled = false

      // Each frame is transparent except for the same question mark at a new
      // horizontal position. The panel underneath remains perfectly static.
      const positions = [-10, -5, 0, 5, 10, 5, 0, -5]
      for (let frame = 0; frame < GLYPH_FRAMES; frame += 1) {
        this.drawQuestionMark(
          context,
          frame * PANEL_SIZE + positions[frame],
          5,
        )
      }

      texture.refresh()
    }
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

    if (!active) {
      context.fillStyle = '#710000'
      context.fillRect(x + 10, 14, 12, 3)
    }
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
}
