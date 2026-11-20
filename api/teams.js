import { neon } from '@neondatabase/serverless';

const LEADERS = [
  "PRATHEEK",
  "T AKSHATHA PAI",
  "AMINA FATHIMA",
  "PRATHVIK",
  "RACHANA",
  "AYISHA ZAHEERA S P"
];

const ALL_STUDENTS = [
  "AISHA LUBABA", "NISHITH", "KISHAN", "SANT SIDDAPPA METAGUDDA",
  "T AKSHATHA PAI", "AYISHA ZAHEERA S P", "BASAVARAJU", "LAKSHMI G D",
  "NIRIKSHA", "PRATHEEK", "SHREERAKSHA K S", "SHRIPAD",
  "ANANYA MANJUNATH HEDGE", "PRATHVIK", "YATHISH", "VIDYASHREE YALLAPPA KARAGANNI",
  "AYESHA", "JANAH TABARAK SHEIKH", "MONU R", "SIENNA DSOUZA",
  "AMINA FATHIMA", "B THRISHA SALIYAN", "HARSHASHRI", "MANISHA",
  "RACHANA", "TARUN", "ANANYA", "SHRITHAN S SHETTY",
  "POORNIMA", "KAUSHAL"
];

const LOCKED_PRATHEEK = ["NISHITH", "SANT SIDDAPPA METAGUDDA", "SHRIPAD"];

// Nov 25, 2026 11:59:00 PM IST (+05:30)
const DEADLINE_MS = new Date('2026-11-25T23:59:00+05:30').getTime();

export default async function handler(req, res) {
  const sql = neon(process.env.DATABASE_URL);

  try {
    // 1. Fetch current state from Neon
    const rows = await sql`SELECT rosters, auto_assigned FROM team_allocations WHERE id = 1`;
    let { rosters, auto_assigned } = rows[0];

    // 2. Server-side auto-assign check if past Nov 25, 11:59 PM IST
    if (Date.now() >= DEADLINE_MS && !auto_assigned) {
      const assigned = new Set(LEADERS);
      Object.values(rosters).flat().forEach(name => {
        if (name) assigned.add(name);
      });

      const remaining = ALL_STUDENTS.filter(s => !assigned.has(s));
      // Shuffle remaining students
      for (let i = remaining.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [remaining[i], remaining[j]] = [remaining[j], remaining[i]];
      }

      let idx = 0;
      for (const leader of LEADERS) {
        for (let slot = 0; slot < 4; slot++) {
          if (!rosters[leader][slot] && idx < remaining.length) {
            rosters[leader][slot] = remaining[idx++];
          }
        }
      }

      auto_assigned = true;
      await sql`
        UPDATE team_allocations
        SET rosters = ${JSON.stringify(rosters)}::jsonb,
            auto_assigned = TRUE,
            updated_at = NOW()
        WHERE id = 1
      `;
    }

    // 3. Handle GET request (sync state to clients)
    if (req.method === 'GET') {
      return res.status(200).json({ rosters, autoAssigned: auto_assigned });
    }

    // 4. Handle POST request (save updated roster)
    if (req.method === 'POST') {
      if (auto_assigned || Date.now() >= DEADLINE_MS) {
        return res.status(403).json({ error: 'Allocation window is closed and locked.' });
      }

      const incoming = req.body.rosters;
      // Enforce locked slots for PRATHEEK
      incoming["PRATHEEK"][0] = LOCKED_PRATHEEK[0];
      incoming["PRATHEEK"][1] = LOCKED_PRATHEEK[1];
      incoming["PRATHEEK"][2] = LOCKED_PRATHEEK[2];

      // Prevent duplicate assignments across teams
      const seen = new Set(LEADERS);
      for (const leader of LEADERS) {
        for (let i = 0; i < 4; i++) {
          const val = incoming[leader][i];
          if (val) {
            if (seen.has(val)) {
              return res.status(400).json({ error: `${val} is already assigned to another team.` });
            }
            seen.add(val);
          }
        }
      }

      await sql`
        UPDATE team_allocations
        SET rosters = ${JSON.stringify(incoming)}::jsonb,
            updated_at = NOW()
        WHERE id = 1
      `;

      return res.status(200).json({ rosters: incoming, autoAssigned: false });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Database sync failed' });
  }
}