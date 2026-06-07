import { Octree } from 'three/addons/math/Octree.js'
import * as THREE from 'three'

const EPSILON = 0.000001
const TRACE_SKIN = 0.001
const AXES = ['x', 'y', 'z']
const scratchCenter = new THREE.Vector3()
const scratchHalfSize = new THREE.Vector3()
const scratchMin = new THREE.Vector3()
const scratchMax = new THREE.Vector3()
const scratchNormal = new THREE.Vector3()
const scratchTranslation = new THREE.Vector3()
const scratchTraceBox = new THREE.Box3()
const scratchPoint = new THREE.Vector3()
const scratchPointA = new THREE.Vector3()
const scratchPointB = new THREE.Vector3()
const scratchPointC = new THREE.Vector3()
const scratchEdgeA = new THREE.Vector3()
const scratchEdgeB = new THREE.Vector3()
const scratchTerrainNormal = new THREE.Vector3()
const scratchBestTerrainNormal = new THREE.Vector3()
const scratchBrushCenter = new THREE.Vector3()
const scratchEndCenter = new THREE.Vector3()
const UP_NORMAL = new THREE.Vector3(0, 1, 0)

export class StaticWorldCollider {
  constructor() {
    this.octree = new Octree()
    this.source = null
    this.brushBoxes = []
    this.convexBrushes = []
    this.terrainPatches = []
    this.hasTriangleCollision = false
    this.stats = {
      hullIntersections: 0,
      hullTraces: 0,
      queryTimeMs: 0,
    }
    this.traceIterations = 6
    this.maxTraceStepLength = 0.04
    this.contactSlop = 0.02
    this.stuckTestEpsilon = 0.002
  }

  buildFromSceneObject(sceneObject) {
    this.source = sceneObject
    this.brushBoxes.length = 0
    this.convexBrushes.length = 0
    this.terrainPatches.length = 0
    this.hasTriangleCollision = false
    sceneObject.updateMatrixWorld(true)

    const fallbackCollision = new THREE.Group()

    sceneObject.traverse((child) => {
      if (!child.isMesh || !child.geometry) {
        return
      }

      if (
        child.userData.collisionKind === 'slope' ||
        child.userData.collisionKind === 'brush' ||
        child.userData.collisionKind === 'convex'
      ) {
        this.convexBrushes.push(createConvexBrush(child))
        return
      }

      if (child.userData.collisionKind === 'terrain') {
        this.terrainPatches.push(createTerrainPatch(child))
        return
      }

      if (child.userData.collisionKind === 'triangle') {
        addFallbackCollisionMesh(fallbackCollision, child)
        this.hasTriangleCollision = true
        return
      }

      if (isAxisAlignedMesh(child)) {
        this.brushBoxes.push(new THREE.Box3().setFromObject(child))
        return
      }

      addFallbackCollisionMesh(fallbackCollision, child)
      this.hasTriangleCollision = true
    })

    fallbackCollision.updateMatrixWorld(true)
    this.octree.fromGraphNode(fallbackCollision)
  }

  boxIntersect(box) {
    const start = performance.now()
    let result = intersectBrushBoxes(box, this.brushBoxes, this.contactSlop)

    if (!result) {
      result = intersectConvexBrushes(box, this.convexBrushes, this.contactSlop)
    }

    if (!result) {
      result = intersectTerrainPatches(box, this.terrainPatches, this.contactSlop)
    }

    if (!result && this.hasTriangleCollision) {
      result = this.octree.boxIntersect(box)
    }

    this.stats.hullIntersections += 1
    this.stats.queryTimeMs += performance.now() - start

    return result
  }

  testBox(box) {
    const start = performance.now()
    let result = intersectBrushBoxes(box, this.brushBoxes, 0)

    if (!result) {
      result = intersectConvexBrushes(box, this.convexBrushes, 0)
    }

    if (!result) {
      result = intersectTerrainPatches(box, this.terrainPatches, 0)
    }

    if (!result && this.hasTriangleCollision) {
      result = this.octree.boxIntersect(box)
    }

    this.stats.hullIntersections += 1
    this.stats.queryTimeMs += performance.now() - start

    return result && result.depth > this.stuckTestEpsilon ? result : null
  }

