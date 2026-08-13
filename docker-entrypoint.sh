#!/bin/sh
# Entrypoint: adapta el usuario del proceso a la propiedad de los archivos del
# host (patrón PUID/PGID, estilo linuxserver.io).
#
# Por qué existe: /input y /output son carpetas del host con los media del
# usuario; los archivos que la app mueva/copie deben quedar con SU uid/gid, no
# con uno inventado por la imagen. La versión antigua lo "resolvía" con un
# sudo chown recursivo desde dentro de la app — lento, destruía la propiedad
# real de la librería y regalaba root; ese hack está eliminado: aquí jamás se
# toca la propiedad de los media, es el proceso el que se adapta.
set -eu

# Camino pure-non-root: si compose arrancó el contenedor con `user:`, ya
# corremos sin privilegios y no hay nada que remapear (ni podríamos).
if [ "$(id -u)" != "0" ]; then
  exec "$@"
fi

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

# Remapear el usuario rg de la imagen al uid/gid pedido. -o (non-unique)
# permite reutilizar un id que ya exista en /etc/passwd de la imagen.
groupmod -o -g "$PGID" rg
usermod -o -u "$PUID" rg

# Solo /data (DB + thumbs, estado nuestro) y no recursivo a propósito: basta
# con que el directorio raíz sea escribible — lo de dentro lo creó la propia
# app con el uid efectivo — y un /data con miles de thumbs no debe pagar un
# chown completo en cada arranque. NUNCA /input ni /output (media del host).
chown rg:rg /data

# gosu y no su/sudo: exec directo, sin proceso intermedio ni TTY, y las
# señales (SIGTERM de docker stop) llegan a uvicorn sin intermediarios.
exec gosu rg "$@"
