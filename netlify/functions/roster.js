// Retourne l'alignement actuel du Canadien de Montréal
export async function handler() {
  try {
    const res = await fetch('https://api-web.nhle.com/v1/roster/MTL/current')
    const data = await res.json()

    const joueurs = [
      ...data.forwards,
      ...data.defensemen,
      ...data.goalies,
    ].map((j) => ({
      nhl_id: j.id,
      nom: `${j.firstName.default} ${j.lastName.default}`,
      numero: j.sweaterNumber,
      position: j.positionCode,
    }))

    joueurs.sort((a, b) => a.nom.localeCompare(b.nom))

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ joueurs }),
    }
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    }
  }
}
