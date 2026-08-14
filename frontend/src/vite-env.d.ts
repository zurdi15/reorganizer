/// <reference types="vite/client" />

interface ImportMetaEnv {
  // versión inyectada por el workflow de release desde el tag (build-arg
  // APP_VERSION → ENV en el Dockerfile); ausente en dev
  readonly VITE_APP_VERSION?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
