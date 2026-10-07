import { createClient } from '@supabase/supabase-js'
import { reorganiserOrdres } from './_ordres.js'

// Remet l'ordre de choix des matchs à venir (sans choix) en règle. Sans danger à
// appeler souvent : si tout est déjà correct, il ne change rien. Le site l'appelle
// à l'ouverture, et le cron creer-matchs-a-venir le fait aussi.
export async function handler() {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
  try {
    const changements = await reorganiserOrdres(supabase)
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ modifies: changements.length }),
    }
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) }
  }
}
