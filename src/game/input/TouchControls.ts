import Phaser from 'phaser'

export type TouchControlState = {
  accelerate: boolean
  brake: boolean
  steerLeft: boolean
  steerRight: boolean
  powerslide: boolean
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
  private joystickPointerId?: number

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
    this.releaseJoystick()

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

    const joystickX = 165
    const joystickY = gameBottom + 245
    const actionX = width - 175
    const actionY = gameBottom + 250

    this.createJoystick(joystickX, joystickY, 1.08)
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

    this.createJoystick(132, height - 94, 0.9)

    const actionX = width - 112
    const actionY = height - 92
    this.createSlideActionCluster(actionX, actionY, 0.92)
    this.createItemButton(actionX - 122, actionY + 4, 40)
  }

  private createJoystick(x: number, y: number, scale: number) {
    const baseRadius = 70 * scale
    const gateRadius = 48 * scale
    const capRadius = 34 * scale
    const maxThrow = 34 * scale

    const shadow = this.scene.add
      .circle(x + 4 * scale, y + 7 * scale, baseRadius, 0x000000, 0.42)
      .setDepth(78)
      .setScrollFactor(0)

    const base = this.scene.add
      .circle(x, y, baseRadius, 0x272727, 0.88)
      .setStrokeStyle(4, 0xd8d8d8, 0.68)
      .setDepth(79)
      .setScrollFactor(0)

    const gate = this.scene.add
      .circle(x, y, gateRadius, 0x0c0c0c, 0.82)
      .setStrokeStyle(3, 0x5e5e5e, 0.9)
      .setDepth(80)
      .setScrollFactor(0)

    const notchStyle: Phaser.Types.GameObjects.Text.TextStyle = {
      fontFamily: 'monospace',
      fontSize: `${Math.round(16 * scale)}px`,
      fontStyle: 'bold',
      color: '#bcbcbc',
      stroke: '#000000',
      strokeThickness: 2,
    }

    const left = this.scene.add
      .text(x - 55 * scale, y, '◀', notchStyle)
      .setOrigin(0.5)
      .setDepth(81)
      .setScrollFactor(0)
    const right = this.scene.add
      .text(x + 55 * scale, y, '▶', notchStyle)
      .setOrigin(0.5)
      .setDepth(81)
      .setScrollFactor(0)
    const up = this.scene.add
      .text(x, y - 55 * scale, '▲', notchStyle)
      .setOrigin(0.5)
      .setDepth(81)
      .setScrollFactor(0)
    const down = this.scene.add
      .text(x, y + 55 * scale, '▼', notchStyle)
      .setOrigin(0.5)
      .setDepth(81)
      .setScrollFactor(0)

    const capShadow = this.scene.add
      .circle(x + 3 * scale, y + 5 * scale, capRadius, 0x000000, 0.65)
      .setDepth(82)
      .setScrollFactor(0)

    const cap = this.scene.add
      .circle(x, y, capRadius, 0x181818, 1)
      .setStrokeStyle(4, 0xf0f0f0, 0.62)
      .setDepth(83)
      .setScrollFactor(0)

    const capInner = this.scene.add
      .circle(x, y, capRadius * 0.58, 0x303030, 1)
      .setStrokeStyle(2, 0x080808, 0.85)
      .setDepth(84)
      .setScrollFactor(0)

    const zone = this.scene.add
      .zone(x, y, baseRadius * 2.6, baseRadius * 2.6)
      .setDepth(86)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: false })

    const setCapPosition = (offsetX: number, offsetY: number) => {
      cap.setPosition(x + offsetX, y + offsetY)
      capInner.setPosition(x + offsetX, y + offsetY)
      capShadow.setPosition(
        x + offsetX + 3 * scale,
        y + offsetY + 5 * scale,
      )
    }

    const updateJoystick = (pointer: Phaser.Input.Pointer) => {
      if (this.joystickPointerId !== pointer.id) return

      const dx = pointer.x - x
      const dy = pointer.y - y
      const distance = Math.sqrt(dx * dx + dy * dy)
      const clamp = distance > maxThrow && distance > 0
        ? maxThrow / distance
        : 1
      const offsetX = dx * clamp
      const offsetY = dy * clamp

      setCapPosition(offsetX, offsetY)

      const normalizedX = offsetX / maxThrow
      const normalizedY = offsetY / maxThrow

      this.steerLeftDown = normalizedX < -0.28
      this.steerRightDown = normalizedX > 0.28
      this.brakeDown = normalizedY > 0.38

      // Up remains a secondary throttle option for one-thumb play.
      if (this.actionPointerId === undefined) {
        this.accelerateDown = normalizedY < -0.45
      }

      const active =
        this.steerLeftDown ||
        this.steerRightDown ||
        this.brakeDown ||
        normalizedY < -0.45

      cap.setFillStyle(active ? 0x242424 : 0x181818, 1)
      gate.setStrokeStyle(3, active ? 0xbdbdbd : 0x5e5e5e, 0.9)
    }

    zone.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.joystickPointerId !== undefined) return
      this.scene.tweens.killTweensOf([cap, capInner, capShadow])
      this.joystickPointerId = pointer.id
      updateJoystick(pointer)
    })

    zone.on('pointermove', updateJoystick)

    const release = (pointer?: Phaser.Input.Pointer) => {
      if (
        pointer &&
        this.joystickPointerId !== undefined &&
        pointer.id !== this.joystickPointerId
      ) {
        return
      }

      this.releaseJoystick()
      cap.setFillStyle(0x181818, 1)
      gate.setStrokeStyle(3, 0x5e5e5e, 0.9)

      this.scene.tweens.add({
        targets: [cap, capInner],
        x,
        y,
        duration: 90,
        ease: 'Back.Out',
      })
      this.scene.tweens.add({
        targets: capShadow,
        x: x + 3 * scale,
        y: y + 5 * scale,
        duration: 90,
        ease: 'Back.Out',
      })
    }

    zone.on('pointerup', release)
    zone.on('pointerout', release)
    zone.on('pointerupoutside', release)

    this.track(
      shadow,
      base,
      gate,
      left,
      right,
      up,
      down,
      capShadow,
      cap,
      capInner,
      zone,
    )
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

  private releaseActionGesture() {
    this.actionPointerId = undefined
    this.accelerateDown = false
    this.powerslideDown = false
  }

  private releaseJoystick() {
    this.joystickPointerId = undefined
    this.steerLeftDown = false
    this.steerRightDown = false
    this.brakeDown = false

    if (this.actionPointerId === undefined) {
      this.accelerateDown = false
    }
  }

  private track(...objects: Phaser.GameObjects.GameObject[]) {
    this.uiObjects.push(...objects)
  }
}
