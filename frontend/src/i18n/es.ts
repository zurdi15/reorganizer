// Barrel del locale es — DESVIACIÓN DELIBERADA respecto a berserk (que usa
// un único es.ts monolítico): los mensajes viven en ficheros por dominio
// (i18n/es/<dominio>.ts) para que oleadas de agentes en paralelo puedan
// añadir claves sin pisarse en un mismo fichero central. Este barrel solo
// ensambla; messages.spec.ts garantiza que es/en comparten árbol de claves.
import { common } from './es/common'
import { errors } from './es/errors'
import { history } from './es/history'
import { organize } from './es/organize'
import { settings } from './es/settings'
import { shell } from './es/shell'
import { upload } from './es/upload'

export const es = { common, shell, upload, organize, history, settings, errors }
