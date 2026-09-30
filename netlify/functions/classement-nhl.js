// Retourne le classement complet de la LNH (32 équipes), une ligne par
// équipe avec sa division — le regroupement par division se fait côté
// frontend pour l'affichage.
const DIVISIONS_FR = {
  Atlantic: 'Atlantique',
  Metropolitan: 'Métropolitaine',
  Central: 'Centrale',
  Pacific: 'Pacifique',
}

export async function handler() {
  try {
    const res = await fetch('https://api-web.nhle.com/v1/standings/now')
    const data = await res.json()

    const equipes = (data.standings || []).map((t) => ({
      abbrev: t.teamAbbrev?.default || '',
      nom: t.teamCommonName?.default || t.teamName?.default || t.teamAbbrev?.default || '?',
      division: DIVISIONS_FR[t.divisionName] || t.divisionName || '',
      rang_division: t.divisionSequence ?? 99,
      matchs_joues: t.gamesPlayed || 0,
      victoires: t.wins || 0,
      defaites: t.losses || 0,
      defaites_prolongation: t.otLosses || 0,
      points: t.points || 0,
      differentiel: t.goalDifferential ?? 0,
      sequence: t.streakCode ? `${t.streakCode}${t.streakCount || ''}` : '',
    }))

    // Si la NHL retourne une liste vide (pépin passager), surtout ne pas
    // mettre ça en cache — même logique que roster.js et stats-equipe.js.
    if (equipes.length === 0) {
      return {
        statusCode: 503,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        body: JSON.stringify({ error: 'Classement vide reçu de la NHL.', equipes: [] }),
      }
    }

    equipes.sort((a, b) => a.rang_division - b.rang_division)

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        // Le classement bouge après chaque match de chaque équipe de la
        // ligue, mais pas seconde par seconde : même fenêtre de cache que
        // le reste du site (15 min), largement suffisant.
        'Cache-Control': 'public, max-age=60',
        'Netlify-CDN-Cache-Control': 'public, s-maxage=900, stale-while-revalidate=3600',
      },
      body: JSON.stringify({ equipes }),
    }
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ error: err.message, equipes: [] }),
    }
  }
}
