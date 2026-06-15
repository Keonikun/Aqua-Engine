import * as THREE from 'three'

const UP = new THREE.Vector3(0, 1, 0)
const wishDirection = new THREE.Vector3()
const forward = new THREE.Vector3()
const right = new THREE.Vector3()
const delta = new THREE.Vector3()
const clipResult = new THREE.Vector3()
const creaseDirection = new THREE.Vector3()
const hullCenter = new THREE.Vector3()
const euler = new THREE.Euler(0, 0, 0, 'YXZ')
const quadrantHull = new THREE.Box3()
const noclipDirection = new THREE.Vector3()
const noclipForward = new THREE.Vector3()
const noclipRight = new THREE.Vector3()

export class CharacterController {
  constructor({ collider, config, spawnPosition = null }) {
    this.collider = collider
    this.config = config
    this.velocity = new THREE.Vector3()
    this.position = new THREE.Vector3()
    this.grounded = false
    this.noclip = false
    this.stuck = false
    this.groundNormal = new THREE.Vector3(0, 1, 0)
    this.contacts = []
    this.minGroundDot = Math.cos(THREE.MathUtils.degToRad(config.slopeLimitDegrees))
    this.hull = new THREE.Box3()
    this.moveOriginalVelocity = new THREE.Vector3()
    this.movePrimalVelocity = new THREE.Vector3()
    this.stepStartHull = new THREE.Box3()
    this.stepDownHull = new THREE.Box3()
    this.stepStartVelocity = new THREE.Vector3()
    this.stepDownVelocity = new THREE.Vector3()
    this.clipPlanes = []
    this.contactPool = Array.from({ length: config.maxClipBumps }, () => ({
      point: new THREE.Vector3(),
      normal: new THREE.Vector3(),
      depth: 0,
    }))

    this.setFeetPosition(spawnPosition || new THREE.Vector3(0, 0.1, 4))
  }

  fixedUpdate(deltaTime, input) {
    this.contacts.length = 0
    this.stuck = false

    if (this.noclip) {
      this.noclipMove(deltaTime, input)
      return
    }

    this.categorizePosition()

    if (this.grounded) {
      this.velocity.y = 0
      this.applyFriction(deltaTime)
    } else {
      this.velocity.y -= this.config.gravity * deltaTime
    }

    this.applyJump(input)
    this.accelerate(deltaTime, input)

    if (this.grounded) {
      this.walkMove(deltaTime)
    } else {
      this.airMove(deltaTime)
    }

    this.categorizePosition()

    if (this.grounded && this.velocity.y < 0) {
      this.velocity.y = 0
    }

    this.refreshPosition()
  }

  setFeetPosition(feetPosition) {
    const halfWidth = this.config.capsuleRadius

    this.position.copy(feetPosition)
    this.hull.min.set(feetPosition.x - halfWidth, feetPosition.y, feetPosition.z - halfWidth)
    this.hull.max.set(
      feetPosition.x + halfWidth,
      feetPosition.y + this.config.capsuleHeight,
      feetPosition.z + halfWidth
    )
  }

  getEyePosition(target) {
    return target.set(this.position.x, this.position.y + this.config.eyeHeight, this.position.z)
  }

  getState() {
    return {
      position: this.position,
      velocity: this.velocity,
      grounded: this.grounded,
      groundNormal: this.groundNormal,
      contacts: this.contacts,
      noclip: this.noclip,
      stuck: this.stuck,
    }
  }

  getBounds(target = new THREE.Box3()) {
    return target.copy(this.hull)
  }

  setNoclip(enabled) {
    this.noclip = enabled
    this.contacts.length = 0
    this.velocity.set(0, 0, 0)
    this.grounded = false
    this.groundNormal.set(0, 1, 0)
  }

