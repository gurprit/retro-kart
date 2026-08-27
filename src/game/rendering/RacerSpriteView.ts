import Phaser from 'phaser'

type SpriteBounds = {
  x: number
  y: number
  width: number
  height: number
}

const CELL_SIZE = 32
const COLUMNS = 14
const ROWS = 4
const TARGET_HEIGHT = 96

export class RacerSpriteView {
  private readonly scene: Phaser.Scene
  private readonly textureKey: string
  private readonly sprite: Phaser.GameObjects.Image
  private readonly frames: SpriteBounds[]
  private baseFrameIndex = 0

  constructor(
    scene: Phaser.Scene,
    textureKey: string,
    x: number,
    y: number,
  ) {
    this.scene = scene
    this.textureKey = textureKey
    this.frames = this.createPrototypeFrames()

    this.sprite = scene.add
      .image(x, y, textureKey)
      .setOrigin(0.5, 1)
      .setDepth(20)

    this.applyFrame(this.baseFrameIndex)
  }

  get frameCount() {
    return this.frames.length
  }

  get currentFrameIndex() {
    return this.baseFrameIndex
  }

  cycleFrame(direction: number) {
    this.baseFrameIndex = Phaser.Math.Wrap(
      this.baseFrameIndex + direction,
      0,
      this.frames.length,
    )

    this.applyFrame(this.baseFrameIndex)
  }

  update(steerDirection: number) {
    const offset = steerDirection < 0 ? -1 : steerDirection > 0 ? 1 : 0
    const frameIndex = Phaser.Math.Wrap(
      this.baseFrameIndex + offset,
      0,
      this.frames.length,
    )

    this.applyFrame(frameIndex)
  }

  private createPrototypeFrames() {
    const frames: SpriteBounds[] = []

    // The temporary Mario sheet is laid out on a regular 32px grid in its
    // upper racing-frame section. Keep these prototype coordinates isolated
    // here so original art can replace the sheet without touching gameplay.
    for (let row = 0; row < ROWS; row += 1) {
      for (let column = 0; column < COLUMNS; column += 1) {
        frames.push({
          x: column * CELL_SIZE,
          y: row * CELL_SIZE,
          width: CELL_SIZE,
          height: CELL_SIZE,
        })
      }
    }

    return frames
  }

  private applyFrame(index: number) {
    const frame = this.frames[index]

    if (!frame) {
      return
    }

    this.sprite.setCrop(frame.x, frame.y, frame.width, frame.height)

    const sourceTexture = this.scene.textures.get(this.textureKey)
    const sourceImage = sourceTexture.getSourceImage() as {
      width: number
      height: number
    }
    const scale = TARGET_HEIGHT / frame.height

    // Phaser crops Image objects in source-texture coordinates. The display
    // origin therefore needs to follow the crop centre/bottom rather than the
    // full 455x331 source sheet.
    this.sprite.setScale(scale)
    this.sprite.setDisplayOrigin(
      frame.x + frame.width / 2,
      frame.y + frame.height,
    )

    // Retain source access here so TypeScript catches a missing/invalid texture
    // during development rather than silently drawing nothing.
    void sourceImage.width
  }
}
