// Sample pattern for pb_emu — a rainbow drift that works on 1D, 2D, and 3D maps.
// Uses the Pixelblaze dispatch cascade: the emulator picks the right render
// function based on the map's dimensionality.

export var brightness = 0.6
export function sliderBrightness(v) { brightness = v }

export var speed = 0.2
export function sliderSpeed(v) { speed = v * 2 }  // 0..2 cycles/sec

var t = 0
export function beforeRender(delta) {
  t += (delta / 1000) * speed
}

export function render(index) {
  hsv(index / pixelCount + t, 1, brightness)
}

export function render2D(index, x, y) {
  hsv((x + y) * 0.5 + t, 1, brightness)
}

export function render3D(index, x, y, z) {
  hsv((x + y + z) / 3 + t, 1, brightness)
}
