import { defineConfig } from 'vite'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

const home = homedir()
const pbDir = resolve(home, 'code/pb')
const mariDir = resolve(home, 'code/marimapper')

export default defineConfig({
  server: {
    fs: {
      allow: [resolve(__dirname), pbDir, mariDir]
    }
  },
  resolve: {
    alias: {
      '/pb': pbDir,
      '/marimapper': mariDir
    }
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.js']
  }
})
