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
const PANEL_FRAME_MS = 300
const ROULETTE_DURATION_MS = 1250
const ROULETTE_STEP_MS = 120

// The Mario Circuit tileset stores the question panel as component tiles rather
// than complete animation frames. Build a tiny complete-panel sheet at runtime
// instead, using the supplied reconstructed panel as the visual reference.
const PANEL_TEXTURE_KEY = 'item-panels-complete'
const PANEL_SIZE = 16
const ACTIVE_PANEL_FRAMES = 4
const EMPTY_PANEL_FRAME_START = 4
const EMPTY_PANEL_FRAMES = 2
const PANEL_FRAME_COUNT = ACTIVE_PANEL_FRAMES + EMPTY_PANEL_FRAMES
const PANEL_WORLD_SCALE = 1.65

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

  update(playerX: number, playerY: number, _camera?: Mode7CameraState) {
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
    this.renderer.setGroundSprites(PANEL_TEXTURE_KEY, [])
    this.rouletteContainer.destroy(true)
    if (this.scene.textures.exists(PANEL_TEXTURE_KEY)) {
      this.scene.textures.remove(PANEL_TEXTURE_KEY)
    }
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
    this.rouletteContainer.setVisible(true).setAlpha(1).setScale(0.08)

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
        this.rouletteContainer.setVisible(false).setScale(1).setAlpha(1)
      },
    })
    this.heldText.setText('')
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

      // Complete 16 x 16 panel. The one-pixel highlight and dark lower/right
      // lip are taken from the user's reconstructed full-block reference.
      context.fillStyle = active
        ? pulse % 2 === 0
          ? '#ffc000'
          : '#ffd000'
        : pulse % 2 === 0
          ? '#d40000'
          : '#ea0000'
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

  private refreshGroundPanels() {
    const sprites: Mode7GroundSprite[] = this.itemBoxes.map((itemBox) => {
      const animationFrame = itemBox.active
        ? this.panelFrame % ACTIVE_PANEL_FRAMES
        : EMPTY_PANEL_FRAME_START + (this.panelFrame % EMPTY_PANEL_FRAMES)

      return {
        x: itemBox.x,
        y: itemBox.y,
        frameX: animationFrame * PANEL_SIZE,
        frameY: 0,
        frameWidth: PANEL_SIZE,
        frameHeight: PANEL_SIZE,
        worldScale: PANEL_WORLD_SCALE,
      }
    })

    this.renderer.setGroundSprites(PANEL_TEXTURE_KEY, sprites)
  }
}
