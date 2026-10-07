// Retourne les buts et passes de chaque patineur d'un match, en direct, à
// partir du boxscore de la NHL. Sert à afficher des points PROVISOIRES
// pendant le match : rien n'est écrit en base ici, le calcul officiel reste
// celui de calculer-points (une fois le match terminé).
export async function handler(event) {
  const id = event.queryStringParameters?.id
  if (!id || !/^\d+$/.test(id)) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ error: 'Paramètre id manquant ou invalide.' }),
    }
  }

  try {
    const res = await fetch(`https://api-web.nhle.com/v1/gamecenter/${id}/boxscore`)
    if (!res.ok) throw new Error(`NHL HTTP ${res.status}`)
    const boxscore = await res.json()

    const stats = {}
    for (const cote of ['awayTeam', 'homeTeam']) {
      const patineurs = [
        ...(boxscore.playerByGameStats?.[cote]?.forwards || []),
        ...(boxscore.playerByGameStats?.[cote]?.defense || []),
      ]
      for (const j of patineurs) {
        stats[j.playerId] = { buts: j.goals || 0, passes: j.assists || 0 }
      }
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ statut: boxscore.gameState || null, stats }),
    }
  } catch (err) {
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ error: err.message }),
    }
  }
}
