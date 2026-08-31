import Phaser from 'phaser'

export type TouchControlState = {
  accelerate: boolean
  brake: boolean
  steerLeft: boolean
  steerRight: boolean
  powerslide: boolean
}

type HoldCallbacks = {
  onDown: () => void
  onUp: () => void
}

export class TouchControls {
  readonly enabled: boolean

  private readonly scene: Phaser.Scene
  private accelerateDown = false
  private brakeDown = false
  private steerLeftDown = false
  private steerRightDown = false
  private powerslideDown = false
  private itemPressed = false
  private actionPointerId?: number

  private readonly uiObjects: Phaser.GameObjects.GameObject[] = []

  constructor(scene: Phaser.Scene) {
    this.scene = scene
    this.enabled =
      typeof navigator !== 'undefined' &&
      (navigator.maxTouchPoints > 0 || 'ontouchstart' in window)

    if (!this.enabled) return

    this.scene.input.addPointer(4)

    const portrait = this.scene.scale.height > 700
    if (portrait) {
      this.createPortraitGameBoyLayout()
    } else {
      this.createLandscapeLayout()
    }
  }

  get state(): TouchControlState {
    return {
      accelerate: this.accelerateDown,
      brake: this.brakeDown,
      steerLeft: this.steerLeftDown,
      steerRight: this.steerRightDown,
      powerslide: this.powerslideDown,
    }
  }

  consumeItemPress() {
    if (!this.itemPressed) return false
    this.itemPressed = false
    return true
  }

  destroy() {
    this.releaseActionGesture()

    for (const object of this.uiObjects) {
      object.destroy()
    }
    this.uiObjects.length = 0
  }