  noclipMove(deltaTime, input) {
    input.clearJumpQueue()

    const axes = input.getNoclipMoveAxes()
    noclipDirection.set(0, 0, 0)

    euler.set(input.pitch, input.yaw, 0)
    noclipForward.set(0, 0, -1).applyEuler(euler)
    noclipRight.set(1, 0, 0).applyEuler(euler)
    noclipRight.y = 0

    if (noclipRight.lengthSq() > 0) {
      noclipRight.normalize()
    }

    noclipDirection
      .addScaledVector(noclipForward, axes.forward)
      .addScaledVector(noclipRight, axes.right)
    noclipDirection.y += axes.up

    if (noclipDirection.lengthSq() > 0) {
      noclipDirection.normalize().multiplyScalar(this.config.noclipSpeed)
    }

    this.velocity.copy(noclipDirection)
    this.hull.translate(delta.copy(this.velocity).multiplyScalar(deltaTime))
    this.refreshPosition()
  }

  categorizePosition() {
    if (this.velocity.y > this.config.nonJumpVelocity) {
      this.grounded = false
      this.groundNormal.set(0, 1, 0)
      return
    }

    const wasGrounded = this.grounded
    const probeDistance = wasGrounded
      ? this.config.stepHeight + this.config.groundProbeDistance
      : this.config.groundProbeDistance
    delta.set(0, -probeDistance, 0)
    const trace = this.findGroundTrace(this.hull, delta, true)

    if (isWalkableGroundTrace(trace, this.minGroundDot)) {
      const snapDelta = trace.endBox.min.y - this.hull.min.y

      if (
        wasGrounded &&
        isTraceMoveResult(trace) &&
        snapDelta < 0 &&
        Math.abs(snapDelta) > this.config.groundSnapEpsilon
      ) {
        this.hull.copy(trace.endBox)
      }

      this.grounded = true
      this.groundNormal.copy(trace.normal)
      return
    }

    this.grounded = false
    this.groundNormal.set(0, 1, 0)
  }

  applyFriction(deltaTime) {
    const speed = Math.hypot(this.velocity.x, this.velocity.z)

    if (speed < 0.1) {
      this.velocity.x = 0
      this.velocity.z = 0
      return
    }

    const drop = speed * this.config.friction * deltaTime
    const newSpeed = Math.max(speed - drop, 0)
    const scale = newSpeed / speed

    this.velocity.x *= scale
    this.velocity.z *= scale
  }

  applyJump(input) {
    if (!input.consumeJump() || !this.grounded) {
      return
    }

    this.velocity.y = this.config.jumpImpulse
    this.grounded = false
  }

  accelerate(deltaTime, input) {
    const axes = input.getMoveAxes()
    wishDirection.set(0, 0, 0)

    euler.set(0, input.yaw, 0)
    forward.set(0, 0, -1).applyEuler(euler)
    right.set(1, 0, 0).applyEuler(euler)

    wishDirection
      .addScaledVector(forward, axes.forward)
      .addScaledVector(right, axes.right)

    if (wishDirection.lengthSq() === 0) {
      return
    }

    wishDirection.normalize()

    const maxSpeed = this.grounded ? this.config.maxGroundSpeed : this.config.maxAirSpeed
    const acceleration = this.grounded ? this.config.groundAcceleration : this.config.airAcceleration
    const currentSpeed = this.velocity.dot(wishDirection)
    const addSpeed = maxSpeed - currentSpeed

    if (addSpeed <= 0) {
      return
    }

    const accelerationSpeed = Math.min(acceleration * maxSpeed * deltaTime, addSpeed)
    this.velocity.addScaledVector(wishDirection, accelerationSpeed)
  }

  walkMove(deltaTime) {
    this.velocity.y = 0
    delta.copy(this.velocity).multiplyScalar(deltaTime)

    if (delta.lengthSq() === 0) {
      this.stayOnGround()
      return
    }

    const firstTrace = this.collider.traceBox(this.hull, delta)

    if (firstTrace.fraction === 1) {
      this.hull.copy(firstTrace.endBox)
      this.stayOnGround()
      return
    }

    this.stepMove(deltaTime, firstTrace)
    this.stayOnGround()
  }

  airMove(deltaTime) {
    this.tryPlayerMove(deltaTime)
  }

