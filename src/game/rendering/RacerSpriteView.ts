import Phaser from 'phaser'

const FRAME_WIDTH = 32
const FRAME_HEIGHT = 32
const FRAME_COUNT = 12
const FRAME_GAP = 1
const TARGET_HEIGHT = 82

// Cleaned Mario sheet is a single directional strip:
// rear -> rear quarter -> side -> front quarter -> front.
// The first six frames are enough for driving; the whole strip is used for spins.
const DRIVING_FRAMES = {
  neutral: 0,
  slightTurn: 1,
  mediumTurn: 2,
  hardTurn: 3,
  powerslide: 4,
} as const

const TURN_FRAME_THRESHOLDS = {
  medium: 0.4,
  hard: 0.72,
} as const

const OFF_ROAD_BOUNCE_HEIGHT = 4
const OFF_ROAD_BOUNCE_BASE_RATE = 18
const OFF_ROAD_BOUNCE_SPEED_RATE = 18

const SPIN_FRAME_TIME = 0.05
const DEFAULT_SPIN_LOOPS = 2

export class RacerSpriteView {
  private readonly scene: Phaser.Scene
  private readonly sprite: Phaser.GameObjects.Image
  private readonly baseX: number
  private readonly baseY: number
  private readonly frames: string[] = []

  private bouncePhase = 0
  private spinTimer = 0
  private spinFrameTimer = 0
  private spinFrameIndex = 0

  constructor(
    scene: Phaser.Scene,
    textureKey: string,
    x: number,
    y: number,
  ) {
    this.scene = scene
    this.baseX = x
    this.baseY = y
    this.createStripFrames(textureKey)

    this.sprite = scene.add
      .image(x, y, this.frames[DRIVING_FRAMES.neutral] ?? textureKey)
      .setOrigin(0.5, 1)
      .setDepth(20)
      .setDisplaySize(TARGET_HEIGHT, TARGET_HEIGHT)
  }

  update(
    steerDirection: number,
    speedRatio: number,
    isOffRoad: boolean,
    isPowersliding: boolean,
    deltaSeconds: number,
  ) {
    const clampedSteer = Phaser.Math.Clamp(steerDirection, -1, 1)
    const clampedSpeed = Phaser.Math.Clamp(Math.abs(speedRatio), 0, 1)

    if (this.spinTimer > 0 && this.frames.length > 1) {
      this.updateSpin(deltaSeconds)
    } else {
      this.updateDrivingFrame(clampedSteer, clampedSpeed, isPowersliding)
    }

    let bounceOffset = 0

    if (isOffRoad && clampedSpeed > 0.03 && this.spinTimer <= 0) {
      const bounceRate =
        OFF_ROAD_BOUNCE_BASE_RATE + OFF_ROAD_BOUNCE_SPEED_RATE * clampedSpeed

      this.bouncePhase += bounceRate * deltaSeconds
      bounceOffset =
        Math.abs(Math.sin(this.bouncePhase)) *
        OFF_ROAD_BOUNCE_HEIGHT *
        (0.45 + clampedSpeed * 0.55)
    } else {
      this.bouncePhase = 0
    }

    this.sprite
      .setX(this.baseX)
      .setY(this.baseY - bounceOffset)
      .setRotation(0)
      .setDisplaySize(TARGET_HEIGHT, TARGET_HEIGHT)
  }

  /** Reusable for barrier hits and, later, weapon/item impacts. */
  triggerSpin(loops = DEFAULT_SPIN_LOOPS) {
    if (this.frames.length < 2) {
      return
    }

    this.spinFrameIndex = 0
    this.spinFrameTimer = 0
    this.spinTimer = this.frames.length * SPIN_FRAME_TIME * Math.max(1, loops)
  }

  get isSpinning() {
    return this.spinTimer > 0
  }

  private updateDrivingFrame(
    steerDirection: number,
    speedRatio: number,
    isPowersliding: boolean,
  ) {
    if (this.frames.length === 0) {
      return
    }

    let frameIndex: number = DRIVING_FRAMES.neutral

    if (steerDirection !== 0) {
      if (isPowersliding) {
        frameIndex = DRIVING_FRAMES.powerslide
      } else if (speedRatio >= TURN_FRAME_THRESHOLDS.hard) {
        frameIndex = DRIVING_FRAMES.hardTurn
      } else if (speedRatio >= TURN_FRAME_THRESHOLDS.medium) {
        frameIndex = DRIVING_FRAMES.mediumTurn
      } else {
        frameIndex = DRIVING_FRAMES.slightTurn
      }
    }

    const textureKey = this.frames[Math.min(frameIndex, this.frames.length - 1)]

    this.sprite
      .setVisible(true)
      .setTexture(textureKey)
      // The strip contains one turn direction; mirror it for the opposite turn.
      .setFlipX(steerDirection < 0)
  }

  private updateSpin(deltaSeconds: number) {
    this.spinTimer = Math.max(0, this.spinTimer - deltaSeconds)
    this.spinFrameTimer -= deltaSeconds

    while (this.spinFrameTimer <= 0 && this.spinTimer > 0) {
      this.spinFrameTimer += SPIN_FRAME_TIME
      this.spinFrameIndex = (this.spinFrameIndex + 1) % this.frames.length
    }

    const textureKey = this.frames[this.spinFrameIndex]

    if (textureKey) {
      this.sprite
        .setVisible(true)
        .setTexture(textureKey)
        .setFlipX(false)
    }
  }

  private createStripFrames(textureKey: string) {
    const sourceTexture = this.scene.textures.get(textureKey)
    const sourceImage = sourceTexture.getSourceImage() as CanvasImageSource & {
      width: number
      height: number
    }

    // The uploaded cleaned sheet is 395x32: twelve 32px poses separated by 1px.
    // Explicit slicing keeps every pose anchored to the same 32x32 canvas and
    // removes the wobble caused by auto-cropping each sprite to a different box.
    const availableFrames = Math.min(
      FRAME_COUNT,
      Math.floor((sourceImage.width + FRAME_GAP) / (FRAME_WIDTH + FRAME_GAP)),
    )

    const sourceCanvas = document.createElement('canvas')
    sourceCanvas.width = sourceImage.width
    sourceCanvas.height = sourceImage.height

    const sourceContext = sourceCanvas.getContext('2d')

    if (!sourceContext) {
      return
    }

    sourceContext.imageSmoothingEnabled = false
    sourceContext.drawImage(sourceImage, 0, 0)

    for (let index = 0; index < availableFrames; index += 1) {
      const x = index * (FRAME_WIDTH + FRAME_GAP)
      const textureKeyForFrame = `prototype-racer-strip-${index}`

      if (!this.scene.textures.exists(textureKeyForFrame)) {
        const texture = this.scene.textures.createCanvas(
          textureKeyForFrame,
          FRAME_WIDTH,
          FRAME_HEIGHT,
        )

        if (!texture) {
          continue
        }

        texture.context.imageSmoothingEnabled = false
        texture.context.clearRect(0, 0, FRAME_WIDTH, FRAME_HEIGHT)
        texture.context.drawImage(
          sourceCanvas,
          x,
          0,
          FRAME_WIDTH,
          FRAME_HEIGHT,
          0,
          0,
          FRAME_WIDTH,
          FRAME_HEIGHT,
        )
        texture.refresh()
      }

      this.frames.push(textureKeyForFrame)
    }
  }
}
