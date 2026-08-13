// Pila global de "capas flotantes" (sheets y paneles de formulario:
// RgSheet/RgSelect). Con varias abiertas a la vez, un solo Escape debe
// cerrar SOLO la de más arriba, nunca todas de golpe: un RgSelect abierto
// DENTRO de un RgSheet se come el primer Escape él solo, sin que el sheet
// se entere ni se cierre a la vez.
//
// Un módulo aparte (no un composable) a propósito: es estado compartido a
// nivel de aplicación, no por-instancia-de-componente — importarlo desde
// varios componentes siempre resuelve al mismo array, porque los módulos ES
// son singletons.
const stack: symbol[] = []

export function pushLayer(id: symbol): void {
  stack.push(id)
}

export function popLayer(id: symbol): void {
  const idx = stack.indexOf(id)
  if (idx !== -1) stack.splice(idx, 1)
}

export function isTopLayer(id: symbol): boolean {
  return stack.at(-1) === id
}
