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
const ROULETTE_STEP_MS = 70

// The supplied Mario Circuit tileset crop is a 4 x 4 frame block. Each frame
// is 16 x 8 source pixels: the top two rows are the live yellow question-panel
// animation and the bottom two rows are the red/empty-panel animation.
const PANEL_FRAME_WIDTH = 16
const PANEL_FRAME_HEIGHT = 8
const PANEL_COLUMNS = 4
const ACTIVE_PANEL_FRAMES = 8
const EMPTY_PANEL_FRAME_START = 8
const EMPTY_PANEL_FRAMES = 8
const PANEL_WORLD_SCALE = 2

// Item Roulette.png is 80px wide. Cycle five 16px cells across the top row for
// the fast roulette flicker, while the container itself performs the opening pop.
const ROULETTE_CELL_SIZE = 16
const ROULETTE_CELL_COUNT = 5

// Mario Circuit 1 first item row, expressed in normalized track coordinates.
// Placement/state stay independent from PlayerKart so AI/network racers can
// consume exactly the same item-box data later.
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

  private readonly rouletteFrame: Phaser.GameObjects.Rectangle
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

    this.rouletteFrame = scene.add
      .rectangle(90, 128, 68, 68, 0x101018, 0.92)
      .setStrokeStyle(4, 0xffffff)
      .setDepth(40)
      .setVisible(false)

    this.rouletteSprite = scene.add
      .image(90, 128, rouletteTextureKey)
      .setDepth(41)
      .setCrop(0, 0, ROULETTE_CELL_SIZE, ROULETTE_CELL_SIZE)
      .setDisplaySize(48, 48)
      .setVisible(false)

    this.heldText = scene.add
      .text(90, 168, '', {
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
    this.closeRouletteHud()

    // Keep the collected panel visibly empty until the item is actually used,
    // then recharge it shortly afterwards. This makes the lifecycle obvious
    // during this milestone and maps cleanly to server-authoritative respawns.
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
    this.rouletteFrame.destroy()
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
    this.rouletteFrame.setVisible(true).setScale(0.12).setAlpha(1)
    this.rouletteSprite
      .setVisible(true)
      .setAlpha(1)
      .setCrop(0, 0, ROULETTE_CELL_SIZE, ROULETTE_CELL_SIZE)
      .setScale(0.12)
    this.heldText.setText('ROULETTE').setAlpha(0)

    this.scene.tweens.add({
      targets: [this.rouletteFrame, this.rouletteSprite],
      scaleX: 1.12,
      scaleY: 1.12,
      duration: 110,
      ease: 'Back.Out',
      onComplete: () => {
        this.scene.tweens.add({
          targets: [this.rouletteFrame, this.rouletteSprite],
          scaleX: 1,
          scaleY: 1,
          duration: 70,
        })
        this.heldText.setAlpha(1)
      },
    })

    let step = 0
    this.rouletteTimer?.destroy()
    this.rouletteTimer = this.scene.time.addEvent({
      delay: ROULETTE_STEP_MS,
      loop: true,
      callback: () => {
        step += 1
        const cell = step % ROULETTE_CELL_COUNT
        this.rouletteSprite.setCrop(
          cell * ROULETTE_CELL_SIZE,
          0,
          ROULETTE_CELL_SIZE,
          ROULETTE_CELL_SIZE,
        )

        const flashOn = step % 2 === 0
        this.rouletteFrame.setAlpha(flashOn ? 1 : 0.58)
        this.rouletteSprite.setAlpha(flashOn ? 1 : 0.72)
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
        this.rouletteFrame.setAlpha(1)
        this.rouletteSprite
          .setAlpha(1)
          .setCrop(0, 0, ROULETTE_CELL_SIZE, ROULETTE_CELL_SIZE)
        this.heldText.setText('BANANA  [SPACE]')
      },
    )
  }

  private closeRouletteHud() {
    this.scene.tweens.add({
      targets: [this.rouletteFrame, this.rouletteSprite],
      scaleX: 0.1,
      scaleY: 0.1,
      alpha: 0,
      duration: 90,
      onComplete: () => {
        this.rouletteFrame.setVisible(false).setScale(1).setAlpha(1)
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
        frameX: column * PANEL_FRAME_WIDTH,
        frameY: row * PANEL_FRAME_HEIGHT,
        frameWidth: PANEL_FRAME_WIDTH,
        frameHeight: PANEL_FRAME_HEIGHT,
        worldScale: PANEL_WORLD_SCALE,
      }
    })

    this.renderer.setGroundSprites(this.tilesetTextureKey, sprites)
  }
}
