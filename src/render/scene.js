import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'

function makeAxisLabel(text, position, color) {
  const size = 128
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')
  ctx.font = 'bold 96px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = color
  ctx.fillText(text, size / 2, size / 2)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true })
  const sprite = new THREE.Sprite(mat)
  sprite.scale.set(0.08, 0.08, 0.08)
  sprite.position.set(...position)
  sprite.renderOrder = 11
  return sprite
}

export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(window.devicePixelRatio)
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false)
  // LEDs are authored in direct linear [0, 1] — ACES tone mapping would crush
  // midtones and flatten dim patterns. Pass through untouched; bloom handles
  // the HDR glow feel.
  renderer.toneMapping = THREE.NoToneMapping

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x07080c)

  const camera = new THREE.PerspectiveCamera(60, canvas.clientWidth / canvas.clientHeight, 0.01, 10000)
  camera.position.set(2, 2, 2)
  camera.lookAt(0, 0, 0)

  const controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  controls.dampingFactor = 0.08

  // Minimal reference geometry — axes helper on origin with labeled tips.
  const axes = new THREE.AxesHelper(1)
  axes.material.depthTest = false
  axes.renderOrder = 10
  scene.add(axes)
  for (const [label, pos, color] of [
    ['X', [1.1, 0, 0], '#ff5555'],
    ['Y', [0, 1.1, 0], '#55ff55'],
    ['Z', [0, 0, 1.1], '#5599ff']
  ]) {
    scene.add(makeAxisLabel(label, pos, color))
  }

  const composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, camera))
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(canvas.clientWidth, canvas.clientHeight),
    0.55,  // strength — subtle halo; the sprite core carries the brightness
    0.2,   // radius — tight glow, not smear
    0.0    // threshold — pass everything through
  )
  composer.addPass(bloom)

  function resize() {
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    renderer.setSize(w, h, false)
    composer.setSize(w, h)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
  window.addEventListener('resize', resize)
  // Also observe the canvas's own size (it's 100vw/vh so usually matches window).
  new ResizeObserver(resize).observe(canvas)

  return {
    renderer, scene, camera, controls, composer, bloom,
    render() {
      controls.update()
      composer.render()
    },
    setBloomEnabled(on) {
      bloom.enabled = !!on
    }
  }
}
