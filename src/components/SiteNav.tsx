import { NavLink } from "react-router-dom";

const LINKS = [
  { to: "/", label: "Canvas lab" },
  { to: "/body", label: "Pixl bodies" },
  { to: "/gif", label: "GIF" },
  { to: "/map", label: "Edit map" },
  { to: "/3d", label: "3D" },
  { to: "/agent", label: "Agent" },
] as const;

export function SiteNav() {
  return (
    <nav className="site-nav" aria-label="Normie Canvas Lab sections">
      {LINKS.map(({ to, label }) => (
        <NavLink
          key={to}
          to={to}
          end={to === "/"}
          className={({ isActive }) =>
            isActive
              ? "site-nav__link site-nav__link--active"
              : "site-nav__link"
          }
        >
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
