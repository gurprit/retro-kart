export type RacerWeightClass = 'light' | 'medium' | 'heavy'

export type RacerProfile = {
  key: string
  name: string
  file: string
  weightClass: RacerWeightClass
  strength: 1 | 2 | 3
  accelerationMultiplier: number
  topSpeedMultiplier: number
}

const CLASS_STATS = {
  light: {
    strength: 1 as const,
    accelerationMultiplier: 1.22,
    topSpeedMultiplier: 0.9,
  },
  medium: {
    strength: 2 as const,
    accelerationMultiplier: 1,
    topSpeedMultiplier: 1,
  },
  heavy: {
    strength: 3 as const,
    accelerationMultiplier: 0.72,
    topSpeedMultiplier: 1.12,
  },
} as const

export const RACERS: readonly RacerProfile[] = [
  {
    key: 'racer-mario',
    name: 'Mario',
    file: 'Racers - Mario.png',
    weightClass: 'medium',
    ...CLASS_STATS.medium,
  },
  {
    key: 'racer-luigi',
    name: 'Luigi',
    file: 'Racers - Luigi.png',
    weightClass: 'medium',
    ...CLASS_STATS.medium,
  },
  {
    key: 'racer-yoshi',
    name: 'Yoshi',
    file: 'Racers - Yoshi.png',
    weightClass: 'medium',
    ...CLASS_STATS.medium,
  },
  {
    key: 'racer-princess-toadstool',
    name: 'Princess Toadstool',
    file: 'Racers - Princess Toadstool _ Peach.png',
    weightClass: 'medium',
    ...CLASS_STATS.medium,
  },
  {
    key: 'racer-toad',
    name: 'Toad',
    file: 'Racers - Toad.png',
    weightClass: 'light',
    ...CLASS_STATS.light,
  },
  {
    key: 'racer-koopa-troopa',
    name: 'Koopa Troopa',
    file: 'Racers - Koopa Troopa.png',
    weightClass: 'light',
    ...CLASS_STATS.light,
  },
  {
    key: 'racer-bowser',
    name: 'Bowser',
    file: 'Racers - Bowser.png',
    weightClass: 'heavy',
    ...CLASS_STATS.heavy,
  },
  {
    key: 'racer-donkey-kong-jr',
    name: 'Donkey Kong Jr.',
    file: 'Racers - Donkey Kong Jr..png',
    weightClass: 'heavy',
    ...CLASS_STATS.heavy,
  },
]

export function shouldSpinFromRacerCollision(
  attacker: RacerProfile,
  defender: RacerProfile,
) {
  return attacker.strength > defender.strength
}