  traceBox(box, delta) {
    this.stats.hullTraces += 1
    const start = performance.now()

    if (delta.lengthSq() <= EPSILON) {
      const hit = this.testBox(box)

      return {
        fraction: hit ? 0 : 1,
        startSolid: Boolean(hit),
        allSolid: Boolean(hit),
        normal: hit ? hit.normal : null,
        depth: hit ? hit.depth : 0,
        endBox: box.clone(),
      }
    }

    let result = traceBrushBoxes(box, delta, this.brushBoxes, this.contactSlop)

    if (result.fraction === 0) {
      this.stats.queryTimeMs += performance.now() - start
      return result
    }

    if (this.convexBrushes.length > 0) {
      result = chooseEarlierTrace(
        result,
        traceConvexBrushes(box, delta, this.convexBrushes, this.contactSlop)
      )
    }

    if (result.fraction === 0) {
      this.stats.queryTimeMs += performance.now() - start
      return result
    }

    if (this.terrainPatches.length > 0) {
      result = chooseEarlierTrace(
        result,
        traceTerrainPatches(box, delta, this.terrainPatches, this.contactSlop, this.maxTraceStepLength, this.traceIterations)
      )
    }

    if (result.fraction === 0) {
      this.stats.queryTimeMs += performance.now() - start
      return result
    }

    if (this.hasTriangleCollision) {
      result = chooseEarlierTrace(result, this.traceTriangleBox(box, delta))
    }

    this.stats.queryTimeMs += performance.now() - start

    return result
  }

  traceTriangleBox(box, delta) {
    const startHit = this.octree.boxIntersect(box)

    if (startHit && startHit.depth > this.contactSlop && delta.dot(startHit.normal) < -0.00001) {
      return {
        fraction: 0,
        startSolid: true,
        allSolid: false,
        normal: startHit.normal,
        depth: startHit.depth,
        endBox: box.clone(),
      }
    }

    const distance = delta.length()
    const steps = Math.max(1, Math.ceil(distance / this.maxTraceStepLength))
    let safeFraction = 0
    let hitFraction = 0
    let hit = null

    for (let step = 1; step <= steps; step += 1) {
      const fraction = step / steps
      const testBox = scratchTraceBox.copy(box).translate(scratchTranslation.copy(delta).multiplyScalar(fraction))
      const testHit = this.octree.boxIntersect(testBox)

      if (testHit) {
        hit = testHit
        hitFraction = fraction
        break
      }

      safeFraction = fraction
    }

    if (!hit) {
      return {
        fraction: 1,
        startSolid: false,
        allSolid: false,
        normal: null,
        depth: 0,
        endBox: box.clone().translate(delta),
      }
    }

    let low = safeFraction
    let high = hitFraction

    for (let index = 0; index < this.traceIterations; index += 1) {
      const mid = (low + high) * 0.5
      const testBox = scratchTraceBox.copy(box).translate(scratchTranslation.copy(delta).multiplyScalar(mid))
      const testHit = this.octree.boxIntersect(testBox)

      if (testHit) {
        hit = testHit
        high = mid
      } else {
        low = mid
      }
    }

    const safeHitFraction = getSafeTraceFraction(low, delta)

    return {
      fraction: low,
      startSolid: false,
      allSolid: false,
      normal: hit.normal,
      depth: hit.depth,
      endBox: box.clone().translate(scratchTranslation.copy(delta).multiplyScalar(safeHitFraction)),
    }
  }

  flushStats() {
    const stats = { ...this.stats }

    this.stats.hullIntersections = 0
    this.stats.hullTraces = 0
    this.stats.queryTimeMs = 0

    return stats
  }
}

function addFallbackCollisionMesh(fallbackCollision, child) {
  const fallbackMesh = child.clone()

  fallbackMesh.geometry = child.geometry
  fallbackMesh.matrix.copy(child.matrixWorld)
  fallbackMesh.matrixAutoUpdate = false
  fallbackCollision.add(fallbackMesh)
}

