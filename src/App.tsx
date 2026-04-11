import { lazy, Suspense } from "react";
import { BrowserRouter, NavLink, Route, Routes } from "react-router-dom";
import "./App.css";

const LabPage = lazy(() =>
  import("./pages/LabPage.tsx").then((m) => ({ default: m.LabPage })),
);
const GifEvolutionPage = lazy(() => import("./pages/GifEvolutionPage.tsx"));

export default function App() {
  return (
    <BrowserRouter>
      <nav className="site-nav" aria-label="Site">
        <NavLink
          className={({ isActive }) =>
            isActive ? "site-nav__link site-nav__link--active" : "site-nav__link"
          }
          end
          to="/"
        >
          Lab
        </NavLink>
        <NavLink
          className={({ isActive }) =>
            isActive ? "site-nav__link site-nav__link--active" : "site-nav__link"
          }
          to="/gif"
        >
          GIF evolution
        </NavLink>
      </nav>
      <Suspense fallback={<div className="route-fallback">Loading…</div>}>
        <Routes>
          <Route path="/" element={<LabPage />} />
          <Route path="/gif" element={<GifEvolutionPage />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
