import { createClient } from '@supabase/supabase-js'

export const config = {
  schedule: '0 6 * * 1', // chaque lundi à 6h UTC (~1-2h du matin heure de l'Est)
}

// Vide complètement le chat "Jasette" une fois par semaine pour ne pas
// accumuler les vieux messages indéfiniment.
export async function handler() {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)

  try {
    const { error } = await supabase
      .from('messages_chat')
      .delete()
      .gte('id', 0) // supprime toutes les lignes

    if (error) throw error

    return { statusCode: 200, body: JSON.stringify({ message: 'Chat vidé' }) }
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) }
  }
}
