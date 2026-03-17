const GROQ_API_KEY = process.env.GROQ_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

const SYSTEM_PROMPT = `אתה OMNI-COACH v6.2 — סוכן אימונים מבוסס ראיות לאוכלוסייה כללית.
אתה מקבל נתוני משתמש ומייצר תוכנית אימון מותאמת אישית בעברית בלבד.
החזר JSON תקין בלבד — ללא markdown, ללא backticks, ללא טקסט נוסף.

סכמת JSON (החזר בדיוק את המבנה הזה):
{
  "session_metadata": {
    "status": "APPROVED",
    "environment": "GYM_FULL",
    "format": "straight_sets",
    "total_estimated_time_mins": 45,
    "calculated_readiness_score": 7.5,
    "rpe_cap": 8,
    "goal": "hypertrophy",
    "block_phase": "hypertrophy",
    "microcycle_day": "upper",
    "system_adjustments": ["התאמה 1"]
  },
  "phases": [
    {
      "phase": "warmup",
      "label": "חימום",
      "exercises": [
        {
          "id": "MB_001",
          "he_name": "שם התרגיל",
          "sets": 1,
          "target_reps": "60 שניות",
          "target_weight_kg": null,
          "rest_sec": 0,
          "technique_cues": ["טיפ טכני"],
          "cue_muscle_mind": "חיבור מוח שריר",
          "cue_breathing": "הנחיות נשימה",
          "prescriptive_cue": "הוראה מרכזית",
          "safety_flag": null,
          "coaching_note": null
        }
      ]
    },
    {
      "phase": "main",
      "label": "עיקרי",
      "exercises": []
    },
    {
      "phase": "core",
      "label": "ליבה",
      "exercises": []
    },
    {
      "phase": "cooldown",
      "label": "קירור",
      "exercises": []
    }
  ],
  "post_workout_state_updates": {
    "recommended_next_session_focus": "lower",
    "next_deload_eta_weeks": 3,
    "flags_for_review": [],
    "coach_summary": "סיכום למאמן"
  }
}`;

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    let userData = req.body;
    if (typeof userData === "string") {
      try { userData = JSON.parse(userData); } catch(e) { userData = {}; }
    }
    if (!userData || typeof userData !== "object") userData = {};

    if (!GROQ_API_KEY) {
      return res.status(500).json({ success: false, error: "GROQ_API_KEY חסר ב-Vercel Environment Variables" });
    }

    const userPrompt = `צור תוכנית אימון מלאה לפי OMNI-COACH v6.2:
שם: ${userData.name || "ספורטאי"} | גיל: ${userData.age || 30} | משקל: ${userData.weight || 70}ק"ג
רמה: ${userData.level || "beginner"} | מטרה: ${userData.goal || "general_fitness"}
זמן: ${userData.available_time || 45} דקות | מיקום: ${userData.location || "gym"}
ציוד: ${userData.equipment || "bodyweight"} | פציעות: ${userData.injuries || "אין"}
תחושה: ${userData.subjective_feel || 7}/10 | שינה: ${userData.sleep_hours || 7}ש | סטרס: ${userData.stress_level || 4}/10
תזונה: ${userData.nutrition_status || "adequate"} | ימים מאחרון: ${userData.days_since_workout || 1}
שרירים באחרון: ${userData.last_muscles || "רגליים"} | עצימות: ${userData.last_intensity || "moderate"}
החזר JSON בלבד.`;

    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.7,
        max_tokens: 4096,
        response_format: { type: "json_object" },
      }),
    });

    if (!groqRes.ok) {
      const errText = await groqRes.text();
      return res.status(500).json({ success: false, error: `Groq שגיאה ${groqRes.status}`, details: errText });
    }

    const groqData = await groqRes.json();
    const raw = groqData.choices?.[0]?.message?.content;

    if (!raw) {
      return res.status(500).json({ success: false, error: "תגובה ריקה מ-Groq" });
    }

    const workout = JSON.parse(raw);

    // Save to Supabase
    if (SUPABASE_URL && SUPABASE_KEY) {
      try {
        const userId = userData.user_id || crypto.randomUUID();
        await fetch(`${SUPABASE_URL}/rest/v1/users`, {
          method: "POST",
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
            "Content-Type": "application/json",
            Prefer: "resolution=merge-duplicates",
          },
          body: JSON.stringify({
            id: userId,
            name: userData.name,
            level: userData.level,
            goal: userData.goal,
            age: parseInt(userData.age) || null,
            weight_kg: parseFloat(userData.weight) || null,
            updated_at: new Date().toISOString(),
          }),
        });
        await fetch(`${SUPABASE_URL}/rest/v1/workout_sessions`, {
          method: "POST",
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
            "Content-Type": "application/json",
            Prefer: "return=representation",
          },
          body: JSON.stringify({
            user_id: userId,
            user_name: userData.name,
            status: workout.session_metadata?.status,
            environment: workout.session_metadata?.environment,
            goal: workout.session_metadata?.goal,
            readiness_score: workout.session_metadata?.calculated_readiness_score,
            estimated_time_mins: workout.session_metadata?.total_estimated_time_mins,
            workout_json: workout,
            created_at: new Date().toISOString(),
          }),
        });
      } catch (dbErr) {
        console.error("DB error:", dbErr.message);
      }
    }

    return res.status(200).json({ success: true, workout });

  } catch (err) {
    console.error("Handler error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};
