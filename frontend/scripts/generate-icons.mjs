// Rasteriza los SVG del icono a los PNG que exige el manifest PWA.
// El fondo coincide con bg-void del tema oscuro (#0C0C0E → rgb 12,12,14):
// el hex vive duplicado aquí a propósito — sharp no puede importar
// tokens/index.ts sin arrastrar toda la toolchain de TS a este script.
import sharp from 'sharp'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const publicDir = path.join(__dirname, '..', 'public', 'icons')

const sizes = [
  { name: 'pwa-192.png', size: 192 },
  { name: 'pwa-512.png', size: 512 },
  { name: 'maskable-512.png', size: 512 },
]

async function generateIcons() {
  for (const { name, size } of sizes) {
    const outputPath = path.join(publicDir, name)
    const svgPath = path.join(
      publicDir,
      name.includes('maskable') ? 'reorganizer-maskable.svg' : 'reorganizer.svg',
    )

    try {
      await sharp(svgPath)
        .resize(size, size, { fit: 'contain', background: { r: 12, g: 12, b: 14, alpha: 1 } })
        .png()
        .toFile(outputPath)
      console.log(`✓ Generated ${name} (${size}x${size})`)
    } catch (error) {
      console.error(`✗ Failed to generate ${name}:`, error.message)
      process.exitCode = 1
    }
  }
}

generateIcons()
