const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { type, user_id } = req.query;

  try {
    if (type === "athletes") {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/users?select=*&order=updated_at.desc`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
      );
      const athletes = await r.json();

      const enriched = await Promise.all(athletes.map(async (a) => {
        const sr = await fetch(
          `${SUPABASE_URL}/rest/v1/workout_sessions?user_id=eq.${a.id}&order=created_at.desc&limit=3`,
          { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
        );
        const sessions = await sr.json();
        return { ...a, sessions };
      }));

      return res.status(200).json(enriched);
    }

    if (type === "sessions" && user_id) {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/workout_sessions?user_id=eq.${user_id}&order=created_at.desc&limit=30`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
      );
      return res.status(200).json(await r.json());
    }

    if (type === "stats") {
      const [ar, sr] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/users?select=id`, {
          headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, Prefer: "count=exact" }
        }),
        fetch(`${SUPABASE_URL}/rest/v1/workout_sessions?select=id&created_at=gte.${new Date(Date.now()-7*864e5).toISOString()}`, {
          headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, Prefer: "count=exact" }
        }),
      ]);
      const totalAthletes = ar.headers.get("content-range")?.split("/")[1] ?? "0";
      const weekSessions = sr.headers.get("content-range")?.split("/")[1] ?? "0";
      return res.status(200).json({ total_athletes: totalAthletes, week_sessions: weekSessions });
    }

    return res.status(400).json({ error: "Unknown type" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