function traceBrushBoxes(box, delta, brushBoxes, contactSlop) {
  let bestTrace = null
  const startHit = intersectBrushBoxes(box, brushBoxes, contactSlop)

  if (startHit && startHit.depth > contactSlop && delta.dot(startHit.normal) < -0.00001) {
    return {
      fraction: 0,
      startSolid: true,
      allSolid: false,
      normal: startHit.normal.clone(),
      depth: startHit.depth,
      endBox: box.clone(),
    }
  }

  for (const brushBox of brushBoxes) {
    const trace = traceBoxAgainstBrush(box, delta, brushBox, contactSlop)

    if (!trace) {
      continue
    }

    if (!bestTrace || trace.fraction < bestTrace.fraction) {
      bestTrace = trace
    }
  }

  if (bestTrace) {
    return bestTrace
  }

  return {
    fraction: 1,
    startSolid: false,
    allSolid: false,
    normal: null,
    depth: 0,
    endBox: box.clone().translate(delta),
  }
}

function traceBoxAgainstBrush(box, delta, brushBox, contactSlop) {
  if (delta.lengthSq() <= EPSILON) {
    return null
  }

  box.getCenter(scratchCenter)
  box.getSize(scratchHalfSize).multiplyScalar(0.5)

  scratchMin.copy(brushBox.min).sub(scratchHalfSize)
  scratchMax.copy(brushBox.max).add(scratchHalfSize)

  let entryTime = -Infinity
  let exitTime = Infinity
  scratchNormal.set(0, 0, 0)

  for (const axis of AXES) {
    const origin = scratchCenter[axis]
    const velocity = delta[axis]
    const min = scratchMin[axis]
    const max = scratchMax[axis]

    if (Math.abs(velocity) <= EPSILON) {
      if (
        origin < min ||
        origin > max ||
        origin <= min + contactSlop ||
        origin >= max - contactSlop
      ) {
        return null
      }

      continue
    }

    const inverseVelocity = 1 / velocity
    let axisEntry = (min - origin) * inverseVelocity
    let axisExit = (max - origin) * inverseVelocity
    let normalSign = -1

    if (axisEntry > axisExit) {
      const swap = axisEntry
      axisEntry = axisExit
      axisExit = swap
      normalSign = 1
    }

    if (shouldReplaceTraceNormal(axisEntry, entryTime, axis, velocity, scratchNormal)) {
      entryTime = axisEntry
      scratchNormal.set(0, 0, 0)
      scratchNormal[axis] = normalSign
    }

    exitTime = Math.min(exitTime, axisExit)
  }

  if (entryTime > exitTime || entryTime < 0 || entryTime > 1) {
    return null
  }

  const safeEntryTime = getSafeTraceFraction(entryTime, delta)
  scratchTranslation.copy(delta).multiplyScalar(safeEntryTime)

  return {
    fraction: entryTime,
    startSolid: false,
    allSolid: false,
    normal: scratchNormal.clone(),
    depth: 0,
    endBox: box.clone().translate(scratchTranslation),
  }
}

function shouldReplaceTraceNormal(axisEntry, entryTime, axis, velocity, currentNormal) {
  if (axisEntry > entryTime + EPSILON) {
    return true
  }

  if (Math.abs(axisEntry - entryTime) > EPSILON) {
    return false
  }

  return axis === 'y' && velocity < 0 && currentNormal.y === 0
}

function traceConvexBrushes(box, delta, convexBrushes, contactSlop) {
  let bestTrace = null
  const startHit = intersectConvexBrushes(box, convexBrushes, contactSlop)

  if (startHit && startHit.depth > contactSlop && delta.dot(startHit.normal) < -0.00001) {
    return {
      fraction: 0,
      startSolid: true,
      allSolid: false,
      normal: startHit.normal.clone(),
      depth: startHit.depth,
      endBox: box.clone(),
    }
  }

  for (const convexBrush of convexBrushes) {
    const trace = traceBoxAgainstConvexBrush(box, delta, convexBrush, contactSlop)

    if (!trace) {
      continue
    }

    if (!bestTrace || trace.fraction < bestTrace.fraction) {
      bestTrace = trace
    }
  }

  return bestTrace
}

