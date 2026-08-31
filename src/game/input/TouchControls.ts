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

  constructor(scene: Phaser.Scene) {
    this.scene = scene
    this.enabled =
      typeof navigator !== 'undefined' &&
      (navigator.maxTouchPoints > 0 || 'ontouchstart' in window)

    if (!this.enabled) return

    // Phaser starts with a small pointer pool. Extra pointers make steering,
    // accelerating and drifting simultaneously reliable on phones/tablets.
    this.scene.input.addPointer(4)

    this.createHoldButton(82, 510, 44, '◀', () => {
      this.steerLeftDown = true
    }, () => {
      this.steerLeftDown = false
    })

    this.createHoldButton(184, 510, 44, '▶', () => {
      this.steerRightDown = true
    }, () => {
      this.steerRightDown = false
    })

    this.createHoldButton(133, 420, 38, 'DRIFT', () => {
      this.powerslideDown = true
    }, () => {
      this.powerslideDown = false
    }, 13)

    this.createHoldButton(716, 500, 50, 'GO', () => {
      this.accelerateDown = true
    }, () => {
      this.accelerateDown = false
    }, 17)

    this.createHoldButton(610, 520, 42, 'BRAKE', () => {
      this.brakeDown = true
    }, () => {
      this.brakeDown = false
    }, 12)

    this.createTapButton(696, 402, 38, 'ITEM', () => {
      this.itemPressed = true
    })
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
