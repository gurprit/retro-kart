import Phaser from 'phaser'

export type Mode7CameraState = {
  x: number
  y: number
  angle: number
}

export type Mode7ProjectedPoint = {
  x: number
  y: number
  screenY: number
  distance: number
  scale: number
}

const KART_CONTACT_OFFSET_FROM_BOTTOM = 42

export class Mode7Renderer {
  readonly sourceWidth: number
  readonly sourceHeight: number
  readonly groundContactDistance: number

  private readonly sourcePixels: Uint8ClampedArray
  private readonly outputTexture: Phaser.Textures.CanvasTexture
  private readonly outputContext: CanvasRenderingContext2D
  private readonly outputImageData: ImageData
  private readonly width: number
  private readonly height: number
  private readonly originX: number
  private readonly originY: number
  private readonly nearDistance: number
  private readonly farDistance: number
  private readonly halfFovTangent: number

  constructor(
    scene: Phaser.Scene,
    sourceTextureKey: string,
    width: number,
    height: number,
    x: number,
    y: number,
  ) {
    this.width = width
    this.height = height
    this.originX = x
    this.originY = y

    const sourceTexture = scene.textures.get(sourceTextureKey)
    const sourceImage = sourceTexture.getSourceImage() as CanvasImageSource & {
      width: number
      height: number
    }

    this.sourceWidth = sourceImage.width
    this.sourceHeight = sourceImage.height

    const sourceCanvas = document.createElement('canvas')
    sourceCanvas.width = this.sourceWidth
    sourceCanvas.height = this.sourceHeight

    const sourceContext = sourceCanvas.getContext('2d', {
      willReadFrequently: true,
    })

    if (!sourceContext) {
      throw new Error('Could not create source canvas context')
    }

    sourceContext.imageSmoothingEnabled = false
    sourceContext.drawImage(sourceImage, 0, 0)
    this.sourcePixels = sourceContext.getImageData(
      0,
      0,
      this.sourceWidth,
      this.sourceHeight,
    ).data

    const outputTexture = scene.textures.createCanvas(
      'mode7-ground',
      width,
      height,
    )

    if (!outputTexture) {
      throw new Error('Could not create Mode 7 canvas texture')
    }

    this.outputTexture = outputTexture
    this.outputContext = outputTexture.context
    this.outputContext.imageSmoothingEnabled = false
    this.outputImageData = this.outputContext.createImageData(width, height)

    const minSourceDimension = Math.min(this.sourceWidth, this.sourceHeight)
    this.nearDistance = minSourceDimension * 0.055
    this.farDistance = minSourceDimension * 0.56

    // Mario's tyre/contact point is 42 screen pixels above the bottom edge.
    // Align the camera to the projection distance at that exact scanline rather
    // than the final ground row, so visuals and collision sample the same point.
    const contactRow = Phaser.Math.Clamp(
      this.height - KART_CONTACT_OFFSET_FROM_BOTTOM,
      0,
      this.height - 1,
    )
    this.groundContactDistance = this.distanceForRow(contactRow)

    const horizontalFovDegrees = 62
    this.halfFovTangent = Math.tan(
      Phaser.Math.DegToRad(horizontalFovDegrees / 2),
    )

    scene.add
      .image(x, y, 'mode7-ground')
      .setOrigin(0)
      .setDisplaySize(width, height)
  }

  render(camera: Mode7CameraState) {
    const outputPixels = this.outputImageData.data
    const forwardX = Math.sin(camera.angle)
    const forwardY = -Math.cos(camera.angle)
    const rightX = Math.cos(camera.angle)
    const rightY = Math.sin(camera.angle)

    for (let screenY = 0; screenY < this.height; screenY += 1) {
      const distance = this.distanceForRow(screenY)

      const halfWorldWidth = distance * this.halfFovTangent
      const rowCenterX = camera.x + forwardX * distance
      const rowCenterY = camera.y + forwardY * distance

      for (let screenX = 0; screenX < this.width; screenX += 1) {
        const lateral =
          ((screenX / Math.max(1, this.width - 1)) * 2 - 1) * halfWorldWidth
        const worldX = rowCenterX + rightX * lateral
        const worldY = rowCenterY + rightY * lateral

        const outputIndex = (screenY * this.width + screenX) * 4
        const sourceX = Math.floor(worldX)
        const sourceY = Math.floor(worldY)

        if (
          sourceX < 0 ||
          sourceY < 0 ||
          sourceX >= this.sourceWidth ||
          sourceY >= this.sourceHeight
        ) {
          outputPixels[outputIndex] = 27
          outputPixels[outputIndex + 1] = 33
          outputPixels[outputIndex + 2] = 24
          outputPixels[outputIndex + 3] = 255
          continue
        }

        const sourceIndex = (sourceY * this.sourceWidth + sourceX) * 4
        outputPixels[outputIndex] = this.sourcePixels[sourceIndex]
        outputPixels[outputIndex + 1] = this.sourcePixels[sourceIndex + 1]
        outputPixels[outputIndex + 2] = this.sourcePixels[sourceIndex + 2]
        outputPixels[outputIndex + 3] = 255
      }
    }

    this.outputContext.putImageData(this.outputImageData, 0, 0)
    this.outputTexture.refresh()
  }

  projectWorldPoint(
    worldX: number,
    worldY: number,
    camera: Mode7CameraState,
  ): Mode7ProjectedPoint | undefined {
    const forwardX = Math.sin(camera.angle)
    const forwardY = -Math.cos(camera.angle)
    const rightX = Math.cos(camera.angle)
    const rightY = Math.sin(camera.angle)
    const relativeX = worldX - camera.x
    const relativeY = worldY - camera.y
    const distance = relativeX * forwardX + relativeY * forwardY

    if (distance < this.nearDistance || distance > this.farDistance) {
      return undefined
    }

    const lateral = relativeX * rightX + relativeY * rightY
    const halfWorldWidth = distance * this.halfFovTangent

    if (Math.abs(lateral) > halfWorldWidth) {
      return undefined
    }

    const denominator = (this.nearDistance * this.farDistance) / distance
    const rowProgress =
      (denominator - this.nearDistance) /
      (this.farDistance - this.nearDistance)
    const screenY = rowProgress * Math.max(1, this.height - 1)
    const normalizedX = lateral / halfWorldWidth
    const screenX =
      ((normalizedX + 1) * 0.5) * Math.max(1, this.width - 1)

    return {
      x: this.originX + screenX,
      y: this.originY + screenY,
      screenY,
      distance,
      scale: this.groundContactDistance / distance,
    }
  }

  private distanceForRow(screenY: number) {
    const rowProgress = screenY / Math.max(1, this.height - 1)
    const denominator =
      this.nearDistance +
      (this.farDistance - this.nearDistance) * rowProgress

    return (this.nearDistance * this.farDistance) / denominator
  }
}