function traceBoxAgainstConvexBrush(box, delta, convexBrush, contactSlop) {
  box.getCenter(scratchCenter)
  box.getSize(scratchHalfSize).multiplyScalar(0.5)
  scratchEndCenter.copy(scratchCenter).add(delta)

  let enterTime = 0
  let exitTime = 1
  let enterNormal = null
  let startPenetrationDepth = Infinity
  let endPenetrationDepth = Infinity

  for (const plane of convexBrush.planes) {
    const expandedConstant = plane.constant + getHullPlaneOffset(scratchHalfSize, plane.normal)
    const startDistance = plane.normal.dot(scratchCenter) - expandedConstant
    const endDistance = plane.normal.dot(scratchEndCenter) - expandedConstant
    const startDepth = -startDistance
    const endDepth = -endDistance

    startPenetrationDepth = Math.min(startPenetrationDepth, startDepth)
    endPenetrationDepth = Math.min(endPenetrationDepth, endDepth)

    if (startDistance > 0 && endDistance > 0) {
      return null
    }

    if (startDistance <= 0 && endDistance <= 0) {
      if (
        startDistance >= -contactSlop &&
        endDistance < startDistance - EPSILON &&
        enterTime === 0 &&
        !enterNormal
      ) {
        enterNormal = plane.normal
      }

      continue
    }

    const fraction = startDistance / (startDistance - endDistance)

    if (startDistance > endDistance) {
      if (fraction > enterTime) {
        enterTime = fraction
        enterNormal = plane.normal
      }
    } else {
      exitTime = Math.min(exitTime, fraction)
    }

    if (enterTime > exitTime) {
      return null
    }
  }

  if (startPenetrationDepth > contactSlop) {
    const hit = intersectConvexBrush(box, convexBrush, 0)

    return {
      fraction: 0,
      startSolid: true,
      allSolid: endPenetrationDepth > contactSlop,
      normal: hit ? hit.normal : null,
      depth: hit ? hit.depth : 0,
      endBox: box.clone(),
    }
  }

  if (!enterNormal || enterTime < 0 || enterTime > 1) {
    return null
  }

  const safeEnterTime = getSafeTraceFraction(enterTime, delta)
  scratchTranslation.copy(delta).multiplyScalar(safeEnterTime)

  return {
    fraction: enterTime,
    startSolid: false,
    allSolid: false,
    normal: enterNormal.clone(),
    depth: 0,
    endBox: box.clone().translate(scratchTranslation),
  }
}

function intersectConvexBrushes(box, convexBrushes, contactSlop = 0) {
  let bestHit = null

  for (const convexBrush of convexBrushes) {
    const hit = intersectConvexBrush(box, convexBrush, contactSlop)

    if (!hit) {
      continue
    }

    if (!bestHit || hit.depth < bestHit.depth) {
      bestHit = hit
    }
  }

  return bestHit
}

function intersectConvexBrush(box, convexBrush, contactSlop) {
  box.getCenter(scratchCenter)
  box.getSize(scratchHalfSize).multiplyScalar(0.5)

  let bestDepth = Infinity
  let bestNormal = null

  for (const plane of convexBrush.planes) {
    const expandedConstant = plane.constant + getHullPlaneOffset(scratchHalfSize, plane.normal)
    const depth = expandedConstant - plane.normal.dot(scratchCenter)

    if (depth < -contactSlop) {
      return null
    }

    if (depth < bestDepth) {
      bestDepth = depth
      bestNormal = plane.normal
    }
  }

  if (!bestNormal) {
    return null
  }

  return {
    normal: bestNormal.clone(),
    depth: Math.max(bestDepth, 0),
  }
}

function getHullPlaneOffset(halfSize, normal) {
  return Math.abs(normal.x) * halfSize.x +
    Math.abs(normal.y) * halfSize.y +
    Math.abs(normal.z) * halfSize.z
}

function intersectBrushBoxes(box, brushBoxes, contactSlop = 0) {
  let bestHit = null

  for (const brushBox of brushBoxes) {
    const overlapX = Math.min(box.max.x, brushBox.max.x) - Math.max(box.min.x, brushBox.min.x)
    const overlapY = Math.min(box.max.y, brushBox.max.y) - Math.max(box.min.y, brushBox.min.y)
    const overlapZ = Math.min(box.max.z, brushBox.max.z) - Math.max(box.min.z, brushBox.min.z)

    if (overlapX <= EPSILON || overlapY <= EPSILON || overlapZ <= EPSILON) {
      continue
    }

    const hit = makeBrushHit(box, brushBox, overlapX, overlapY, overlapZ, contactSlop)

    if (!bestHit || hit.depth < bestHit.depth) {
      bestHit = hit
    }
  }

  return bestHit
}

