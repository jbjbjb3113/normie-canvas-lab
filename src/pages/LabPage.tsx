import { NormiesHeaderArt } from "../components/NormiesHeaderArt";
import { PixelPastePlanner } from "../components/PixelPastePlanner";
import { SiteNav } from "../components/SiteNav";
import "../App.css";

export function LabPage() {
  return (
    <div className="layout">
      <header className="header">
        <div className="header__intro">
          <h1 className="title">Normie Canvas Lab</h1>
          <p className="subtitle">
            Plan{" "}
            <a
              href="https://canvas.normies.art/"
              target="_blank"
              rel="noreferrer"
            >
              Community Canvas
            </a>{" "}
            pixels locally — paste a reference, sample to a grid, edit, export.
            Normie art data still lives on{" "}
            <a
              href="https://api.normies.art/"
              target="_blank"
              rel="noreferrer"
            >
              api.normies.art
            </a>
            .
          </p>
        </div>
        <NormiesHeaderArt tokenId={null} />
      </header>

      <SiteNav />

      <section
        className="panel paste-planner-wrap"
        aria-label="Community canvas pixel planner"
      >
        <h2 className="paste-planner__title">Community canvas — pixel planner</h2>
        <p className="paste-planner__lede">
          Paste or drop a reference image to build a <strong>1:1 grid</strong>{" "}
          you can edit here, then recreate by hand on{" "}
          <a
            href="https://canvas.normies.art/"
            target="_blank"
            rel="noreferrer"
          >
            Community Canvas
          </a>
          . Set width/height to match their grid. Export is rows of{" "}
          <code>1</code>/<code>0</code> (filled/empty).
        </p>
        <PixelPastePlanner />
      </section>
    </div>
  );
}
