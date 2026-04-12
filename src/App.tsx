import { lazy, Suspense } from "react";
import { BrowserRouter, NavLink, Route, Routes } from "react-router-dom";
import "./App.css";
import { LabPage } from "./pages/LabPage.tsx";
const GifEvolutionPage = lazy(() => import("./pages/GifEvolutionPage.tsx"));
const EditMapPage = lazy(() => import("./pages/EditMapPage.tsx"));
const Normie3DPage = lazy(() => import("./pages/Normie3DPage.tsx"));

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
        <NavLink
          className={({ isActive }) =>
            isActive ? "site-nav__link site-nav__link--active" : "site-nav__link"
          }
          to="/3d"
        >
          Normies GLB Creator
        </NavLink>
      </nav>
      <Suspense fallback={<div className="route-fallback">Loading…</div>}>
        <Routes>
          <Route path="/" element={<LabPage />} />
          <Route path="/gif" element={<GifEvolutionPage />} />
          <Route path="/map" element={<EditMapPage />} />
          <Route path="/3d" element={<Normie3DPage />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
