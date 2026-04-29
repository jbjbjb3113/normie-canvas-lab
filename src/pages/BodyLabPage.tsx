import { NormiesHeaderArt } from "../components/NormiesHeaderArt";
import { NormieBodyLab } from "../components/NormieBodyLab";
import { SiteNav } from "../components/SiteNav";
import "../App.css";

export function BodyLabPage() {
  return (
    <div className="layout">
      <header className="header">
        <div className="header__intro">
          <h1 className="title">Pixl bodies</h1>
          <p className="subtitle">
            A <strong>pixel extension</strong> for the same 40×40 face, plus a
            matching <strong>40×40</strong> body panel (<strong>40×80</strong>{" "}
            composite): bodies as
            separate assets you could treat like <strong>outfits</strong> — collect
            different fits, swap the “look of the day,” trade them without selling
            the Normie. Fan prototype only (not affiliated, no mint).
          </p>
        </div>
        <NormiesHeaderArt tokenId={9098} />
      </header>

      <SiteNav />

      <section className="panel body-lab-panel" aria-label="Pixl bodies generator">
        <NormieBodyLab />
      </section>
    </div>
  );
}