function traceTerrainPatches(box, delta, terrainPatches, contactSlop, maxTraceStepLength, traceIterations) {
  const startHit = intersectTerrainPatches(box, terrainPatches, contactSlop, delta)

  if (startHit && startHit.depth > contactSlop && delta.dot(startHit.normal) < -0.00001) {
    return {
      fraction: 0,
      startSolid: true,
      allSolid: false,
      normal: startHit.normal.clone(),
      depth: startHit.depth,
      endBox: box.clone(),
    }
  }

  const distance = delta.length()
  const steps = Math.max(1, Math.ceil(distance / maxTraceStepLength))
  let safeFraction = 0
  let hitFraction = 0
  let hit = null

  for (let step = 1; step <= steps; step += 1) {
    const fraction = step / steps
    const testBox = scratchTraceBox.copy(box).translate(scratchTranslation.copy(delta).multiplyScalar(fraction))
    const testHit = intersectTerrainPatches(testBox, terrainPatches, contactSlop, delta)

    if (testHit) {
      hit = testHit
      hitFraction = fraction
      break
    }

    safeFraction = fraction
  }

  if (!hit) {
    return {
      fraction: 1,
      startSolid: false,
      allSolid: false,
      normal: null,
      depth: 0,
      endBox: box.clone().translate(delta),
    }
  }

  let low = safeFraction
  let high = hitFraction

  for (let index = 0; index < traceIterations; index += 1) {
    const mid = (low + high) * 0.5
    const testBox = scratchTraceBox.copy(box).translate(scratchTranslation.copy(delta).multiplyScalar(mid))
    const testHit = intersectTerrainPatches(testBox, terrainPatches, contactSlop, delta)

    if (testHit) {
      hit = testHit
      high = mid
    } else {
      low = mid
    }
  }

  return {
    fraction: low,
    startSolid: false,
    allSolid: false,
    normal: hit.normal.clone(),
    depth: hit.depth,
    endBox: box.clone().translate(scratchTranslation.copy(delta).multiplyScalar(getSafeTraceFraction(low, delta))),
  }
}

function getSafeTraceFraction(fraction, delta) {
  const distance = delta.length()

  if (distance <= EPSILON || fraction <= 0) {
    return 0
  }

  return Math.max(0, fraction - TRACE_SKIN / distance)
}

function intersectTerrainPatches(box, terrainPatches, contactSlop, traceDelta = null) {
  let bestHit = null

  for (const terrainPatch of terrainPatches) {
    const hit = intersectTerrainPatch(box, terrainPatch, contactSlop, traceDelta)

    if (!hit) {
      continue
    }

    if (!bestHit || hit.depth < bestHit.depth) {
      bestHit = hit
    }
  }

  return bestHit
}

function intersectTerrainPatch(box, terrainPatch, contactSlop, traceDelta) {
  if (
    box.max.x < terrainPatch.minX ||
    box.min.x > terrainPatch.maxX ||
    box.max.z < terrainPatch.minZ ||
    box.min.z > terrainPatch.maxZ ||
    box.min.y > terrainPatch.maxY + contactSlop ||
    box.max.y < terrainPatch.minY
  ) {
    return null
  }

  let bestDepth = -Infinity
  const centerX = (box.min.x + box.max.x) * 0.5
  const centerZ = (box.min.z + box.max.z) * 0.5

  bestDepth = sampleTerrainContact(terrainPatch, box.min.x, box.min.z, box.min.y, contactSlop, bestDepth)
  bestDepth = sampleTerrainContact(terrainPatch, box.max.x, box.min.z, box.min.y, contactSlop, bestDepth)
  bestDepth = sampleTerrainContact(terrainPatch, box.min.x, box.max.z, box.min.y, contactSlop, bestDepth)
  bestDepth = sampleTerrainContact(terrainPatch, box.max.x, box.max.z, box.min.y, contactSlop, bestDepth)
  bestDepth = sampleTerrainContact(terrainPatch, centerX, centerZ, box.min.y, contactSlop, bestDepth)

  if (!Number.isFinite(bestDepth)) {
    return null
  }

  if (traceDelta && traceDelta.dot(scratchBestTerrainNormal) >= -0.00001 && bestDepth <= contactSlop) {
    return null
  }

  return {
    normal: scratchBestTerrainNormal.clone(),
    depth: Math.max(bestDepth, 0),
  }
}

