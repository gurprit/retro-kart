import Phaser from 'phaser'

export type TouchControlState = {
  accelerate: boolean
  brake: boolean
  steerLeft: boolean
  steerRight: boolean
  powerslide: boolean
}

type TouchButton = {
  container: Phaser.GameObjects.Container
  background: Phaser.GameObjects.Arc
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

  private readonly buttons: TouchButton[] = []
  private deck?: Phaser.GameObjects.Graphics
  private deckLabel?: Phaser.GameObjects.Text

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
    for (const button of this.buttons) {
      button.container.destroy(true)
    }
    this.buttons.length = 0
    this.deck?.destroy()
    this.deckLabel?.destroy()
  }

  private createPortraitGameBoyLayout() {
    const width = this.scene.scale.width
    const gameBottom = 600
    const deckHeight = this.scene.scale.height - gameBottom

    this.deck = this.scene.add.graphics().setDepth(70).setScrollFactor(0)
    this.deck.fillStyle(0xb8b39f, 1)
    this.deck.fillRoundedRect(0, gameBottom, width, deckHeight + 24, 0)
    this.deck.lineStyle(4, 0x777467, 1)
    this.deck.lineBetween(0, gameBottom, width, gameBottom)

    this.deckLabel = this.scene.add
      .text(width / 2, gameBottom + 36, 'RETRO KART', {
        fontFamily: 'monospace',
        fontSize: '24px',
        fontStyle: 'bold',
        color: '#4f486a',
      })
      .setOrigin(0.5)
      .setDepth(72)
      .setScrollFactor(0)

    const dpadX = 175
    const dpadY = gameBottom + 235
    const actionX = width - 175
    const actionY = gameBottom + 225

    this.createHoldButton(dpadX - 62, dpadY, 48, '◀', () => {
      this.steerLeftDown = true
    }, () => {
      this.steerLeftDown = false
    })

    this.createHoldButton(dpadX + 62, dpadY, 48, '▶', () => {
      this.steerRightDown = true
    }, () => {
      this.steerRightDown = false
    })

    this.createHoldButton(dpadX, dpadY + 62, 44, '▼', () => {
      this.brakeDown = true
    }, () => {
      this.brakeDown = false
    }, 22)

    this.createHoldButton(actionX + 48, actionY - 24, 50, 'A', () => {
      this.accelerateDown = true
    }, () => {
      this.accelerateDown = false
    }, 24)

    this.createHoldButton(actionX - 56, actionY + 24, 46, 'B', () => {
      this.powerslideDown = true
    }, () => {
      this.powerslideDown = false
    }, 22)

    this.createTapButton(width / 2 - 64, gameBottom + 340, 28, 'ITEM', () => {
      this.itemPressed = true
    })

    this.createTapButton(width / 2 + 64, gameBottom + 340, 28, 'START', () => {})
  }

  private createLandscapeLayout() {
    const width = this.scene.scale.width
    const height = this.scene.scale.height
    const margin = 72

    this.createHoldButton(margin + 18, height - 92, 48, '◀', () => {
      this.steerLeftDown = true
    }, () => {
      this.steerLeftDown = false
    })

    this.createHoldButton(margin + 132, height - 92, 48, '▶', () => {
      this.steerRightDown = true
    }, () => {
      this.steerRightDown = false
    })

    this.createHoldButton(margin + 76, height - 190, 42, 'DRIFT', () => {
      this.powerslideDown = true
    }, () => {
      this.powerslideDown = false
    }, 13)

    this.createHoldButton(width - margin - 10, height - 96, 54, 'GO', () => {
      this.accelerateDown = true
    }, () => {
      this.accelerateDown = false
    }, 17)

    this.createHoldButton(width - margin - 124, height - 84, 46, 'BRAKE', () => {
      this.brakeDown = true
    }, () => {
      this.brakeDown = false
    }, 12)

    this.createTapButton(width - margin - 16, height - 205, 42, 'ITEM', () => {
      this.itemPressed = true
    })
  }

  private createHoldButton(
    x: number,
    y: number,
    radius: number,
    label: string,
    onDown: () => void,
    onUp: () => void,
    fontSize = 22,
  ) {
    const button = this.createButton(x, y, radius, label, fontSize)

    button.background.on('pointerdown', () => {
      button.container.setScale(0.93)
      button.background.setAlpha(0.82)
      onDown()
    })

    const release = () => {
      button.container.setScale(1)
      button.background.setAlpha(0.52)
      onUp()
    }

    button.background.on('pointerup', release)
    button.background.on('pointerout', release)
    button.background.on('pointerupoutside', release)
  }

  private createTapButton(
    x: number,
    y: number,
    radius: number,
    label: string,
    onTap: () => void,
  ) {
    const button = this.createButton(x, y, radius, label, 13)

    button.background.on('pointerdown', () => {
      button.container.setScale(0.93)
      button.background.setAlpha(0.82)
      onTap()
    })

    const release = () => {
      button.container.setScale(1)
      button.background.setAlpha(0.52)
    }

    button.background.on('pointerup', release)
    button.background.on('pointerout', release)
    button.background.on('pointerupoutside', release)
  }

  private createButton(
    x: number,
    y: number,
    radius: number,
    label: string,
    fontSize: number,
  ) {
    const background = this.scene.add
      .circle(0, 0, radius, 0x050505, 0.52)
      .setStrokeStyle(3, 0xffffff, 0.72)
      .setInteractive({ useHandCursor: false })

    const text = this.scene.add
      .text(0, 0, label, {
        fontFamily: 'monospace',
        fontSize: `${fontSize}px`,
        fontStyle: 'bold',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 3,
      })
      .setOrigin(0.5)

    const container = this.scene.add
      .container(x, y, [background, text])
      .setDepth(80)
      .setScrollFactor(0)

    const button = { container, background }
    this.buttons.push(button)
    return button
  }
}
