// js/roles.js — who is on the Ozara team, and what to show as their name and role.
//
// This only controls what is DISPLAYED (name and role label). It does not give
// anyone extra permissions. To really restrict something to administrators,
// check the email in the database rules (auth.token.email) as well.

export const TEAM = {
  "johndeviscuyos@gmail.com":    { name: "John Devis M. Cuyos",    role: "Administrator" },
  "diongshanmarc@gmail.com":     { name: "Shan Marc C. Diong",     role: "Administrator" },
  "franzjodiedomingo@gmail.com": { name: "Franzjodie C. Domingo",  role: "Administrator" },
  "mjgillago0@gmail.com":        { name: "Mariel Jane A. Gillado", role: "Administrator" }
};

export function teamMember(email) {
  return TEAM[String(email || "").trim().toLowerCase()] || null;
}

function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

// Team members are always Administrator. Everyone else shows the role saved in
// the database (users/{uid}/role), or "Member".
export function roleLabel(email, savedRole) {
  const member = teamMember(email);
  if (member) return member.role;
  return savedRole ? capitalize(String(savedRole)) : "Member";
}

// Order: name saved in Settings/Profile, then the team name, then the Google
// account name, then the part of the email before the @.
export function resolveName(user, savedName) {
  if (savedName) return savedName;
  const member = teamMember(user.email);
  if (member) return member.name;
  if (user.displayName) return user.displayName;
  return user.email ? user.email.split("@")[0] : "User";
}
