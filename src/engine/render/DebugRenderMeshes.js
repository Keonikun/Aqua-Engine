import * as THREE from 'three'

const hiddenCollisionMaterial = new THREE.MeshBasicMaterial({ visible: false })
const collisionBrushDebugMaterial = new THREE.MeshBasicMaterial({
  color: '#75d3c8',
  wireframe: true,
  transparent: true,
  opacity: 0.78,
  depthWrite: false,
})
const triggerBrushDebugMaterial = new THREE.MeshBasicMaterial({
  color: '#d875ff',
  wireframe: true,
  transparent: true,
  opacity: 0.72,
  depthWrite: false,
})

export function createCollisionMesh(renderMesh, resources) {
  const collisionMesh = renderMesh.clone()

  collisionMesh.geometry = renderMesh.geometry
  collisionMesh.material = hiddenCollisionMaterial
  collisionMesh.name = `${renderMesh.name}_collision`
  collisionMesh.userData = cloneUserData(renderMesh.userData)
  resources?.trackObject(collisionMesh)

  return collisionMesh
}

export function createCollisionDebugMesh(renderMesh, resources) {
  const debugMesh = renderMesh.clone()

  debugMesh.geometry = renderMesh.geometry
  debugMesh.material = collisionBrushDebugMaterial
  debugMesh.name = `${renderMesh.name}_debug`
  debugMesh.userData = cloneUserData(renderMesh.userData)
  debugMesh.renderOrder = 10
  resources?.trackObject(debugMesh)

  return debugMesh
}

export function createTriggerVolumeMesh(renderMesh, resources) {
  const triggerMesh = renderMesh.clone()

  triggerMesh.geometry = renderMesh.geometry
  triggerMesh.material = hiddenCollisionMaterial
  triggerMesh.name = `${renderMesh.name}_trigger`
  triggerMesh.userData = {
    ...cloneUserData(renderMesh.userData),
    collisionKind: 'none',
    trigger: true,
  }
  resources?.trackObject(triggerMesh)

  return triggerMesh
}

export function createTriggerDebugMesh(renderMesh, resources) {
  const debugMesh = renderMesh.clone()

  debugMesh.geometry = renderMesh.geometry
  debugMesh.material = triggerBrushDebugMaterial
  debugMesh.name = `${renderMesh.name}_trigger_debug`
  debugMesh.userData = cloneUserData(renderMesh.userData)
  debugMesh.renderOrder = 11
  resources?.trackObject(debugMesh)

  return debugMesh
}

function cloneUserData(userData) {
  return JSON.parse(JSON.stringify(userData || {}))
}
