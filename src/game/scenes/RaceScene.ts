import Phaser from 'phaser'
import {
  Mode7Renderer,
  type Mode7CameraState,
} from '../rendering/Mode7Renderer'

const GAME_WIDTH = 800
const GAME_HEIGHT = 600
const HORIZON_Y = 250
const GROUND_HEIGHT = GAME_HEIGHT - HORIZON_Y
const TRACK_TEXTURE_KEY = 'prototype-track'

export class RaceScene extends Phaser.Scene {
  private mode7Renderer?: Mode7Renderer
  private cameraState: Mode7CameraState = {
    x: 0,
    y: 0,
    angle: Math.PI / 2,
  }

  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys
  private wasd?: {
    up: Phaser.Input.Keyboard.Key
    down: Phaser.Input.Keyboard.Key
    left: Phaser.Input.Keyboard.Key
    right: Phaser.Input.Keyboard.Key
  }

  private moveSpeed = 0
  private readonly turnSpeed = 1.8

  constructor() {
    super('RaceScene')
  }

  preload() {
    this.load.image(
      TRACK_TEXTURE_KEY,
      '/assets/tracks/Mario Circuit 1.png',
    )
  }

  create() {
    this.cameras.main.setBackgroundColor('#67b7e8')

    this.add.rectangle(
      GAME_WIDTH / 2,
      HORIZON_Y / 2,
      GAME_WIDTH,
      HORIZON_Y,
      0x67b7e8,
    )

    this.add.rectangle(
      GAME_WIDTH / 2,
      HORIZON_Y - 16,
      GAME_WIDTH,
      32,
      0x4e8d47,
    )

    this.mode7Renderer = new Mode7Renderer(
      this,
      TRACK_TEXTURE_KEY,
      GAME_WIDTH,
      GROUND_HEIGHT,
      0,
      HORIZON_Y,
    )

    this.cameraState.x = this.mode7Renderer.sourceWidth * 0.5
    this.cameraState.y = this.mode7Renderer.sourceHeight * 0.78

    this.moveSpeed =
      Math.min(
        this.mode7Renderer.sourceWidth,
        this.mode7Renderer.sourceHeight,
      ) * 0.32

    const keyboard = this.input.keyboard

    if (keyboard) {
      this.cursors = keyboard.createCursorKeys()
      this.wasd = keyboard.addKeys({
        up: Phaser.Input.Keyboard.KeyCodes.W,
        down: Phaser.Input.Keyboard.KeyCodes.S,
        left: Phaser.Input.Keyboard.KeyCodes.A,
        right: Phaser.Input.Keyboard.KeyCodes.D,
      }) as {
        up: Phaser.Input.Keyboard.Key
        down: Phaser.Input.Keyboard.Key
        left: Phaser.Input.Keyboard.Key
        right: Phaser.Input.Keyboard.Key
      }
    }

    this.add
      .text(20, 18, 'RETRO KART // MODE 7 TEST', {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 4,
      })
      .setDepth(10)

    this.add
      .text(20, 48, 'WASD / ARROWS  DRIVE + TURN', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 3,
      })
      .setDepth(10)

    this.add
      .image(GAME_WIDTH - 18, 18, TRACK_TEXTURE_KEY)
      .setOrigin(1, 0)
      .setDisplaySize(150, 150)
      .setAlpha(0.9)
      .setDepth(10)

    this.mode7Renderer.render(this.cameraState)
  }

  update(_time: number, delta: number) {
    if (!this.mode7Renderer || !this.cursors || !this.wasd) {
      return
    }

    const deltaSeconds = delta / 1000
    const turnLeft = this.cursors.left.isDown || this.wasd.left.isDown
    const turnRight = this.cursors.right.isDown || this.wasd.right.isDown
    const driveForward = this.cursors.up.isDown || this.wasd.up.isDown
    const driveBackward = this.cursors.down.isDown || this.wasd.down.isDown

    if (turnLeft) {
      this.cameraState.angle -= this.turnSpeed * deltaSeconds
    }

    if (turnRight) {
      this.cameraState.angle += this.turnSpeed * deltaSeconds
    }

    let direction = 0

    if (driveForward) {
      direction += 1
    }

    if (driveBackward) {
      direction -= 1
    }

    if (direction !== 0) {
      const distance = this.moveSpeed * direction * deltaSeconds
      this.cameraState.x += Math.sin(this.cameraState.angle) * distance
      this.cameraState.y -= Math.cos(this.cameraState.angle) * distance
    }

    this.mode7Renderer.render(this.cameraState)
  }
}
