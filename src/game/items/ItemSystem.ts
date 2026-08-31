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

// The earlier 90 ms cadence was far too frantic once the tiles were projected
// through Mode 7. A slower cadence reads much more like a track-panel animation
// instead of noisy texture flicker.
const PANEL_FRAME_MS = 190
const ROULETTE_DURATION_MS = 1250
const ROULETTE_STEP_MS = 120

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

// These are painted into the track before Mode 7 projection. At 2x they were
// only 32 x 16 world pixels and several source pixels vanished at distance,
// making the artwork appear tiny/cropped. 4x preserves the whole tile better.
const PANEL_WORLD_SCALE = 4

// GIMP measurement from public/assets/items/Item Roulette.png.
const ROULETTE_FRAME_X = 0
const ROULETTE_FRAME_Y = 19
const ROULETTE_FRAME_WIDTH = 26
const ROULETTE_FRAME_HEIGHT = 18
const ROULETTE_FRAME_COUNT = 3
const ROULETTE_DISPLAY_SCALE = 4

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

  private readonly rouletteContainer: Phaser.GameObjects.Container
  private readonly rouletteBacking: Phaser.GameObjects.Rectangle
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

    this.rouletteBacking = scene.add
      .rectangle(0, 0, 122, 88, 0x080808, 0.94)
      .setStrokeStyle(4, 0xffffff)

    this.rouletteSprite = scene.add
      .image(0, -4, rouletteTextureKey)
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

    this.heldText = scene.add
      .text(0, 34, '', {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 3,
      })
      .setOrigin(0.5, 0)

    // Animate this container instead of rouletteSprite itself. That preserves
    // the sprite's 4x display size while the whole HUD slot pops open/closed.
    this.rouletteContainer = scene.add
      .container(94, 132, [
        this.rouletteBacking,
        this.rouletteSprite,
        this.heldText,
      ])
      .setDepth(41)
      .setVisible(false)

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
    this.rouletteContainer.destroy(true)
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
    this.heldText.setText('ROULETTE')
    this.rouletteSprite.setAlpha(1)
    this.rouletteBacking.setAlpha(1)
    this.rouletteContainer
      .setVisible(true)
      .setAlpha(1)
      .setScale(0.08)

    this.scene.tweens.killTweensOf(this.rouletteContainer)
    this.scene.tweens.add({
      targets: this.rouletteContainer,
      scaleX: 1.08,
      scaleY: 1.08,
      duration: 140,
      ease: 'Back.Out',
      onComplete: () => {
        this.scene.tweens.add({
          targets: this.rouletteContainer,
          scaleX: 1,
          scaleY: 1,
          duration: 80,
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

        // Flash the slot rather than shrinking the sprite. Keep it readable.
        const bright = step % 2 === 0
        this.rouletteSprite.setAlpha(bright ? 1 : 0.65)
        this.rouletteBacking.setAlpha(bright ? 1 : 0.8)
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
        this.rouletteBacking.setAlpha(1)
        this.heldText.setText('BANANA  [SPACE]')
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

    // setCrop can alter the displayed crop bounds internally, so explicitly
    // restore our intended pixel-art size after every frame switch.
    this.rouletteSprite.setDisplaySize(
      ROULETTE_FRAME_WIDTH * ROULETTE_DISPLAY_SCALE,
      ROULETTE_FRAME_HEIGHT * ROULETTE_DISPLAY_SCALE,
    )
  }

  private closeRouletteHud() {
    this.scene.tweens.killTweensOf(this.rouletteContainer)
    this.scene.tweens.add({
      targets: this.rouletteContainer,
      scaleX: 0.08,
      scaleY: 0.08,
      alpha: 0,
      duration: 110,
      onComplete: () => {
        this.rouletteContainer
          .setVisible(false)
          .setScale(1)
          .setAlpha(1)
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
