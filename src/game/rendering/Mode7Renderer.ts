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

export type Mode7GroundSprite = {
  x: number
  y: number
  frameX: number
  frameY: number
  frameWidth: number
  frameHeight: number
  worldScale?: number
}

const KART_CONTACT_OFFSET_FROM_BOTTOM = 42

export class Mode7Renderer {
  readonly sourceWidth: number
  readonly sourceHeight: number
  readonly groundContactDistance: number

  private readonly scene: Phaser.Scene
  private readonly sourcePixels: Uint8ClampedArray
  private readonly groundOverlayPixels: Uint8ClampedArray
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
    this.scene = scene
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
    this.groundOverlayPixels = new Uint8ClampedArray(
      this.sourceWidth * this.sourceHeight * 4,
    )

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

  setGroundSprites(textureKey: string, sprites: Mode7GroundSprite[]) {
    this.groundOverlayPixels.fill(0)

    if (sprites.length === 0) {
      return
    }

    const texture = this.scene.textures.get(textureKey)
    const image = texture.getSourceImage() as CanvasImageSource & {
      width: number
      height: number
    }
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d', { willReadFrequently: true })

    if (!context) {
      return
    }

    context.imageSmoothingEnabled = false
    context.drawImage(image, 0, 0)
    const pixels = context.getImageData(0, 0, image.width, image.height).data

    for (const sprite of sprites) {
      const scale = Math.max(1, Math.round(sprite.worldScale ?? 1))
      const worldWidth = sprite.frameWidth * scale
      const worldHeight = sprite.frameHeight * scale
      const startX = Math.round(sprite.x - worldWidth / 2)
      const startY = Math.round(sprite.y - worldHeight / 2)

      for (let dy = 0; dy < worldHeight; dy += 1) {
        const targetY = startY + dy

        if (targetY < 0 || targetY >= this.sourceHeight) {
          continue
        }

        const sourceY = sprite.frameY + Math.floor(dy / scale)

        for (let dx = 0; dx < worldWidth; dx += 1) {
          const targetX = startX + dx

          if (targetX < 0 || targetX >= this.sourceWidth) {
            continue
          }

          const sourceX = sprite.frameX + Math.floor(dx / scale)
          const sourceIndex = (sourceY * image.width + sourceX) * 4
          const alpha = pixels[sourceIndex + 3]

          if (alpha === 0) {
            continue
          }

          const targetIndex = (targetY * this.sourceWidth + targetX) * 4
          this.groundOverlayPixels[targetIndex] = pixels[sourceIndex]
          this.groundOverlayPixels[targetIndex + 1] = pixels[sourceIndex + 1]
          this.groundOverlayPixels[targetIndex + 2] = pixels[sourceIndex + 2]
          this.groundOverlayPixels[targetIndex + 3] = alpha
        }
      }
    }
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
        const overlayAlpha = this.groundOverlayPixels[sourceIndex + 3]

        if (overlayAlpha > 0) {
          const alpha = overlayAlpha / 255
          const inverseAlpha = 1 - alpha
          outputPixels[outputIndex] =
            this.groundOverlayPixels[sourceIndex] * alpha +
            this.sourcePixels[sourceIndex] * inverseAlpha
          outputPixels[outputIndex + 1] =
            this.groundOverlayPixels[sourceIndex + 1] * alpha +
            this.sourcePixels[sourceIndex + 1] * inverseAlpha
          outputPixels[outputIndex + 2] =
            this.groundOverlayPixels[sourceIndex + 2] * alpha +
            this.sourcePixels[sourceIndex + 2] * inverseAlpha
          outputPixels[outputIndex + 3] = 255
          continue
        }

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
