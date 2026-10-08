// Même calcul que calculer-points.js, mais appelable par URL.
// Netlify interdit d'appeler une fonction PLANIFIÉE (calculer-points, aux 15 minutes)
// par son adresse : le bouton « Bouton à Pa! » du site passe donc par cette
// fonction-ci, qui n'est pas planifiée. Rien n'est dupliqué : la logique reste
// dans calculer-points.js (et un match n'est jamais calculé ni annoncé deux fois).
import { handler as calculerPoints } from './calculer-points.js'

export async function handler(event, context) {
  return calculerPoints(event, context)
}
