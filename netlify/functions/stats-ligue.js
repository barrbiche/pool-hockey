// Retourne les statistiques de base de TOUS les patineurs de la LNH pour la
// saison en cours (environ 700-900 joueurs), triés par points. Contrairement
// à stats-equipe.js, pas de tours du chapeau ni de forme récente ici — ça
// demanderait de fouiller chaque match de la ligue au complet (des milliers
// par saison) plutôt que juste les ~80 du Canadien. Juste les totaux de
// saison, qui sont déjà calculés côté NHL — une poignée d'appels au total.
import { saisonEnCours } from './_participants.js'

const TAILLE_PAGE = 100
const MAX_JOUEURS = 1200 // garde-fou : la LNH a ~700-900 patineurs actifs

// fetch avec limite de temps stricte, pour ne pas laisser une page lente
// faire dépasser la coupure de ~10s des fonctions Netlify.
async function fetchJson(url, delaiMs) {
  const controleur = new AbortController()
  const minuterie = setTimeout(() => controleur.abort(), delaiMs)
  try {
    const res = await fetch(url, { signal: controleur.signal })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  } finally {
    clearTimeout(minuterie)
  }
}

function urlPage(codeApiSaison, start) {
  const cayenneExp = encodeURIComponent(`seasonId=${codeApiSaison} and gameTypeId=2`)
  const sort = encodeURIComponent(
    JSON.stringify([
      { property: 'points', direction: 'DESC' },
      { property: 'goals', direction: 'DESC' },
    ])
  )
  return `https://api.nhle.com/stats/rest/en/skater/summary?isAggregate=false&isGame=false&start=${start}&limit=${TAILLE_PAGE}&sort=${sort}&cayenneExp=${cayenneExp}`
}

export async function handler() {
  try {
    const { codeApi } = saisonEnCours()

    // Première page : donne le total de joueurs pour savoir combien de
    // pages suivantes demander.
    const premierePage = await fetchJson(urlPage(codeApi, 0), 6000)
    const lots = [premierePage?.data || []]
    const total = Math.min(premierePage?.total || 0, MAX_JOUEURS)

    const pagesRestantes = Math.max(0, Math.ceil(total / TAILLE_PAGE) - 1)
    if (pagesRestantes > 0) {
      const autresPages = await Promise.all(
        Array.from({ length: pagesRestantes }, (_, i) =>
          fetchJson(urlPage(codeApi, (i + 1) * TAILLE_PAGE), 6000)
        )
      )
      for (const page of autresPages) lots.push(page?.data || [])
    }

    const vus = new Set()
    const joueurs = []
    for (const lot of lots) {
      for (const j of lot) {
        if (!j.playerId || vus.has(j.playerId)) continue
        vus.add(j.playerId)
        joueurs.push({
          playerId: j.playerId,
          nom: j.skaterFullName,
          equipe: j.teamAbbrevs || '',
          position: j.positionCode || '',
          matchs_joues: j.gamesPlayed || 0,
          buts: j.goals || 0,
          passes: j.assists || 0,
          points: j.points || 0,
          plus_minus: j.plusMinus || 0,
          pun: j.penaltyMinutes || 0,
        })
      }
    }

    // Si la NHL retourne une liste vide (pépin passager), surtout ne pas
    // mettre ça en cache — même garde que roster.js et stats-equipe.js.
    if (joueurs.length === 0) {
      return {
        statusCode: 503,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        body: JSON.stringify({ error: 'Liste de joueurs vide reçue de la NHL.', joueurs: [] }),
      }
    }

    joueurs.sort((a, b) => b.points - a.points || b.buts - a.buts)

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=60',
        'Netlify-CDN-Cache-Control': 'public, s-maxage=900, stale-while-revalidate=3600',
      },
      body: JSON.stringify({ joueurs }),
    }
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ error: err.message, joueurs: [] }),
    }
  }
}
