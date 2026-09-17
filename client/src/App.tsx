import { Route, Switch, Redirect } from "wouter";
import { useEffect, useState } from "react";
import LoginPage from "./pages/Login";
import RegisterPage from "./pages/Register";
import DashboardPage from "./pages/Dashboard";
import { api, type MeResponse } from "./lib/api";

export default function App() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<MeResponse>("/api/me")
      .then(setMe)
      .catch(() => setMe(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center text-ink-500">
        Loading…
      </div>
    );
  }

  return (
    <Switch>
      <Route path="/login">
        {me ? <Redirect to="/" /> : <LoginPage onAuthed={setMe} />}
      </Route>
      <Route path="/register">
        {me ? <Redirect to="/" /> : <RegisterPage onAuthed={setMe} />}
      </Route>
      <Route>
        {me ? (
          <DashboardPage me={me} onLogout={() => setMe(null)} />
        ) : (
          <Redirect to="/login" />
        )}
      </Route>
    </Switch>
  );
}
