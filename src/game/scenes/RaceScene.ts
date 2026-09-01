import Phaser from 'phaser'
import { ComputerRacerManager } from '../ai/ComputerRacerManager'
import { RACERS, type RacerProfile } from '../config/RacerProfiles'
import { PlayerKart } from '../entities/PlayerKart'
import { SkidEffects } from '../effects/SkidEffects'
import { TouchControls } from '../input/TouchControls'
import { ItemSystem } from '../items/ItemSystem'
import { MultiplayerManager } from '../network/MultiplayerManager'
import {
  Mode7Renderer,
  type Mode7CameraState,
} from '../rendering/Mode7Renderer'
import { ParallaxBackground } from '../rendering/ParallaxBackground'
import { RacerSpriteView } from '../rendering/RacerSpriteView'
import {
  TrackSurfaceMap,
  type TrackSurface,
} from '../tracks/TrackSurfaceMap'

const isTouchDevice =
  typeof navigator !== 'undefined' &&
  (navigator.maxTouchPoints > 0 || 'ontouchstart' in window)
const isLandscapeTouch =
  isTouchDevice && window.innerWidth > window.innerHeight
const isPortraitTouch =
  isTouchDevice && window.innerHeight >= window.innerWidth
const GAME_WIDTH = isLandscapeTouch
  ? Phaser.Math.Clamp(
      Math.round(600 * (window.innerWidth / window.innerHeight)),
      960,
      1360,
    )
  : 800
const GAME_HEIGHT = isPortraitTouch ? 700 : 600
const HORIZON_Y = isPortraitTouch ? 292 : 250
const GROUND_HEIGHT = GAME_HEIGHT - HORIZON_Y
const TRACK_TEXTURE_KEY = 'prototype-track'
const COLLISION_TEXTURE_KEY = 'prototype-collision'
const OUTSIDE_GRASS_TEXTURE_KEY = 'outside-grass'
const ITEM_ROULETTE_TEXTURE_KEY = 'item-roulette'
const PARTICLE_SHEET_URL = '/assets/effects/Particles.png'
const FAR_BACKGROUND_TEXTURE_KEY = 'prototype-far-background'
const NEAR_BACKGROUND_TEXTURE_KEY = 'prototype-near-background'
const HARD_COLLISION_SPIN_SPEED = 0.48

const ITEM_ASSETS = [
  ['item-bomb', '/assets/items/bomb_shroom_item.jpg'],
  ['item-banana', '/assets/items/bsnana_skin_item.jpg'],
  ['item-coin', '/assets/items/coin_item.jpg'],
  ['item-egg', '/assets/items/egg_item.jpg'],
  ['item-fireball', '/assets/items/fireball_item.jpg'],
  ['item-green-shell', '/assets/items/green_shell_item.jpg'],
  ['item-red-shell', '/assets/items/red_shell_item.jpg'],
] as const

const START_GRID = {
  xRatio: 0.91,
  yRatio: 0.66,
  heading: 0,
} as const

const SURFACE_HANDLING = {
  road: { speedMultiplier: 1, gripMultiplier: 1, dragMultiplier: 1 },
  offRoad: { speedMultiplier: 0.58, gripMultiplier: 0.7, dragMultiplier: 2.2 },
  barrier: { speedMultiplier: 0.4, gripMultiplier: 0.6, dragMultiplier: 3 },
  void: { speedMultiplier: 0.42, gripMultiplier: 0.55, dragMultiplier: 2.8 },
} as const

export class RaceScene extends Phaser.Scene {
  private mode7Renderer?: Mode7Renderer
  private parallaxBackground?: ParallaxBackground
  private playerKart?: PlayerKart
  private computerRacers?: ComputerRacerManager
  private multiplayer?: MultiplayerManager
  private racerSprite?: RacerSpriteView
  private skidEffects?: SkidEffects
  private itemSystem?: ItemSystem
  private touchControls?: TouchControls
  private trackSurfaceMap?: TrackSurfaceMap
  private speedText?: Phaser.GameObjects.Text
  private surfaceText?: Phaser.GameObjects.Text
  private racerText?: Phaser.GameObjects.Text
  private coinText?: Phaser.GameObjects.Text
  private networkText?: Phaser.GameObjects.Text
  private currentSurface: TrackSurface = 'road'
  private selectedRacer: RacerProfile = RACERS[0]

  private cameraState: Mode7CameraState = {
    x: 0,
    y: 0,
    angle: START_GRID.heading,
  }

  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys
  private slideKey?: Phaser.Input.Keyboard.Key
  private useItemKey?: Phaser.Input.Keyboard.Key
  private wasd?: {
    up: Phaser.Input.Keyboard.Key
    down: Phaser.Input.Keyboard.Key
    left: Phaser.Input.Keyboard.Key
    right: Phaser.Input.Keyboard.Key
  }

