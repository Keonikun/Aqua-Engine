import './style.css'
import { bootClient } from './bootClient.js'

const engine = await bootClient(document.querySelector('#app'))

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    engine.stop()
    window.aquaEngine = null
  })
}
