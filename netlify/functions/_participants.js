// SOURCE UNIQUE pour les participants du pool : le site (src/) et toutes les
// fonctions Netlify lisent cette liste. Pour ajouter quelqu'un : une seule
// ligne dans PARTICIPANTS (son ID vient de Supabase > Authentication > Users).
// L'ordre de la liste = l'ordre de choix du PREMIER match de la saison. Ensuite
// la rotation se fait toute seule (le 1er passe à la fin à chaque match), peu
// importe le nombre de participants.
// `serie` = nom de la couleur de sa courbe (--serie-<nom> dans App.css).
export const PARTICIPANTS = [
  { id: '47c5e9ed-8e57-4933-a1f9-509627195cae', nom: 'Sylvain', couleur: '#1f9d55', serie: 'sylvain' },
  { id: '0918539e-788e-4ed9-9c84-b8f39b83f05c', nom: 'Père', couleur: '#c9971f', serie: 'pere' },
  { id: '58220e78-2226-4983-a026-3abefc8431a7', nom: 'Mike', couleur: '#2f5bb8', serie: 'mike' },
  { id: 'b5c5d9e5-1c91-4da8-ab5e-adcc40057090', nom: 'Eric', couleur: '#ce0e2d', serie: 'eric' },
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

export function rotationGauche(ordre) {
  const o = completerOrdre(ordre)
  return o.length > 1 ? [...o.slice(1), o[0]] : o
}

export function memeOrdre(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i])
}

// Vrai si l'ordre contient exactement tous les participants actuels.
export function ordreComplet(ordre) {
  return (
    Array.isArray(ordre) &&
    ordre.length === ORDRE_BASE.length &&
    ORDRE_BASE.every((id) => ordre.includes(id))
  )
}

// Recalcule l'ordre de choix des matchs d'une saison (triés par date).
// - Un match déjà commencé/terminé OU qui a déjà des choix est "figé" : on n'y touche
//   pas (sauf pour y ajouter un nouveau participant à la fin, s'il n'a pas commencé).
// - Les autres suivent la rotation : 1er match de la saison = ORDRE_BASE, puis chaque
//   match = l'ordre du précédent, le 1er passant à la fin.
// - Un match figé qui date d'avant l'arrivée d'un participant (ordre incomplet)
//   remet la rotation à zéro pour la suite.
// Retourne seulement les changements à écrire : [{ id, ordre }].
export function recalculerOrdres(matchs, idsAvecChoix, maintenant = new Date()) {
  const changements = []
  let precedent = null
  for (const m of matchs) {
    const brut = Array.isArray(m.ordre_choix) ? m.ordre_choix : []
    const commence = new Date(m.date_match) <= maintenant
    const fige = m.statut !== 'a_venir' || commence || idsAvecChoix.has(String(m.id))
    if (!fige) {
      const attendu = precedent ? rotationGauche(precedent) : [...ORDRE_BASE]
      if (!memeOrdre(brut, attendu)) changements.push({ id: m.id, ordre: attendu })
      precedent = attendu
    } else if (ordreComplet(brut)) {
      precedent = brut
    } else {
      precedent = null
      if (m.statut === 'a_venir' && !commence) {
        const complete = completerOrdre(brut)
        if (!memeOrdre(complete, brut)) changements.push({ id: m.id, ordre: complete })
      }
    }
  }
  return changements
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
