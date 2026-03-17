const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

const SYSTEM_PROMPT = `אתה OMNI-COACH v6.2 — סוכן אימונים מבוסס ראיות לאוכלוסייה כללית.
אתה מקבל נconst GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

const SYSTEM_PROMPT = `אתה OMNI-COACH v6.2 — סוכן אימונים מבוסס ראיות לאוכלוסייה כללית.
אתה מקבל נתוני משתמש ומייצר תוכנית אימון מותאמת אישית בעברית בלבד.
החזר JSON תקין בלבד ללא markdown.

סכמת JSON:
{
  "session_metadata": {
    "status": "APPROVED|PEAK|DELOAD|RECOVERY",
    "environment": "GYM_FULL|HOME_WITH_WEIGHTS|HOME_NO_WEIGHTS|OUTDOOR|OFFICE",
    "format": "straight_sets|circuit|superset",
    "total_estimated_time_mins": 45,
    "calculated_readiness_score": 7.5,
    "rpe_cap": 8,
    "goal": "hypertrophy",
    "block_phase": "hypertrophy|strength|peaking|deload",
    "microcycle_day": "upper|lower|full_body|push|pull|core",
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
    { "phase": "main", "label": "עיקרי", "exercises": [] },
    { "phase": "core", "label": "ליבה", "exercises": [] },
    { "phase": "cooldown", "label": "קירור", "exercises": [] }
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

    if (!GEMINI_API_KEY) {
      return res.status(500).json({ success: false, error: "GEMINI_API_KEY חסר ב-Vercel Environment Variables" });
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

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ parts: [{ text: userPrompt }] }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 4096,
            responseMimeType: "application/json",
          },
        }),
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      return res.status(500).json({ success: false, error: `Gemini שגיאה ${geminiRes.status}`, details: errText });
    }

    const geminiData = await geminiRes.json();

    if (!geminiData.candidates?.[0]?.content?.parts?.[0]?.text) {
      return res.status(500).json({ 
        success: false, 
        error: "תגובה ריקה מ-Gemini",
        details: JSON.stringify(geminiData).substring(0, 300)
      });
    }

    let raw = geminiData.candidates[0].content.parts[0].text.trim();
    raw = raw.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
    const workout = JSON.parse(raw);

    // Save to Supabase (non-fatal)
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
        console.error("DB error (non-fatal):", dbErr.message);
      }
    }

    return res.status(200).json({ success: true, workout });

  } catch (err) {
    console.error("Handler error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};
תוני משתמש ומייצר תוכנית אימון מותאמת אישית בעברית בלבד.

חוקים מוחלטים:
1. ענה בעברית בלבד
2. החזר JSON תקין בלבד — ללא טקסט נוסף, ללא markdown, ללא backticks
3. עקוב בדיוק אחרי סכמת ה-JSON הבאה
4. התאם תרגילים לציוד, פציעות, רמה וזמן
5. כלול cues מוח-שריר ונשימה לכל תרגיל
6. בחר 4-8 תרגילים בהתאם לזמן הזמין

אלגוריתם OMNI-COACH (10 שכבות):
L0: זיהוי סביבה לפי ציוד ומיקום
L1: שער בטיחות — פציעות, מנוחה 24ש, מוכנות היברידית (שינה+סטרס+תחושה)
L2: מחזוריות — MEV/MAV/MRV, פאזת בלוק, deload אוטומטי
L3: עייפות — תקציב CNS, עייפות מקומית, ימי עצימות ברצף
L4: זמן ומטבוליקה — 10%+80%+10%, יחס תרכובות לפי מטרה
L5: ציון תרגיל — 7 פקטורים, איזון דחיפה/משיכה, החלפה חכמה
L6: פרוגרסיה — Triple Progression, Stall Resolution, Myo-Reps/Rest-Pause
L7: גרף תרגיל — בדיקת שליטה, קידום/נסיגה
L8: בריאות — שינה/סטרס/תזונה/מחזור חודשי
L9: אוכלוסיות — גיל/הריון/BMI/מתחיל מוחלט

סכמת JSON מלאה (החזר רק זה):
{
  "session_metadata": {
    "status": "APPROVED|PEAK|DELOAD|RECOVERY",
    "environment": "GYM_FULL|GYM_DUMBBELL_ONLY|HOME_WITH_WEIGHTS|HOME_NO_WEIGHTS|OUTDOOR|OFFICE",
    "format": "straight_sets|circuit|superset",
    "total_estimated_time_mins": 45,
    "calculated_readiness_score": 7.5,
    "load_multiplier": 1.0,
    "rpe_cap": 8,
    "goal": "hypertrophy",
    "block_phase": "hypertrophy|strength|peaking|deload",
    "microcycle_day": "upper|lower|full_body|push|pull|core",
    "system_adjustments": ["התאמה 1", "התאמה 2"]
  },
  "phases": [
    {
      "phase": "warmup",
      "label": "חימום",
      "exercises": [
        {
          "id": "MB_001",
          "he_name": "חתול-פרה",
          "sets": 1,
          "target_reps": "60 שניות",
          "target_weight_kg": null,
          "rest_sec": 0,
          "technique_cues": ["כוון כל חוליה בנפרד"],
          "cue_muscle_mind": "הרגש את עמוד השדרה זז",
          "cue_breathing": "שאף בפרה, נשוף בחתול",
          "prescriptive_cue": "תנועה איטית ומבוקרת",
          "safety_flag": null,
          "coaching_note": null,
          "rationale": "חימום עמוד שדרה"
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
    "flags_for_review": ["דגל 1"],
    "coach_summary": "סיכום האימון למאמן בעברית"
  }
}`;

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const userData = req.body;

    const userPrompt = `צור תוכנית אימון מלאה לפי OMNI-COACH v6.2 עבור המשתמש הבא:

שם: ${userData.name || "ספורטאי"}
גיל: ${userData.age || 30} | משקל: ${userData.weight || 70}ק"ג | מין: ${userData.sex || "male"}
רמה: ${userData.level || "beginner"} | מטרה: ${userData.goal || "general_fitness"}
זמן: ${userData.available_time || 45} דקות | מיקום: ${userData.location || "gym"}
ציוד: ${userData.equipment || "bodyweight"}
פציעות: ${userData.injuries || "אין"}

מוכנות:
תחושה: ${userData.subjective_feel || 7}/10 | שינה: ${userData.sleep_hours || 7}ש | סטרס: ${userData.stress_level || 4}/10
תזונה: ${userData.nutrition_status || "adequate"} | ימים מאחרון: ${userData.days_since_workout || 1}
שרירים באחרון: ${userData.last_muscles || "רגליים"} | עצימות: ${userData.last_intensity || "moderate"}

החזר JSON בלבד.`;

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ parts: [{ text: userPrompt }] }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 4096,
            responseMimeType: "application/json",
          },
        }),
      }
    );

    const geminiData = await geminiRes.json();

    if (!geminiData.candidates?.[0]?.content?.parts?.[0]?.text) {
      console.error("Gemini error:", JSON.stringify(geminiData));
      throw new Error("תגובה ריקה מ-Gemini");
    }

    let raw = geminiData.candidates[0].content.parts[0].text.trim();
    raw = raw.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
    const workout = JSON.parse(raw);

    // Save to Supabase
    let sessionId = null;
    if (SUPABASE_URL && SUPABASE_KEY) {
      try {
        // Upsert user
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

        // Save session
        const sessRes = await fetch(`${SUPABASE_URL}/rest/v1/workout_sessions`, {
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
        const sessData = await sessRes.json();
        sessionId = sessData[0]?.id;
      } catch (dbErr) {
        console.error("DB error (non-fatal):", dbErr.message);
      }
    }

    return res.status(200).json({ success: true, workout, session_id: sessionId });
  } catch (err) {
    console.error("Handler error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
