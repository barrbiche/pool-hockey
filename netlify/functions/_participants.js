// Source unique de vérité pour les IDs et l'ordre de rotation.
// Si un compte est recréé et change d'ID, modifier SEULEMENT ici.
export const ORDRE_BASE = [
  '0918539e-788e-4ed9-9c84-b8f39b83f05c', // Père
  '58220e78-2226-4983-a026-3abefc8431a7', // Mike (frère)
  'b5c5d9e5-1c91-4da8-ab5e-adcc40057090', // Eric
]

export const NOMS = {
  '58220e78-2226-4983-a026-3abefc8431a7': 'Mike',
  'b5c5d9e5-1c91-4da8-ab5e-adcc40057090': 'Eric',
  '0918539e-788e-4ed9-9c84-b8f39b83f05c': 'Père',
}

export function ordreChoixPourMatch(numeroMatch) {
  const decalage = (numeroMatch - 1) % 3
  return [...ORDRE_BASE.slice(decalage), ...ORDRE_BASE.slice(0, decalage)]
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
