// Pixelblaze JS mapper-function evaluator.
// Per the canonical Mapper tab spec: the user may provide a function
// `function (pixelCount) { ... return mapArray; }` — the Pixelblaze web UI
// runs it in the browser once and uploads the resulting static array. We
// mirror that: evaluate once at load time and feed the array into the
// normal map pipeline.

import { evaluateMapperFunction } from '../vm/sandbox.js'
import { arrayToMap } from './json.js'

export function runMapperFunction(source, pixelCount) {
  // Math is the only global mapper fns typically use. Hand it in explicitly.
  const env = { Math, Array, Object }
  let result
  try {
    result = evaluateMapperFunction(source, pixelCount, env)
  } catch (err) {
    throw new Error(`mapper function threw: ${err.message}`)
  }
  if (!Array.isArray(result)) {
    throw new Error('mapper function did not return an array')
  }
  return arrayToMap(result, 'mapper-fn')
}