function makeBrushHit(box, brushBox, overlapX, overlapY, overlapZ, contactSlop) {
  box.getCenter(scratchCenter)
  brushBox.getCenter(scratchBrushCenter)
  let depth = overlapX

  if (box.min.y >= brushBox.max.y - contactSlop) {
    return {
      normal: UP_NORMAL,
      depth: overlapY,
    }
  }

  scratchNormal.set(scratchCenter.x >= scratchBrushCenter.x ? 1 : -1, 0, 0)

  if (overlapY < depth) {
    depth = overlapY
    scratchNormal.set(0, scratchCenter.y >= scratchBrushCenter.y ? 1 : -1, 0)
  }

  if (overlapZ < depth) {
    depth = overlapZ
    scratchNormal.set(0, 0, scratchCenter.z >= scratchBrushCenter.z ? 1 : -1)
  }

  return { normal: scratchNormal.clone(), depth }
}

function createConvexBrush(mesh) {
  const worldBounds = new THREE.Box3().setFromObject(mesh).expandByScalar(0.01)
  const planes = createConvexBrushPlanes(mesh, worldBounds)

  return {
    planes,
    worldBounds,
  }
}

function createConvexBrushPlanes(mesh, worldBounds) {
  const position = mesh.geometry.getAttribute('position')
  const index = mesh.geometry.index
  const planes = []

  if (!position) {
    return planes
  }

  getGeometryCentroid(position, mesh.matrixWorld, scratchBrushCenter)

  const triangleCount = index ? index.count / 3 : position.count / 3

  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const a = getGeometryVertex(position, index, triangle * 3, mesh.matrixWorld, scratchPointA)
    const b = getGeometryVertex(position, index, triangle * 3 + 1, mesh.matrixWorld, scratchPointB)
    const c = getGeometryVertex(position, index, triangle * 3 + 2, mesh.matrixWorld, scratchPointC)

    scratchEdgeA.subVectors(b, a)
    scratchEdgeB.subVectors(c, a)
    scratchNormal.crossVectors(scratchEdgeA, scratchEdgeB)

    if (scratchNormal.lengthSq() <= EPSILON) {
      continue
    }

    scratchNormal.normalize()
    let constant = scratchNormal.dot(a)

    if (scratchNormal.dot(scratchBrushCenter) > constant) {
      scratchNormal.multiplyScalar(-1)
      constant *= -1
    }

    addUniqueBrushPlane(planes, scratchNormal, constant)
  }

  return planes
}

function getGeometryCentroid(position, matrixWorld, target) {
  target.set(0, 0, 0)

  for (let vertexIndex = 0; vertexIndex < position.count; vertexIndex += 1) {
    scratchPoint
      .fromBufferAttribute(position, vertexIndex)
      .applyMatrix4(matrixWorld)
    target.add(scratchPoint)
  }

  if (position.count > 0) {
    target.multiplyScalar(1 / position.count)
  }

  return target
}

function getGeometryVertex(position, index, vertexIndex, matrixWorld, target) {
  const sourceIndex = index ? index.getX(vertexIndex) : vertexIndex

  return target.fromBufferAttribute(position, sourceIndex).applyMatrix4(matrixWorld)
}

function addUniqueBrushPlane(planes, normal, constant) {
  for (const plane of planes) {
    if (
      plane.normal.dot(normal) > 0.9999 &&
      Math.abs(plane.constant - constant) < 0.0001
    ) {
      return
    }
  }

  planes.push({
    normal: normal.clone(),
    constant,
  })
}

function createTerrainPatch(mesh) {
  const metadata = mesh.userData.terrain || {}
  const segmentsX = metadata.segmentsX
  const segmentsZ = metadata.segmentsZ

  if (!Number.isInteger(segmentsX) || !Number.isInteger(segmentsZ)) {
    throw new Error(`Terrain mesh "${mesh.name || 'unnamed'}" is missing userData.terrain.segmentsX/segmentsZ`)
  }

  const columns = segmentsX + 1
  const rows = segmentsZ + 1
  const position = mesh.geometry.getAttribute('position')
  const heights = new Float32Array(columns * rows)
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  let minY = Infinity
  let maxY = -Infinity

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const index = row * columns + column

      scratchPoint
        .fromBufferAttribute(position, index)
        .applyMatrix4(mesh.matrixWorld)

      heights[index] = scratchPoint.y
      minX = Math.min(minX, scratchPoint.x)
      maxX = Math.max(maxX, scratchPoint.x)
      minZ = Math.min(minZ, scratchPoint.z)
      maxZ = Math.max(maxZ, scratchPoint.z)
      minY = Math.min(minY, scratchPoint.y)
      maxY = Math.max(maxY, scratchPoint.y)
    }
  }

  return {
    columns,
    rows,
    heights,
    minX,
    maxX,
    minZ,
    maxZ,
    minY,
    maxY,
    cellSizeX: (maxX - minX) / segmentsX,
    cellSizeZ: (maxZ - minZ) / segmentsZ,
    maxSnapDepth: metadata.maxSnapDepth || 0.65,
  }
}

