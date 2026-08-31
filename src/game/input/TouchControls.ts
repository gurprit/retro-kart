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
  private dpadPointerId?: number

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
      this.createLandscapeHandheldLayout()
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
    this.releaseDpad()

    for (const object of this.uiObjects) object.destroy()
    this.uiObjects.length = 0
  }

  private createPortraitGameBoyLayout() {
    const width = this.scene.scale.width
    const height = this.scene.scale.height
    const gameBottom = 600
    const deckHeight = height - gameBottom

    const shell = this.scene.add.graphics().setDepth(70).setScrollFactor(0)
    shell.fillStyle(0xbdb9a8, 1)
    shell.fillRect(0, gameBottom, width, deckHeight + 30)
    shell.fillStyle(0x9d998b, 1)
    shell.fillRect(0, gameBottom, width, 7)
    shell.fillStyle(0xd4d0c1, 0.8)
    shell.fillRect(0, gameBottom + 7, width, 3)
    this.track(shell)

    const brand = this.scene.add
      .text(width / 2, gameBottom + 38, 'RETRO KART', {
        fontFamily: 'monospace',
        fontSize: '24px',
        fontStyle: 'bold',
        color: '#51496d',
      })
      .setOrigin(0.5)
      .setDepth(72)
      .setScrollFactor(0)
    this.track(brand)

    const dpadX = 168
    const dpadY = gameBottom + 244
    const actionX = width - 150
    const actionY = gameBottom + 258

    this.createDpad(dpadX, dpadY, 1.16)
    this.createAButtonWithDrift(actionX, actionY, 1.08)
    this.createBButton(actionX - 126, actionY - 28, 46)
    this.createStartButton(width / 2 + 4, gameBottom + 350, 1)
    this.createSpeakerGrille(width - 68, gameBottom + 356, 1)

    const accent = this.scene.add
      .circle(32, gameBottom + 42, 6, 0x51496d, 0.9)
      .setDepth(73)
      .setScrollFactor(0)
    this.track(accent)
  }

  private createLandscapeHandheldLayout() {
    const width = this.scene.scale.width
    const height = this.scene.scale.height
    const wingWidth = Phaser.Math.Clamp(width * 0.16, 150, 210)

    const shell = this.scene.add.graphics().setDepth(70).setScrollFactor(0)
    shell.fillStyle(0xbdb9a8, 0.98)
    shell.fillRoundedRect(0, 0, wingWidth + 26, height, 36)
    shell.fillRoundedRect(width - wingWidth - 26, 0, wingWidth + 26, height, 36)

    shell.fillStyle(0x1b1b1b, 1)
    shell.fillRoundedRect(wingWidth - 2, 10, width - wingWidth * 2 + 4, height - 20, 24)

    shell.lineStyle(3, 0x858174, 1)
    shell.strokeRoundedRect(0, 0, wingWidth + 26, height, 36)
    shell.strokeRoundedRect(width - wingWidth - 26, 0, wingWidth + 26, height, 36)
    this.track(shell)

    const dpadScale = Phaser.Math.Clamp(height / 600, 0.74, 0.9)
    this.createDpad(wingWidth * 0.53, height * 0.56, dpadScale)

    const actionX = width - wingWidth * 0.5
    const actionY = height * 0.64
    this.createAButtonWithDrift(actionX, actionY, dpadScale * 0.98)
    this.createBButton(actionX - 12, actionY - 122 * dpadScale, 39 * dpadScale)
    this.createStartButton(width - wingWidth * 0.52, 58, 0.82)
    this.createSpeakerGrille(width - wingWidth * 0.52, height - 48, 0.72)

    const led = this.scene.add
      .circle(wingWidth * 0.5, 33, 5, 0x51496d, 1)
      .setDepth(75)
      .setScrollFactor(0)
    this.track(led)
  }

  private createDpad(x: number, y: number, scale: number) {
    const arm = 39 * scale
    const length = 108 * scale
    const recessRadius = 79 * scale
    const maxNudge = 7 * scale

    const recessShadow = this.scene.add
      .circle(x + 3, y + 5, recessRadius, 0x000000, 0.18)
      .setDepth(77)
      .setScrollFactor(0)
    const recess = this.scene.add
      .circle(x, y, recessRadius, 0xa6a293, 1)
      .setStrokeStyle(2, 0xd8d4c5, 0.8)
      .setDepth(78)
      .setScrollFactor(0)

    const shadow = this.drawDpadCross(x + 5 * scale, y + 7 * scale, arm, length, 0x080808, 0.5, 79)
    const cross = this.drawDpadCross(x, y, arm, length, 0x202020, 1, 80)

    const arrowStyle: Phaser.Types.GameObjects.Text.TextStyle = {
      fontFamily: 'monospace',
      fontSize: `${Math.round(18 * scale)}px`,
      fontStyle: 'bold',
      color: '#555555',
      stroke: '#080808',
      strokeThickness: 1,
    }

    const arrowSpecs: Array<[number, number, string]> = [
      [0, -36, '▲'],
      [36, 0, '▶'],
      [0, 36, '▼'],
      [-36, 0, '◀'],
    ]
    const arrows = arrowSpecs.map(([ox, oy, label]) =>
      this.scene.add
        .text(x + ox * scale, y + oy * scale, label, arrowStyle)
        .setOrigin(0.5)
        .setDepth(81)
        .setScrollFactor(0),
    )

    const centre = this.scene.add
      .circle(x, y, 15 * scale, 0x2d2d2d, 1)
      .setStrokeStyle(2, 0x111111, 1)
      .setDepth(82)
      .setScrollFactor(0)

    const zone = this.scene.add
      .zone(x, y, recessRadius * 2.35, recessRadius * 2.35)
      .setDepth(88)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: false })

    const setVisualOffset = (nx: number, ny: number) => {
      const ox = nx * maxNudge
      const oy = ny * maxNudge
      cross.setPosition(ox, oy)
      shadow.setPosition(ox * 0.3, oy * 0.3)
      centre.setPosition(x + ox, y + oy)
      arrows.forEach((arrow, index) => {
        const [ax, ay] = arrowSpecs[index]
        arrow.setPosition(x + ax * scale + ox, y + ay * scale + oy)
      })
      cross.setAlpha(0.94)
      centre.setScale(0.96)
    }

    const updateDpad = (pointer: Phaser.Input.Pointer) => {
      if (this.dpadPointerId !== pointer.id) return

      const dx = pointer.x - x
      const dy = pointer.y - y
      const distance = Math.sqrt(dx * dx + dy * dy)
      const deadZone = 18 * scale

      if (distance < deadZone) {
        this.steerLeftDown = false
        this.steerRightDown = false
        this.brakeDown = false
        setVisualOffset(0, 0)
        return
      }

      const nx = dx / distance
      const ny = dy / distance

      // Eight-way gate. Horizontal and vertical thresholds overlap so diagonal
      // thumb positions naturally produce combined inputs.
      this.steerLeftDown = nx < -0.34
      this.steerRightDown = nx > 0.34
      this.brakeDown = ny > 0.34

      setVisualOffset(nx, ny)
    }

    zone.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.dpadPointerId !== undefined) return
      this.scene.tweens.killTweensOf([cross, shadow, centre, ...arrows])
      this.dpadPointerId = pointer.id
      updateDpad(pointer)
    })
    zone.on('pointermove', updateDpad)

    const release = (pointer?: Phaser.Input.Pointer) => {
      if (
        pointer &&
        this.dpadPointerId !== undefined &&
        pointer.id !== this.dpadPointerId
      ) return

      this.releaseDpad()
      cross.setAlpha(1)
      centre.setScale(1)

      this.scene.tweens.add({
        targets: [cross, shadow],
        x: 0,
        y: 0,
        duration: 85,
        ease: 'Back.Out',
      })
      this.scene.tweens.add({
        targets: centre,
        x,
        y,
        duration: 85,
        ease: 'Back.Out',
      })
      arrows.forEach((arrow, index) => {
        const [ax, ay] = arrowSpecs[index]
        this.scene.tweens.add({
          targets: arrow,
          x: x + ax * scale,
          y: y + ay * scale,
          duration: 85,
          ease: 'Back.Out',
        })
      })
    }

    zone.on('pointerup', release)
    zone.on('pointerout', release)
    zone.on('pointerupoutside', release)

    this.track(recessShadow, recess, shadow, cross, ...arrows, centre, zone)
  }

  private drawDpadCross(
    x: number,
    y: number,
    arm: number,
    length: number,
    colour: number,
    alpha: number,
    depth: number,
  ) {
    const halfArm = arm / 2
    const halfLength = length / 2
    const g = this.scene.add.graphics().setDepth(depth).setScrollFactor(0)
    g.fillStyle(colour, alpha)
    g.fillRoundedRect(x - halfArm, y - halfLength, arm, length, 5)
    g.fillRoundedRect(x - halfLength, y - halfArm, length, arm, 5)
    g.lineStyle(2, 0x050505, 0.9)
    g.strokeRoundedRect(x - halfArm, y - halfLength, arm, length, 5)
    g.strokeRoundedRect(x - halfLength, y - halfArm, length, arm, 5)
    return g
  }

  private createAButtonWithDrift(x: number, y: number, scale: number) {
    const radius = 59 * scale
    const driftTop = y - 150 * scale
    const driftThreshold = y - 55 * scale

    const track = this.scene.add.graphics().setDepth(78).setScrollFactor(0)
    track.fillStyle(0x8f8b80, 0.34)
    track.fillRoundedRect(
      x - radius * 0.78,
      driftTop,
      radius * 1.56,
      y - driftTop + radius * 0.78,
      radius * 0.72,
    )
    track.lineStyle(2, 0x777269, 0.65)
    track.strokeRoundedRect(
      x - radius * 0.78,
      driftTop,
      radius * 1.56,
      y - driftTop + radius * 0.78,
      radius * 0.72,
    )

    const driftLabel = this.scene.add
      .text(x, driftTop + 20 * scale, 'DRIFT', {
        fontFamily: 'monospace',
        fontSize: `${Math.round(11 * scale)}px`,
        fontStyle: 'bold',
        color: '#5b5760',
      })
      .setOrigin(0.5)
      .setDepth(79)
      .setScrollFactor(0)

    const arrows = this.scene.add
      .text(x, y - 88 * scale, '▲\n▲', {
        fontFamily: 'monospace',
        fontSize: `${Math.round(13 * scale)}px`,
        fontStyle: 'bold',
        color: '#625b73',
        align: 'center',
        lineSpacing: -3,
      })
      .setOrigin(0.5)
      .setAlpha(0.7)
      .setDepth(79)
      .setScrollFactor(0)

    const shadow = this.scene.add
      .circle(x + 5 * scale, y + 7 * scale, radius, 0x28121f, 0.75)
      .setDepth(80)
      .setScrollFactor(0)
    const button = this.scene.add
      .circle(x, y, radius, 0x8f285b, 1)
      .setStrokeStyle(5 * scale, 0x3c142b, 1)
      .setDepth(81)
      .setScrollFactor(0)
    const highlight = this.scene.add
      .circle(x - 8 * scale, y - 10 * scale, radius * 0.72, 0xb74277, 0.38)
      .setDepth(82)
      .setScrollFactor(0)
    const label = this.scene.add
      .text(x, y, 'A', {
        fontFamily: 'monospace',
        fontSize: `${Math.round(35 * scale)}px`,
        fontStyle: 'bold',
        color: '#f4dce8',
        stroke: '#5c1c3d',
        strokeThickness: 2,
      })
      .setOrigin(0.5)
      .setDepth(83)
      .setScrollFactor(0)

    const zone = this.scene.add
      .zone(x, y - 55 * scale, radius * 2.25, 220 * scale)
      .setDepth(89)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: false })

    const pressButton = (drifting: boolean) => {
      const pressY = drifting ? -6 * scale : 4 * scale
      button.setPosition(x, y + pressY).setScale(0.96)
      highlight.setPosition(x - 8 * scale, y - 10 * scale + pressY).setScale(0.96)
      label.setPosition(x, y + pressY).setScale(0.96)
      shadow.setAlpha(drifting ? 0.3 : 0.45)
      track.setAlpha(drifting ? 1 : 0.75)
      arrows.setAlpha(drifting ? 1 : 0.7)
      driftLabel.setColor(drifting ? '#33253f' : '#5b5760')
    }

    const updateGesture = (pointer: Phaser.Input.Pointer) => {
      if (this.actionPointerId !== pointer.id) return
      this.accelerateDown = true
      this.powerslideDown = pointer.y <= driftThreshold
      pressButton(this.powerslideDown)
    }

    zone.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.actionPointerId !== undefined) return
      this.actionPointerId = pointer.id
      this.scene.tweens.killTweensOf([button, highlight, label, shadow])
      updateGesture(pointer)
    })
    zone.on('pointermove', updateGesture)

    const release = (pointer?: Phaser.Input.Pointer) => {
      if (
        pointer &&
        this.actionPointerId !== undefined &&
        pointer.id !== this.actionPointerId
      ) return

      this.releaseActionGesture()
      track.setAlpha(1)
      arrows.setAlpha(0.7)
      driftLabel.setColor('#5b5760')
      shadow.setAlpha(0.75)

      this.scene.tweens.add({
        targets: [button, label],
        x,
        y,
        scaleX: 1,
        scaleY: 1,
        duration: 80,
        ease: 'Back.Out',
      })
      this.scene.tweens.add({
        targets: highlight,
        x: x - 8 * scale,
        y: y - 10 * scale,
        scaleX: 1,
        scaleY: 1,
        duration: 80,
        ease: 'Back.Out',
      })
    }

    zone.on('pointerup', release)
    zone.on('pointerout', release)
    zone.on('pointerupoutside', release)

    this.track(track, driftLabel, arrows, shadow, button, highlight, label, zone)
  }

  private createBButton(x: number, y: number, radius: number) {
    const shadow = this.scene.add
      .circle(x + 4, y + 6, radius, 0x28121f, 0.72)
      .setDepth(80)
      .setScrollFactor(0)
    const button = this.scene.add
      .circle(x, y, radius, 0x862752, 1)
      .setStrokeStyle(4, 0x3b1428, 1)
      .setDepth(81)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: false })
    const highlight = this.scene.add
      .circle(x - radius * 0.13, y - radius * 0.16, radius * 0.72, 0xb44474, 0.34)
      .setDepth(82)
      .setScrollFactor(0)
    const label = this.scene.add
      .text(x, y, 'B', {
        fontFamily: 'monospace',
        fontSize: `${Math.round(radius * 0.58)}px`,
        fontStyle: 'bold',
        color: '#f4dce8',
        stroke: '#5c1c3d',
        strokeThickness: 2,
      })
      .setOrigin(0.5)
      .setDepth(83)
      .setScrollFactor(0)

    button.on('pointerdown', () => {
      button.setPosition(x, y + 4).setScale(0.94)
      highlight.setPosition(x - radius * 0.13, y - radius * 0.16 + 4).setScale(0.94)
      label.setPosition(x, y + 4).setScale(0.94)
      shadow.setAlpha(0.38)
      this.itemPressed = true
    })

    const release = () => {
      button.setPosition(x, y).setScale(1)
      highlight.setPosition(x - radius * 0.13, y - radius * 0.16).setScale(1)
      label.setPosition(x, y).setScale(1)
      shadow.setAlpha(0.72)
    }

    button.on('pointerup', release)
    button.on('pointerout', release)
    button.on('pointerupoutside', release)

    this.track(shadow, button, highlight, label)
  }

  private createStartButton(x: number, y: number, scale: number) {
    const shadow = this.scene.add
      .ellipse(x + 2, y + 4, 72 * scale, 28 * scale, 0x000000, 0.35)
      .setDepth(79)
      .setScrollFactor(0)
    const button = this.scene.add
      .ellipse(x, y, 72 * scale, 28 * scale, 0x494641, 1)
      .setStrokeStyle(2, 0x262522, 1)
      .setDepth(80)
      .setScrollFactor(0)
    const text = this.scene.add
      .text(x, y, 'START', {
        fontFamily: 'monospace',
        fontSize: `${Math.round(11 * scale)}px`,
        fontStyle: 'bold',
        color: '#dedbd2',
      })
      .setOrigin(0.5)
      .setDepth(81)
      .setScrollFactor(0)
    this.track(shadow, button, text)
  }

  private createSpeakerGrille(x: number, y: number, scale: number) {
    const grille = this.scene.add.graphics().setDepth(76).setScrollFactor(0)
    grille.fillStyle(0x57544e, 0.9)
    const cols = 4
    const rows = 4
    const gap = 10 * scale
    const radius = 2.3 * scale
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        grille.fillCircle(
          x + (col - 1.5) * gap,
          y + (row - 1.5) * gap,
          radius,
        )
      }
    }
    this.track(grille)
  }

  private releaseActionGesture() {
    this.actionPointerId = undefined
    this.accelerateDown = false
    this.powerslideDown = false
  }

  private releaseDpad() {
    this.dpadPointerId = undefined
    this.steerLeftDown = false
    this.steerRightDown = false
    this.brakeDown = false
  }

  private track(...objects: Phaser.GameObjects.GameObject[]) {
    this.uiObjects.push(...objects)
  }
}
