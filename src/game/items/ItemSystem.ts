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
const ITEM_BOX_RESPAWN_AFTER_USE_MS = 1200
const PANEL_FRAME_MS = 90
const ROULETTE_DURATION_MS = 1050
const ROULETTE_STEP_MS = 80

// Exact GIMP measurements from public/assets/tilesets/Mario Circuit.png:
// item-panel animation block = x 0, y 192, size 64 x 32.
// It contains a 4 x 4 grid of 16 x 8 frames. The upper two rows are the
// live yellow panels and the lower two rows are the red/empty panels.
const PANEL_SHEET_X = 0
const PANEL_SHEET_Y = 192
const PANEL_FRAME_WIDTH = 16
const PANEL_FRAME_HEIGHT = 8
const PANEL_COLUMNS = 4
const ACTIVE_PANEL_FRAMES = 8
const EMPTY_PANEL_FRAME_START = 8
const EMPTY_PANEL_FRAMES = 8
const PANEL_WORLD_SCALE = 2

// Exact GIMP measurement from public/assets/items/Item Roulette.png:
// first roulette window begins at x 0, y 19 and is 26 x 18 pixels.
// The 80px-wide sheet fits three horizontal animation cells on that row.
const ROULETTE_FRAME_X = 0
const ROULETTE_FRAME_Y = 19
const ROULETTE_FRAME_WIDTH = 26
const ROULETTE_FRAME_HEIGHT = 18
const ROULETTE_FRAME_COUNT = 3
const ROULETTE_DISPLAY_SCALE = 3

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
  private readonly tilesetTextureKey: string
  private readonly itemBoxes: ItemBox[]
  private readonly pickupRadius: number
  private heldItem?: ItemType
  private rouletteRunning = false
  private collectedBox?: ItemBox
  private panelFrame = 0
  private panelAnimationTimer?: Phaser.Time.TimerEvent
  private rouletteTimer?: Phaser.Time.TimerEvent
  private rouletteFinishTimer?: Phaser.Time.TimerEvent
  private respawnTimer?: Phaser.Time.TimerEvent

  private readonly rouletteSprite: Phaser.GameObjects.Image
  private readonly heldText: Phaser.GameObjects.Text

  constructor(
    scene: Phaser.Scene,
    renderer: Mode7Renderer,
    worldScale: number,
    rouletteTextureKey: string,
    tilesetTextureKey: string,
  ) {
    this.scene = scene
    this.renderer = renderer
    this.tilesetTextureKey = tilesetTextureKey
    this.pickupRadius = worldScale * PICKUP_RADIUS_RATIO

    this.itemBoxes = MARIO_CIRCUIT_ITEM_BOXES.map((definition) => ({
      id: definition.id,
      x: renderer.sourceWidth * definition.xRatio,
      y: renderer.sourceHeight * definition.yRatio,
      active: true,
    }))

    // The roulette artwork already contains its own SNES border, so don't draw
    // a modern rectangle behind it. Crop the measured 26 x 18 window directly.
    this.rouletteSprite = scene.add
      .image(90, 128, rouletteTextureKey)
      .setDepth(41)
      .setCrop(
        ROULETTE_FRAME_X,
        ROULETTE_FRAME_Y,
        ROULETTE_FRAME_WIDTH,
        ROULETTE_FRAME_HEIGHT,
      )
      .setDisplaySize(
        ROULETTE_FRAME_WIDTH * ROULETTE_DISPLAY_SCALE,
        ROULETTE_FRAME_HEIGHT * ROULETTE_DISPLAY_SCALE,
      )
      .setVisible(false)

    this.heldText = scene.add
      .text(90, 162, '', {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 3,
      })
      .setOrigin(0.5, 0)
      .setDepth(42)

    this.panelAnimationTimer = scene.time.addEvent({
      delay: PANEL_FRAME_MS,
      loop: true,
      callback: () => {
        this.panelFrame += 1
        this.refreshGroundPanels()
      },
    })

    this.refreshGroundPanels()
  }

  update(
    playerX: number,
    playerY: number,
    _camera?: Mode7CameraState,
  ) {
    if (this.heldItem || this.rouletteRunning) {
      return
    }

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
    this.closeRouletteHud()

    if (this.collectedBox) {
      const boxToRespawn = this.collectedBox
      this.collectedBox = undefined
      this.respawnTimer?.destroy()
      this.respawnTimer = this.scene.time.delayedCall(
        ITEM_BOX_RESPAWN_AFTER_USE_MS,
        () => {
          boxToRespawn.active = true
          this.refreshGroundPanels()
        },
      )
    }

    return item
  }

  get currentItem() {
    return this.heldItem
  }

  destroy() {
    this.panelAnimationTimer?.destroy()
    this.rouletteTimer?.destroy()
    this.rouletteFinishTimer?.destroy()
    this.respawnTimer?.destroy()
    this.renderer.setGroundSprites(this.tilesetTextureKey, [])
    this.rouletteSprite.destroy()
    this.heldText.destroy()
  }

  private collect(itemBox: ItemBox) {
    itemBox.active = false
    this.collectedBox = itemBox
    this.refreshGroundPanels()
    this.startRoulette()
  }

  private startRoulette() {
    this.rouletteRunning = true
    this.setRouletteFrame(0)
    this.rouletteSprite.setVisible(true).setAlpha(1).setScale(0.08)
    this.heldText.setText('').setAlpha(0)

    // Open from almost nothing to the native cropped sprite size, with a tiny
    // overshoot. This gives the SNES item-window "pop open" rather than making
    // the entire source sheet wobble.
    this.scene.tweens.add({
      targets: this.rouletteSprite,
      scaleX: 1.08,
      scaleY: 1.08,
      duration: 120,
      ease: 'Back.Out',
      onComplete: () => {
        this.scene.tweens.add({
          targets: this.rouletteSprite,
          scaleX: 1,
          scaleY: 1,
          duration: 60,
        })
      },
    })

    let step = 0
    this.rouletteTimer?.destroy()
    this.rouletteTimer = this.scene.time.addEvent({
      delay: ROULETTE_STEP_MS,
      loop: true,
      callback: () => {
        step += 1
        this.setRouletteFrame(step % ROULETTE_FRAME_COUNT)
        this.rouletteSprite.setAlpha(step % 2 === 0 ? 1 : 0.7)
      },
    })

    this.rouletteFinishTimer?.destroy()
    this.rouletteFinishTimer = this.scene.time.delayedCall(
      ROULETTE_DURATION_MS,
      () => {
        this.rouletteTimer?.destroy()
        this.rouletteTimer = undefined
        this.rouletteRunning = false
        this.heldItem = 'banana'
        this.setRouletteFrame(0)
        this.rouletteSprite.setAlpha(1)
        this.heldText.setText('BANANA  [SPACE]').setAlpha(1)
      },
    )
  }

  private setRouletteFrame(frame: number) {
    this.rouletteSprite.setCrop(
      ROULETTE_FRAME_X + frame * ROULETTE_FRAME_WIDTH,
      ROULETTE_FRAME_Y,
      ROULETTE_FRAME_WIDTH,
      ROULETTE_FRAME_HEIGHT,
    )
    this.rouletteSprite.setDisplaySize(
      ROULETTE_FRAME_WIDTH * ROULETTE_DISPLAY_SCALE,
      ROULETTE_FRAME_HEIGHT * ROULETTE_DISPLAY_SCALE,
    )
  }

  private closeRouletteHud() {
    this.scene.tweens.add({
      targets: this.rouletteSprite,
      scaleX: 0.08,
      scaleY: 0.08,
      alpha: 0,
      duration: 90,
      onComplete: () => {
        this.rouletteSprite.setVisible(false).setScale(1).setAlpha(1)
      },
    })
    this.heldText.setText('')
  }

  private refreshGroundPanels() {
    const sprites: Mode7GroundSprite[] = this.itemBoxes.map((itemBox) => {
      const animationFrame = itemBox.active
        ? this.panelFrame % ACTIVE_PANEL_FRAMES
        : EMPTY_PANEL_FRAME_START + (this.panelFrame % EMPTY_PANEL_FRAMES)
      const column = animationFrame % PANEL_COLUMNS
      const row = Math.floor(animationFrame / PANEL_COLUMNS)

      return {
        x: itemBox.x,
        y: itemBox.y,
        frameX: PANEL_SHEET_X + column * PANEL_FRAME_WIDTH,
        frameY: PANEL_SHEET_Y + row * PANEL_FRAME_HEIGHT,
        frameWidth: PANEL_FRAME_WIDTH,
        frameHeight: PANEL_FRAME_HEIGHT,
        worldScale: PANEL_WORLD_SCALE,
      }
    })

    this.renderer.setGroundSprites(this.tilesetTextureKey, sprites)
  }
}
