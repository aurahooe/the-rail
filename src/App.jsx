import { useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabase";

function nextHour() {
  const d = new Date();
  d.setMinutes(60, 0, 0);
  return d;
}

function useCountdown() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const target = nextHour();
  const ms = Math.max(0, target - now);
  const m = String(Math.floor(ms / 60000)).padStart(2, "0");
  const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, "0");
  return `${m}:${s}`;
}

export default function App() {
  const [session, setSession] = useState(null);
  const [view, setView] = useState("rail");
  const [hours, setHours] = useState([]);
  const [publicNotes, setPublicNotes] = useState([]);
  const [mine, setMine] = useState([]);
  const [authMode, setAuthMode] = useState("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMsg, setAuthMsg] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const [busy, setBusy] = useState(false);
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const remain = useCountdown();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    loadPublic();
    const ch = supabase
      .channel("live")
      .on("postgres_changes", { event: "*", schema: "public", table: "notes" }, loadPublic)
      .on("postgres_changes", { event: "*", schema: "public", table: "hourly_log" }, loadPublic)
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, []);

  useEffect(() => {
    if (!session?.user) {
      setMine([]);
      return;
    }
    (async () => {
      const { data } = await supabase.from("profiles").select("*").eq("id", session.user.id).maybeSingle();
      if (data) {
        setHandle(data.handle || "");
        setDisplayName(data.display_name || "");
      } else {
        const seed = (session.user.email || "member").split("@")[0];
        await supabase.from("profiles").insert({
          id: session.user.id,
          handle: seed.slice(0, 18),
          display_name: seed,
        });
      }
      const { data: notes } = await supabase
        .from("notes")
        .select("*")
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: false });
      setMine(notes || []);
    })();
  }, [session]);

  async function loadPublic() {
    const [{ data: h }, { data: n }] = await Promise.all([
      supabase.from("hourly_log").select("*").order("created_at", { ascending: false }).limit(12),
      supabase.from("notes").select("*").eq("is_public", true).order("created_at", { ascending: false }).limit(40),
    ]);
    setHours(h || []);
    setPublicNotes(n || []);
  }

  async function submitAuth(e) {
    e.preventDefault();
    setBusy(true);
    setAuthMsg("");
    try {
      if (authMode === "up") {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setAuthMsg("Account made. Sign in now. Confirm email if your project requires it.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        setView("desk");
      }
    } catch (err) {
      setAuthMsg(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveNote(e) {
    e.preventDefault();
    if (!session?.user || !title.trim() || !body.trim()) return;
    setBusy(true);
    const { error } = await supabase.from("notes").insert({
      user_id: session.user.id,
      title: title.trim(),
      body: body.trim(),
      is_public: isPublic,
    });
    setBusy(false);
    if (error) {
      setAuthMsg(error.message);
      return;
    }
    setTitle("");
    setBody("");
    loadPublic();
    const { data: notes } = await supabase
      .from("notes")
      .select("*")
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: false });
    setMine(notes || []);
  }

  async function togglePublic(note) {
    await supabase.from("notes").update({ is_public: !note.is_public }).eq("id", note.id);
    const { data: notes } = await supabase
      .from("notes")
      .select("*")
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: false });
    setMine(notes || []);
    loadPublic();
  }

  async function removeNote(id) {
    await supabase.from("notes").delete().eq("id", id);
    setMine((m) => m.filter((n) => n.id !== id));
    loadPublic();
  }

  async function saveProfile(e) {
    e.preventDefault();
    if (!session?.user) return;
    await supabase
      .from("profiles")
      .update({ handle: handle.trim(), display_name: displayName.trim() })
      .eq("id", session.user.id);
  }

  const currentHour = hours[0];
  const lamp = useMemo(() => {
    const h = new Date().getHours();
    if (h < 6 || h > 20) return "night";
    if (h < 11) return "morning";
    return "day";
  }, [remain]);

  return (
    <div className={`page lamp-${lamp}`}>
      <div className="grain" aria-hidden="true" />
      <header className="mast">
        <button className="mark" onClick={() => setView("rail")}>
          <span className="mark-dot" />
          The Rail
        </button>
        <nav>
          <button className={view === "rail" ? "on" : ""} onClick={() => setView("rail")}>Street</button>
          <button className={view === "hours" ? "on" : ""} onClick={() => setView("hours")}>Hours</button>
          {session ? (
            <>
              <button className={view === "desk" ? "on" : ""} onClick={() => setView("desk")}>Desk</button>
              <button onClick={() => supabase.auth.signOut()}>Leave</button>
            </>
          ) : (
            <button className={view === "door" ? "on" : ""} onClick={() => setView("door")}>Come in</button>
          )}
        </nav>
        <div className="clock">
          <em>next hour</em>
          <strong>{remain}</strong>
        </div>
      </header>

      {view === "rail" && (
        <main className="wrap">
          <section className="hero">
            <p className="kicker">A porch that keeps turning</p>
            <h1>{currentHour?.title || "The lamp is on."}</h1>
            <p className="lede">
              {currentHour?.body ||
                "Leave a note on the rail if you want the street to see it. Keep it in the drawer if you do not."}
            </p>
            <div className="hero-meta">
              <span>Hourly log lives here</span>
              <span>{publicNotes.length} public notes</span>
            </div>
          </section>
          <section className="grid">
            {publicNotes.map((n, i) => (
              <article className="card" key={n.id} style={{ animationDelay: `${i * 40}ms` }}>
                <h3>{n.title}</h3>
                <p>{n.body}</p>
                <footer>
                  <span>public</span>
                  <time>{new Date(n.created_at).toLocaleString()}</time>
                </footer>
              </article>
            ))}
            {!publicNotes.length && (
              <p className="empty">The rail is empty. Come in and pin the first note.</p>
            )}
          </section>
        </main>
      )}

      {view === "hours" && (
        <main className="wrap narrow">
          <h2 className="sec">What changed this hour</h2>
          <ol className="log">
            {hours.map((h) => (
              <li key={h.id}>
                <time>{new Date(h.created_at).toLocaleString()}</time>
                <strong>{h.title}</strong>
                <p>{h.body}</p>
              </li>
            ))}
          </ol>
        </main>
      )}

      {view === "door" && (
        <main className="wrap narrow">
          <h2 className="sec">{authMode === "up" ? "Make a key" : "Come in"}</h2>
          <form className="sheet" onSubmit={submitAuth}>
            <label>
              Email
              <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required />
            </label>
            <label>
              Password
              <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" minLength={6} required />
            </label>
            <button className="primary" disabled={busy} type="submit">
              {authMode === "up" ? "Create account" : "Sign in"}
            </button>
            <button type="button" className="ghost" onClick={() => setAuthMode(authMode === "up" ? "in" : "up")}>
              {authMode === "up" ? "Already have a key" : "Need a key"}
            </button>
            {authMsg && <p className="msg">{authMsg}</p>}
          </form>
        </main>
      )}

      {view === "desk" && session && (
        <main className="wrap desk">
          <section className="sheet">
            <h2 className="sec">Write a note</h2>
            <form onSubmit={saveNote}>
              <label>
                Title
                <input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={80} />
              </label>
              <label>
                Body
                <textarea value={body} onChange={(e) => setBody(e.target.value)} required rows={6} maxLength={2000} />
              </label>
              <label className="check">
                <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
                Put it on the public rail
              </label>
              <button className="primary" disabled={busy} type="submit">Pin it</button>
            </form>
            {authMsg && <p className="msg">{authMsg}</p>}
          </section>
          <section className="sheet">
            <h2 className="sec">Your name on the rail</h2>
            <form onSubmit={saveProfile}>
              <label>
                Display name
                <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
              </label>
              <label>
                Handle
                <input value={handle} onChange={(e) => setHandle(e.target.value)} />
              </label>
              <button className="primary" type="submit">Save</button>
            </form>
          </section>
          <section className="full">
            <h2 className="sec">Drawer</h2>
            <div className="grid">
              {mine.map((n) => (
                <article className="card" key={n.id}>
                  <h3>{n.title}</h3>
                  <p>{n.body}</p>
                  <footer>
                    <span>{n.is_public ? "On the rail" : "In the drawer"}</span>
                    <span className="row">
                      <button type="button" onClick={() => togglePublic(n)}>
                        {n.is_public ? "Hide" : "Publish"}
                      </button>
                      <button type="button" onClick={() => removeNote(n.id)}>Burn</button>
                    </span>
                  </footer>
                </article>
              ))}
            </div>
          </section>
        </main>
      )}

      <footer className="colophon">
        <p>The Rail keeps a public wall and a private drawer. Something small is written into the hour log every hour.</p>
      </footer>
    </div>
  );
}
