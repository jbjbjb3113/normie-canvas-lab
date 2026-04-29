import { lazy, Suspense } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import "./App.css";
import { BodyLabPage } from "./pages/BodyLabPage.tsx";
import { LabPage } from "./pages/LabPage.tsx";
import { NormieAgentPage } from "./pages/NormieAgentPage.tsx";
const GifEvolutionPage = lazy(() => import("./pages/GifEvolutionPage.tsx"));
const EditMapPage = lazy(() => import("./pages/EditMapPage.tsx"));
const Normie3DPage = lazy(() => import("./pages/Normie3DPage.tsx"));

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<div className="route-fallback">Loading…</div>}>
        <Routes>
          <Route path="/" element={<LabPage />} />
          <Route path="/body" element={<BodyLabPage />} />
          <Route path="/gif" element={<GifEvolutionPage />} />
          <Route path="/map" element={<EditMapPage />} />
          <Route path="/3d" element={<Normie3DPage />} />
          <Route path="/agent" element={<NormieAgentPage />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