function chooseEarlierTrace(currentTrace, candidateTrace) {
  if (!candidateTrace) {
    return currentTrace
  }

  if (!currentTrace || candidateTrace.fraction < currentTrace.fraction) {
    return candidateTrace
  }

  return currentTrace
}

function sampleTerrainPatch(terrainPatch, x, z) {
  if (
    x < terrainPatch.minX ||
    x > terrainPatch.maxX ||
    z < terrainPatch.minZ ||
    z > terrainPatch.maxZ
  ) {
    return null
  }

  const localX = (x - terrainPatch.minX) / terrainPatch.cellSizeX
  const localZ = (z - terrainPatch.minZ) / terrainPatch.cellSizeZ
  const column = Math.min(Math.max(Math.floor(localX), 0), terrainPatch.columns - 2)
  const row = Math.min(Math.max(Math.floor(localZ), 0), terrainPatch.rows - 2)
  const tx = localX - column
  const tz = localZ - row

  const h00 = getTerrainHeightAtIndex(terrainPatch, column, row)
  const h10 = getTerrainHeightAtIndex(terrainPatch, column + 1, row)
  const h01 = getTerrainHeightAtIndex(terrainPatch, column, row + 1)
  const h11 = getTerrainHeightAtIndex(terrainPatch, column + 1, row + 1)
  const heightA = THREE.MathUtils.lerp(h00, h10, tx)
  const heightB = THREE.MathUtils.lerp(h01, h11, tx)
  const height = THREE.MathUtils.lerp(heightA, heightB, tz)

  const left = getTerrainHeightAtIndex(terrainPatch, Math.max(column - 1, 0), row)
  const right = getTerrainHeightAtIndex(terrainPatch, Math.min(column + 1, terrainPatch.columns - 1), row)
  const down = getTerrainHeightAtIndex(terrainPatch, column, Math.max(row - 1, 0))
  const up = getTerrainHeightAtIndex(terrainPatch, column, Math.min(row + 1, terrainPatch.rows - 1))

  scratchTerrainNormal
    .set(
      -(right - left) / Math.max(terrainPatch.cellSizeX * 2, EPSILON),
      1,
      -(up - down) / Math.max(terrainPatch.cellSizeZ * 2, EPSILON)
    )
    .normalize()

  return {
    height,
    normal: scratchTerrainNormal,
  }
}

function sampleTerrainContact(terrainPatch, x, z, boxMinY, contactSlop, bestDepth) {
  const terrainSample = sampleTerrainPatch(terrainPatch, x, z)

  if (!terrainSample) {
    return bestDepth
  }

  const depth = terrainSample.height - boxMinY

  if (depth < -contactSlop || depth > terrainPatch.maxSnapDepth || depth <= bestDepth) {
    return bestDepth
  }

  scratchBestTerrainNormal.copy(terrainSample.normal)
  return depth
}

function getTerrainHeightAtIndex(terrainPatch, column, row) {
  return terrainPatch.heights[row * terrainPatch.columns + column]
}

function isAxisAlignedMesh(mesh) {
  const elements = mesh.matrixWorld.elements
  const diagonalScale =
    Math.abs(elements[0]) +
    Math.abs(elements[5]) +
    Math.abs(elements[10])
  const totalScale =
    Math.abs(elements[0]) +
    Math.abs(elements[1]) +
    Math.abs(elements[2]) +
    Math.abs(elements[4]) +
    Math.abs(elements[5]) +
    Math.abs(elements[6]) +
    Math.abs(elements[8]) +
    Math.abs(elements[9]) +
    Math.abs(elements[10])

  return totalScale - diagonalScale < 0.00001
}