  constructor() {
    super('RaceScene')
  }

  preload() {
    this.load.image(TRACK_TEXTURE_KEY, '/assets/tracks/Mario Circuit 1.png')
    this.load.image(COLLISION_TEXTURE_KEY, '/assets/tracks/Mario Circuit 1 - Collision.png')
    this.load.image(OUTSIDE_GRASS_TEXTURE_KEY, '/assets/tilesets/Mario Circuit-grass.png')
    this.load.image(FAR_BACKGROUND_TEXTURE_KEY, '/assets/backgrounds/Mario Circuit 1 - Far Background.png')
    this.load.image(NEAR_BACKGROUND_TEXTURE_KEY, '/assets/backgrounds/Mario Circuit 1 - Near Background.png')

    for (const racer of RACERS) {
      this.load.image(racer.key, `/assets/characters/${racer.file}`)
    }

    this.load.image(ITEM_ROULETTE_TEXTURE_KEY, '/assets/items/Item Roulette.png')
    for (const [key, url] of ITEM_ASSETS) this.load.image(key, url)
  }

  create() {
    this.cameras.main.setBackgroundColor('#67b7e8')
    this.add.rectangle(GAME_WIDTH / 2, HORIZON_Y / 2, GAME_WIDTH, HORIZON_Y, 0x67b7e8)

    this.parallaxBackground = new ParallaxBackground(
      this,
      FAR_BACKGROUND_TEXTURE_KEY,
      NEAR_BACKGROUND_TEXTURE_KEY,
      GAME_WIDTH,
      HORIZON_Y,
    )

    this.add
      .rectangle(GAME_WIDTH / 2, HORIZON_Y - 8, GAME_WIDTH, 16, 0x4e8d47)
      .setDepth(4)

    this.mode7Renderer = new Mode7Renderer(
      this,
      TRACK_TEXTURE_KEY,
      GAME_WIDTH,
      GROUND_HEIGHT,
      0,
      HORIZON_Y,
      OUTSIDE_GRASS_TEXTURE_KEY,
    )

    this.trackSurfaceMap = new TrackSurfaceMap(this, TRACK_TEXTURE_KEY, COLLISION_TEXTURE_KEY)

    const worldScale = Math.min(
      this.mode7Renderer.sourceWidth,
      this.mode7Renderer.sourceHeight,
    )

    this.selectedRacer = RACERS[Math.floor(Math.random() * RACERS.length)]
    const startX = this.mode7Renderer.sourceWidth * START_GRID.xRatio
    const startY = this.mode7Renderer.sourceHeight * START_GRID.yRatio

    this.playerKart = new PlayerKart(
      startX,
      startY,
      START_GRID.heading,
      worldScale,
      this.selectedRacer,
    )

    this.computerRacers = new ComputerRacerManager(
      this,
      this.mode7Renderer,
      this.trackSurfaceMap,
      worldScale,
      RACERS,
      startX,
      startY - worldScale * 0.1,
      START_GRID.heading,
    )

    this.multiplayer = new MultiplayerManager(this, this.mode7Renderer, RACERS)
    void this.multiplayer.connect(this.selectedRacer.key, {
      x: this.playerKart.x,
      y: this.playerKart.y,
      angle: this.playerKart.angle,
      speedRatio: this.playerKart.speedRatio,
    })

    this.currentSurface = this.trackSurfaceMap.sample(this.playerKart.x, this.playerKart.y)
    this.syncCameraToKart()
    this.createKeyboardControls()
    this.createHud()

    this.racerSprite = new RacerSpriteView(
      this,
      this.selectedRacer.key,
      GAME_WIDTH / 2,
      GAME_HEIGHT - 42,
    )

    this.skidEffects = new SkidEffects(
      this,
      PARTICLE_SHEET_URL,
      GAME_WIDTH / 2,
      GAME_HEIGHT - 42,
    )

    this.itemSystem = new ItemSystem(
      this,
      this.mode7Renderer,
      worldScale,
      ITEM_ROULETTE_TEXTURE_KEY,
      {
        ownerId: 'player',
        getRacers: () => {
          const racers = this.computerRacers?.itemStates ?? []
          if (!this.playerKart) return racers
          return [
            {
              id: 'player',
              x: this.playerKart.x,
              y: this.playerKart.y,
              angle: this.playerKart.angle,
              speedRatio: this.playerKart.speedRatio,
              invulnerable: this.playerKart.isInvulnerable,
            },
            ...racers,
          ]
        },
        spinOutRacer: (racerId, blastX, blastY, pushStrength, controlLockSeconds) => {
          if (racerId === 'player' && this.playerKart) {
            this.playerKart.applySpinOut(
              blastX,
              blastY,
              pushStrength,
              controlLockSeconds,
            )
            this.racerSprite?.triggerSpin(3)
            return
          }
          this.computerRacers?.spinOut(
            racerId,
            blastX,
            blastY,
            pushStrength,
            controlLockSeconds,
          )
        },
        boostRacer: (racerId, multiplier, durationSeconds) => {
          if (racerId === 'player') {
            this.playerKart?.applyBoost(multiplier, durationSeconds)
            return
          }
          this.computerRacers?.boost(racerId, multiplier, durationSeconds)
        },
        grantStar: (racerId, durationSeconds) => {
          if (racerId === 'player') {
            this.playerKart?.grantStar(durationSeconds)
            return
          }
          this.computerRacers?.grantStar(racerId, durationSeconds)
        },
        addCoin: (racerId, amount) => {
          if (racerId === 'player') {
            this.playerKart?.addCoins(amount)
            return
          }
          this.computerRacers?.addCoin(racerId, amount)
        },
        isBarrierAt: (x, y) => this.trackSurfaceMap?.sample(x, y) === 'barrier',
      },
    )

    this.touchControls = new TouchControls(this)

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.itemSystem?.destroy()
      this.itemSystem = undefined
      this.multiplayer?.destroy()
      this.multiplayer = undefined
      this.computerRacers?.destroy()
      this.computerRacers = undefined
      this.touchControls?.destroy()
      this.touchControls = undefined
    })

    this.parallaxBackground.update(this.cameraState.angle)
    this.mode7Renderer.render(this.cameraState)
    this.computerRacers.update(0, this.cameraState)
    this.multiplayer.update(
      0,
      {
        x: this.playerKart.x,
        y: this.playerKart.y,
        angle: this.playerKart.angle,
        speedRatio: this.playerKart.speedRatio,
      },
      this.cameraState,
    )
    this.itemSystem.update(0, this.cameraState)
    this.updateHud()
  }

  update(_time: number, delta: number) {
    if (
      !this.mode7Renderer ||
      !this.playerKart ||
      !this.trackSurfaceMap ||
      !this.cursors ||
      !this.wasd
    ) return

    const deltaSeconds = Math.min(delta / 1000, 0.05)
    const touchState = this.touchControls?.state
    const steerLeft =
      this.cursors.left.isDown ||
      this.wasd.left.isDown ||
      (touchState?.steerLeft ?? false)
    const steerRight =
      this.cursors.right.isDown ||
      this.wasd.right.isDown ||
      (touchState?.steerRight ?? false)
    const powerslide =
      (this.slideKey?.isDown ?? false) ||
      (touchState?.powerslide ?? false)

    this.currentSurface = this.trackSurfaceMap.sample(this.playerKart.x, this.playerKart.y)
    const previousX = this.playerKart.x
    const previousY = this.playerKart.y

    this.playerKart.update(
      {
        accelerate:
          this.cursors.up.isDown ||
          this.wasd.up.isDown ||
          (touchState?.accelerate ?? false),
        brake:
          this.cursors.down.isDown ||
          this.wasd.down.isDown ||
          (touchState?.brake ?? false),
        steerLeft,
        steerRight,
        powerslide,
      },
      deltaSeconds,
      SURFACE_HANDLING[this.currentSurface],
    )

    const nextX = this.playerKart.x
    const nextY = this.playerKart.y
    const impactSpeedRatio = Math.abs(this.playerKart.speedRatio)
    const hitBarrier = this.trackSurfaceMap.collidesAlongSegment(
      previousX,
      previousY,
      nextX,
      nextY,
    )

    if (hitBarrier) {
      this.playerKart.applyCollision(previousX, previousY)
      if (
        impactSpeedRatio >= HARD_COLLISION_SPIN_SPEED &&
        !this.racerSprite?.isSpinning
      ) this.racerSprite?.triggerSpin()
      this.currentSurface = this.trackSurfaceMap.sample(previousX, previousY)
    } else {
      this.currentSurface = this.trackSurfaceMap.sample(nextX, nextY)
    }

    this.syncCameraToKart()
    this.parallaxBackground?.update(this.cameraState.angle)
    this.computerRacers?.update(deltaSeconds, this.cameraState)
    this.multiplayer?.update(
      deltaSeconds,
      {
        x: this.playerKart.x,
        y: this.playerKart.y,
        angle: this.playerKart.angle,
        speedRatio: this.playerKart.speedRatio,
      },
      this.cameraState,
    )

    const keyboardItemPressed =
      this.useItemKey && Phaser.Input.Keyboard.JustDown(this.useItemKey)
    const touchItemPressed = this.touchControls?.consumeItemPress() ?? false
    if (keyboardItemPressed || touchItemPressed) this.itemSystem?.useHeldItem()

    this.itemSystem?.update(deltaSeconds, this.cameraState)

    let steerDirection = 0
    if (steerLeft) steerDirection = -1
    else if (steerRight) steerDirection = 1

    const isPowersliding = this.playerKart.state === 'powerslide'
    this.racerSprite?.update(
      steerDirection,
      this.playerKart.speedRatio,
      this.currentSurface === 'offRoad',
      isPowersliding,
      deltaSeconds,
    )
    this.skidEffects?.update(isPowersliding, this.playerKart.speedRatio, deltaSeconds)

    this.updateHud()
    this.mode7Renderer.render(this.cameraState)
  }

  private createKeyboardControls() {
    const keyboard = this.input.keyboard
    if (!keyboard) return

    this.cursors = keyboard.createCursorKeys()
    this.slideKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT)
    this.useItemKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE)
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

  private createHud() {
    this.add.text(20, 18, 'RETRO KART // MULTIPLAYER TEST', {
      fontFamily: 'monospace', fontSize: '20px', color: '#ffffff',
      stroke: '#000000', strokeThickness: 4,
    }).setDepth(30)

    this.add.text(20, 48, 'UP/W ACCELERATE   DOWN/S BRAKE + REVERSE', {
      fontFamily: 'monospace', fontSize: '14px', color: '#ffffff',
      stroke: '#000000', strokeThickness: 3,
    }).setDepth(30)

    this.add.text(
      20,
      68,
      'LEFT/RIGHT OR A/D STEER   SHIFT POWERSLIDE   SPACE USE ITEM',
      {
        fontFamily: 'monospace', fontSize: '14px', color: '#ffffff',
        stroke: '#000000', strokeThickness: 3,
      },
    ).setDepth(30)

    this.racerText = this.add.text(20, 92, '', {
      fontFamily: 'monospace', fontSize: '14px', color: '#ffffff',
      stroke: '#000000', strokeThickness: 3,
    }).setDepth(30)

    this.coinText = this.add.text(20, 114, 'COINS 00', {
      fontFamily: 'monospace', fontSize: '13px', color: '#ffe66d',
      stroke: '#000000', strokeThickness: 3,
    }).setDepth(30)

    this.networkText = this.add.text(20, 134, 'HUMANS 1', {
      fontFamily: 'monospace', fontSize: '13px', color: '#9fffb0',
      stroke: '#000000', strokeThickness: 3,
    }).setDepth(30)

    this.speedText = this.add.text(20, GAME_HEIGHT - 44, 'SPEED 000', {
      fontFamily: 'monospace', fontSize: '18px', color: '#ffffff',
      stroke: '#000000', strokeThickness: 4,
    }).setDepth(30)

    this.surfaceText = this.add.text(GAME_WIDTH - 20, GAME_HEIGHT - 44, 'ROAD', {
      fontFamily: 'monospace', fontSize: '16px', color: '#ffffff',
      stroke: '#000000', strokeThickness: 4,
    }).setOrigin(1, 0).setDepth(30)

    this.add.image(GAME_WIDTH - 18, 18, TRACK_TEXTURE_KEY)
      .setOrigin(1, 0)
      .setDisplaySize(150, 150)
      .setAlpha(0.9)
      .setDepth(30)
  }

  private updateHud() {
    if (!this.speedText || !this.surfaceText || !this.playerKart) return

    const speedPercent = Math.round(Math.abs(this.playerKart.speedRatio) * 100)
    const direction = this.playerKart.speed < -0.01 ? 'R' : ' '
    this.speedText.setText(`SPEED ${direction}${speedPercent.toString().padStart(3, '0')}`)
    this.racerText?.setText(
      `${this.selectedRacer.name.toUpperCase()} // ${this.selectedRacer.weightClass.toUpperCase()}`,
    )
    this.coinText?.setText(`COINS ${this.playerKart.coins.toString().padStart(2, '0')}`)
    this.networkText?.setText(`HUMANS ${1 + (this.multiplayer?.remoteCount ?? 0)}`)

    const surfaceLabel =
      this.currentSurface === 'road'
        ? 'ROAD'
        : this.currentSurface === 'offRoad'
          ? 'OFF-ROAD'
          : this.currentSurface === 'barrier'
            ? 'BARRIER'
            : 'OUTSIDE'
    this.surfaceText.setText(surfaceLabel)
  }

  private syncCameraToKart() {
    if (!this.playerKart || !this.mode7Renderer) return
    const cameraOffset = this.mode7Renderer.groundContactDistance
    const forwardX = Math.sin(this.playerKart.angle)
    const forwardY = -Math.cos(this.playerKart.angle)
    this.cameraState.x = this.playerKart.x - forwardX * cameraOffset
    this.cameraState.y = this.playerKart.y - forwardY * cameraOffset
    this.cameraState.angle = this.playerKart.angle
  }
}
