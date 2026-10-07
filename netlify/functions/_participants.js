// SOURCE UNIQUE pour les participants du pool : le site (src/) et toutes les
// fonctions Netlify lisent cette liste. Pour ajouter quelqu'un : une seule
// ligne dans PARTICIPANTS (son ID vient de Supabase > Authentication > Users).
// L'ordre de la liste = l'ordre de base du match 1. La rotation se fait
// ensuite toute seule, peu importe le nombre de participants.
// `serie` = nom de la couleur de sa courbe (--serie-<nom> dans App.css).
export const PARTICIPANTS = [
  { id: '0918539e-788e-4ed9-9c84-b8f39b83f05c', nom: 'Père', couleur: '#c9971f', serie: 'pere' },
  { id: '58220e78-2226-4983-a026-3abefc8431a7', nom: 'Mike', couleur: '#2f5bb8', serie: 'mike' },
  { id: 'b5c5d9e5-1c91-4da8-ab5e-adcc40057090', nom: 'Eric', couleur: '#ce0e2d', serie: 'eric' },
  { id: '47c5e9ed-8e57-4933-a1f9-509627195cae', nom: 'Sylvain', couleur: '#1f9d55', serie: 'sylvain' },
]

export const ORDRE_BASE = PARTICIPANTS.map((p) => p.id)

export const NOMS = Object.fromEntries(PARTICIPANTS.map((p) => [p.id, p.nom]))

// Seul compte autorisé à envoyer des annonces à tout le monde (Eric).
export const ADMIN_ID = 'b5c5d9e5-1c91-4da8-ab5e-adcc40057090'

export function ordreChoixPourMatch(numeroMatch) {
  const decalage = (numeroMatch - 1) % ORDRE_BASE.length
  return [...ORDRE_BASE.slice(decalage), ...ORDRE_BASE.slice(0, decalage)]
}

// Un match créé avant l'arrivée d'un nouveau participant n'a pas son nom dans
// l'ordre de choix : on l'ajoute à la fin (et on garde l'ordre déjà prévu).
export function completerOrdre(ordre) {
  const base = Array.isArray(ordre) ? ordre : []
  const manquants = ORDRE_BASE.filter((id) => !base.includes(id))
  return manquants.length > 0 ? [...base, ...manquants] : base
}

// L'API de la NHL utilise DEUX états pour un match terminé : "FINAL" juste
// après la fin, puis "OFF" une fois le pointage officialisé. Oublier "FINAL"
// fait que le match paraît encore à venir pendant quelques heures.
export function matchTermine(gameState) {
  return gameState === 'OFF' || gameState === 'FINAL'
}

// Calcule la saison NHL en cours au format "20262027" et le début de saison
// (1er juillet) pour filtrer les données par saison automatiquement, sans
// qu'aucune mise à jour manuelle ne soit nécessaire d'année en année.
export function saisonEnCours(date = new Date()) {
  const mois = date.getUTCMonth() // 0 = janvier
  const anneeDebut = mois >= 6 ? date.getUTCFullYear() : date.getUTCFullYear() - 1
  return {
    codeApi: `${anneeDebut}${anneeDebut + 1}`,
    libelle: `${anneeDebut}-${anneeDebut + 1}`,
    debutSaison: new Date(Date.UTC(anneeDebut, 6, 1)), // 1er juillet
  }
}
