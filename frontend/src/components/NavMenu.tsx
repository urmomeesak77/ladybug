import { NavLink } from 'react-router-dom';

// Fixed anonymous navigation. NavLink applies aria-current="page" on the active route
// so the current location is conveyed to assistive tech, not by color alone (Principle IV).
// The Login/register destination is owned by a future auth feature; here it is a plain link.
function NavMenu() {
  return (
    <nav aria-label="Primary">
      <ul>
        <li>
          <NavLink to="/" end>
            Home
          </NavLink>
        </li>
        <li>
          <NavLink to="/login">Login/register</NavLink>
        </li>
      </ul>
    </nav>
  );
}

export default NavMenu;
