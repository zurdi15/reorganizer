# Fixtures de vídeo

Vídeos diminutos (~2 KB) commiteados para los tests de `test_metadata.py`.
Generados UNA vez con ffmpeg (n8.1.2) — no se regeneran en CI:

```bash
# tiny-h.mp4 — 64x32 horizontal, con creation_time (formato y stream)
ffmpeg -f lavfi -i testsrc=size=64x32:duration=0.1:rate=10 -pix_fmt yuv420p \
  -metadata creation_time=2024-08-15T10:00:00Z tiny-h.mp4

# tiny-v.mp4 — 32x64 vertical, sin tags de fecha
ffmpeg -f lavfi -i testsrc=size=32x64:duration=0.1:rate=10 -pix_fmt yuv420p tiny-v.mp4

# tiny-rot90.mp4 — 64x32 con display matrix rotation=90 (remux con -display_rotation)
ffmpeg -f lavfi -i testsrc=size=64x32:duration=0.1:rate=10 -pix_fmt yuv420p base-tmp.mp4
ffmpeg -display_rotation 90 -i base-tmp.mp4 -c copy tiny-rot90.mp4
rm base-tmp.mp4
```

Nota: en ffmpeg moderno (>=5) el tag legacy `-metadata:s:v:0 rotate=90` ya NO
sobrevive al mux mp4 — la rotación se declara con `-display_rotation` (opción
de entrada + `-c copy`), que escribe la display matrix como side data. ffprobe
la reporta en `streams[].side_data_list[].rotation`. Los JPEG/HEIC con EXIF no
se commitean: se generan en los propios tests con Pillow.

Verificación rápida:

```bash
ffprobe -v error -print_format json -show_format -show_streams tiny-rot90.mp4
```
