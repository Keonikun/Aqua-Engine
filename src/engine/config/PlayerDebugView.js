import * as THREE from 'three'

const velocityEnd = new THREE.Vector3()
const hullPosition = new THREE.Vector3()

export class PlayerDebugView {
  constructor({ scene, config }) {
    this.config = config
    this.group = new THREE.Group()
    this.group.name = 'PlayerDebugView'

    this.hullWire = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(config.capsuleRadius * 2, config.capsuleHeight, config.capsuleRadius * 2)),
      new THREE.LineBasicMaterial({ color: '#75d3c8' })
    )
    this.group.add(this.hullWire)

    this.velocityLine = makeLine('#f0cf6a')
    this.group.add(this.velocityLine)

    this.groundLine = makeLine('#8df06a')
    this.group.add(this.groundLine)

    scene.add(this.group)
  }

  update(playerState) {
    if (!this.group.visible) {
      return
    }

    hullPosition.copy(playerState.position)
    hullPosition.y += this.config.capsuleHeight / 2
    this.hullWire.position.copy(hullPosition)

    setLine(
      this.velocityLine,
      playerState.position,
      velocityEnd.copy(playerState.position).addScaledVector(playerState.velocity, 0.18)
    )

    setLine(
      this.groundLine,
      playerState.position,
      velocityEnd.copy(playerState.position).addScaledVector(playerState.groundNormal, 1)
    )
  }

  setVisible(visible) {
    this.group.visible = visible
  }
}

function makeLine(color) {
  return new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
    new THREE.LineBasicMaterial({ color })
  )
}

function setLine(line, start, end) {
  const position = line.geometry.attributes.position
  position.setXYZ(0, start.x, start.y + 0.05, start.z)
  position.setXYZ(1, end.x, end.y + 0.05, end.z)
  position.needsUpdate = true
}