  tryPlayerMove(deltaTime, firstTrace = null) {
    const originalVelocity = this.moveOriginalVelocity.copy(this.velocity)
    const primalVelocity = this.movePrimalVelocity.copy(this.velocity)
    const planes = this.clipPlanes
    planes.length = 0
    let timeLeft = deltaTime
    let totalFraction = 0

    for (let bump = 0; bump < this.config.maxClipBumps; bump += 1) {
      if (this.velocity.lengthSq() === 0) {
        break
      }

      delta.copy(this.velocity).multiplyScalar(timeLeft)
      const trace = firstTrace && bump === 0 ? firstTrace : this.collider.traceBox(this.hull, delta)
      firstTrace = null
      totalFraction += trace.fraction

      if (trace.allSolid) {
        this.velocity.set(0, 0, 0)
        this.stuck = true
        return
      }

      if (trace.fraction > 0) {
        if (bump > 0 && trace.fraction === 1 && this.isHullStuck(trace.endBox)) {
          this.velocity.set(0, 0, 0)
          this.stuck = true
          break
        }

        this.hull.copy(trace.endBox)
        originalVelocity.copy(this.velocity)
        planes.length = 0
      }

      if (trace.fraction === 1 || !trace.normal) {
        break
      }

      this.contacts.push(this.writeContact(trace))

      timeLeft -= timeLeft * trace.fraction
      planes.push(trace.normal)

      if (planes.length >= this.config.maxClipPlanes) {
        this.velocity.set(0, 0, 0)
        break
      }

      let clipped = false

      for (let i = 0; i < planes.length; i += 1) {
        clipVelocity(originalVelocity, planes[i], clipResult)

        let valid = true

        for (let j = 0; j < planes.length; j += 1) {
          if (j !== i && clipResult.dot(planes[j]) < 0) {
            valid = false
            break
          }
        }

        if (valid) {
          this.velocity.copy(clipResult)
          clipped = true
          break
        }
      }

      if (!clipped) {
        if (planes.length !== 2) {
          this.velocity.set(0, 0, 0)
          break
        }

        creaseDirection.crossVectors(planes[0], planes[1]).normalize()
        this.velocity.copy(creaseDirection).multiplyScalar(this.velocity.dot(creaseDirection))
      }

      if (this.velocity.dot(primalVelocity) <= 0) {
        this.velocity.set(0, 0, 0)
        break
      }
    }

    if (totalFraction === 0) {
      this.velocity.set(0, 0, 0)
    }
  }

  stepMove(deltaTime, firstTrace) {
    const startHull = this.stepStartHull.copy(this.hull)
    const startVelocity = this.stepStartVelocity.copy(this.velocity)
    const startX = this.hull.min.x
    const startZ = this.hull.min.z

    this.tryPlayerMove(deltaTime, firstTrace)
    const downHull = this.stepDownHull.copy(this.hull)
    const downVelocity = this.stepDownVelocity.copy(this.velocity)

    this.hull.copy(startHull)
    this.velocity.copy(startVelocity)

    delta.set(0, this.config.stepHeight + this.config.traceEpsilon, 0)
    const upTrace = this.collider.traceBox(this.hull, delta)

    if (!upTrace.startSolid && !upTrace.allSolid) {
      this.hull.copy(upTrace.endBox)
    }

    this.tryPlayerMove(deltaTime)

    delta.set(0, -(this.config.stepHeight + this.config.traceEpsilon), 0)
    const downTrace = this.collider.traceBox(this.hull, delta)

    if (!isWalkableTrace(downTrace, this.minGroundDot)) {
      this.hull.copy(downHull)
      this.velocity.copy(downVelocity)
      return
    }

    this.hull.copy(downTrace.endBox)

    const downDistance = horizontalDistanceSq(downHull, startX, startZ)
    const upDistance = horizontalDistanceSq(this.hull, startX, startZ)

    if (downDistance > upDistance) {
      this.hull.copy(downHull)
      this.velocity.copy(downVelocity)
      return
    }

    this.velocity.y = downVelocity.y
  }

  stayOnGround() {
    const startMinY = this.hull.min.y
    delta.set(0, this.config.groundLiftDistance, 0)
    const upTrace = this.collider.traceBox(this.hull, delta)
    const raisedHull = upTrace.endBox

    delta.set(0, -(this.config.stepHeight + this.config.groundLiftDistance), 0)
    const downTrace = this.findGroundTrace(raisedHull, delta, false)

    if (isWalkableTrace(downTrace, this.minGroundDot)) {
      if (Math.abs(downTrace.endBox.min.y - startMinY) > this.config.groundSnapEpsilon) {
        this.hull.copy(downTrace.endBox)
      }

      this.grounded = true
      this.groundNormal.copy(downTrace.normal)
    }
  }

