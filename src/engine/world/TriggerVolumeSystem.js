import * as THREE from 'three'

const scratchPlayerBox = new THREE.Box3()

export class TriggerVolumeSystem {
  constructor({ eventTarget = window } = {}) {
    this.eventTarget = eventTarget
    this.volumes = []
    this.activeVolumeIds = new Set()
  }

  buildFromSceneObject(sceneObject) {
    this.volumes.length = 0
    this.activeVolumeIds.clear()

    sceneObject?.updateMatrixWorld(true)
    sceneObject?.traverse((child) => {
      if (!child.isMesh || !child.geometry || !child.userData?.trigger) {
        return
      }

      this.volumes.push(createTriggerVolume(child, this.volumes.length))
    })
  }

  update(playerBox) {
    if (!playerBox || this.volumes.length === 0) {
      return []
    }

    scratchPlayerBox.copy(playerBox)
    const events = []
    const nextActiveVolumeIds = new Set()

    for (const volume of this.volumes) {
      if (!volume.bounds.intersectsBox(scratchPlayerBox)) {
        continue
      }

      nextActiveVolumeIds.add(volume.id)

      const phase = this.activeVolumeIds.has(volume.id) ? 'stay' : 'enter'
      events.push(createTriggerEvent(volume, phase))
    }

    for (const volumeId of this.activeVolumeIds) {
      if (nextActiveVolumeIds.has(volumeId)) {
        continue
      }

      const volume = this.volumes.find((candidate) => candidate.id === volumeId)

      if (volume) {
        events.push(createTriggerEvent(volume, 'exit'))
      }
    }

    this.activeVolumeIds = nextActiveVolumeIds

    for (const event of events) {
      this.dispatch(event)
    }

    return events
  }

  dispatch(event) {
    if (!this.eventTarget?.dispatchEvent || typeof CustomEvent !== 'function') {
      return
    }

    this.eventTarget.dispatchEvent(new CustomEvent('aqua:trigger', { detail: event }))
  }
}

function createTriggerVolume(mesh, index) {
  const id = String(mesh.userData.triggerId || mesh.userData.aqua_trigger_id || mesh.name || `trigger_${index}`)
  const bounds = new THREE.Box3().setFromObject(mesh)

  return {
    id,
    name: mesh.name || id,
    bounds,
    event: mesh.userData.triggerEvent || mesh.userData.aqua_trigger_event || 'trigger',
    type: mesh.userData.triggerType || mesh.userData.aqua_trigger_type || 'generic',
    payload: mesh.userData.triggerPayload || mesh.userData.aqua_trigger_payload || null,
    userData: JSON.parse(JSON.stringify(mesh.userData || {})),
  }
}

function createTriggerEvent(volume, phase) {
  return {
    phase,
    id: volume.id,
    name: volume.name,
    event: volume.event,
    type: volume.type,
    payload: volume.payload,
    bounds: {
      min: volume.bounds.min.toArray(),
      max: volume.bounds.max.toArray(),
    },
    userData: volume.userData,
  }
}
