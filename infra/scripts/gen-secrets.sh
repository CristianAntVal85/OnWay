#!/bin/sh
# Genera, solo la primera vez, las contraseñas, el secreto CSRF y las claves de los datos sensibles dentro del volumen `secrets`.
# Cada secreto va en su propio directorio para que cada servicio monte solo los que necesita
# (la API no ve la contraseña del propietario del esquema; la base de datos no ve el secreto CSRF).
# Nada de esto está en el repositorio: se crea al azar en tu máquina o en el servidor.
set -eu

root=/secrets
umask 022

gen() {
  dir="$root/$1"
  file="$dir/$2"
  mkdir -p "$dir"
  if [ -s "$file" ]; then
    echo "kept      $1/$2"
    return
  fi
  tmp="$dir/.$2.tmp"
  # 48 bytes del sistema operativo -> 96 caracteres hexadecimales (el secreto CSRF exige >= 32 bytes).
  head -c 48 /dev/urandom | od -An -v -tx1 | tr -d ' \n' >"$tmp"
  chmod 444 "$tmp"
  mv "$tmp" "$file"
  echo "generated $1/$2"
}

gen admin password   # superusuario de PostgreSQL: solo el arranque de la base de datos
gen owner password   # onway_owner: migraciones y datos de demostración
gen app password     # onway_app: la API
gen csrf secret      # clave HMAC de los tokens CSRF
gen sensitive key    # cifrado AES-256-GCM de documento y dirección (H5): si se pierde, se pierden esos datos
gen fingerprint key  # clave HMAC de la huella del documento (INV-24), distinta de la de cifrado
