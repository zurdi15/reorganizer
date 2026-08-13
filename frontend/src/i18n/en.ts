// Barrel del locale en — ver el why-comment de es.ts (ficheros por dominio
// para paralelizar oleadas de agentes sin conflictos).
import { common } from './en/common'
import { errors } from './en/errors'
import { history } from './en/history'
import { organize } from './en/organize'
import { settings } from './en/settings'
import { shell } from './en/shell'
import { upload } from './en/upload'

export const en = { common, shell, upload, organize, history, settings, errors }
