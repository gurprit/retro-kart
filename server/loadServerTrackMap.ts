import fs from 'node:fs'
import { PNG } from 'pngjs'
import { ServerTrackMap, type TrackPixelSource } from './ServerTrackMap'

function readPng(path: string): Promise<TrackPixelSource> {
  return new Promise((resolve, reject) => {
    fs.createReadStream(path)
      .pipe(new PNG())
      .on('parsed', function parsed(this: PNG) {
        resolve({ width: this.width, height: this.height, data: this.data })
      })
      .on('error', reject)
  })
}

export async function loadServerTrackMap(surfacePath: string, collisionPath: string) {
  const [surface, collision] = await Promise.all([
    readPng(surfacePath),
    readPng(collisionPath),
  ])
  return ServerTrackMap.fromPixels(surface, collision)
}