  private createPortraitGameBoyLayout() {
    const width = this.scene.scale.width
    const gameBottom = 600
    const deckHeight = this.scene.scale.height - gameBottom

    const deck = this.scene.add.graphics().setDepth(70).setScrollFactor(0)
    deck.fillStyle(0xb8b39f, 1)
    deck.fillRect(0, gameBottom, width, deckHeight + 24)
    deck.lineStyle(4, 0x777467, 1)
    deck.lineBetween(0, gameBottom, width, gameBottom)
    this.track(deck)

    const deckLabel = this.scene.add
      .text(width / 2, gameBottom + 36, 'RETRO KART', {
        fontFamily: 'monospace',
        fontSize: '24px',
        fontStyle: 'bold',
        color: '#4f486a',
      })
      .setOrigin(0.5)
      .setDepth(72)
      .setScrollFactor(0)
    this.track(deckLabel)

    const dpadX = 165
    const dpadY = gameBottom + 245
    const actionX = width - 175
    const actionY = gameBottom + 250

    this.createDPad(dpadX, dpadY, 1)
    this.createSlideActionCluster(actionX, actionY, 1.05)
    this.createItemButton(actionX - 128, actionY + 8, 42)

    const start = this.scene.add
      .ellipse(width / 2 + 62, gameBottom + 345, 68, 26, 0x403f3a, 0.7)
      .setStrokeStyle(2, 0xe4e0d3, 0.6)
      .setDepth(80)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: false })
    const startText = this.scene.add
      .text(width / 2 + 62, gameBottom + 345, 'START', {
        fontFamily: 'monospace',
        fontSize: '12px',
        fontStyle: 'bold',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 2,
      })
      .setOrigin(0.5)
      .setDepth(81)
      .setScrollFactor(0)
    this.track(start, startText)
  }

  private createLandscapeLayout() {
    const width = this.scene.scale.width
    const height = this.scene.scale.height

    this.createDPad(138, height - 92, 0.92)

    const actionX = width - 112
    const actionY = height - 92
    this.createSlideActionCluster(actionX, actionY, 0.92)
    this.createItemButton(actionX - 122, actionY + 4, 40)
  }

  private createDPad(x: number, y: number, scale: number) {
    const arm = 54 * scale
    const thickness = 58 * scale
    const total = arm * 2 + thickness

    const graphics = this.scene.add.graphics().setDepth(80).setScrollFactor(0)
    graphics.fillStyle(0x141414, 0.72)
    graphics.lineStyle(3, 0xf2f2f2, 0.55)
    graphics.fillRoundedRect(
      x - thickness / 2,
      y - total / 2,
      thickness,
      total,
      9 * scale,
    )
    graphics.strokeRoundedRect(
      x - thickness / 2,
      y - total / 2,
      thickness,
      total,
      9 * scale,
    )
    graphics.fillRoundedRect(
      x - total / 2,
      y - thickness / 2,
      total,
      thickness,
      9 * scale,
    )
    graphics.strokeRoundedRect(
      x - total / 2,
      y - thickness / 2,
      total,
      thickness,
      9 * scale,
    )
    graphics.fillStyle(0x090909, 0.82)
    graphics.fillCircle(x, y, 18 * scale)
    this.track(graphics)

    const glyphStyle: Phaser.Types.GameObjects.Text.TextStyle = {
      fontFamily: 'monospace',
      fontSize: `${Math.round(24 * scale)}px`,
      fontStyle: 'bold',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 3,
    }

    const leftText = this.scene.add.text(x - arm, y, '◀', glyphStyle).setOrigin(0.5).setDepth(82).setScrollFactor(0)
    const rightText = this.scene.add.text(x + arm, y, '▶', glyphStyle).setOrigin(0.5).setDepth(82).setScrollFactor(0)
    const upText = this.scene.add.text(x, y - arm, '▲', glyphStyle).setOrigin(0.5).setDepth(82).setScrollFactor(0)
    const downText = this.scene.add.text(x, y + arm, '▼', glyphStyle).setOrigin(0.5).setDepth(82).setScrollFactor(0)
    this.track(leftText, rightText, upText, downText)

    this.createHoldZone(x - arm, y, thickness, thickness, {
      onDown: () => {
        this.steerLeftDown = true
      },
      onUp: () => {
        this.steerLeftDown = false
      },
    })

    this.createHoldZone(x + arm, y, thickness, thickness, {
      onDown: () => {
        this.steerRightDown = true
      },
      onUp: () => {
        this.steerRightDown = false
      },
    })

    this.createHoldZone(x, y + arm, thickness, thickness, {
      onDown: () => {
        this.brakeDown = true
      },
      onUp: () => {
        this.brakeDown = false
      },
    })

    this.createHoldZone(x, y - arm, thickness, thickness, {
      onDown: () => {
        this.accelerateDown = true
      },
      onUp: () => {
        this.accelerateDown = false
      },
    })
  }

  private createSlideActionCluster(x: number, y: number, scale: number) {
    const goRadius = 56 * scale
    const driftRadius = 33 * scale
    const driftY = y - 82 * scale
    const gestureHeight = 180 * scale

    const go = this.scene.add
      .circle(x, y, goRadius, 0x151515, 0.7)
      .setStrokeStyle(3, 0xffffff, 0.65)
      .setDepth(80)
      .setScrollFactor(0)

    const goText = this.scene.add
      .text(x, y, 'GO', {
        fontFamily: 'monospace',
        fontSize: `${Math.round(18 * scale)}px`,
        fontStyle: 'bold',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setDepth(82)
      .setScrollFactor(0)

    const drift = this.scene.add
      .circle(x, driftY, driftRadius, 0x3d3d3d, 0.72)
      .setStrokeStyle(3, 0xffffff, 0.6)
      .setDepth(80)
      .setScrollFactor(0)

    const driftText = this.scene.add
      .text(x, driftY, 'DRIFT', {
        fontFamily: 'monospace',
        fontSize: `${Math.round(11 * scale)}px`,
        fontStyle: 'bold',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 2,
      })
      .setOrigin(0.5)
      .setDepth(82)
      .setScrollFactor(0)

    const hint = this.scene.add
      .text(x, y - 45 * scale, '↑', {
        fontFamily: 'monospace',
        fontSize: `${Math.round(17 * scale)}px`,
        fontStyle: 'bold',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 2,
      })
      .setOrigin(0.5)
      .setAlpha(0.58)
      .setDepth(82)
      .setScrollFactor(0)

    const zone = this.scene.add
      .zone(x, y - 40 * scale, goRadius * 2.15, gestureHeight)
      .setDepth(84)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: false })

    const driftThreshold = y - 48 * scale

    const updateGesture = (pointer: Phaser.Input.Pointer) => {
      if (this.actionPointerId !== pointer.id) return
      this.accelerateDown = true
      this.powerslideDown = pointer.y <= driftThreshold
      go.setAlpha(0.9)
      drift.setAlpha(this.powerslideDown ? 0.95 : 0.72)
      go.setScale(0.96)
      drift.setScale(this.powerslideDown ? 0.94 : 1)
    }

    zone.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.actionPointerId !== undefined) return
      this.actionPointerId = pointer.id
      updateGesture(pointer)
    })
    zone.on('pointermove', updateGesture)

    const release = (pointer?: Phaser.Input.Pointer) => {
      if (
        pointer &&
        this.actionPointerId !== undefined &&
        pointer.id !== this.actionPointerId
      ) {
        return
      }
      this.releaseActionGesture()
      go.setAlpha(0.7)
      drift.setAlpha(0.72)
      go.setScale(1)
      drift.setScale(1)
    }

    zone.on('pointerup', release)
    zone.on('pointerout', release)
    zone.on('pointerupoutside', release)

    this.track(go, goText, drift, driftText, hint, zone)
  }

  private createItemButton(x: number, y: number, radius: number) {
    const background = this.scene.add
      .circle(x, y, radius, 0x1b1b1b, 0.72)
      .setStrokeStyle(3, 0xffffff, 0.65)
      .setDepth(80)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: false })

    const text = this.scene.add
      .text(x, y, 'ITEM', {
        fontFamily: 'monospace',
        fontSize: '12px',
        fontStyle: 'bold',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 2,
      })
      .setOrigin(0.5)
      .setDepth(82)
      .setScrollFactor(0)

    background.on('pointerdown', () => {
      background.setScale(0.93)
      background.setAlpha(0.95)
      this.itemPressed = true
    })

    const release = () => {
      background.setScale(1)
      background.setAlpha(0.72)
    }

    background.on('pointerup', release)
    background.on('pointerout', release)
    background.on('pointerupoutside', release)

    this.track(background, text)
  }

  private createHoldZone(
    x: number,
    y: number,
    width: number,
    height: number,
    callbacks: HoldCallbacks,
  ) {
    const zone = this.scene.add
      .zone(x, y, width, height)
      .setDepth(84)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: false })

    zone.on('pointerdown', callbacks.onDown)
    zone.on('pointerup', callbacks.onUp)
    zone.on('pointerout', callbacks.onUp)
    zone.on('pointerupoutside', callbacks.onUp)

    this.track(zone)
  }

  private releaseActionGesture() {
    this.actionPointerId = undefined
    this.accelerateDown = false
    this.powerslideDown = false
  }

  private track(...objects: Phaser.GameObjects.GameObject[]) {
    this.uiObjects.push(...objects)
  }
}