  findGroundTrace(hull, traceDelta, useQuadrants) {
    const trace = this.collider.traceBox(hull, traceDelta)

    if (isWalkableGroundTrace(trace, this.minGroundDot) || !useQuadrants) {
      return trace
    }

    return this.tryGroundQuadrants(traceDelta, trace, hull)
  }

  tryGroundQuadrants(traceDelta, originalTrace, sourceHull = this.hull) {
    const minX = sourceHull.min.x
    const maxX = sourceHull.max.x
    const minZ = sourceHull.min.z
    const maxZ = sourceHull.max.z
    const centerX = (minX + maxX) * 0.5
    const centerZ = (minZ + maxZ) * 0.5

    for (let quadrant = 0; quadrant < 4; quadrant += 1) {
      const quadMinX = quadrant === 1 || quadrant === 3 ? centerX : minX
      const quadMaxX = quadrant === 1 || quadrant === 3 ? maxX : centerX
      const quadMinZ = quadrant === 1 || quadrant === 2 ? centerZ : minZ
      const quadMaxZ = quadrant === 1 || quadrant === 2 ? maxZ : centerZ

      quadrantHull.min.set(quadMinX, sourceHull.min.y, quadMinZ)
      quadrantHull.max.set(quadMaxX, sourceHull.max.y, quadMaxZ)

      const trace = this.collider.traceBox(quadrantHull, traceDelta)

      if (isWalkableGroundTrace(trace, this.minGroundDot)) {
        return {
          ...trace,
          fraction: originalTrace ? originalTrace.fraction : trace.fraction,
          startSolid: originalTrace ? originalTrace.startSolid : trace.startSolid,
          allSolid: originalTrace ? originalTrace.allSolid : trace.allSolid,
          endBox: originalTrace ? originalTrace.endBox : trace.endBox,
        }
      }
    }

    return originalTrace
  }

  writeContact(trace) {
    const index = this.contacts.length
    const contact = this.contactPool[index] || {
      point: new THREE.Vector3(),
      normal: new THREE.Vector3(),
      depth: 0,
    }

    if (!this.contactPool[index]) {
      this.contactPool[index] = contact
    }

    this.hull.getCenter(contact.point)
    contact.normal.copy(trace.normal)
    contact.depth = trace.depth

    return contact
  }

  isHullStuck(hull) {
    if (this.collider.testBox) {
      return Boolean(this.collider.testBox(hull))
    }

    return Boolean(this.collider.boxIntersect(hull))
  }

  refreshPosition() {
    this.position.set(
      (this.hull.min.x + this.hull.max.x) * 0.5,
      this.hull.min.y,
      (this.hull.min.z + this.hull.max.z) * 0.5
    )
  }
}

function clipVelocity(input, normal, output) {
  const backoff = input.dot(normal)

  output.copy(input).addScaledVector(normal, -backoff)

  const adjust = output.dot(normal)

  if (adjust < 0) {
    output.addScaledVector(normal, -adjust)
  }

  return output
}

function isWalkableTrace(trace, minGroundDot) {
  return (
    trace &&
    !trace.startSolid &&
    !trace.allSolid &&
    trace.fraction < 1 &&
    trace.normal &&
    trace.normal.dot(UP) >= minGroundDot
  )
}

function isWalkableGroundTrace(trace, minGroundDot) {
  return (
    trace &&
    !trace.startSolid &&
    !trace.allSolid &&
    trace.normal &&
    trace.normal.dot(UP) >= minGroundDot
  )
}

function isTraceMoveResult(trace) {
  return trace && trace.fraction > 0 && trace.fraction < 1 && !trace.startSolid && !trace.allSolid
}

function horizontalDistanceSq(hull, startX, startZ) {
  const deltaX = hull.min.x - startX
  const deltaZ = hull.min.z - startZ

  return deltaX * deltaX + deltaZ * deltaZ
}
